"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getVoiceAgentSocket, disconnectVoiceAgent } from "../../lib/voice-agent-socket";
import type { VoiceAgentState, VoiceAgentPhase, VoiceAgentDraft } from "@cribliv/shared-types";
import "./voice-agent-inline.css";

/* ══════════════════════════════════════════════════════════════════════
 * VoiceAgentInline
 *
 * Headless voice agent that integrates directly into the manual form
 * wizard. Instead of a full-page conversational UI, it exposes:
 *
 *   1. A compact status bar (waveform + state label) to slot between
 *      the step indicator and the form body.
 *   2. A mic toggle button for the page header.
 *   3. Callbacks that fire on every draft_update and phase_change so
 *      the parent page can fill form fields live with animations.
 *
 * Audio playback (agent speaks) still works — user hears the Hindi
 * voice while watching their form fill itself.
 * ══════════════════════════════════════════════════════════════════════ */

/* ─── Phase → wizard step mapping ─────────────────────────────────── */
const PHASE_TO_STEP: Partial<Record<VoiceAgentPhase, number>> = {
  greeting: 0,
  property_type: 0,
  basics: 0,
  location: 1,
  details: 2,
  amenities: 2,
  confirmation: 3,
  complete: 5
};

/* ─── State display config ────────────────────────────────────────── */
const STATE_LABELS: Record<VoiceAgentState, string> = {
  connecting: "Agent connect हो रहा है…",
  greeting: "नमस्ते! Boliye…",
  listening: "सुन रहे हैं… 🎤",
  thinking: "सोच रहे हैं…",
  speaking: "बोल रहे हैं… 🔊",
  complete: "पूरा हो गया! ✅",
  error: "कुछ गड़बड़ हुई"
};

/* ═════════════════════════════════════════════════════════════════════ */

export interface VoiceAgentInlineProps {
  userId: string;
  locale?: "hi-IN" | "en-IN";
  listingTypeHint?: "flat_house" | "pg";
  /** Called every time the AI extracts / updates fields */
  onDraftUpdate: (draft: VoiceAgentDraft, fieldsCollected: string[]) => void;
  /** Called when the conversation phase advances */
  onPhaseChange: (phase: VoiceAgentPhase, suggestedStep: number) => void;
  /** Called when the session completes with the final draft */
  onComplete: (draft: VoiceAgentDraft, sessionId: string) => void;
  /** Called when the agent encounters a non-recoverable error */
  onError?: (message: string) => void;
}

