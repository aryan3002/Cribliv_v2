"use client";

import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { Route } from "next";
import type { VoiceAgentPgPhase } from "@cribliv/shared-types";
import { pgWizardReducer, initialPgWizardState } from "@/lib/pg-wizard-state";
import { sanitizePartialDraft, draftToPayload } from "@/lib/pg-wizard-sanitizer";
import { putPgDraft } from "@/lib/pg-operator-api";
import { trackPgFunnel, setPgFunnelToken } from "@/lib/pg-funnel";
import { createPgVoiceSocket, setPgVoiceToken } from "@/lib/pg-voice-socket";
import {
  handleFieldExtracted,
  type FieldExtractedEvent
} from "@/components/pg-operator/voice/handlers/handleFieldExtracted";
import {
  handlePhaseChanged,
  type PhaseChangedEvent
} from "@/components/pg-operator/voice/handlers/handlePhaseChanged";
import PgChatThread, { type PgChatMessage } from "@/components/pg-operator/voice/PgChatThread";
import PgVoiceMicCapture from "@/components/pg-operator/voice/PgVoiceMicCapture";
import PgVoiceFallbackInput from "@/components/pg-operator/voice/PgVoiceFallbackInput";
import { PgPhaseRail } from "@/components/pg-operator/voice/PgPhaseRail";
import { PgFieldConfirmCard } from "@/components/pg-operator/voice/PgFieldConfirmCard";
import PgScoreMeter from "@/components/pg-operator/wizard/shared/PgScoreMeter";

interface Props {
  userId: string;
  accessToken: string | null;
  locale: "en" | "hi";
}

interface ConfirmCard {
  key: string;
  field: string;
  value: unknown;
  confidence: number;
}

let msgSeq = 0;

/**
 * Voice-first PG listing surface. Owns the SAME pgWizardReducer as the manual
 * wizard (so the draft is identical + resumable), consumes the shipped
 * voice-agent-pg gateway events, and on completion hands off into the manual
 * wizard's Review step (?draft=&step=review) for confirm + submit.
 */
