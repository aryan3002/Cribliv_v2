import { Injectable, Logger, ServiceUnavailableException } from "@nestjs/common";
import * as sdk from "microsoft-cognitiveservices-speech-sdk";

/* ──────────────────────────────────────────────────────────────────────
 * StreamingTTSService
 *
 * Azure Speech TTS with hi-IN-SwaraNeural voice. Synthesizes Hindi text
 * to audio and returns PCM/Opus chunks that can be streamed over
 * WebSocket to the browser for playback.
 *
 * Supports SSML for natural prosody control and barge-in cancellation.
 * ──────────────────────────────────────────────────────────────────── */

interface TtsConfig {
  key: string;
  region: string;
  voiceName: string;
}

function readTtsConfig(): TtsConfig {
  return {
    key: process.env.AZURE_SPEECH_KEY?.trim() ?? "",
    region: process.env.AZURE_SPEECH_REGION?.trim() ?? "",
    voiceName: process.env.VOICE_AGENT_TTS_VOICE?.trim() || "hi-IN-SwaraNeural"
  };
}

export interface TtsSynthResult {
  audioData: ArrayBuffer;
  durationMs: number;
}

@Injectable()
export class StreamingTTSService {
  private readonly logger = new Logger(StreamingTTSService.name);

  /**
   * Active synthesizers per session — tracked so we can cancel on barge-in.
   */
  private readonly activeSynthesizers = new Map<string, sdk.SpeechSynthesizer>();

  /* ────── Synthesize text to audio ───────────────────────────────── */
  async synthesize(
    sessionId: string,
    text: string,
    options?: { rate?: string; pitch?: string }
  ): Promise<TtsSynthResult> {
    const config = readTtsConfig();
    if (!config.key || !config.region) {
      throw new ServiceUnavailableException({
        code: "voice_agent_tts_unavailable",
        message: "Azure Speech TTS is not configured"
      });
    }

    const speechConfig = sdk.SpeechConfig.fromSubscription(config.key, config.region);
    speechConfig.speechSynthesisOutputFormat =
      sdk.SpeechSynthesisOutputFormat.Audio16Khz32KBitRateMonoMp3;

    const synthesizer = new sdk.SpeechSynthesizer(speechConfig, null as unknown as sdk.AudioConfig);
    this.activeSynthesizers.set(sessionId, synthesizer);

    const ssml = this.buildSsml(text, config.voiceName, options);

    try {
      const result = await new Promise<sdk.SpeechSynthesisResult>((resolve, reject) => {
        synthesizer.speakSsmlAsync(
          ssml,
          (result) => {
            if (result.reason === sdk.ResultReason.SynthesizingAudioCompleted) {
              resolve(result);
            } else {
              const details = sdk.CancellationDetails.fromResult(result);
              this.logger.error(
                `[${sessionId}] TTS failed: ${sdk.CancellationReason[details.reason]} — ${details.errorDetails}`
              );
              reject(new Error(`TTS synthesis failed: ${details.errorDetails}`));
            }
          },
          (err) => reject(new Error(`TTS error: ${err}`))
        );
      });

      const audioData = result.audioData;
      // Approximate duration from audio size (MP3 ~32kbps = 4KB/s)
      const durationMs = Math.round((audioData.byteLength / 4000) * 1000);

      this.logger.log(`[${sessionId}] TTS done — ${audioData.byteLength} bytes, ~${durationMs}ms`);

      return { audioData, durationMs };
    } finally {
      this.activeSynthesizers.delete(sessionId);
      synthesizer.close();
    }
  }

  /* ────── Cancel active synthesis (for barge-in) ─────────────────── */
  cancelSynthesis(sessionId: string): void {
    const synth = this.activeSynthesizers.get(sessionId);
    if (synth) {
      this.logger.log(`[${sessionId}] TTS cancelled (barge-in)`);
      synth.close();
      this.activeSynthesizers.delete(sessionId);
    }
  }

  /* ────── Build SSML with natural Hindi prosody ──────────────────── */
  private buildSsml(
    text: string,
    voiceName: string,
    options?: { rate?: string; pitch?: string }
  ): string {
    const rate = options?.rate ?? "+10%"; // slightly faster for natural conversational feel
    const pitch = options?.pitch ?? "+0Hz";

    return `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis"
  xmlns:mstts="https://www.w3.org/2001/mstts" xml:lang="hi-IN">
  <voice name="${voiceName}">
    <mstts:express-as style="friendly">
      <prosody rate="${rate}" pitch="${pitch}">
        ${this.escapeXml(text)}
      </prosody>
    </mstts:express-as>
  </voice>
</speak>`;
  }

  private escapeXml(text: string): string {
    return text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&apos;");
  }
}