export function VoiceAgentInline({
  userId,
  locale,
  listingTypeHint,
  onDraftUpdate,
  onPhaseChange,
  onComplete,
  onError
}: VoiceAgentInlineProps) {
  /* ── State ── */
  const [agentState, setAgentState] = useState<VoiceAgentState>("connecting");
  const [textInput, setTextInput] = useState("");
  const [showTextInput, setShowTextInput] = useState(false);
  const [micDenied, setMicDenied] = useState(false);

  /* ── Refs ── */
  const audioContextRef = useRef<AudioContext | null>(null);
  const workletNodeRef = useRef<AudioWorkletNode | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const audioPlaybackRef = useRef<AudioContext | null>(null);
  const activeSourceRef = useRef<AudioBufferSourceNode | null>(null);
  const audioQueueRef = useRef<ArrayBuffer[]>([]);
  const isPlayingRef = useRef(false);
  const mountedRef = useRef(true);

  /* ── Setup socket on mount ── */
  useEffect(() => {
    mountedRef.current = true;
    const socket = getVoiceAgentSocket(userId);

    socket.on("session_started", (data) => {
      if (!mountedRef.current) return;
      // session started — greeting phase
      void data; // sessionId tracked internally
    });

    socket.on("state_change", (data) => {
      if (!mountedRef.current) return;
      setAgentState(data.state);
    });

    socket.on("agent_text", () => {
      // Agent text is for reference — no chat panel to show it
    });

    socket.on("user_transcript", () => {
      // No visible transcript — forms fills are the feedback
    });

    socket.on("draft_update", (data) => {
      if (!mountedRef.current) return;
      onDraftUpdate(data.draft, data.fields_collected);
    });

    socket.on("phase_change", (data) => {
      if (!mountedRef.current) return;
      const step = PHASE_TO_STEP[data.phase] ?? 0;
      onPhaseChange(data.phase, step);
    });

    socket.on("session_complete", (data) => {
      if (!mountedRef.current) return;
      setAgentState("complete");
      onComplete(data.final_draft, data.session_id);
    });

    socket.on("agent_audio", (data) => {
      if (!mountedRef.current) return;
      enqueueAudio(data);
    });

    socket.on("agent_audio_end", () => {
      // Marker — queue drains naturally
    });

    socket.on("error", (data) => {
      if (!mountedRef.current) return;
      if (!data.recoverable) {
        setAgentState("error");
        onError?.(data.message);
      }
    });

    socket.on("connect_error", (err) => {
      if (!mountedRef.current) return;
      console.error("[VoiceAgentInline] connect_error:", err);
      onError?.("Server se connect nahi ho paa raha. Retry kar rahe hain…");
    });

    socket.on("connect", () => {
      if (!mountedRef.current) return;
      setAgentState("greeting");
    });

    initMicAndStart(socket);

    return () => {
      mountedRef.current = false;
      cleanupAll();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ── Mic + AudioWorklet + start session ── */
  async function initMicAndStart(socket: ReturnType<typeof getVoiceAgentSocket>) {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          sampleRate: 16000,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        }
      });
      mediaStreamRef.current = stream;

      const audioCtx = new AudioContext({ sampleRate: 16000 });
      audioContextRef.current = audioCtx;
      await audioCtx.audioWorklet.addModule("/audio-capture-processor.js");

      const source = audioCtx.createMediaStreamSource(stream);
      const workletNode = new AudioWorkletNode(audioCtx, "audio-capture-processor");
      workletNodeRef.current = workletNode;

      workletNode.port.onmessage = (event) => {
        if (socket.connected) socket.emit("audio_chunk", event.data);
      };

      source.connect(workletNode);
      workletNode.connect(audioCtx.destination);

      const startSession = () => {
        socket.emit("start_session", {
          locale: locale ?? "hi-IN",
          listing_type_hint: listingTypeHint
        });
      };

      if (socket.connected) {
        startSession();
      } else {
        socket.once("connect", startSession);
        socket.connect();
      }
    } catch {
      setMicDenied(true);
      setShowTextInput(true); // text fallback auto-opens
      if (!socket.connected) socket.connect();
      // Still emit start_session for text-only mode
      socket.once("connect", () => {
        socket.emit("start_session", {
          locale: locale ?? "hi-IN",
          listing_type_hint: listingTypeHint
        });
      });
    }
  }

  /* ── Audio playback queue ── */
  function enqueueAudio(data: ArrayBuffer) {
    audioQueueRef.current.push(data);
    if (!isPlayingRef.current) drainAudioQueue();
  }

  async function drainAudioQueue() {
    if (isPlayingRef.current) return;
    isPlayingRef.current = true;

    while (audioQueueRef.current.length > 0) {
      const mp3 = audioQueueRef.current.shift()!;
      try {
        if (!audioPlaybackRef.current || audioPlaybackRef.current.state === "closed") {
          audioPlaybackRef.current = new AudioContext();
        }
        const ctx = audioPlaybackRef.current;
        if (ctx.state === "suspended") await ctx.resume();

        const decoded = await ctx.decodeAudioData(mp3.slice(0));
        await new Promise<void>((resolve) => {
          const src = ctx.createBufferSource();
          src.buffer = decoded;
          src.connect(ctx.destination);
          activeSourceRef.current = src;
          src.onended = () => {
            activeSourceRef.current = null;
            resolve();
          };
          src.start();
        });
      } catch {
        // skip undecodable buffer
      }
    }
    isPlayingRef.current = false;
  }

  function stopPlayback() {
    audioQueueRef.current = [];
    if (activeSourceRef.current) {
      try {
        activeSourceRef.current.stop();
      } catch {
        /* ok */
      }
      activeSourceRef.current = null;
    }
    isPlayingRef.current = false;
  }

  /* ── Cleanup ── */
  function cleanupAll() {
    workletNodeRef.current?.disconnect();
    workletNodeRef.current = null;
    audioContextRef.current?.close();
    audioContextRef.current = null;
    mediaStreamRef.current?.getTracks().forEach((t) => t.stop());
    mediaStreamRef.current = null;
    stopPlayback();
    disconnectVoiceAgent();
  }

  /* ── Text submit ── */
  const handleTextSubmit = useCallback(() => {
    if (!textInput.trim()) return;
    const socket = getVoiceAgentSocket();
    if (socket.connected) {
      socket.emit("text_input", { text: textInput.trim() });
      setTextInput("");
    }
  }, [textInput]);

  /* ── Barge-in ── */
  function handleInterrupt() {
    stopPlayback();
    const socket = getVoiceAgentSocket();
    if (socket.connected) socket.emit("interrupt");
  }

  /* ── End session ── */
  function handleEndSession() {
    const socket = getVoiceAgentSocket();
    if (socket.connected) socket.emit("end_session");
    cleanupAll();
  }

  /* ── Determine bar modifier class ── */
  const barClass =
    agentState === "listening"
      ? "vai-bar--listening"
      : agentState === "speaking"
        ? "vai-bar--speaking"
        : agentState === "thinking"
          ? "vai-bar--thinking"
          : "";

  const isActive = agentState !== "complete" && agentState !== "error";

  /* ══════════════════════════════════════════════════════════════════
   *  RENDER — compact status bar
   * ══════════════════════════════════════════════════════════════════ */
  return (
    <div>
      {/* Status bar */}
      <div className={`vai-bar ${barClass}`}>
        {/* Waveform */}
        <div className="vai-wave">
          <span className="vai-wave__bar" />
          <span className="vai-wave__bar" />
          <span className="vai-wave__bar" />
          <span className="vai-wave__bar" />
          <span className="vai-wave__bar" />
        </div>

        {/* State label */}
        <span className="vai-label">{STATE_LABELS[agentState]}</span>

        {/* Interrupt button (while speaking) */}
        {agentState === "speaking" && (
          <button type="button" className="vai-bar__btn" onClick={handleInterrupt}>
            ✋ Rokein
          </button>
        )}

        {/* Text fallback toggle */}
        {isActive && (
          <button
            type="button"
            className="vai-bar__btn"
            onClick={() => setShowTextInput((v) => !v)}
            title="Type instead of speaking"
          >
            ⌨️
          </button>
        )}

        {/* Stop / Done */}
        {isActive && (
          <button
            type="button"
            className="vai-bar__btn vai-bar__btn--stop"
            onClick={handleEndSession}
          >
            ✅ Done
          </button>
        )}
      </div>

      {/* Text input fallback */}
      {showTextInput && isActive && (
        <div className="vai-text-input">
          <input
            type="text"
            value={textInput}
            onChange={(e) => setTextInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleTextSubmit()}
            placeholder="Hindi mein type karein…"
          />
          <button type="button" onClick={handleTextSubmit} disabled={!textInput.trim()}>
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <line x1="22" y1="2" x2="11" y2="13" />
              <polygon points="22 2 15 22 11 13 2 9 22 2" />
            </svg>
          </button>
        </div>
      )}

      {/* Mic denied notice */}
      {micDenied && (
        <p className="vai-mic-denied">
          🎤 Mic permission denied — type karein ya browser settings mein mic allow karein.
        </p>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════
 * Mic Toggle Button — rendered in the page header
 * ═══════════════════════════════════════════════════════════════════ */

export function VoiceMicButton({ active, onClick }: { active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      className={`vai-mic-btn ${active ? "vai-mic-btn--active" : ""}`}
      onClick={onClick}
      title={active ? "Voice agent band karein" : "Voice agent se form bharein"}
    >
      {active ? (
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <line x1="1" y1="1" x2="23" y2="23" />
          <path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6" />
          <path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2c0 .76-.13 1.49-.35 2.17" />
          <line x1="12" y1="19" x2="12" y2="23" />
          <line x1="8" y1="23" x2="16" y2="23" />
        </svg>
      ) : (
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <rect x="9" y="1" width="6" height="14" rx="3" />
          <path d="M5 10a7 7 0 0 0 14 0" />
          <line x1="12" y1="21" x2="12" y2="17" />
          <line x1="8" y1="21" x2="16" y2="21" />
        </svg>
      )}
      <span className="vai-mic-btn__text">{active ? "Stop Voice" : "🎤 Voice Fill"}</span>
    </button>
  );
}
