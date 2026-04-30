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

/* ─── Human labels (no field keys ever shown to the user) ───────────── */
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
  // Tracks the latest user voice transcript so onToolCall closures can
  // cross-reference money values against what the owner actually said.
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
          if (role === "assistant") {
            setAssistantText(text);
          } else {
            setUserText(text);
            userTextRef.current = text;
          }
        },
        onToolCall: (name, args, callId) => {
          const result = dispatchToolCall(name, args, formRef.current, userTextRef.current);
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

  const cueLabel = (() => {
    switch (agentState) {
      case "idle":
        return voiceActive ? "starting up" : "ready when you are";
      case "connecting":
        return "connecting";
      case "listening":
        return "listening";
      case "thinking":
        return "thinking";
      case "speaking":
        return "speaking";
      case "ended":
        return "session ended";
      case "error":
        return "something went wrong";
      default:
        return "";
    }
  })();

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
        <div className="cz-copilot__masthead">
          <div className="cz-copilot__name">Maya</div>
          <div className="cz-copilot__role">your listing concierge</div>
        </div>
        <div className="cz-copilot__cue" data-state={agentState} aria-live="polite">
          {cueLabel}
        </div>
      </div>

      {!supported ? (
        <div className="cz-error-banner">
          Voice concierge needs a recent Chrome, Safari, or Edge with mic permission. The form works
          without voice — fill it manually and Maya will join when supported.
        </div>
      ) : null}
      {errorBanner ? <div className="cz-error-banner">{errorBanner}</div> : null}

      <div className="cz-orb-stage">
        <VoiceOrb
          state={agentState}
          userLevel={userLevel}
          assistantLevel={assistantLevel}
          onClick={handleMicClick}
        />
      </div>

      <div className="cz-cap-stack">
        <CaptionBlock
          role="assistant"
          text={assistantText}
          show={showAssistant}
          state={agentState}
        />
        <div className="cz-cap-rule" aria-hidden="true" />
        <CaptionBlock role="user" text={userText} show={showUser} state={agentState} />
      </div>

      <AtelierPreview form={form} onJump={onChipJump} />

      <div className="cz-copilot__actions">
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
        : state === "thinking"
          ? "Thinking it through…"
          : "Maya is ready when you are."
      : "Your words will appear here, in your voice.";

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

/* ════════════════════════════════════════════════════════════════════
 *  AtelierPreview — the listing taking shape
 *
 *  A miniature of the listing card the owner will publish. As Maya
 *  captures facts, they materialize *into* this card with a gold-leaf
 *  shimmer (reusing cz-glow). No field keys are ever shown — every
 *  label is human English. Click any region to jump back to that step
 *  and edit it.
 * ════════════════════════════════════════════════════════════════════ */

interface AtelierPreviewProps {
  form: WizardForm;
  onJump: (step: number) => void;
}

function AtelierPreview({ form, onJump }: AtelierPreviewProps) {
  // Track which fields just transitioned from empty → filled, so we can
  // briefly attach the cz-fill class to the corresponding region.
  const prevFilledRef = useRef<Set<string>>(new Set());
  const [recentlyFilled, setRecentlyFilled] = useState<Set<string>>(new Set());

  const filledNow = useMemo(() => {
    const set = new Set<string>();
    for (const f of ATELIER_FIELDS) if (isFilled(form, f.key)) set.add(String(f.key));
    return set;
  }, [form]);

  useEffect(() => {
    const prev = prevFilledRef.current;
    const newlyFilled = new Set<string>();
    for (const k of filledNow) if (!prev.has(k)) newlyFilled.add(k);
    if (newlyFilled.size > 0) {
      setRecentlyFilled(newlyFilled);
      const t = setTimeout(() => setRecentlyFilled(new Set()), 1400);
      prevFilledRef.current = filledNow;
      return () => clearTimeout(t);
    }
    prevFilledRef.current = filledNow;
    return undefined;
  }, [filledNow]);

  const filledCount = filledNow.size;
  const totalCount = ATELIER_FIELDS.length;
  const remaining = ATELIER_FIELDS.filter((f) => !filledNow.has(String(f.key)));

  const flash = (k: keyof WizardForm) => (recentlyFilled.has(String(k)) ? " cz-fill" : "");
  const flashAny = (...keys: (keyof WizardForm)[]) =>
    keys.some((k) => recentlyFilled.has(String(k))) ? " cz-fill" : "";

  // ── Title block ──────────────────────────────────────────────────
  const hasTitle = isFilled(form, "title");

  // ── Location line ────────────────────────────────────────────────
  const locParts: string[] = [];
  if (form.listing_type === "pg") locParts.push("PG");
  else locParts.push("Flat");
  if (isFilled(form, "locality")) locParts.push(titleCase(form.locality));
  if (isFilled(form, "city")) locParts.push(titleCase(form.city));
  const hasLocation = isFilled(form, "city") || isFilled(form, "locality");

  // ── Stats trio ───────────────────────────────────────────────────
  const isPg = form.listing_type === "pg";
  const statBhk = isPg
    ? isFilled(form, "beds")
      ? `${form.beds} beds`
      : null
    : isFilled(form, "bedrooms")
      ? `${form.bedrooms} BHK`
      : null;
  const statBath = isFilled(form, "bathrooms")
    ? `${form.bathrooms} bath${Number(form.bathrooms) === 1 ? "" : "s"}`
    : null;
  const statArea = isFilled(form, "area_sqft") ? `${form.area_sqft} sqft` : null;

  return (
    <section className="cz-atelier" aria-label="Your listing taking shape">
      <div className="cz-atelier__top">
        <div className="cz-atelier__eyebrow">Your listing — taking shape</div>
        <div className="cz-atelier__count" aria-label={`${filledCount} of ${totalCount} captured`}>
          <strong>{filledCount}</strong>
          <span> of {totalCount}</span>
        </div>
      </div>

      <button
        type="button"
        className={`cz-atelier__loc${hasLocation ? "" : " cz-atelier__loc--empty"}${flashAny("city", "locality", "listing_type")}`}
        onClick={() => onJump(hasLocation ? 1 : 1)}
      >
        {hasLocation ? (
          <>
            <span>{locParts[0]}</span>
            {locParts.length > 1 && <span className="cz-atelier__loc-dot" />}
            <span>{locParts.slice(1).join(", ")}</span>
          </>
        ) : (
          <span>A new home, somewhere wonderful…</span>
        )}
      </button>

      <button
        type="button"
        className={`cz-atelier__title-btn${flash("title")}`}
        onClick={() => onJump(3)}
        aria-label="Edit title"
      >
        <h3 className={`cz-atelier__title${hasTitle ? "" : " cz-atelier__title--placeholder"}`}>
          {hasTitle ? form.title : "Untitled draft"}
        </h3>
      </button>

      <button
        type="button"
        className={`cz-atelier__price-btn${flashAny("monthly_rent", "deposit")}`}
        onClick={() => onJump(0)}
        aria-label="Edit rent and deposit"
      >
        {isFilled(form, "monthly_rent") ? (
          <span className="cz-atelier__rent">
            {formatINR(form.monthly_rent)}
            <small> /month</small>
          </span>
        ) : (
          <span className="cz-atelier__rent cz-atelier__rent--placeholder">Rent — to be set</span>
        )}
        {isFilled(form, "deposit") && (
          <span className="cz-atelier__deposit">
            {formatINR(form.deposit)}
            <em>deposit</em>
          </span>
        )}
      </button>

      <div className="cz-atelier__rule" aria-hidden="true" />

      <button
        type="button"
        className={`cz-atelier__stats${flashAny("bedrooms", "beds", "bathrooms", "area_sqft")}`}
        onClick={() => onJump(2)}
        disabled={!statBhk && !statBath && !statArea}
        aria-label="Edit property details"
      >
        <div className="cz-atelier__stat">
          <span className="cz-atelier__stat-label">{isPg ? "Beds" : "BHK"}</span>
          <span
            className={`cz-atelier__stat-value${statBhk ? "" : " cz-atelier__stat-value--placeholder"}`}
          >
            {statBhk ?? "—"}
          </span>
        </div>
        <div className="cz-atelier__stat">
          <span className="cz-atelier__stat-label">Baths</span>
          <span
            className={`cz-atelier__stat-value${statBath ? "" : " cz-atelier__stat-value--placeholder"}`}
          >
            {statBath ?? "—"}
          </span>
        </div>
        <div className="cz-atelier__stat">
          <span className="cz-atelier__stat-label">Area</span>
          <span
            className={`cz-atelier__stat-value${statArea ? "" : " cz-atelier__stat-value--placeholder"}`}
          >
            {statArea ?? "—"}
          </span>
        </div>
      </button>

      {isFilled(form, "amenities") && (
        <button
          type="button"
          className={`cz-atelier__amenities${flash("amenities")}`}
          onClick={() => onJump(2)}
        >
          <span className="cz-atelier__amenities-count">+{form.amenities.length}</span>
          handpicked amenit{form.amenities.length === 1 ? "y" : "ies"}
        </button>
      )}

      {remaining.length > 0 ? (
        <div className="cz-atelier__remaining">
          <div className="cz-atelier__remaining-label">Still to capture</div>
          <div className="cz-atelier__remaining-list">
            {remaining.map((f, i) => (
              <span
                key={String(f.key)}
                style={{ display: "inline-flex", alignItems: "center", gap: 4 }}
              >
                <button
                  type="button"
                  className="cz-atelier__remaining-item"
                  onClick={() => onJump(f.step)}
                >
                  {f.label}
                </button>
                {i < remaining.length - 1 && <span className="cz-atelier__remaining-sep">·</span>}
              </span>
            ))}
          </div>
        </div>
      ) : (
        <div className="cz-atelier__remaining">
          <div className="cz-atelier__remaining--done">
            <em>Everything's in. Time to review.</em>
          </div>
        </div>
      )}
    </section>
  );
}
