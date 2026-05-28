"use client";

import { useEffect, useMemo, useRef, useState } from "react";
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
 * VoiceCoPilot — compact concierge panel
 *
 * The right-column panel (desktop) / bottom drawer (mobile) that hosts
 * Maya. It owns the RealtimeClient lifecycle and surfaces:
 *   1. onFormApply(nextForm, animatedFields) — page swaps WizardForm
 *      and animates the named fields.
 *   2. onNavigate(step)                      — jump wizard step.
 *   3. onUiAction(action)                    — generate_title, etc.
 *
 * The conversation surface is a *capture feed* derived from the
 * fieldsAnimated returned by every tool dispatch — never raw ASR text.
 * That keeps the UI honest even when transcription mishears.
 * ──────────────────────────────────────────────────────────────────── */

const ATELIER_FIELDS: { key: keyof WizardForm; label: string; step: number }[] = [
  { key: "listing_type", label: "Property type", step: 0 },
  { key: "monthly_rent", label: "Monthly rent", step: 0 },
  { key: "deposit", label: "Deposit", step: 0 },
  { key: "furnishing", label: "Furnishing", step: 0 },
  { key: "city", label: "City", step: 1 },
  { key: "locality", label: "Neighborhood", step: 1 },
  { key: "bedrooms", label: "Bedrooms", step: 2 },
  { key: "bathrooms", label: "Bathrooms", step: 2 },
  { key: "area_sqft", label: "Area", step: 2 },
  { key: "amenities", label: "Amenities", step: 2 },
  { key: "title", label: "Listing title", step: 3 }
];

const FIELD_BY_KEY = new Map(ATELIER_FIELDS.map((f) => [String(f.key), f]));

function isFilled(form: WizardForm, key: keyof WizardForm): boolean {
  const value = form[key];
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "string") return value.trim().length > 0;
  return value != null;
}

function formatINR(raw: string): string {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return raw;
  return `₹${n.toLocaleString("en-IN")}`;
}

function titleCase(s: string): string {
  return s
    .split(/\s+/)
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1).toLowerCase() : ""))
    .join(" ");
}

function furnishingLabel(value: string): string {
  switch (value) {
    case "unfurnished":
      return "Unfurnished";
    case "semi_furnished":
      return "Semi-furnished";
    case "fully_furnished":
      return "Fully furnished";
    default:
      return titleCase(value.replace(/_/g, " "));
  }
}

interface CaptureEntry {
  id: string;
  field: string; // keyof WizardForm as string — used for de-dupe
  label: string; // human label shown on the row
  value: string; // human value shown on the row
  step: number; // wizard step to jump to
  ts: number;
}

