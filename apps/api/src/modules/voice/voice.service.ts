import { Inject, Injectable, Logger, ServiceUnavailableException } from "@nestjs/common";
import { readFeatureFlags } from "../../config/feature-flags";
import { SearchService } from "../search/search.service";
import { AzureSpeechClient } from "../owner/azure-speech.client";
import type { SupportedCaptureLocale } from "../owner/owner.capture.types";

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

  constructor(
    @Inject(SearchService) private readonly searchService: SearchService,
    @Inject(AzureSpeechClient) private readonly speechClient: AzureSpeechClient
  ) {}

  /**
   * Full voice-to-search pipeline:
   *  1. Transcribe audio via Azure Speech SDK (ffmpeg → 16kHz WAV → SDK)
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
   * Transcribe audio buffer using the shared Azure Speech SDK client.
   * Uses ffmpeg → 16kHz mono WAV → Speech SDK with auto language detection
   * for Hindi (hi-IN) and English (en-IN).
   */
  async transcribe(
    audioBuffer: Buffer,
    contentType: string,
    locale: VoiceLocale
  ): Promise<VoiceTranscription> {
    try {
      const sdkResult = await this.speechClient.transcribe({
        audioBuffer,
        contentType,
        locale: locale as SupportedCaptureLocale
      });

      const detectedLocale = (
        sdkResult.detectedLocale === "hi-IN" ? "hi-IN" : "en-IN"
      ) as VoiceLocale;

      return {
        text: sdkResult.text,
        locale: detectedLocale,
        confidence: sdkResult.text.length > 0 ? 0.9 : 0,
        duration_ms: 0
      };
    } catch (error) {
      if (
        error instanceof ServiceUnavailableException ||
        (error as { status?: number })?.status === 503
      ) {
        throw error;
      }
      this.logger.error("Voice transcription failed", error);
      throw new ServiceUnavailableException({
        code: "voice_transcription_failed",
        message: "Speech transcription failed"
      });
    }
  }
}
