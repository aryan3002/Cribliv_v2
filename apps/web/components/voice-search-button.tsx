"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { fetchApi } from "../lib/api";
import { trackEvent } from "../lib/analytics";
import { VoiceSearchFallback } from "./voice-search-fallback";
import type { VoiceSearchButtonProps, VoiceSearchResponse, VoiceStage } from "./voice-search-types";

export type { VoiceSearchResponse, VoiceTranscription } from "./voice-search-types";

const WAVEFORM_BARS = 7;
const SILENCE_TIMEOUT_MS = 1500;
const MAX_RECORDING_MS = 12_000;

interface SpeechRecognitionAlternative {
  readonly transcript: string;
  readonly confidence: number;
}

interface SpeechRecognitionResult {
  readonly isFinal: boolean;
  readonly length: number;
  item(index: number): SpeechRecognitionAlternative;
  [index: number]: SpeechRecognitionAlternative;
}

interface SpeechRecognitionResultList {
  readonly length: number;
  item(index: number): SpeechRecognitionResult;
  [index: number]: SpeechRecognitionResult;
}

interface SpeechRecognitionEvent extends Event {
  readonly resultIndex: number;
  readonly results: SpeechRecognitionResultList;
}

interface SpeechRecognitionErrorEvent extends Event {
  readonly error: string;
  readonly message: string;
}

interface SpeechRecognitionLike extends EventTarget {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onstart: ((this: SpeechRecognitionLike, ev: Event) => unknown) | null;
  onend: ((this: SpeechRecognitionLike, ev: Event) => unknown) | null;
  onerror: ((this: SpeechRecognitionLike, ev: SpeechRecognitionErrorEvent) => unknown) | null;
  onresult: ((this: SpeechRecognitionLike, ev: SpeechRecognitionEvent) => unknown) | null;
}

type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

declare global {
  interface Window {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  }
}

function getSpeechRecognitionCtor(): SpeechRecognitionCtor | null {
  if (typeof window === "undefined") return null;
  return window.SpeechRecognition ?? window.webkitSpeechRecognition ?? null;
}

/**
 * Streaming voice search using the browser's on-device Web Speech API.
 * Falls back to the Azure batch path (VoiceSearchFallback) when the API
 * is unavailable.
 *
 * Pipeline:
 *  1. getUserMedia → AnalyserNode for waveform + SpeechRecognition for STT
 *  2. As partials arrive, push them up via onTranscript so the input
 *     reflects the user's voice live (sub-200ms feel)
 *  3. 1.5s of silence → recognition.stop()
 *  4. POST final transcript to /search/agentic-route → onResult fires
 */
export function VoiceSearchButton(props: VoiceSearchButtonProps) {
  const [hasSpeechRecognition, setHasSpeechRecognition] = useState<boolean | null>(null);

  useEffect(() => {
    setHasSpeechRecognition(getSpeechRecognitionCtor() !== null);
  }, []);

  // Hold rendering until we know which path to use to avoid flicker.
  if (hasSpeechRecognition === null) {
    return <div className={`voice-search-container ${props.className ?? ""}`} aria-hidden="true" />;
  }

  if (!hasSpeechRecognition) {
    return <VoiceSearchFallback {...props} />;
  }

  return <StreamingVoiceButton {...props} />;
}