/** Build a feed entry from a current form + a field key that just changed. */
function entryFor(field: keyof WizardForm, form: WizardForm): CaptureEntry | null {
  const meta = FIELD_BY_KEY.get(String(field));
  if (!meta) return null;
  if (!isFilled(form, field)) return null;

  let label = meta.label;
  let value = "";

  switch (field) {
    case "listing_type":
      label = "Property";
      value = form.listing_type === "pg" ? "PG" : "Flat / House";
      break;
    case "monthly_rent":
      label = "Rent";
      value = `${formatINR(form.monthly_rent)} / mo`;
      break;
    case "deposit":
      label = "Deposit";
      value = formatINR(form.deposit);
      break;
    case "furnishing":
      label = "Furnishing";
      value = furnishingLabel(form.furnishing);
      break;
    case "city":
      label = "City";
      value = titleCase(form.city);
      break;
    case "locality":
      label = "Neighborhood";
      value = titleCase(form.locality);
      break;
    case "bedrooms":
      label = "Bedrooms";
      value = form.listing_type === "pg" ? `${form.bedrooms}` : `${form.bedrooms} BHK`;
      break;
    case "bathrooms": {
      const n = Number(form.bathrooms);
      label = "Bathrooms";
      value = `${form.bathrooms} bath${n === 1 ? "" : "s"}`;
      break;
    }
    case "area_sqft":
      label = "Area";
      value = `${form.area_sqft} sqft`;
      break;
    case "amenities": {
      const c = form.amenities.length;
      label = "Amenities";
      value = `${c} selected`;
      break;
    }
    case "title":
      label = "Title";
      value = form.title.length > 32 ? `${form.title.slice(0, 30)}…` : form.title;
      break;
    default:
      return null;
  }

  return {
    id: `${String(field)}-${Date.now()}`,
    field: String(field),
    label,
    value,
    step: meta.step,
    ts: Date.now()
  };
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
  const [errorBanner, setErrorBanner] = useState<string | null>(null);
  const [textInput, setTextInput] = useState("");
  const [showTextFallback, setShowTextFallback] = useState(false);
  const [drawerCollapsed, setDrawerCollapsed] = useState(false);
  const [supported, setSupported] = useState(true);
  const [captureLog, setCaptureLog] = useState<CaptureEntry[]>([]);
  const [pulseField, setPulseField] = useState<string | null>(null);

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
  // Tracks the latest user voice transcript so guardMoneyValue can compare
  // numbers — kept as a ref only, never rendered (transcription is unreliable).
  const userTextRef = useRef("");
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
          if (role === "user") {
            userTextRef.current = text;
          }
          // Assistant transcripts are intentionally not surfaced — the
          // capture feed shows what Maya actually did, not what she said.
        },
        onToolCall: (name, args, callId) => {
          const result = dispatchToolCall(name, args, formRef.current, userTextRef.current);
          if (!result) {
            client.sendToolOutput(callId, { ok: false, error: "Unknown tool" });
            return;
          }
          onFormApplyRef.current(result.nextForm, result.fieldsAnimated, result.nextStep);

          // The capture log itself is recomputed by the form-watching effect
          // below — here we only flag the most-recently-touched field so its
          // row gets the pulse animation.
          if (result.fieldsAnimated.length > 0) {
            const last = result.fieldsAnimated[result.fieldsAnimated.length - 1];
            setPulseField(String(last));
            setTimeout(() => setPulseField(null), 1400);
          }

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

  /* ── Re-derive the capture log from the live form on every change ──
   * Manual edits (typing in inputs, toggling chips) and tool-driven edits
   * both flow through the same WizardForm. We rebuild the log here so the
   * displayed value always matches the current field value (e.g. while
   * typing "30000" the row updates from ₹3 → ₹30 → ₹300 → ₹30,000 instead
   * of freezing at the first keystroke). Order is preserved across rebuilds
   * so existing rows stay put — only newly-filled fields get appended.
   */
  useEffect(() => {
    setCaptureLog((prev) => {
      const order: string[] = [];
      // Existing rows that are still filled keep their position.
      for (const e of prev) {
        if (isFilled(form, e.field as keyof WizardForm) && !order.includes(e.field)) {
          order.push(e.field);
        }
      }
      // Newly-filled fields land at the end, in canonical order.
      for (const f of ATELIER_FIELDS) {
        if (isFilled(form, f.key) && !order.includes(String(f.key))) {
          order.push(String(f.key));
        }
      }
      const prevById = new Map(prev.map((e) => [e.field, e]));
      const next: CaptureEntry[] = [];
      for (const k of order) {
        const fresh = entryFor(k as keyof WizardForm, form);
        if (!fresh) continue;
        const existing = prevById.get(k);
        next.push(
          existing
            ? { ...existing, label: fresh.label, value: fresh.value, step: fresh.step }
            : fresh
        );
      }
      // Avoid an unnecessary state replacement if nothing actually changed —
      // keeps React from re-rendering the feed each keystroke when only an
      // unrelated field updated.
      if (
        next.length === prev.length &&
        next.every((e, i) => e.value === prev[i].value && e.field === prev[i].field)
      ) {
        return prev;
      }
      return next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form]);

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
      onToggleVoice(true);
      setTimeout(() => clientRef.current?.sendText(trimmed), 1200);
    }
    setTextInput("");
  }

  const cueLabel = (() => {
    switch (agentState) {
      case "idle":
        return voiceActive ? "starting up" : "ready";
      case "connecting":
        return "connecting";
      case "listening":
        return "listening";
      case "thinking":
        return "thinking";
      case "speaking":
        return "speaking";
      case "ended":
        return "ended";
      case "error":
        return "error";
      default:
        return "";
    }
  })();

  const heroLine = (() => {
    switch (agentState) {
      case "idle":
        return voiceActive ? "starting up…" : "tap the orb when you're ready";
      case "connecting":
        return "connecting to Maya…";
      case "listening":
        return "I'm listening — speak naturally";
      case "thinking":
        return "thinking it through…";
      case "speaking":
        return "Maya is talking";
      case "ended":
        return "session ended";
      case "error":
        return "something went wrong";
      default:
        return "";
    }
  })();

  const filledCount = useMemo(() => {
    let n = 0;
    for (const f of ATELIER_FIELDS) if (isFilled(form, f.key)) n++;
    return n;
  }, [form]);

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

      {/* ── Crest: Maya + status pill ─────────────────────────────── */}
      <header className="cz-crest">
        <div className="cz-crest__title">
          <div className="cz-crest__name">Maya</div>
          <div className="cz-crest__role">your listing concierge</div>
        </div>
        <div className="cz-crest__pill" data-state={agentState} aria-live="polite">
          <span className="cz-crest__dot" aria-hidden="true" />
          {cueLabel}
        </div>
      </header>

      {!supported ? (
        <div className="cz-error-banner">
          Voice concierge needs Chrome, Safari, or Edge with mic permission. The form still works
          manually — Maya will join when supported.
        </div>
      ) : null}
      {errorBanner ? <div className="cz-error-banner">{errorBanner}</div> : null}

      {/* ── Hero: smaller orb + single status line ─────────────────── */}
      <div className="cz-hero">
        <div className="cz-hero__stage">
          <VoiceOrb
            state={agentState}
            userLevel={userLevel}
            assistantLevel={assistantLevel}
            onClick={handleMicClick}
            size={120}
          />
        </div>
        <div className="cz-hero__line" aria-live="polite">
          {heroLine}
        </div>
      </div>

      {/* ── Capture feed: what Maya actually filled in ─────────────── */}
      <CaptureFeed
        entries={captureLog}
        form={form}
        filledCount={filledCount}
        totalCount={ATELIER_FIELDS.length}
        pulseField={pulseField}
        onJump={onChipJump}
      />

      {/* ── Progress crest: 11 segments ────────────────────────────── */}
      <ProgressCrest
        form={form}
        total={ATELIER_FIELDS.length}
        filled={filledCount}
        pulseField={pulseField}
      />

      {/* ── Action: mic + typing fallback ──────────────────────────── */}
      <div className="cz-action">
        <button
          type="button"
          className="cz-mic-btn"
          data-state={voiceActive ? "active" : "idle"}
          onClick={handleMicClick}
          disabled={!supported}
        >
          {voiceActive
            ? "End conversation"
            : supported
              ? "Tap to talk to Maya"
              : "Voice unavailable"}
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
            or switch to typing
          </button>
        )}
      </div>
    </aside>
  );
}

