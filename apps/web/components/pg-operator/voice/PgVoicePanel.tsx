"use client";
import { Dispatch, useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { X, MicOff, Mic, Keyboard } from "lucide-react";
import { createPgVoiceSocket } from "@/lib/pg-voice-socket";
import type { PgWizardAction, PgWizardState } from "@/lib/pg-wizard-state";
import PgVoiceTimer from "./PgVoiceTimer";
import PgVoiceFallbackInput from "./PgVoiceFallbackInput";
import PgVoiceMicCapture from "./PgVoiceMicCapture";
import PgChatThread, { type PgChatMessage } from "./PgChatThread";
import { handleSessionEnded } from "./handlers/handleSessionEnded";
import { handleFieldExtracted } from "./handlers/handleFieldExtracted";
import { handlePhaseChanged } from "./handlers/handlePhaseChanged";
import { terminationCopy } from "@/lib/pg-termination-copy";
import { PgPhaseRail } from "./PgPhaseRail";
import { PgFieldConfirmCard } from "./PgFieldConfirmCard";
import { usePgFieldHighlight } from "./PgFieldHighlightContext";
import type { VoiceAgentPgPhase } from "@cribliv/shared-types";

interface CoPilotCard {
  key: string;
  field: string;
  value: unknown;
  confidence: number;
}

/**
 * Assistant panel. One brain (voice-agent-pg gateway), two mouths.
 *
 * - Voice mode: mic capture + orb, audio chunks go up via the socket. Existing
 *   behaviour, untouched.
 * - Text mode: chat thread + typing input. The server (`PgLlmClient`) drives
 *   Azure OpenAI chat-completions with function-calling, executes tools
 *   internally, and emits `assistant_text` deltas plus the existing
 *   `field_extracted` events. The wizard form fills the same way.
 *
 * The mode toggle is persisted in wizard state so refreshing or stepping back
 * preserves the operator's choice.
 */
export default function PgVoicePanel({
  locale,
  userId,
  state,
  dispatch,
  orb,
  setOrb,
  onClose
}: {
  locale: string;
  /** Real operator UUID. If null (unauth or stale session) we render a gate
   *  message rather than connecting — prevents the gateway from rejecting
   *  the handshake with "invalid input syntax for type uuid". */
  userId: string | null;
  state: PgWizardState;
  dispatch: Dispatch<PgWizardAction>;
  orb: string;
  setOrb: (s: any) => void;
  onClose: () => void;
}) {
  const [startedAt] = useState(Date.now());
  const [phase, setPhase] = useState<string>("greeting");
  // Low-confidence extractions surface as confirm cards (with undo) so the
  // operator can correct the co-pilot inline.
  const [coPilotCards, setCoPilotCards] = useState<CoPilotCard[]>([]);
  const [voiceTranscript, setVoiceTranscript] = useState<string[]>([]);

  // Shared highlight channel → wizard highlights the just-filled field + offers
  // a jump to its step. Ref so the mount-only lifecycle effect never goes stale.
  const highlight = usePgFieldHighlight();
  const highlightRef = useRef(highlight);
  highlightRef.current = highlight;

  const onUndoCard = (field: string) => {
    dispatch({ type: "UNDO_LAST" });
    setCoPilotCards((c) => c.filter((x) => x.field !== field));
    highlightRef.current.setField(null);
  };
  const [chatMessages, setChatMessages] = useState<PgChatMessage[]>([]);
  const [thinking, setThinking] = useState(false);
  // Visible reason shown when a session ends for a non-user reason (idle / duration /
  // cap / disconnect). Replaces the old console.warn stub so failures aren't silent.
  const [notice, setNotice] = useState<{ title: string; body: string; tone: string } | null>(null);
  // sockRef is initialised once; ref-identity stable across renders. The
  // factory uses the latest userId argument on each call (singleton internally).
  const sockRef = useRef(createPgVoiceSocket({ userId: userId ?? "anonymous" }));
  const toast = useRef({
    show: (args: { title: string; body: string; tone: string }) => setNotice(args)
  });
  const bodyRef = useRef<HTMLDivElement>(null);

  const mode = state.assistantMode ?? "voice";

  // Latest-mode ref so the lifecycle effect's `connect` handler can pick up
  // whatever mode the user chose without re-running the lifecycle on toggle.
  const modeRef = useRef(mode);
  modeRef.current = mode;

  // Early gate: without a real operator UUID we can't open a session — the
  // gateway will reject the handshake at the DB-insert step. Render a friendly
  // message instead of letting the user trigger an error storm. See pg-voice
  // session.service.ts: operator_user_id FK to users(id) uuid.
  const hasIdentity = Boolean(userId) && /^[0-9a-f-]{36}$/i.test(userId ?? "");

  // ──────────────────────────────────────────────────────────────────────
  // Lifecycle effect (mount-only). Owns: socket connection + event listeners.
  //
  // Why empty deps: previously this had `[mode]`, which made every voice/text
  // toggle tear down the socket. In React-18 strict-mode dev that produced
  // "WebSocket is closed before the connection is established" because the
  // cleanup fired mid-handshake. The socket lifecycle should be tied to the
  // PANEL, not to the assistant mode.
  //
  // Why we don't disconnect on cleanup: the singleton socket survives panel
  // close/reopen — same pattern Maya uses. The server enforces session limits;
  // a lingering idle socket is cheap.
  // ──────────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!hasIdentity) return; // gate — see hasIdentity comment above
    const s = sockRef.current;

    // Initial start fires from inside the `connect` event so we never race
    // start_session against an in-flight handshake.
    const onConnect = () => {
      s.start({ locale: locale === "hi" ? "hi" : "en", mode: modeRef.current });
    };
    const onReady = () => setOrb(modeRef.current === "voice" ? "listening" : "idle");
    const onPhase = (ev: any) => handlePhaseChanged(ev, { setPhase });
    const onField = (ev: any) => {
      handleFieldExtracted(ev, {
        dispatch,
        onTranscriptLine: (l: string) => {
          if (modeRef.current === "voice") setVoiceTranscript((p) => [...p, l]);
          // In text mode the assistant's own text already narrates these.
        }
      });
      // Highlight the just-filled field in the wizard (shared context).
      if (ev?.field) highlightRef.current.setField(ev.field);
      // Surface low-confidence extractions as confirm cards (most recent first,
      // de-duped per field, capped).
      if (ev?.field && typeof ev.confidence === "number" && ev.confidence < 0.6) {
        setCoPilotCards((c) =>
          [
            {
              key: `${ev.field}-${Date.now()}`,
              field: ev.field,
              value: ev.value,
              confidence: ev.confidence
            },
            ...c.filter((x) => x.field !== ev.field)
          ].slice(0, 4)
        );
      }
    };
    const onAssistantThinking = () => setThinking(true);
    const onAssistantText = (ev: { text?: string }) => {
      setThinking(false);
      if (!ev?.text) return;
      setChatMessages((p) => [
        ...p,
        { id: `a-${Date.now()}-${p.length}`, role: "assistant", text: ev.text!, ts: Date.now() }
      ]);
    };
    const onToolSignal = (ev: { name?: string }) => {
      if (!ev?.name) return;
      const label =
        ev.name === "request_photo_upload"
          ? "📷 Ready for photo upload, head to the photos step"
          : ev.name === "summarize_for_confirm"
            ? "✅ Looks complete. Go ahead and review"
            : `tool: ${ev.name}`;
      setChatMessages((p) => [
        ...p,
        { id: `t-${Date.now()}-${p.length}`, role: "tool-signal", text: label, ts: Date.now() }
      ]);
    };
    const onEnded = (ev: any) => {
      handleSessionEnded(ev, { toast: toast.current });
      setOrb("ended");
      // Clean end (operator clicked "End Session") closes the panel. Abnormal ends
      // (idle / duration / cap / disconnect) keep it open so the reason banner is
      // visible instead of the panel vanishing with no explanation.
      if (terminationCopy(ev?.reason).silent) {
        onClose();
      }
    };

    s.on("connect" as any, onConnect);
    s.on("session_ready" as any, onReady);
    s.on("phase_changed" as any, onPhase);
    s.on("field_extracted" as any, onField);
    s.on("assistant_thinking" as any, onAssistantThinking);
    s.on("assistant_text" as any, onAssistantText);
    s.on("tool_signal" as any, onToolSignal);
    s.on("session_ended" as any, onEnded);

    if (!s.isConnected()) {
      s.connect();
    } else {
      // Socket already alive (panel reopened) — go straight to start_session.
      s.start({ locale: locale === "hi" ? "hi" : "en", mode: modeRef.current });
    }

    return () => {
      s.off("connect" as any, onConnect);
      s.off("session_ready" as any, onReady);
      s.off("phase_changed" as any, onPhase);
      s.off("field_extracted" as any, onField);
      s.off("assistant_thinking" as any, onAssistantThinking);
      s.off("assistant_text" as any, onAssistantText);
      s.off("tool_signal" as any, onToolSignal);
      s.off("session_ended" as any, onEnded);
      // Intentionally do NOT disconnect — see header comment.
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasIdentity]);

  // ──────────────────────────────────────────────────────────────────────
  // Mode-change effect. Owns: server session restart on toggle.
  //
  // First mount is a no-op (socket isn't connected yet — the `connect`
  // handler above sends the initial start_session). Subsequent toggles
  // restart the session on the same live socket.
  // ──────────────────────────────────────────────────────────────────────
  useEffect(() => {
    const s = sockRef.current;
    if (!s.isConnected()) return;
    s.end();
    s.start({ locale: locale === "hi" ? "hi" : "en", mode });
    // Reset visible chat state so the user sees a clean slate per mode.
    setChatMessages([]);
    setVoiceTranscript([]);
    setThinking(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  // Auto-scroll voice transcript
  useEffect(() => {
    if (bodyRef.current && mode === "voice") {
      bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
    }
  }, [voiceTranscript, mode]);

  const isLive = orb === "listening";
  const sendText = (text: string) => {
    setChatMessages((p) => [
      ...p,
      { id: `u-${Date.now()}-${p.length}`, role: "user", text, ts: Date.now() }
    ]);
    setThinking(true);
    sockRef.current.sendText(text);
  };

  return (
    <motion.aside
      role="dialog"
      aria-label="Chaya assistant"
      className="pgo-voice-sheet"
      initial={{ opacity: 0, x: 100 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 100 }}
      transition={{ type: "spring", damping: 30, stiffness: 300 }}
    >
      {!hasIdentity && (
        <div className="pgo-voice-sheet__header">
          <div className="pgo-voice-sheet__status">
            <span className="pgo-voice-sheet__phase">sign in required</span>
          </div>
          <button className="pgo-voice-sheet__close" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>
      )}
      {!hasIdentity && (
        <div className="pgo-voice-sheet__body">
          <div className="pgo-voice-sheet__empty">
            <p>Please sign in as a PG operator before opening the assistant.</p>
          </div>
        </div>
      )}
      {hasIdentity && (
        <>
          {/* Header */}
          <div className="pgo-voice-sheet__header">
            <div className="pgo-voice-sheet__status">
              <div
                className={`pgo-voice-sheet__dot ${isLive ? "pgo-voice-sheet__dot--live" : ""}`}
              />
              <span className="pgo-voice-sheet__timer">
                <PgVoiceTimer startedAt={startedAt} />
              </span>
            </div>

            {/* Mode toggle */}
            <div className="pgo-mode-toggle" role="tablist" aria-label="Assistant mode">
              <button
                role="tab"
                aria-selected={mode === "voice"}
                className={`pgo-mode-toggle__btn${mode === "voice" ? " pgo-mode-toggle__btn--active" : ""}`}
                onClick={() => dispatch({ type: "SET_ASSISTANT_MODE", mode: "voice" })}
                type="button"
              >
                <Mic size={14} /> Voice
              </button>
              <button
                role="tab"
                aria-selected={mode === "text"}
                className={`pgo-mode-toggle__btn${mode === "text" ? " pgo-mode-toggle__btn--active" : ""}`}
                onClick={() => dispatch({ type: "SET_ASSISTANT_MODE", mode: "text" })}
                type="button"
              >
                <Keyboard size={14} /> Type
              </button>
            </div>

            <button className="pgo-voice-sheet__close" onClick={onClose} aria-label="Minimize">
              <X size={18} />
            </button>
          </div>

          {/* Phase progress rail */}
          <div style={{ padding: "0 16px 8px" }}>
            <PgPhaseRail phase={phase as VoiceAgentPgPhase} />
          </div>

          {/* Low-confidence confirm cards (inline co-pilot corrections) */}
          {coPilotCards.length > 0 && (
            <div
              className="pgo-voice-sheet__cards"
              style={{ display: "flex", flexDirection: "column", gap: 8, padding: "0 16px 8px" }}
            >
              {coPilotCards.map((c) => (
                <PgFieldConfirmCard
                  key={c.key}
                  field={c.field}
                  value={c.value}
                  confidence={c.confidence}
                  onUndo={onUndoCard}
                />
              ))}
            </div>
          )}

          {/* Body */}
          <div className="pgo-voice-sheet__body" ref={bodyRef}>
            {notice ? (
              <div className="pgo-voice-sheet__empty" role="alert">
                <strong style={{ fontSize: 15 }}>{notice.title}</strong>
                <p style={{ marginTop: 8, opacity: 0.85 }}>{notice.body}</p>
                <button
                  type="button"
                  className="pgo-btn pgo-btn--secondary"
                  style={{ marginTop: 16 }}
                  onClick={() => {
                    setNotice(null);
                    onClose();
                  }}
                >
                  Close
                </button>
              </div>
            ) : mode === "voice" ? (
              <>
                <PgVoiceMicCapture
                  onChunk={(buf) => sockRef.current.sendAudio(buf)}
                  onStateChange={(s) => setOrb(s)}
                />
                {voiceTranscript.length === 0 ? (
                  <div className="pgo-voice-sheet__empty">
                    {isLive ? (
                      <>
                        <div className="pgo-waveform">
                          {[...Array(7)].map((_, i) => (
                            <div key={i} className="pgo-waveform__bar" />
                          ))}
                        </div>
                        <p style={{ marginTop: 16 }}>Listening, speak to Chaya…</p>
                      </>
                    ) : (
                      <p>Connecting to Chaya…</p>
                    )}
                  </div>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {voiceTranscript.map((line, i) => (
                      <div
                        key={i}
                        className={`pgo-bubble ${i % 2 === 0 ? "pgo-bubble--ai" : "pgo-bubble--user"}`}
                      >
                        {line}
                      </div>
                    ))}
                  </div>
                )}
              </>
            ) : (
              <PgChatThread messages={chatMessages} thinking={thinking} />
            )}
          </div>

          {/* Footer — hidden once a session has ended (reason banner shown instead) */}
          {!notice && (
            <div className="pgo-voice-sheet__footer">
              {mode === "text" ? (
                <PgVoiceFallbackInput onSend={sendText} />
              ) : (
                <PgVoiceFallbackInput onSend={(text) => sockRef.current.sendText(text)} />
              )}
              <button
                className="pgo-btn pgo-btn--danger pgo-btn--full"
                onClick={() => sockRef.current.end()}
              >
                <MicOff size={16} /> End Session
              </button>
            </div>
          )}
        </>
      )}
    </motion.aside>
  );
}