function StreamingVoiceButton({
  locale,
  sessionToken,
  onResult,
  onTranscript,
  onStageChange,
  className
}: VoiceSearchButtonProps) {
  const [stage, setStage] = useState<VoiceStage>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [waveform, setWaveform] = useState<number[]>(() => new Array(WAVEFORM_BARS).fill(0.2));

  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const rafRef = useRef<number | null>(null);
  const silenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const maxDurationTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const finalTranscriptRef = useRef("");
  const startedAtRef = useRef(0);
  const userStoppedRef = useRef(false);

  const updateStage = useCallback(
    (next: VoiceStage) => {
      setStage(next);
      onStageChange?.(next);
    },
    [onStageChange]
  );

  const cleanup = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    if (silenceTimerRef.current) {
      clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }
    if (maxDurationTimerRef.current) {
      clearTimeout(maxDurationTimerRef.current);
      maxDurationTimerRef.current = null;
    }
    if (analyserRef.current) {
      analyserRef.current.disconnect();
      analyserRef.current = null;
    }
    if (audioContextRef.current && audioContextRef.current.state !== "closed") {
      audioContextRef.current.close().catch(() => {});
      audioContextRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
  }, []);

  // Make sure we tear down on unmount
  useEffect(() => () => cleanup(), [cleanup]);

  const renderWaveform = useCallback(() => {
    const analyser = analyserRef.current;
    if (!analyser) return;
    const buffer = new Uint8Array(analyser.frequencyBinCount);
    analyser.getByteFrequencyData(buffer);

    // Pick WAVEFORM_BARS evenly-spaced bins; normalize 0..1.
    const step = Math.max(1, Math.floor(buffer.length / WAVEFORM_BARS));
    const next: number[] = [];
    for (let i = 0; i < WAVEFORM_BARS; i++) {
      const value = buffer[i * step] ?? 0;
      // Boost low values so quiet speech still shows movement.
      next.push(Math.min(1, Math.max(0.15, value / 200)));
    }
    setWaveform(next);
    rafRef.current = requestAnimationFrame(renderWaveform);
  }, []);

  const finishWithTranscript = useCallback(
    async (text: string) => {
      if (!text.trim()) {
        updateStage("idle");
        cleanup();
        return;
      }
      updateStage("parsing");

      try {
        const routeResult = await fetchApi<{
          intent: string;
          route: string;
          filters: Record<string, unknown>;
          clarifying_question?: {
            id: string;
            text: string;
            options: string[];
          };
          source?: "ai" | "regex";
        }>("/search/agentic-route", {
          method: "POST",
          body: JSON.stringify({ query: text, locale })
        });

        updateStage("searching");

        const result: VoiceSearchResponse = {
          transcription: {
            text,
            locale: locale === "hi" ? "hi-IN" : "en-IN",
            confidence: 0.9,
            duration_ms: Date.now() - startedAtRef.current
          },
          route_result: {
            intent: routeResult.intent,
            route: routeResult.route,
            filters: routeResult.filters ?? {},
            clarifying_question: routeResult.clarifying_question,
            source: routeResult.source ?? "ai"
          }
        };

        trackEvent("voice_search_result", {
          transcript: text,
          confidence: 0.9,
          intent: result.route_result.intent,
          source: result.route_result.source,
          duration_ms: result.transcription.duration_ms,
          path: "web_speech"
        });

        onResult(result);
        updateStage("idle");
      } catch (err) {
        updateStage("error");
        const msg =
          err instanceof Error && err.message ? err.message : "Could not parse your voice query.";
        setErrorMessage(msg);
        trackEvent("voice_search_error", { locale, error: msg, path: "web_speech" });
      } finally {
        cleanup();
      }
    },
    [cleanup, locale, onResult, updateStage]
  );

  const start = useCallback(async () => {
    setErrorMessage(null);
    finalTranscriptRef.current = "";
    userStoppedRef.current = false;
    startedAtRef.current = Date.now();

    const Ctor = getSpeechRecognitionCtor();
    if (!Ctor) {
      updateStage("error");
      setErrorMessage("Voice search not supported in this browser.");
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      const AudioCtor =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtor) {
        // No analyser available — proceed without waveform.
        streamRef.current = stream;
      } else {
        const audioContext = new AudioCtor();
        audioContextRef.current = audioContext;
        const source = audioContext.createMediaStreamSource(stream);
        const analyser = audioContext.createAnalyser();
        analyser.fftSize = 256;
        analyser.smoothingTimeConstant = 0.6;
        source.connect(analyser);
        analyserRef.current = analyser;
        rafRef.current = requestAnimationFrame(renderWaveform);
      }
    } catch {
      updateStage("error");
      setErrorMessage("Microphone access denied. Please allow microphone permissions.");
      trackEvent("voice_search_mic_denied", { locale });
      return;
    }

    const recognition = new Ctor();
    recognition.lang = locale === "hi" ? "hi-IN" : "en-IN";
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;

    recognition.onstart = () => {
      updateStage("listening");
      trackEvent("voice_search_started", { locale, path: "web_speech" });
    };

    recognition.onerror = (event) => {
      // "no-speech" and "aborted" are common when the user just stops; don't surface them as errors.
      if (event.error === "no-speech" || event.error === "aborted") {
        return;
      }
      updateStage("error");
      const msg =
        event.error === "not-allowed"
          ? "Microphone access denied. Please allow microphone permissions."
          : `Voice error: ${event.error}`;
      setErrorMessage(msg);
      trackEvent("voice_search_error", { locale, error: event.error, path: "web_speech" });
      cleanup();
    };

    recognition.onresult = (event) => {
      let interim = "";
      let finalText = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        const transcript = result[0].transcript;
        if (result.isFinal) {
          finalText += transcript;
        } else {
          interim += transcript;
        }
      }

      if (finalText) {
        finalTranscriptRef.current = (finalTranscriptRef.current + " " + finalText).trim();
      }

      const liveText = (finalTranscriptRef.current + " " + interim).trim();
      if (liveText) onTranscript?.(liveText);

      // Reset silence timer on every voice activity
      if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = setTimeout(() => {
        userStoppedRef.current = true;
        try {
          recognition.stop();
        } catch {
          /* ignore */
        }
      }, SILENCE_TIMEOUT_MS);
    };

    recognition.onend = async () => {
      // Move into transcribing state momentarily so the stage strip ticks.
      updateStage("transcribing");
      const text = finalTranscriptRef.current.trim();
      if (!text) {
        // No final transcript captured (e.g. user said nothing); reset cleanly.
        updateStage("idle");
        cleanup();
        return;
      }
      await finishWithTranscript(text);
    };

    recognitionRef.current = recognition;
    try {
      recognition.start();
    } catch {
      updateStage("error");
      setErrorMessage("Voice search could not start.");
      cleanup();
      return;
    }

    maxDurationTimerRef.current = setTimeout(() => {
      userStoppedRef.current = true;
      try {
        recognition.stop();
      } catch {
        /* ignore */
      }
    }, MAX_RECORDING_MS);
  }, [cleanup, finishWithTranscript, locale, onTranscript, renderWaveform, updateStage]);

  const stop = useCallback(() => {
    userStoppedRef.current = true;
    try {
      recognitionRef.current?.stop();
    } catch {
      /* ignore */
    }
  }, []);

  const handleClick = useCallback(() => {
    if (stage === "listening") {
      stop();
    } else if (stage === "idle" || stage === "error") {
      start();
    }
  }, [stage, start, stop]);

  const isActive = stage === "listening";
  const isBusy = stage === "transcribing" || stage === "parsing" || stage === "searching";

  return (
    <div
      className={`voice-search-container ${className ?? ""}`}
      role="region"
      aria-label="Voice search"
    >
      <button
        type="button"
        className={`voice-search-btn voice-search-btn--${stage}`}
        onClick={handleClick}
        disabled={isBusy}
        aria-label={
          isActive
            ? "Stop recording"
            : isBusy
              ? "Processing voice"
              : stage === "error"
                ? "Retry voice search"
                : "Search by voice"
        }
        title={isActive ? "Tap to stop" : "Search by voice"}
      >
        {isActive ? <Waveform values={waveform} /> : isBusy ? <SpinnerIcon /> : <MicIcon />}
      </button>

      <div className="voice-search-feedback" aria-live="polite">
        {errorMessage && stage === "error" ? (
          <span className="voice-search-error">
            {errorMessage}{" "}
            <button type="button" className="voice-search-retry" onClick={handleClick}>
              Try again
            </button>
          </span>
        ) : null}
      </div>
    </div>
  );
}

function Waveform({ values }: { values: number[] }) {
  return (
    <div className="voice-waveform" aria-hidden="true">
      {values.map((v, i) => (
        <span key={i} className="voice-waveform__bar" style={{ transform: `scaleY(${v})` }} />
      ))}
    </div>
  );
}

function MicIcon() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="9" y="1" width="6" height="14" rx="3" />
      <path d="M5 10a7 7 0 0 0 14 0" />
      <line x1="12" y1="21" x2="12" y2="17" />
      <line x1="8" y1="21" x2="16" y2="21" />
    </svg>
  );
}

function SpinnerIcon() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      aria-hidden="true"
      className="voice-search-spinner"
    >
      <circle cx="12" cy="12" r="10" strokeDasharray="60" strokeDashoffset="20" />
    </svg>
  );
}