/* ════════════════════════════════════════════════════════════════════
 *  CaptureFeed — what Maya has captured so far
 * ════════════════════════════════════════════════════════════════════ */

interface CaptureFeedProps {
  entries: CaptureEntry[];
  form: WizardForm;
  filledCount: number;
  totalCount: number;
  pulseField: string | null;
  onJump: (step: number) => void;
}

function CaptureFeed({
  entries,
  filledCount,
  totalCount,
  pulseField,
  form,
  onJump
}: CaptureFeedProps) {
  // Show the most recent 4 captured entries (newest at the bottom).
  const visible = entries.slice(-4);

  // Pending = ATELIER_FIELDS not yet filled, in declaration order.
  const pending = useMemo(() => ATELIER_FIELDS.filter((f) => !isFilled(form, f.key)), [form]);

  const isEmpty = entries.length === 0;

  return (
    <section className="cz-feed" aria-label="Captured listing details">
      <div className="cz-feed__head">
        <span className="cz-feed__eyebrow">What we've captured</span>
        <span className="cz-feed__count">
          <strong>{filledCount}</strong>
          <span> / {totalCount}</span>
        </span>
      </div>

      {isEmpty ? (
        <div className="cz-feed__empty">
          Tap the orb and start talking. As Maya catches each detail it lands here — no typos, even
          if she mishears the words.
        </div>
      ) : (
        <ul className="cz-feed__list">
          {visible.map((e) => {
            const pulsing = pulseField === e.field;
            return (
              <li key={e.field} className={`cz-feed__row${pulsing ? " cz-feed__row--pulse" : ""}`}>
                <button
                  type="button"
                  onClick={() => onJump(e.step)}
                  className="cz-feed__btn"
                  aria-label={`Edit ${e.label}`}
                >
                  <span className="cz-feed__dot" aria-hidden="true" />
                  <span className="cz-feed__label">{e.label}</span>
                  <span className="cz-feed__value">{e.value}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {pending.length > 0 ? (
        <button
          type="button"
          className="cz-feed__pending"
          onClick={() => onJump(pending[0].step)}
          aria-label={`Next up: ${pending[0].label}`}
        >
          <span className="cz-feed__pending-label">next</span>
          <span className="cz-feed__pending-value">
            {pending
              .slice(0, 3)
              .map((p) => p.label.toLowerCase())
              .join(" · ")}
            {pending.length > 3 ? " · …" : ""}
          </span>
        </button>
      ) : (
        <div className="cz-feed__done">Everything's in. Time to review.</div>
      )}
    </section>
  );
}

/* ════════════════════════════════════════════════════════════════════
 *  ProgressCrest — 11 segments showing capture progress
 * ════════════════════════════════════════════════════════════════════ */

interface ProgressCrestProps {
  form: WizardForm;
  total: number;
  filled: number;
  pulseField: string | null;
}

function ProgressCrest({ form, total, filled, pulseField }: ProgressCrestProps) {
  return (
    <div
      className="cz-segments"
      role="progressbar"
      aria-valuenow={filled}
      aria-valuemin={0}
      aria-valuemax={total}
      aria-label={`${filled} of ${total} captured`}
    >
      {ATELIER_FIELDS.map((f) => {
        const on = isFilled(form, f.key);
        const pulsing = pulseField === String(f.key);
        return (
          <span
            key={String(f.key)}
            className={`cz-segment${on ? " cz-segment--on" : ""}${pulsing ? " cz-segment--pulse" : ""}`}
            aria-hidden="true"
          />
        );
      })}
    </div>
  );
}