export default function PgVoiceListingFlow({ userId, accessToken, locale }: Props) {
  const router = useRouter();
  const [state, dispatch] = useReducer(pgWizardReducer, undefined, initialPgWizardState);
  const [phase, setPhase] = useState<VoiceAgentPgPhase>("greeting");
  const [ready, setReady] = useState(false);
  const [thinking, setThinking] = useState(false);
  const [mode, setMode] = useState<"voice" | "text">("voice");
  const [messages, setMessages] = useState<PgChatMessage[]>([]);
  const [cards, setCards] = useState<ConfirmCard[]>([]);
  const [ended, setEnded] = useState(false);
  const socketRef = useRef<ReturnType<typeof createPgVoiceSocket> | null>(null);

  const addMessage = useCallback((role: PgChatMessage["role"], text: string) => {
    setMessages((m) => [...m, { id: `m-${msgSeq++}`, role, text, ts: Date.now() }]);
  }, []);

  // Register the access token so voice funnel events authenticate, and so the
  // voice socket handshake is verified server-side (SEC-C2).
  useEffect(() => {
    setPgFunnelToken(accessToken);
    setPgVoiceToken(accessToken);
  }, [accessToken]);

  // Socket lifecycle. Singleton handle (per PgVoicePanel convention) — we detach
  // our listeners on cleanup but do NOT disconnect the shared socket.
  useEffect(() => {
    const socket = createPgVoiceSocket({ userId });
    socketRef.current = socket;

    const onReady = () => {
      setReady(true);
      void trackPgFunnel({ event_type: "wizard_started", source: "voice" });
    };
    const onField = (ev: FieldExtractedEvent) => {
      handleFieldExtracted(ev, { dispatch, onTranscriptLine: (l) => addMessage("system", l) });
      setCards((c) =>
        [
          {
            key: `${ev.field}-${Date.now()}`,
            field: ev.field,
            value: ev.value,
            confidence: ev.confidence
          },
          ...c.filter((x) => x.field !== ev.field)
        ].slice(0, 6)
      );
      if (ev.field === "property.lat" || ev.field === "property.formatted_address") {
        void trackPgFunnel({
          event_type: "geocode_resolved",
          source: "voice",
          step_no: 2,
          draft_id: state.draftId
        });
      }
    };
    const onPhase = (ev: PhaseChangedEvent) =>
      handlePhaseChanged(ev, { setPhase: (p: string) => setPhase(p as VoiceAgentPgPhase) });
    const onTool = (ev: { tool: string }) => {
      if (ev?.tool === "request_photo_upload")
        addMessage("tool-signal", "Please add at least 4 photos.");
    };
    const onThinking = () => setThinking(true);
    const onAssistant = (ev: { text: string }) => {
      setThinking(false);
      if (ev?.text) addMessage("assistant", ev.text);
    };
    const onEnded = () => setEnded(true);

    socket.on("session_ready", onReady);
    socket.on("field_extracted", onField);
    socket.on("phase_changed", onPhase);
    socket.on("tool_signal", onTool);
    socket.on("assistant_thinking", onThinking);
    socket.on("assistant_text", onAssistant);
    socket.on("session_ended", onEnded);
    socket.connect();
    socket.start({ locale, mode: "voice" });

    return () => {
      socket.off("session_ready", onReady);
      socket.off("field_extracted", onField);
      socket.off("phase_changed", onPhase);
      socket.off("tool_signal", onTool);
      socket.off("assistant_thinking", onThinking);
      socket.off("assistant_text", onAssistant);
      socket.off("session_ended", onEnded);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, locale]);

  // Debounced autosave (source: "voice"), so a dropped session resumes.
  const saveTimer = useRef<ReturnType<typeof setTimeout>>();
  useEffect(() => {
    if (!accessToken) return;
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      try {
        const payload = sanitizePartialDraft(state.draft);
        if (!payload.property?.display_name) return;
        const res = await putPgDraft(accessToken, {
          draft_id: state.draftId,
          payload: draftToPayload(payload),
          source: "voice"
        });
        if (!state.draftId) dispatch({ type: "SET_DRAFT_ID", draftId: res.draft_id });
        void trackPgFunnel({ event_type: "draft_saved", source: "voice", draft_id: res.draft_id });
      } catch {
        /* offline tolerated */
      }
    }, 1500);
    return () => clearTimeout(saveTimer.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.draft, accessToken]);

  const goToReview = useCallback(() => {
    void trackPgFunnel({
      event_type: "step_completed",
      source: "voice",
      step_no: 7,
      draft_id: state.draftId,
      metadata: { phase: "review" }
    });
    const q = new URLSearchParams({ step: "review" });
    if (state.draftId) q.set("draft", state.draftId);
    router.push(`/${locale}/pg-operator/listings/new?${q.toString()}` as Route);
  }, [router, locale, state.draftId]);

  const onUndo = useCallback((field: string) => {
    dispatch({ type: "UNDO_LAST" });
    setCards((c) => c.filter((x) => x.field !== field));
  }, []);

  const sendText = useCallback(
    (text: string) => {
      addMessage("user", text);
      socketRef.current?.sendText(text);
    },
    [addMessage]
  );

  const signals = {
    verification_status: "unverified" as const,
    has_exact_geo: state.draft.property?.lat != null,
    photo_count: state.pendingPhotos.length
  };

  return (
    <div
      className="pgo-voice-flow"
      style={{ minHeight: "100vh", display: "flex", flexDirection: "column", gap: 16, padding: 20 }}
    >
      <header style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <h1 className="pgo-h1" style={{ fontSize: 20 }}>
          List your PG by voice
        </h1>
        <PgPhaseRail phase={phase} />
      </header>

      <div
        style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) 320px", gap: 16, flex: 1 }}
      >
        <section style={{ display: "flex", flexDirection: "column", gap: 12, minWidth: 0 }}>
          <PgChatThread messages={messages} thinking={thinking} />

          {!ended ? (
            <div className="pgo-voice-flow__input">
              <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
                <button
                  type="button"
                  className="pgo-chip"
                  aria-pressed={mode === "voice"}
                  onClick={() => setMode("voice")}
                >
                  Voice
                </button>
                <button
                  type="button"
                  className="pgo-chip"
                  aria-pressed={mode === "text"}
                  onClick={() => setMode("text")}
                >
                  Type
                </button>
              </div>
              {!ready ? (
                <p style={{ opacity: 0.6, fontSize: 13 }}>Connecting…</p>
              ) : mode === "voice" ? (
                <PgVoiceMicCapture
                  onChunk={(buf) => socketRef.current?.sendAudio(buf)}
                  onStateChange={() => {}}
                />
              ) : (
                <PgVoiceFallbackInput onSend={sendText} />
              )}
            </div>
          ) : (
            <div
              className="pgo-glass"
              style={{ padding: 16, display: "flex", flexDirection: "column", gap: 10 }}
            >
              <p style={{ fontWeight: 600 }}>All set. Review your listing</p>
              <p style={{ fontSize: 13, opacity: 0.7 }}>
                Confirm the details and add photos (4 minimum) before submitting.
              </p>
              <button type="button" className="pgo-btn pgo-btn--primary" onClick={goToReview}>
                Review your listing
              </button>
            </div>
          )}
        </section>

        <aside style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <PgScoreMeter
            payload={draftToPayload(state.draft)}
            signals={signals}
            onGoToStep={() => goToReview()}
          />
          {cards.length > 0 && (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {cards.map((c) => (
                <PgFieldConfirmCard
                  key={c.key}
                  field={c.field}
                  value={c.value}
                  confidence={c.confidence}
                  onUndo={onUndo}
                />
              ))}
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
