"use client";

import { useState, useRef, useCallback } from "react";
import { fetchApi } from "../lib/api";
import { trackEvent } from "../lib/analytics";

interface VoiceTranscription {
  text: string;
  locale: string;
  confidence: number;
  duration_ms: number;
}

interface VoiceSearchResponse {
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

type VoiceState = "idle" | "recording" | "processing" | "error";

interface VoiceSearchButtonProps {
  locale: "en" | "hi";
  sessionToken?: string;
  onResult: (result: VoiceSearchResponse) => void;
  onTranscript?: (text: string) => void;
  className?: string;
}

export function VoiceSearchButton({
  locale,
  sessionToken,
  onResult,
  onTranscript,
  className
}: VoiceSearchButtonProps) {
  const [state, setState] = useState<VoiceState>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  const startRecording = useCallback(async () => {
    setErrorMessage(null);

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          sampleRate: 16000,
          echoCancellation: true,
          noiseSuppression: true
        }
      });

      // Prefer webm/opus (widely supported), fallback to wav
      const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : "audio/webm";

      const recorder = new MediaRecorder(stream, { mimeType });
      chunksRef.current = [];

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          chunksRef.current.push(event.data);
        }
      };

      recorder.onstop = async () => {
        // Stop all tracks
        stream.getTracks().forEach((track) => track.stop());

        const audioBlob = new Blob(chunksRef.current, { type: mimeType });

        if (audioBlob.size < 1000) {
          setState("error");
          setErrorMessage("Recording too short. Please try again.");
          return;
        }

        setState("processing");
        trackEvent("voice_search_recording_complete", {
          audio_size_bytes: audioBlob.size,
          locale
        });

        try {
          const formData = new FormData();
          formData.append("audio", audioBlob, "voice-search.webm");
          formData.append("locale", locale === "hi" ? "hi-IN" : "en-IN");
          if (sessionToken) {
            formData.append("session_token", sessionToken);
          }

          const result = await fetchApi<VoiceSearchResponse>("/voice/search", {
            method: "POST",
            body: formData
          });

          trackEvent("voice_search_result", {
            transcript: result.transcription.text,
            confidence: result.transcription.confidence,
            intent: result.route_result.intent,
            source: result.route_result.source,
            duration_ms: result.transcription.duration_ms
          });

          if (onTranscript && result.transcription.text) {
            onTranscript(result.transcription.text);
          }

          onResult(result);
          setState("idle");
        } catch {
          setState("error");
          setErrorMessage("Voice search failed. Please try again or type your search.");
          trackEvent("voice_search_error", { locale });
        }
      };

      mediaRecorderRef.current = recorder;
      recorder.start(250); // Collect data every 250ms
      setState("recording");

      trackEvent("voice_search_started", { locale });

      // Auto-stop after 10 seconds
      setTimeout(() => {
        if (recorder.state === "recording") {
          recorder.stop();
        }
      }, 10000);
    } catch {
      setState("error");
      setErrorMessage("Microphone access denied. Please allow microphone permissions.");
      trackEvent("voice_search_mic_denied", { locale });
    }
  }, [locale, sessionToken, onResult, onTranscript]);

  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current?.state === "recording") {
      mediaRecorderRef.current.stop();
    }
  }, []);

  const handleClick = useCallback(() => {
    if (state === "recording") {
      stopRecording();
    } else if (state === "idle" || state === "error") {
      startRecording();
    }
    // Do nothing while processing
  }, [state, startRecording, stopRecording]);

  return (
    <div className={`voice-search-container ${className ?? ""}`}>
      <button
        type="button"
        className={`voice-search-btn voice-search-btn--${state}`}
        onClick={handleClick}
        disabled={state === "processing"}
        aria-label={
          state === "recording"
            ? "Stop recording"
            : state === "processing"
              ? "Processing voice..."
              : "Search by voice"
        }
        title={state === "recording" ? "Tap to stop" : "Search by voice"}
      >
        {state === "recording" ? (
          <MicActiveIcon />
        ) : state === "processing" ? (
          <SpinnerIcon />
        ) : (
          <MicIcon />
        )}
      </button>

      {state === "recording" && (
        <span className="voice-search-label">{locale === "hi" ? "बोलिए..." : "Listening..."}</span>
      )}

      {state === "processing" && (
        <span className="voice-search-label">
          {locale === "hi" ? "समझ रहे हैं..." : "Processing..."}
        </span>
      )}

      {errorMessage && state === "error" && (
        <span className="voice-search-error">{errorMessage}</span>
      )}
    </div>
  );
}

// ─── Icons ───────────────────────────────────────────────────────────────────

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

function MicActiveIcon() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="currentColor"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="voice-search-pulse"
    >
      <rect x="9" y="1" width="6" height="14" rx="3" />
      <path d="M5 10a7 7 0 0 0 14 0" fill="none" />
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
