"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  RealtimeClient,
  isRealtimeSupported,
  type RealtimeAgentState,
  type RealtimeRole
} from "../../lib/realtime-client";
import {
  dispatchToolCall,
  getFilledFields,
  getMissingFields,
  type ToolDispatchResult
} from "../../lib/listing-tool-handlers";
import type { WizardForm } from "./types";
import { VoiceOrb } from "./VoiceOrb";

/* ──────────────────────────────────────────────────────────────────────
 * VoiceCoPilot
 *
 * The always-visible right-column panel (desktop) / bottom-drawer
 * (mobile) that hosts Maya. It owns the RealtimeClient lifecycle and
 * surfaces three things to the rest of the page via callbacks:
 *
 *   1. onFormApply(nextForm, animatedFields)  — every time Maya
 *      updates fields. The page swaps its WizardForm and animates
 *      the named fields.
 *   2. onNavigate(step) — when Maya wants to move the wizard forward
 *      or back.
 *   3. onUiAction(action) — special events ("generate_title",
 *      "request_review", "summarize") so the page can hook in the
 *      existing AI title generator etc.
 *
 * The panel renders (and stays alive) regardless of voice state. The
 * orb / mic button toggles the live session.
 * ──────────────────────────────────────────────────────────────────── */

interface CapturedChip {
  key: string;
  label: string;
  step: number;
}

const CHIP_DEFINITIONS: { key: keyof WizardForm; step: number; render: (v: unknown) => string }[] =
  [
    { key: "listing_type", step: 0, render: (v) => (v === "pg" ? "PG" : "Flat / House") },
    { key: "monthly_rent", step: 0, render: (v) => `₹${Number(v).toLocaleString("en-IN")}/mo` },
    { key: "deposit", step: 0, render: (v) => `Dep ₹${Number(v).toLocaleString("en-IN")}` },
    { key: "furnishing", step: 0, render: (v) => String(v).replace(/_/g, " ") },
    { key: "city", step: 1, render: (v) => String(v).charAt(0).toUpperCase() + String(v).slice(1) },
    { key: "locality", step: 1, render: (v) => String(v) },
    { key: "bedrooms", step: 2, render: (v) => `${v} BHK` },
    { key: "beds", step: 2, render: (v) => `${v} beds` },
    { key: "area_sqft", step: 2, render: (v) => `${v} sqft` },
    { key: "amenities", step: 2, render: (v) => `${(v as string[]).length} amenities` },
    { key: "title", step: 3, render: () => "Title set" }
  ];

function buildChips(form: WizardForm): CapturedChip[] {
  const chips: CapturedChip[] = [];
  for (const def of CHIP_DEFINITIONS) {
    const value = form[def.key];
    const has = Array.isArray(value)
      ? value.length > 0
      : typeof value === "string"
        ? value.trim().length > 0
        : value != null;
    if (has) {
      chips.push({
        key: String(def.key),
        label: def.render(value),
        step: def.step
      });
    }
  }
  return chips;
}

interface VoiceCoPilotProps {
  form: WizardForm;
  step: number;
  accessToken: string | null;
  locale: "en" | "hi";
  ownerFirstName?: string;
  voiceActive: boolean;
  onToggleVoice: (next: boolean) => void;
  onFormApply: (
    nextForm: WizardForm,
    animatedFields: (keyof WizardForm)[],
    nextStep?: number
  ) => void;
  onNavigate: (step: number, reason?: string) => void;
  onUiAction: (action: NonNullable<ToolDispatchResult["uiAction"]>) => void;
  onChipJump: (step: number) => void;
  showFallbackBanner?: boolean;
}

