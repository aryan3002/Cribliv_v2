import {
  BadGatewayException,
  Injectable,
  Logger,
  ServiceUnavailableException
} from "@nestjs/common";
import * as sdk from "microsoft-cognitiveservices-speech-sdk";
import { SupportedCaptureLocale } from "./owner.capture.types";
import { execFile } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

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
    timeoutMs: parsePositiveInt(process.env.AZURE_AI_TIMEOUT_MS, 30000)
  };
}

export interface TranscribeResult {
  text: string;
  detectedLocale: string;
}

@Injectable()
export class AzureSpeechClient {
  private readonly logger = new Logger(AzureSpeechClient.name);

  /**
   * Transcribe audio using the Azure Speech SDK with automatic language
   * detection between Hindi (hi-IN) and English (en-IN).
   *
   * Pipeline: webm/ogg/mp4 → ffmpeg → 16 kHz mono PCM WAV → Speech SDK
   * This guarantees Azure receives audio in the exact format it expects.
   */
  async transcribe(input: {
    audioBuffer: Buffer;
    contentType: string;
    locale: SupportedCaptureLocale;
  }): Promise<TranscribeResult> {
    const config = readConfig();
    if (!config.key || !config.region) {
      throw new ServiceUnavailableException({
        code: "voice_transcription_unavailable",
        message: "Azure Speech is not configured"
      });
    }

    this.logger.log(
      `Transcribe — ${input.audioBuffer.length} bytes, ${input.contentType}, locale=${input.locale}`
    );

    // ── Step 1: Convert to 16 kHz mono PCM WAV using ffmpeg ──
    const wavBuffer = await this.convertToWav(input.audioBuffer, input.contentType);
    this.logger.debug(`WAV conversion done — ${wavBuffer.length} bytes`);

    // ── Step 2: Feed WAV into Speech SDK with auto-language detection ──
    const speechConfig = sdk.SpeechConfig.fromSubscription(config.key, config.region);
    speechConfig.setProperty(
      sdk.PropertyId.SpeechServiceConnection_InitialSilenceTimeoutMs,
      "10000"
    );
    speechConfig.setProperty(sdk.PropertyId.SpeechServiceConnection_EndSilenceTimeoutMs, "3000");
    speechConfig.outputFormat = sdk.OutputFormat.Detailed;
    speechConfig.setProfanity(sdk.ProfanityOption.Raw);

    // Auto-detect between Hindi & English, biased toward the page locale
    const primary = input.locale;
    const secondary: SupportedCaptureLocale = primary === "hi-IN" ? "en-IN" : "hi-IN";
    const autoDetect = sdk.AutoDetectSourceLanguageConfig.fromLanguages([primary, secondary]);

    // Push PCM WAV into SDK
    const pushStream = sdk.AudioInputStream.createPushStream(
      sdk.AudioStreamFormat.getWaveFormatPCM(16000, 16, 1)
    );
    // Skip WAV header (44 bytes) — push raw PCM samples
    const pcmData = wavBuffer.subarray(44);
    const arrayBuf = new ArrayBuffer(pcmData.byteLength);
    new Uint8Array(arrayBuf).set(pcmData);
    pushStream.write(arrayBuf);
    pushStream.close();

    const audioConfig = sdk.AudioConfig.fromStreamInput(pushStream);
    const recognizer = sdk.SpeechRecognizer.FromConfig(speechConfig, autoDetect, audioConfig);

    return this.runContinuousRecognition(recognizer, config.timeoutMs);
  }

  // ──────────────────────────────────────────────────────────────────
  //  Audio conversion (ffmpeg)
  // ──────────────────────────────────────────────────────────────────

  private async convertToWav(audioBuffer: Buffer, contentType: string): Promise<Buffer> {
    const ext = this.mimeToExtension(contentType);
    const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const inputPath = path.join(os.tmpdir(), `cribliv-in-${id}.${ext}`);
    const outputPath = path.join(os.tmpdir(), `cribliv-out-${id}.wav`);

    try {
      fs.writeFileSync(inputPath, audioBuffer);

      await new Promise<void>((resolve, reject) => {
        execFile(
          "ffmpeg",
          [
            "-y", // overwrite output
            "-i",
            inputPath,
            "-ar",
            "16000", // 16 kHz
            "-ac",
            "1", // mono
            "-f",
            "wav", // WAV output
            outputPath
          ],
          { timeout: 15000 },
          (err, _stdout, stderr) => {
            if (err) {
              this.logger.error(`ffmpeg error: ${stderr || err.message}`);
              return reject(new Error(`Audio conversion failed: ${err.message}`));
            }
            resolve();
          }
        );
      });

      return fs.readFileSync(outputPath);
    } finally {
      try {
        fs.unlinkSync(inputPath);
      } catch {
        /* */
      }
      try {
        fs.unlinkSync(outputPath);
      } catch {
        /* */
      }
    }
  }

