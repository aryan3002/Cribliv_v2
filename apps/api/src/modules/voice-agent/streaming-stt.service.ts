import { Injectable, Logger, ServiceUnavailableException } from "@nestjs/common";
import * as sdk from "microsoft-cognitiveservices-speech-sdk";
import { EventEmitter } from "events";

/* ──────────────────────────────────────────────────────────────────────
 * StreamingSTTService
 *
 * Wraps Azure Speech SDK for real-time streaming speech-to-text.
 * Unlike the batch AzureSpeechClient used by the one-shot capture flow,
 * this service keeps a push stream open and emits interim + final
 * recognition events via an EventEmitter per session.
 *
 * Audio format expected: 16 kHz, 16-bit, mono PCM (raw, no WAV header).
 * The frontend AudioWorklet should send raw PCM chunks.
 * ──────────────────────────────────────────────────────────────────── */

interface SttConfig {
  key: string;
  region: string;
}

export interface SttSession {
  id: string;
  pushStream: sdk.PushAudioInputStream;
  recognizer: sdk.SpeechRecognizer;
  events: EventEmitter;
  closed: boolean;
}

function readSttConfig(): SttConfig {
  return {
    key: process.env.AZURE_SPEECH_KEY?.trim() ?? "",
    region: process.env.AZURE_SPEECH_REGION?.trim() ?? ""
  };
}

@Injectable()
export class StreamingSTTService {
  private readonly logger = new Logger(StreamingSTTService.name);
  private readonly sessions = new Map<string, SttSession>();

  /* ────── Create a new streaming STT session ─────────────────────── */
  createSession(sessionId: string, locale: "hi-IN" | "en-IN" = "hi-IN"): SttSession {
    const config = readSttConfig();
    if (!config.key || !config.region) {
      throw new ServiceUnavailableException({
        code: "voice_agent_stt_unavailable",
        message: "Azure Speech is not configured"
      });
    }

    const speechConfig = sdk.SpeechConfig.fromSubscription(config.key, config.region);
    speechConfig.setProperty(
      sdk.PropertyId.SpeechServiceConnection_InitialSilenceTimeoutMs,
      "15000"
    );
    // Longer end-silence for conversational flow — user may pause between thoughts
    speechConfig.setProperty(sdk.PropertyId.SpeechServiceConnection_EndSilenceTimeoutMs, "2000");
    speechConfig.outputFormat = sdk.OutputFormat.Detailed;
    speechConfig.setProfanity(sdk.ProfanityOption.Raw);

    // Auto-detect Hindi ↔ English, biased toward Hindi
    const primary = locale;
    const secondary = primary === "hi-IN" ? "en-IN" : "hi-IN";
    const autoDetect = sdk.AutoDetectSourceLanguageConfig.fromLanguages([primary, secondary]);

    // 16 kHz, 16-bit, mono PCM push stream
    const pushStream = sdk.AudioInputStream.createPushStream(
      sdk.AudioStreamFormat.getWaveFormatPCM(16000, 16, 1)
    );
    const audioConfig = sdk.AudioConfig.fromStreamInput(pushStream);
    const recognizer = sdk.SpeechRecognizer.FromConfig(speechConfig, autoDetect, audioConfig);

    const events = new EventEmitter();
    const session: SttSession = { id: sessionId, pushStream, recognizer, events, closed: false };

    // ── Wire recognition events ──
    recognizer.recognizing = (_s, e) => {
      const text = e.result.text?.trim();
      if (text) {
        events.emit("interim", { text });
      }
    };

    recognizer.recognized = (_s, e) => {
      if (e.result.reason === sdk.ResultReason.RecognizedSpeech) {
        const text = e.result.text?.trim();
        if (text) {
          let detectedLocale = locale;
          try {
            const lang = sdk.AutoDetectSourceLanguageResult.fromResult(e.result);
            if (lang?.language) detectedLocale = lang.language as "hi-IN" | "en-IN";
          } catch {
            /* */
          }

          this.logger.log(`[${sessionId}] ✓ "${text}" (${detectedLocale})`);
          events.emit("final", { text, locale: detectedLocale });
        }
      }
    };

    recognizer.canceled = (_s, e) => {
      if (e.reason === sdk.CancellationReason.Error) {
        this.logger.error(`[${sessionId}] STT error ${e.errorCode}: ${e.errorDetails}`);
        events.emit("error", { code: e.errorCode, details: e.errorDetails });
      }
    };

    recognizer.sessionStopped = () => {
      this.logger.debug(`[${sessionId}] STT session stopped`);
      events.emit("stopped");
    };

    // Start continuous recognition
    recognizer.startContinuousRecognitionAsync(
      () => this.logger.debug(`[${sessionId}] STT recognition started`),
      (err) => {
        this.logger.error(`[${sessionId}] STT start failed: ${err}`);
        events.emit("error", { code: "start_failed", details: String(err) });
      }
    );

    this.sessions.set(sessionId, session);
    return session;
  }

  /* ────── Push audio chunk into the stream ───────────────────────── */
  pushAudio(sessionId: string, pcmBuffer: ArrayBuffer): void {
    const session = this.sessions.get(sessionId);
    if (!session || session.closed) return;
    session.pushStream.write(pcmBuffer);
  }

  /* ────── Stop & cleanup ─────────────────────────────────────────── */
  async closeSession(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    session.closed = true;
    session.pushStream.close();

    await new Promise<void>((resolve) => {
      session.recognizer.stopContinuousRecognitionAsync(
        () => {
          session.recognizer.close();
          resolve();
        },
        () => {
          session.recognizer.close();
          resolve();
        }
      );
    });

    session.events.removeAllListeners();
    this.sessions.delete(sessionId);
    this.logger.log(`[${sessionId}] STT session closed`);
  }

  /* ────── Get session ────────────────────────────────────────────── */
  getSession(sessionId: string): SttSession | undefined {
    return this.sessions.get(sessionId);
  }
}
