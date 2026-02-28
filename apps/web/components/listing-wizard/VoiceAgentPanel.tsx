"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getVoiceAgentSocket, disconnectVoiceAgent } from "../../lib/voice-agent-socket";
import type {
  VoiceAgentState,
  VoiceAgentPhase,
  VoiceAgentDraft,
  ConversationTurn
} from "@cribliv/shared-types";
import "./voice-agent-panel.css";

/* ══════════════════════════════════════════════════════════════════════
 * VoiceAgentPanel  (v2 — full redesign)
 *
 * Full-duplex conversational Hindi voice agent.  Phone-call style UI
 * with a modern chat-based interface, animated orb, collapsible draft
 * card, and proper mobile support.
 * ══════════════════════════════════════════════════════════════════════ */

interface Props {
  userId: string;
  locale?: "hi-IN" | "en-IN";
  listingTypeHint?: "flat_house" | "pg";
  onComplete: (draft: VoiceAgentDraft, sessionId: string) => void;
  onManual: () => void;
}

/* ─── Phase progress config ───────────────────────────────────────── */
const PHASES: { key: VoiceAgentPhase; label: string; icon: string }[] = [
  { key: "greeting", label: "शुरूआत", icon: "👋" },
  { key: "property_type", label: "Type", icon: "🏠" },
  { key: "location", label: "Location", icon: "📍" },
  { key: "basics", label: "Basics", icon: "📋" },
  { key: "details", label: "Details", icon: "🔧" },
  { key: "amenities", label: "Facilities", icon: "✨" },
  { key: "confirmation", label: "Confirm", icon: "✅" },
  { key: "complete", label: "Done!", icon: "🎉" }
];

/* ─── State display config ────────────────────────────────────────── */
const STATE_CONFIG: Record<VoiceAgentState, { label: string; color: string }> = {
  connecting: { label: "Connect हो रहा है…", color: "#94a3b8" },
  greeting: { label: "नमस्ते!", color: "#8b5cf6" },
  listening: { label: "सुन रहे हैं… 🎤", color: "#3b82f6" },
  thinking: { label: "सोच रहे हैं…", color: "#f59e0b" },
  speaking: { label: "बोल रहे हैं… 🔊", color: "#10b981" },
  complete: { label: "पूरा हो गया! ✅", color: "#10b981" },
  error: { label: "कुछ गड़बड़ हुई", color: "#ef4444" }
};

/* ─── Draft field display labels ──────────────────────────────────── */
const DRAFT_FIELDS: { key: string; label: string; icon: string }[] = [
  { key: "listing_type", label: "Type", icon: "🏷️" },
  { key: "title", label: "Title", icon: "📝" },
  { key: "rent", label: "Rent", icon: "💰" },
  { key: "deposit", label: "Deposit", icon: "🏦" },
  { key: "location.city", label: "City", icon: "🌆" },
  { key: "location.locality", label: "Area", icon: "📍" },
  { key: "property_fields.bhk", label: "BHK", icon: "🛏️" },
  { key: "property_fields.bathrooms", label: "Baths", icon: "🚿" },
  { key: "property_fields.area_sqft", label: "Area", icon: "📐" },
  { key: "property_fields.furnishing", label: "Furnishing", icon: "🪑" },
  { key: "preferred_tenant", label: "Tenant", icon: "👤" },
  { key: "amenities", label: "Amenities", icon: "⭐" },
  { key: "pg_fields.total_beds", label: "Beds", icon: "🛏️" },
  { key: "pg_fields.room_sharing_options", label: "Sharing", icon: "👥" },
  { key: "pg_fields.food_included", label: "Food", icon: "🍽️" },
  { key: "pg_fields.attached_bathroom", label: "Bath", icon: "🚿" }
];

