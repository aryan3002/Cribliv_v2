import { BadGatewayException, Injectable, ServiceUnavailableException } from "@nestjs/common";
import { SupportedCaptureLocale } from "./owner.capture.types";

interface SpeechClientConfig {
  key: string;
  region: string;
  timeoutMs: number;
}

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return Math.floor(parsed);
}

function readConfig(): SpeechClientConfig {
  return {
    key: process.env.AZURE_SPEECH_KEY?.trim() ?? "",
    region: process.env.AZURE_SPEECH_REGION?.trim() ?? "",
    timeoutMs: parsePositiveInt(process.env.AZURE_AI_TIMEOUT_MS, 8000)
  };
}

@Injectable()
export class AzureSpeechClient {
  async transcribe(input: {
    audioBuffer: Buffer;
    contentType: string;
    locale: SupportedCaptureLocale;
  }): Promise<string> {
    const config = readConfig();
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
    url.searchParams.set("language", input.locale);
    url.searchParams.set("format", "detailed");
    url.searchParams.set("profanity", "raw");

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Ocp-Apim-Subscription-Key": config.key,
          "Content-Type": input.contentType
        },
        body: new Uint8Array(input.audioBuffer),
        signal: controller.signal
      });

      const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
      if (!response.ok) {
        throw new BadGatewayException({
          code: "voice_transcription_failed",
          message: "Voice transcription provider failed"
        });
      }

      const transcript =
        (typeof payload.DisplayText === "string" ? payload.DisplayText : undefined) ??
        (typeof payload.Display === "string" ? payload.Display : undefined) ??
        (typeof payload.RecognitionStatus === "string" && payload.RecognitionStatus !== "Success"
          ? ""
          : undefined);

      if (!transcript || !transcript.trim()) {
        throw new BadGatewayException({
          code: "voice_transcription_failed",
          message: "Unable to transcribe audio"
        });
      }

      return transcript.trim();
    } catch (error) {
      if (error instanceof BadGatewayException || error instanceof ServiceUnavailableException) {
        throw error;
      }
      if (error instanceof Error && error.name === "AbortError") {
        throw new BadGatewayException({
          code: "voice_transcription_timeout",
          message: "Voice transcription timed out"
        });
      }

      throw new BadGatewayException({
        code: "voice_transcription_failed",
        message: "Voice transcription failed"
      });
    } finally {
      clearTimeout(timeout);
    }
  }
}