  private mimeToExtension(ct: string): string {
    const lower = ct.toLowerCase();
    if (lower.includes("webm")) return "webm";
    if (lower.includes("ogg")) return "ogg";
    if (lower.includes("mp4") || lower.includes("m4a")) return "mp4";
    if (lower.includes("mp3") || lower.includes("mpeg")) return "mp3";
    if (lower.includes("wav")) return "wav";
    if (lower.includes("flac")) return "flac";
    return "webm";
  }

  // ──────────────────────────────────────────────────────────────────
  //  Continuous recognition
  // ──────────────────────────────────────────────────────────────────

  private runContinuousRecognition(
    recognizer: sdk.SpeechRecognizer,
    timeoutMs: number
  ): Promise<TranscribeResult> {
    const segments: string[] = [];
    let detectedLocale = "en-IN";

    return new Promise<TranscribeResult>((resolve, reject) => {
      let settled = false;
      const settle = (fn: () => void) => {
        if (settled) return;
        settled = true;
        fn();
      };

      const timer = setTimeout(() => {
        this.logger.warn(`Timeout (${timeoutMs}ms) — ${segments.length} segment(s) so far`);
        recognizer.stopContinuousRecognitionAsync(
          () => {
            recognizer.close();
            settle(() =>
              segments.length > 0
                ? resolve({ text: segments.join(" ").trim(), detectedLocale })
                : reject(
                    new BadGatewayException({
                      code: "voice_transcription_timeout",
                      message: "Voice transcription timed out"
                    })
                  )
            );
          },
          () => {
            recognizer.close();
            settle(() =>
              reject(
                new BadGatewayException({
                  code: "voice_transcription_timeout",
                  message: "Voice transcription timed out"
                })
              )
            );
          }
        );
      }, timeoutMs);

      recognizer.recognized = (_s, e) => {
        if (e.result.reason === sdk.ResultReason.RecognizedSpeech) {
          const text = e.result.text?.trim();
          if (text) {
            segments.push(text);
            this.logger.log(`✓ "${text}"`);
            try {
              const lang = sdk.AutoDetectSourceLanguageResult.fromResult(e.result);
              if (lang?.language) {
                detectedLocale = lang.language;
                this.logger.debug(`Language=${detectedLocale}`);
              }
            } catch {
              /* */
            }
          }
        } else if (e.result.reason === sdk.ResultReason.NoMatch) {
          const d = sdk.NoMatchDetails.fromResult(e.result);
          this.logger.warn(`NoMatch — ${sdk.NoMatchReason[d.reason]}`);
        }
      };

      recognizer.canceled = (_s, e) => {
        clearTimeout(timer);
        if (e.reason === sdk.CancellationReason.Error) {
          this.logger.error(`SDK error ${e.errorCode}: ${e.errorDetails}`);
          recognizer.close();
          settle(() =>
            reject(
              new BadGatewayException({
                code: "voice_transcription_failed",
                message: `Transcription failed: ${e.errorDetails}`
              })
            )
          );
          return;
        }
        // EndOfStream
        this.logger.log(`Done — ${segments.length} segment(s), locale=${detectedLocale}`);
        recognizer.close();
        settle(() =>
          segments.length > 0
            ? resolve({ text: segments.join(" ").trim(), detectedLocale })
            : reject(
                new BadGatewayException({
                  code: "voice_transcription_failed",
                  message: "No speech detected in the recording"
                })
              )
        );
      };

      recognizer.sessionStopped = () => {
        clearTimeout(timer);
        recognizer.close();
        settle(() => {
          if (segments.length > 0) {
            resolve({ text: segments.join(" ").trim(), detectedLocale });
          }
        });
      };

      recognizer.startContinuousRecognitionAsync(
        () => this.logger.debug("Recognition started"),
        (err) => {
          clearTimeout(timer);
          recognizer.close();
          this.logger.error(`Start failed: ${err}`);
          settle(() =>
            reject(
              new BadGatewayException({
                code: "voice_transcription_failed",
                message: "Failed to start recognition"
              })
            )
          );
        }
      );
    });
  }
}
