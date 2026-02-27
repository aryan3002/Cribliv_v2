import { Inject, Injectable, Logger, ServiceUnavailableException } from "@nestjs/common";
import { readFeatureFlags } from "../../config/feature-flags";
import { SearchService } from "../search/search.service";

// ─── Azure Speech configuration ───────────────────────────────────────────────

interface SpeechConfig {
  key: string;
  region: string;
  timeoutMs: number;
}

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.floor(parsed);
}

function readSpeechConfig(): SpeechConfig {
  return {
    key: process.env.AZURE_SPEECH_KEY?.trim() ?? "",
    region: process.env.AZURE_SPEECH_REGION?.trim() ?? "",
    timeoutMs: parsePositiveInt(process.env.AZURE_AI_TIMEOUT_MS, 8000)
  };
}

export type VoiceLocale = "en-IN" | "hi-IN";

export interface VoiceTranscription {
  text: string;
  locale: VoiceLocale;
  confidence: number;
  duration_ms: number;
}

export interface VoiceSearchResult {
  transcription: VoiceTranscription;
  route_result: {
    intent: string;
    route: string;
    filters: Record<string, unknown>;
    clarifying_question?: {
      id: string;
      text: string;
      options: string[];
    };
    source: "ai" | "regex";
  };
}

@Injectable()
export class VoiceService {
  private readonly logger = new Logger(VoiceService.name);

  constructor(@Inject(SearchService) private readonly searchService: SearchService) {}

  /**
   * Full voice-to-search pipeline:
   *  1. Transcribe audio via Azure Speech STT
   *  2. Route transcribed text through the agentic search pipeline
   */
  async voiceSearch(
    audioBuffer: Buffer,
    contentType: string,
    locale: VoiceLocale,
    sessionToken?: string,
    userId?: string
  ): Promise<VoiceSearchResult> {
    const flags = readFeatureFlags();
    if (!flags.ff_voice_search) {
      throw new ServiceUnavailableException({
        code: "voice_search_disabled",
        message: "Voice search is not enabled"
      });
    }

    const startMs = Date.now();
    const transcription = await this.transcribe(audioBuffer, contentType, locale);
    transcription.duration_ms = Date.now() - startMs;

    // Map voice locale to search locale
    const searchLocale = locale.startsWith("hi") ? "hi" : "en";

    const routeResult = await this.searchService.routeQuery(
      transcription.text,
      searchLocale as "en" | "hi",
      undefined,
      sessionToken,
      userId
    );

    return {
      transcription,
      route_result: routeResult
    };
  }

  /**
   * Transcribe audio buffer using Azure Speech STT REST API.
   */
  async transcribe(
    audioBuffer: Buffer,
    contentType: string,
    locale: VoiceLocale
  ): Promise<VoiceTranscription> {
    const config = readSpeechConfig();
    if (!config.key || !config.region) {
      throw new ServiceUnavailableException({
        code: "voice_transcription_unavailable",
        message: "Azure Speech is not configured"
      });
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), config.timeoutMs);

    const url = new URL(
      `https://${config.region}.stt.speech.microsoft.com/speech/recognition/conversation/cognitiveservices/v1`
    );
    url.searchParams.set("language", locale);
    url.searchParams.set("format", "detailed");
    url.searchParams.set("profanity", "raw");

    try {
      const response = await fetch(url.toString(), {
        method: "POST",
        headers: {
          "Ocp-Apim-Subscription-Key": config.key,
          "Content-Type": contentType,
          Accept: "application/json"
        },
        body: new Uint8Array(audioBuffer),
        signal: controller.signal
      });

      if (!response.ok) {
        this.logger.warn(`Azure Speech returned ${response.status}`);
        throw new ServiceUnavailableException({
          code: "voice_transcription_failed",
          message: "Speech transcription provider failed"
        });
      }

      const payload = (await response.json()) as {
        RecognitionStatus?: string;
        NBest?: Array<{
          Display?: string;
          Confidence?: number;
        }>;
        DisplayText?: string;
      };

      if (payload.RecognitionStatus !== "Success") {
        return {
          text: "",
          locale,
          confidence: 0,
          duration_ms: 0
        };
      }

      const best = payload.NBest?.[0];
      return {
        text: best?.Display ?? payload.DisplayText ?? "",
        locale,
        confidence: best?.Confidence ?? 0,
        duration_ms: 0
      };
    } catch (error) {
      if (error instanceof ServiceUnavailableException) throw error;
      if (error instanceof Error && error.name === "AbortError") {
        throw new ServiceUnavailableException({
          code: "voice_transcription_timeout",
          message: "Speech transcription timed out"
        });
      }
      throw new ServiceUnavailableException({
        code: "voice_transcription_failed",
        message: "Speech transcription failed"
      });
    } finally {
      clearTimeout(timeout);
    }
  }
}