export function VoiceAgentPanel({ userId, locale, listingTypeHint, onComplete, onManual }: Props) {
  /* ── State ── */
  const [agentState, setAgentState] = useState<VoiceAgentState>("connecting");
  const [phase, setPhase] = useState<VoiceAgentPhase>("greeting");
  const [turns, setTurns] = useState<ConversationTurn[]>([]);
  const [currentDraft, setCurrentDraft] = useState<VoiceAgentDraft>({});
  const [fieldsCollected, setFieldsCollected] = useState<string[]>([]);
  const [fieldsRemaining, setFieldsRemaining] = useState<string[]>([]);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [micPermission, setMicPermission] = useState<"prompt" | "granted" | "denied">("prompt");
  const [textInput, setTextInput] = useState("");
  const [showDraft, setShowDraft] = useState(false);
  const [interimText, setInterimText] = useState<string | null>(null);

  /* ── Refs ── */
  const audioContextRef = useRef<AudioContext | null>(null);
  const workletNodeRef = useRef<AudioWorkletNode | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const audioPlaybackRef = useRef<AudioContext | null>(null);
  const chatEndRef = useRef<HTMLDivElement | null>(null);
  /** Currently playing audio source — tracked for barge-in cancellation */
  const activeSourceRef = useRef<AudioBufferSourceNode | null>(null);
  /** Queue of complete MP3 ArrayBuffers waiting to be played sequentially */
  const audioQueueRef = useRef<ArrayBuffer[]>([]);
  /** Whether we are currently playing through the queue */
  const isPlayingRef = useRef(false);

  /* ── Auto-scroll chat ── */
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [turns, interimText]);

  /* ── Compute phase progress ── */
  const phaseIndex = PHASES.findIndex((p) => p.key === phase);
  const progressPercent = Math.round(((phaseIndex + 1) / PHASES.length) * 100);
  const filledCount = fieldsCollected.length;

  /* ── Setup socket & mic on mount ── */
  useEffect(() => {
    let mounted = true;
    const socket = getVoiceAgentSocket(userId);

    socket.on("session_started", (data) => {
      if (!mounted) return;
      setSessionId(data.session_id);
      setPhase(data.phase);
    });

    socket.on("state_change", (data) => {
      if (!mounted) return;
      setAgentState(data.state);
    });

    socket.on("agent_text", (data) => {
      if (!mounted) return;
      setPhase(data.phase);
      setTurns((prev) => [
        ...prev,
        { role: "agent", text: data.text, timestamp: new Date().toISOString() }
      ]);
      setInterimText(null);
    });

    socket.on("user_transcript", (data) => {
      if (!mounted) return;
      if (data.is_final) {
        setTurns((prev) => [
          ...prev,
          { role: "user", text: data.text, timestamp: new Date().toISOString() }
        ]);
        setInterimText(null);
      } else {
        setInterimText(data.text);
      }
    });

    socket.on("draft_update", (data) => {
      if (!mounted) return;
      setCurrentDraft(data.draft);
      setFieldsCollected(data.fields_collected);
      setFieldsRemaining(data.fields_remaining);
    });

    socket.on("phase_change", (data) => {
      if (!mounted) return;
      setPhase(data.phase);
    });

    socket.on("session_complete", (data) => {
      if (!mounted) return;
      setAgentState("complete");
      setCurrentDraft(data.final_draft);
      setFieldsCollected(data.fields_collected);
      setFieldsRemaining(data.fields_remaining);
      setTimeout(() => {
        onComplete(data.final_draft, data.session_id);
      }, 2000);
    });

    socket.on("agent_audio", (data) => {
      if (!mounted) return;
      enqueueAudio(data);
    });

    socket.on("agent_audio_end", () => {
      // Audio end marker — queue will drain naturally
    });

    socket.on("error", (data) => {
      if (!mounted) return;
      setError(data.message);
      if (!data.recoverable) setAgentState("error");
    });

    socket.on("connect_error", (err) => {
      if (!mounted) return;
      console.error("[VoiceAgent] connect_error:", err);
      setError("Server se connect nahi ho paa raha. Retry kar rahe hain…");
    });

    socket.on("connect", () => {
      if (!mounted) return;
      console.log("[VoiceAgent] Socket connected, id:", socket.id);
      setAgentState("greeting");
    });

    // Initialize mic FIRST, then connect socket & start session.
    // This avoids the race where socket connects before mic is ready
    // and the "connect" event fires before we register the handler.
    initMicAndStartSession(socket);

    return () => {
      mounted = false;
      stopMic();
      disconnectVoiceAgent();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ── Initialize mic + AudioWorklet + start session ── */
  async function initMicAndStartSession(socket: ReturnType<typeof getVoiceAgentSocket>) {
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
      setMicPermission("granted");

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

      // Now that mic + worklet are ready, connect the socket.
      // Register the start_session handler BEFORE calling connect()
      // so we never miss the "connect" event.
      const startSession = () => {
        console.log("[VoiceAgent] Emitting start_session");
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
    } catch (err) {
      console.error("[VoiceAgent] Mic access failed:", err);
      setMicPermission("denied");
      setError("Microphone ki permission chahiye — browser settings mein allow karein.");
      setAgentState("error");
      // Still connect socket so text input works
      if (!socket.connected) socket.connect();
    }
  }

  /* ── Stop mic & audio ── */
  function stopMic() {
    workletNodeRef.current?.disconnect();
    workletNodeRef.current = null;
    audioContextRef.current?.close();
    audioContextRef.current = null;
    mediaStreamRef.current?.getTracks().forEach((t) => t.stop());
    mediaStreamRef.current = null;
    stopPlayback();
  }

  /* ── Enqueue a complete MP3 for playback ── */
  function enqueueAudio(data: ArrayBuffer) {
    audioQueueRef.current.push(data);
    if (!isPlayingRef.current) drainAudioQueue();
  }

  /** Play queued audio buffers one-by-one (no overlap) */
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
        // Resume the context — required by Chrome's autoplay policy
        if (ctx.state === "suspended") await ctx.resume();

        const decoded = await ctx.decodeAudioData(mp3.slice(0));
        await new Promise<void>((resolve) => {
          const source = ctx.createBufferSource();
          source.buffer = decoded;
          source.connect(ctx.destination);
          activeSourceRef.current = source;
          source.onended = () => {
            activeSourceRef.current = null;
            resolve();
          };
          source.start();
        });
      } catch {
        // decodeAudioData failed — skip this buffer (text-only fallback)
      }
    }

    isPlayingRef.current = false;
  }

  /** Stop any playing audio immediately (barge-in / cleanup) */
  function stopPlayback() {
    audioQueueRef.current = [];
    if (activeSourceRef.current) {
      try {
        activeSourceRef.current.stop();
      } catch {
        /* already stopped */
      }
      activeSourceRef.current = null;
    }
    isPlayingRef.current = false;
  }

  /* ── Handle text input submit ── */
  const handleTextSubmit = useCallback(() => {
    if (!textInput.trim()) return;
    const socket = getVoiceAgentSocket();
    if (socket.connected) {
      socket.emit("text_input", { text: textInput.trim() });
      setTurns((prev) => [
        ...prev,
        { role: "user", text: textInput.trim(), timestamp: new Date().toISOString() }
      ]);
      setTextInput("");
    }
  }, [textInput]);

  /* ── Handle barge-in ── */
  function handleInterrupt() {
    stopPlayback();
    const socket = getVoiceAgentSocket();
    if (socket.connected) socket.emit("interrupt");
  }

  /* ── Handle end session ── */
  function handleEndSession() {
    const socket = getVoiceAgentSocket();
    if (socket.connected) socket.emit("end_session");
    stopMic();
  }

  /* ── Get draft display value ── */
  function getDraftValue(field: string): string | null {
    if (!currentDraft) return null;
    switch (field) {
      case "listing_type":
        return currentDraft.listing_type === "pg"
          ? "PG"
          : currentDraft.listing_type === "flat_house"
            ? "Flat / House"
            : null;
      case "title":
        return currentDraft.title || null;
      case "rent":
        return currentDraft.rent ? `₹${currentDraft.rent.toLocaleString("en-IN")}` : null;
      case "deposit":
        return currentDraft.deposit ? `₹${currentDraft.deposit.toLocaleString("en-IN")}` : null;
      case "location.city":
        return currentDraft.location?.city || null;
      case "location.locality":
        return currentDraft.location?.locality || null;
      case "preferred_tenant":
        return currentDraft.preferred_tenant || null;
      case "property_fields.bhk":
        return currentDraft.property_fields?.bhk?.toString() || null;
      case "property_fields.bathrooms":
        return currentDraft.property_fields?.bathrooms?.toString() || null;
      case "property_fields.area_sqft":
        return currentDraft.property_fields?.area_sqft
          ? `${currentDraft.property_fields.area_sqft} sqft`
          : null;
      case "property_fields.furnishing":
        return currentDraft.property_fields?.furnishing?.replace(/_/g, " ") || null;
      case "amenities":
        return currentDraft.amenities?.join(", ") || null;
      case "pg_fields.total_beds":
        return currentDraft.pg_fields?.total_beds?.toString() || null;
      case "pg_fields.room_sharing_options":
        return currentDraft.pg_fields?.room_sharing_options?.join(", ") || null;
      case "pg_fields.food_included":
        return currentDraft.pg_fields?.food_included != null
          ? currentDraft.pg_fields.food_included
            ? "Haan"
            : "Nahi"
          : null;
      case "pg_fields.attached_bathroom":
        return currentDraft.pg_fields?.attached_bathroom != null
          ? currentDraft.pg_fields.attached_bathroom
            ? "Haan"
            : "Nahi"
          : null;
      default:
        return null;
    }
  }

  const activeColor = STATE_CONFIG[agentState]?.color ?? "#6366f1";
  const isActive = agentState !== "complete" && agentState !== "error";

  /* ══════════════════════════════════════════════════════════════════
   *  RENDER
   * ══════════════════════════════════════════════════════════════════ */
  return (
    <div className="va">
      {/* ── Progress bar ─────────────────────────────────────────── */}
      <div className="va-progress">
        <div className="va-progress__bar">
          <div
            className="va-progress__fill"
            style={{ width: `${progressPercent}%`, background: activeColor }}
          />
        </div>
        <div className="va-progress__steps">
          {PHASES.map((p, i) => (
            <div
              key={p.key}
              className={`va-progress__step ${i <= phaseIndex ? "va-progress__step--done" : ""} ${p.key === phase ? "va-progress__step--active" : ""}`}
            >
              <span className="va-progress__step-icon">{p.icon}</span>
              <span className="va-progress__step-label">{p.label}</span>
            </div>
          ))}
        </div>
      </div>

      {/* ── Main area ────────────────────────────────────────────── */}
      <div className="va-main">
        {/* Orb */}
        <div className="va-orb-wrap">
          <div
            className={`va-orb ${agentState === "listening" ? "va-orb--listening" : agentState === "speaking" ? "va-orb--speaking" : agentState === "thinking" ? "va-orb--thinking" : agentState === "complete" ? "va-orb--complete" : ""}`}
            style={{ "--orb-color": activeColor } as React.CSSProperties}
          >
            <div className="va-orb__inner">
              {agentState === "listening" && (
                <svg
                  width="32"
                  height="32"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="white"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <rect x="9" y="1" width="6" height="14" rx="3" />
                  <path d="M5 10a7 7 0 0 0 14 0" />
                  <line x1="12" y1="21" x2="12" y2="17" />
                </svg>
              )}
              {agentState === "speaking" && (
                <svg
                  width="32"
                  height="32"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="white"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M11 5 6 9H2v6h4l5 4V5Z" />
                  <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
                  <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
                </svg>
              )}
              {(agentState === "thinking" || agentState === "connecting") && (
                <div className="va-orb__dots">
                  <span />
                  <span />
                  <span />
                </div>
              )}
              {agentState === "complete" && <span style={{ fontSize: 28 }}>🎉</span>}
              {agentState === "error" && <span style={{ fontSize: 28 }}>⚠️</span>}
              {agentState === "greeting" && <span style={{ fontSize: 28 }}>👋</span>}
            </div>
          </div>
          <p className="va-orb__label" style={{ color: activeColor }}>
            {STATE_CONFIG[agentState]?.label}
          </p>
        </div>

        {/* Chat */}
        <div className="va-chat">
          {turns.length === 0 && (agentState === "connecting" || agentState === "greeting") && (
            <div className="va-chat__empty">
              <div className="va-chat__empty-dots">
                <span />
                <span />
                <span />
              </div>
              <p>Agent connect ho raha hai…</p>
            </div>
          )}
          {turns.map((turn, i) => (
            <div
              key={i}
              className={`va-msg ${turn.role === "agent" ? "va-msg--agent" : "va-msg--user"}`}
            >
              {turn.role === "agent" && <div className="va-msg__avatar">🤖</div>}
              <div
                className={`va-msg__bubble ${turn.role === "agent" ? "va-msg__bubble--agent" : "va-msg__bubble--user"}`}
              >
                <p>{turn.text}</p>
              </div>
              {turn.role === "user" && (
                <div className="va-msg__avatar va-msg__avatar--user">🎤</div>
              )}
            </div>
          ))}
          {interimText && (
            <div className="va-msg va-msg--user">
              <div className="va-msg__bubble va-msg__bubble--user va-msg__bubble--interim">
                <p>{interimText}</p>
              </div>
              <div className="va-msg__avatar va-msg__avatar--user">🎤</div>
            </div>
          )}
          <div ref={chatEndRef} />
        </div>
      </div>

      {/* ── Draft card ───────────────────────────────────────────── */}
      <div className={`va-draft ${showDraft ? "va-draft--open" : ""}`}>
        <button type="button" className="va-draft__toggle" onClick={() => setShowDraft(!showDraft)}>
          <span className="va-draft__toggle-icon">📋</span>
          <span className="va-draft__toggle-text">
            Listing Draft
            <span className="va-draft__badge">{filledCount}</span>
          </span>
          <svg
            className={`va-draft__chevron ${showDraft ? "va-draft__chevron--open" : ""}`}
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <path d="m6 9 6 6 6-6" />
          </svg>
        </button>
        {showDraft && (
          <div className="va-draft__body">
            <div className="va-draft__grid">
              {DRAFT_FIELDS.map(({ key, label, icon }) => {
                const value = getDraftValue(key);
                const filled = fieldsCollected.includes(key);
                if (!value && !filled) return null;
                return (
                  <div
                    key={key}
                    className={`va-draft__item ${filled ? "va-draft__item--filled" : ""}`}
                  >
                    <span className="va-draft__item-label">
                      {icon} {label}
                    </span>
                    <span className="va-draft__item-value">{value || "—"}</span>
                  </div>
                );
              })}
              {filledCount === 0 && (
                <p className="va-draft__empty">Agent se baat karein — details yahan dikhenge</p>
              )}
            </div>
          </div>
        )}
      </div>

      {/* ── Error ────────────────────────────────────────────────── */}
      {error && (
        <div className="va-error">
          <p>⚠️ {error}</p>
          <button type="button" onClick={() => setError(null)}>
            ✕
          </button>
        </div>
      )}

      {/* ── Bottom controls ──────────────────────────────────────── */}
      <div className="va-bottom">
        <div className="va-input">
          <input
            type="text"
            value={textInput}
            onChange={(e) => setTextInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleTextSubmit()}
            placeholder="Type karein agar mic kaam nahi kar raha…"
            disabled={!isActive}
          />
          <button
            type="button"
            className="va-input__send"
            onClick={handleTextSubmit}
            disabled={!textInput.trim() || !isActive}
          >
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <line x1="22" y1="2" x2="11" y2="13" />
              <polygon points="22 2 15 22 11 13 2 9 22 2" />
            </svg>
          </button>
        </div>
        <div className="va-actions">
          {agentState === "speaking" && (
            <button type="button" className="va-btn va-btn--interrupt" onClick={handleInterrupt}>
              ✋ Rokein
            </button>
          )}
          {isActive && (
            <button type="button" className="va-btn va-btn--end" onClick={handleEndSession}>
              ✅ Done — Review karein
            </button>
          )}
          <button type="button" className="va-btn va-btn--ghost" onClick={onManual}>
            ✏️ Manual form
          </button>
        </div>
      </div>

      {/* ── Mic denied ───────────────────────────────────────────── */}
      {micPermission === "denied" && (
        <div className="va-mic-denied">
          <p>🎤 Microphone permission chahiye</p>
          <p className="va-mic-denied__sub">
            Browser settings mein jaake allow karein, ya text / manual form use karein.
          </p>
        </div>
      )}
    </div>
  );
}