export function VoiceCoPilot(props: VoiceCoPilotProps) {
  const {
    form,
    step,
    accessToken,
    locale,
    ownerFirstName,
    voiceActive,
    onToggleVoice,
    onFormApply,
    onNavigate,
    onUiAction,
    onChipJump
  } = props;

  const [agentState, setAgentState] = useState<RealtimeAgentState>("idle");
  const [userLevel, setUserLevel] = useState(0);
  const [assistantLevel, setAssistantLevel] = useState(0);
  const [assistantText, setAssistantText] = useState("");
  const [userText, setUserText] = useState("");
  const [errorBanner, setErrorBanner] = useState<string | null>(null);
  const [textInput, setTextInput] = useState("");
  const [showTextFallback, setShowTextFallback] = useState(false);
  const [drawerCollapsed, setDrawerCollapsed] = useState(false);
  const [supported, setSupported] = useState(true);

  useEffect(() => {
    setSupported(isRealtimeSupported());
  }, []);

  const clientRef = useRef<RealtimeClient | null>(null);
  // Always read the freshest form/step + parent callbacks from inside the
  // long-lived RealtimeClient callbacks. Without these refs the closure
  // captures the very first set of values.
  const formRef = useRef(form);
  const stepRef = useRef(step);
  const onFormApplyRef = useRef(onFormApply);
  const onNavigateRef = useRef(onNavigate);
  const onUiActionRef = useRef(onUiAction);
  formRef.current = form;
  stepRef.current = step;
  onFormApplyRef.current = onFormApply;
  onNavigateRef.current = onNavigate;
  onUiActionRef.current = onUiAction;

  /* ── Lifecycle: start when voiceActive flips true ───────────────── */
  useEffect(() => {
    if (!voiceActive) return;
    if (!accessToken) {
      setErrorBanner("Please log in to use the voice concierge.");
      onToggleVoice(false);
      return;
    }
    if (!isRealtimeSupported()) {
      setErrorBanner("Voice concierge needs Chrome, Safari, or Edge with mic support.");
      onToggleVoice(false);
      return;
    }

    setErrorBanner(null);
    const client = new RealtimeClient(
      {
        accessToken,
        currentStep: stepRef.current,
        filledFields: getFilledFields(formRef.current),
        missingFields: getMissingFields(formRef.current),
        locale,
        ownerFirstName
      },
      {
        onState: (s) => setAgentState(s),
        onAudioLevel: (role: RealtimeRole, rms) => {
          if (role === "user") setUserLevel(rms);
          else setAssistantLevel(rms);
        },
        onTranscript: (role, text, _isFinal) => {
          if (role === "assistant") setAssistantText(text);
          else setUserText(text);
        },
        onToolCall: (name, args, callId) => {
          const result = dispatchToolCall(name, args, formRef.current);
          if (!result) {
            client.sendToolOutput(callId, { ok: false, error: "Unknown tool" });
            return;
          }
          onFormApplyRef.current(result.nextForm, result.fieldsAnimated, result.nextStep);
          if (result.nextStep != null && result.nextStep !== stepRef.current) {
            onNavigateRef.current(result.nextStep, result.toast);
          }
          if (result.uiAction) {
            onUiActionRef.current(result.uiAction);
          }
          client.sendToolOutput(callId, result.toolOutput);
        },
        onError: (msg) => setErrorBanner(msg)
      }
    );
    clientRef.current = client;
    void client.start();

    return () => {
      client.stop();
      clientRef.current = null;
      setAgentState("idle");
      setUserLevel(0);
      setAssistantLevel(0);
      setUserText("");
      setAssistantText("");
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [voiceActive, accessToken]);

  /* ── Push form context after manual edits while a session is live ── */
  useEffect(() => {
    const c = clientRef.current;
    if (c && voiceActive && agentState !== "connecting" && agentState !== "idle") {
      c.pushContext(getFilledFields(form), step);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form, step]);

  /* ── Status label ───────────────────────────────────────────────── */
  const statusLabel = (() => {
    switch (agentState) {
      case "idle":
        return voiceActive ? "STARTING" : "TAP TO TALK";
      case "connecting":
        return "CONNECTING";
      case "listening":
        return "LISTENING";
      case "thinking":
        return "THINKING";
      case "speaking":
        return "SPEAKING";
      case "ended":
        return "ENDED";
      case "error":
        return "ERROR";
      default:
        return "";
    }
  })();

  /* ── Caption helpers — choose what to show ──────────────────────── */
  const showAssistant = assistantText.length > 0;
  const showUser = userText.length > 0;

  /* ── Mic toggle ─────────────────────────────────────────────────── */
  function handleMicClick() {
    if (voiceActive && agentState === "speaking") {
      // mid-sentence tap = barge-in
      clientRef.current?.interrupt();
      return;
    }
    onToggleVoice(!voiceActive);
  }

  function handleSendText() {
    const trimmed = textInput.trim();
    if (!trimmed) return;
    if (voiceActive) {
      clientRef.current?.sendText(trimmed);
    } else {
      // If voice isn't on, kicking off a session is the simplest path —
      // user can also just type once it's live.
      onToggleVoice(true);
      setTimeout(() => clientRef.current?.sendText(trimmed), 1200);
    }
    setUserText(trimmed);
    setTextInput("");
  }

  const chips = buildChips(form);

  return (
    <aside
      className="cz-copilot cz-fade cz-fade--3"
      data-collapsed={drawerCollapsed ? "true" : "false"}
      aria-label="Voice concierge"
    >
      <button
        type="button"
        className="cz-copilot__handle"
        aria-label="Toggle drawer"
        onClick={() => setDrawerCollapsed((v) => !v)}
      />
      <div className="cz-copilot__head">
        <div className="cz-copilot__name">Maya, your concierge</div>
        <div className="cz-copilot__status" data-state={agentState}>
          {statusLabel}
        </div>
      </div>

      {!supported ? (
        <div className="cz-error-banner">
          Voice concierge needs a recent Chrome, Safari, or Edge with mic permission. The form works
          without voice — fill it manually and Maya will join when supported.
        </div>
      ) : null}
      {errorBanner ? <div className="cz-error-banner">{errorBanner}</div> : null}

      <VoiceOrb
        state={agentState}
        userLevel={userLevel}
        assistantLevel={assistantLevel}
        onClick={handleMicClick}
      />

      <div className="cz-cap-stack">
        <CaptionBlock
          role="assistant"
          text={assistantText}
          show={showAssistant}
          state={agentState}
        />
        <CaptionBlock role="user" text={userText} show={showUser} state={agentState} />
      </div>

      <div className="cz-chips-label">Captured so far</div>
      <div className="cz-chips">
        <AnimatePresence initial={false}>
          {chips.length === 0 ? (
            <motion.span
              key="empty"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              style={{ color: "rgba(255,255,255,0.4)", fontSize: 12 }}
            >
              Nothing yet — start talking and watch this fill.
            </motion.span>
          ) : (
            chips.map((chip) => (
              <motion.button
                key={chip.key}
                type="button"
                className="cz-chip"
                initial={{ opacity: 0, scale: 0.85, y: 6 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.9 }}
                transition={{ type: "spring", stiffness: 260, damping: 22 }}
                onClick={() => onChipJump(chip.step)}
                title={`Jump to step ${chip.step + 1}`}
              >
                <span className="cz-chip__key">{chip.key}</span>
                <span>{chip.label}</span>
              </motion.button>
            ))
          )}
        </AnimatePresence>
      </div>

      <div className="cz-copilot__actions">
        <button
          type="button"
          className="cz-mic-btn"
          data-state={voiceActive ? "active" : "idle"}
          onClick={handleMicClick}
          disabled={!supported}
        >
          {voiceActive ? "End voice" : supported ? "Tap to talk to Maya" : "Voice unavailable"}
        </button>
        {showTextFallback ? (
          <div className="cz-text-fallback">
            <input
              type="text"
              value={textInput}
              onChange={(e) => setTextInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  handleSendText();
                }
              }}
              placeholder={locale === "hi" ? "Yahan likhein…" : "Type instead…"}
            />
            <button type="button" onClick={handleSendText}>
              Send
            </button>
          </div>
        ) : (
          <button
            type="button"
            className="cz-fallback-link"
            onClick={() => setShowTextFallback(true)}
          >
            switch to typing
          </button>
        )}
      </div>
    </aside>
  );
}

interface CaptionBlockProps {
  role: RealtimeRole;
  text: string;
  show: boolean;
  state: RealtimeAgentState;
}
function CaptionBlock({ role, text, show, state }: CaptionBlockProps) {
  const empty = !show;
  const placeholder =
    role === "assistant"
      ? state === "speaking"
        ? "…"
        : "Maya is listening for your first sentence."
      : "I'll show what I hear here.";

  return (
    <div
      className={`cz-cap cz-cap--${role}${empty ? " cz-cap--empty" : ""}`}
      aria-live={role === "assistant" ? "polite" : "off"}
    >
      <div className="cz-cap__role">{role === "assistant" ? "Maya" : "You"}</div>
      <div className="cz-cap__body">{empty ? placeholder : text}</div>
    </div>
  );
}
