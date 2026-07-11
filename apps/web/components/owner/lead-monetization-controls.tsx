"use client";

import { useEffect, useState } from "react";
import { unlockLead, recordLeadCallClick, type LeadVm } from "../../lib/owner-api";
import { LeadCreditsPanel } from "./lead-credits-panel";
import { useFlag } from "../../lib/feature-flags";
import { trackEvent } from "../../lib/analytics";
import { ApiError } from "../../lib/api";
import { t, type Locale } from "../../lib/i18n";

export interface LeadMonetizationControlsProps {
  lead: LeadVm;
  accessToken: string;
  locale: Locale;
  /** Tighter spacing for Kanban cards, which have far less room than the list view. */
  compact?: boolean;
  /** Lets the parent's lead array stay server-consistent after unlock/call. */
  onLeadPatch?: (patch: Partial<LeadVm>) => void;
}

/**
 * Shared lead monetization state machine: FREE badge, response-window
 * countdown, blurred masked contact + "Unlock for 1 credit", revealed phone +
 * "Call now", the expired message, and inline purchase-dialog recovery when
 * an unlock comes back `insufficient_credits`.
 *
 * Rendered by every surface a lead can appear on — the owner list card
 * (LeadCard), every owner Kanban card, and the PG operator board — so the
 * monetization behavior and copy are identical everywhere. Self-hides
 * entirely when `ff_callback_leads` is off, preserving each surface's
 * pre-monetization behavior untouched.
 */
export function LeadMonetizationControls({
  lead,
  accessToken,
  locale,
  compact = false,
  onLeadPatch
}: LeadMonetizationControlsProps) {
  const callbackMode = useFlag("ff_callback_leads");
  const [phone, setPhone] = useState<string | null>(lead.tenantPhone);
  const [accessState, setAccessState] = useState(lead.accessState);
  const [calledAt, setCalledAt] = useState(lead.calledAt);
  const [unlockKey] = useState(() =>
    typeof crypto !== "undefined" ? crypto.randomUUID() : `${lead.id}-unlock`
  );
  const [unlockBusy, setUnlockBusy] = useState(false);
  const [needsCredits, setNeedsCredits] = useState(false);
  const [cardError, setCardError] = useState<string | null>(null);
  const [remainingMs, setRemainingMs] = useState<number | null>(null);

  // Parent refetches replace the leads array wholesale; adopt fresh server
  // truth over any local optimistic state when it arrives.
  useEffect(() => {
    setAccessState(lead.accessState);
    setPhone(lead.tenantPhone);
    setCalledAt(lead.calledAt);
  }, [lead.accessState, lead.tenantPhone, lead.calledAt]);

  useEffect(() => {
    if (!callbackMode || !lead.callDeadlineAt || calledAt) {
      setRemainingMs(null);
      return;
    }
    const tick = () => setRemainingMs(new Date(lead.callDeadlineAt!).getTime() - Date.now());
    tick();
    const timer = setInterval(tick, 60_000);
    return () => clearInterval(timer);
  }, [callbackMode, lead.callDeadlineAt, calledAt]);

  async function handleUnlock() {
    if (!accessToken) return;
    setUnlockBusy(true);
    setCardError(null);
    try {
      const res = await unlockLead(accessToken, lead.id, unlockKey);
      setPhone(res.tenantPhone);
      setAccessState("unlocked");
      setNeedsCredits(false);
      trackEvent("lead_unlocked", { lead_id: lead.id });
      onLeadPatch?.({ accessState: "unlocked", tenantPhone: res.tenantPhone });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unable to unlock lead";
      if (err instanceof ApiError && err.code === "insufficient_credits") setNeedsCredits(true);
      else if (message.toLowerCase().includes("insufficient")) setNeedsCredits(true);
      else setCardError(message);
    } finally {
      setUnlockBusy(false);
    }
  }

  async function handleCall() {
    if (!accessToken) return;
    try {
      const res = await recordLeadCallClick(accessToken, lead.id);
      trackEvent("call_clicked", { lead_id: lead.id });
      setCalledAt(res.calledAt);
      onLeadPatch?.({ calledAt: res.calledAt });
      window.location.href = res.tel;
    } catch (err) {
      setCardError(err instanceof Error ? err.message : "Unable to start call");
    }
  }

  function formatRemaining(ms: number) {
    if (ms <= 0) return "expired";
    const h = Math.floor(ms / 3_600_000);
    const m = Math.floor((ms % 3_600_000) / 60_000);
    return `${h}h ${m}m left`;
  }

  if (!callbackMode) return null;

  const gap = compact ? "var(--space-1)" : "var(--space-2)";

  return (
    <div style={{ marginTop: gap }} data-testid="lead-monetization">
      {accessState === "free" ? (
        <span className="caption" style={{ fontWeight: 700, color: "#166534" }}>
          {t(locale, "leadFreeBadge")}
        </span>
      ) : null}
      {remainingMs !== null && accessState !== "expired" ? (
        <span
          style={{
            marginLeft: "var(--space-2)",
            color: remainingMs < 6 * 3_600_000 ? "#b91c1c" : "var(--text-secondary)"
          }}
          className="caption"
        >
          ⏱ {formatRemaining(remainingMs)}
        </span>
      ) : null}

      {accessState === "locked" ? (
        <div style={{ marginTop: gap }}>
          <div style={{ filter: "blur(6px)", userSelect: "none" }} aria-hidden="true">
            <p>
              {lead.tenantName} · {lead.tenantPhoneMasked ?? "XXXXXXXX"}
            </p>
          </div>
          <button
            className="btn btn--primary btn--sm"
            onClick={() => void handleUnlock()}
            disabled={unlockBusy || !accessToken}
            style={{ marginTop: "var(--space-1)" }}
          >
            {unlockBusy ? "Unlocking…" : t(locale, "leadUnlockButton")}
          </button>
        </div>
      ) : null}

      {accessState === "free" || accessState === "unlocked" ? (
        <div style={{ marginTop: gap }}>
          {phone ? <p style={{ fontWeight: 700 }}>{phone}</p> : null}
          <button
            className="btn btn--primary btn--sm"
            onClick={() => void handleCall()}
            disabled={!accessToken}
          >
            {calledAt ? t(locale, "leadCallAgain") : t(locale, "leadCallNow")}
          </button>
          {!calledAt ? (
            <p
              className="caption"
              style={{ color: "var(--text-tertiary)", marginTop: "var(--space-1)" }}
            >
              {t(locale, "leadCallReminder")}
            </p>
          ) : null}
        </div>
      ) : null}

      {accessState === "expired" ? (
        <p className="caption" style={{ color: "var(--text-tertiary)", marginTop: gap }}>
          {t(locale, "leadExpired")}
        </p>
      ) : null}

      {needsCredits && accessToken ? (
        <LeadCreditsPanel
          accessToken={accessToken}
          locale={locale}
          onPurchased={() => void handleUnlock()}
        />
      ) : null}
      {cardError ? (
        <p className="alert alert--error" style={{ marginTop: gap }}>
          {cardError}
        </p>
      ) : null}
    </div>
  );
}
