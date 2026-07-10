"use client";

import { useEffect, useState } from "react";
import { unlockLead, recordLeadCallClick, type LeadVm, type LeadStatus } from "../../lib/owner-api";
import { Clock, StickyNote } from "lucide-react";
import { LeadCreditsPanel } from "./lead-credits-panel";
import { useFlag } from "../../lib/feature-flags";
import { trackEvent } from "../../lib/analytics";
import { ApiError } from "../../lib/api";

interface LeadCardProps {
  lead: LeadVm;
  onStatusChange: (leadId: string, newStatus: LeadStatus, notes?: string) => Promise<void>;
  updating?: boolean;
  accessToken?: string | null;
}

const STATUS_CONFIG: Record<LeadStatus, { label: string; color: string; bg: string; dot: string }> =
  {
    new: { label: "New", color: "#1d4ed8", bg: "#eff6ff", dot: "#3b82f6" },
    contacted: { label: "Contacted", color: "#92400e", bg: "#fffbeb", dot: "#f59e0b" },
    visit_scheduled: { label: "Visit Scheduled", color: "#3730a3", bg: "#eef2ff", dot: "#5046e5" },
    deal_done: { label: "Deal Done", color: "#166534", bg: "#f0fdf4", dot: "#22c55e" },
    lost: { label: "Lost", color: "#4b5563", bg: "#f9fafb", dot: "#9ca3af" }
  };

const ACTIONS: Record<
  LeadStatus,
  Array<{ label: string; next: LeadStatus; variant: "primary" | "secondary" | "danger" }>
> = {
  new: [
    { label: "Mark Contacted", next: "contacted", variant: "primary" },
    { label: "Mark Lost", next: "lost", variant: "danger" }
  ],
  contacted: [
    { label: "Schedule Visit", next: "visit_scheduled", variant: "primary" },
    { label: "Mark Lost", next: "lost", variant: "danger" }
  ],
  visit_scheduled: [
    { label: "Deal Done ✓", next: "deal_done", variant: "primary" },
    { label: "Mark Lost", next: "lost", variant: "danger" }
  ],
  deal_done: [],
  lost: [{ label: "Re-open", next: "new", variant: "secondary" }]
};

function formatDate(iso: string) {
  try {
    return new Intl.DateTimeFormat("en-IN", {
      day: "numeric",
      month: "short",
      year: "numeric"
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

export function LeadCard({ lead, onStatusChange, updating, accessToken }: LeadCardProps) {
  const [showNotes, setShowNotes] = useState(false);
  const [noteText, setNoteText] = useState(lead.ownerNotes ?? "");
  const [pendingStatus, setPendingStatus] = useState<LeadStatus | null>(null);

  const cfg = STATUS_CONFIG[lead.status];

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

  async function handleAction(next: LeadStatus) {
    setPendingStatus(next);
    try {
      await onStatusChange(lead.id, next, noteText.trim() || undefined);
    } finally {
      setPendingStatus(null);
    }
  }

  return (
    <article className="lead-card" style={{ opacity: updating ? 0.65 : 1 }}>
      {/* Status accent bar at top */}
      <div className="lead-card__accent" style={{ background: cfg.dot }} />

      <div className="lead-card__inner">
        {/* Header: listing title + status */}
        <div className="lead-card__header">
          <h4 className="lead-card__listing-title">{lead.listingTitle}</h4>
          <span className="lead-card__status" style={{ background: cfg.bg, color: cfg.color }}>
            <span className="lead-card__status-dot" style={{ background: cfg.dot }} />
            {cfg.label}
          </span>
        </div>

        {/* Tenant info */}
        <div className="lead-card__tenant">
          <div className="lead-card__avatar">{lead.tenantName.charAt(0).toUpperCase()}</div>
          <div className="lead-card__tenant-info">
            <p className="lead-card__tenant-name">{lead.tenantName}</p>
            {lead.tenantPhoneMasked && (
              <p className="lead-card__tenant-phone">{lead.tenantPhoneMasked}</p>
            )}
          </div>
        </div>

        {/* Lead monetization strip: countdown, blur/unlock, call-now, buy credits */}
        {callbackMode ? (
          <div style={{ marginTop: "var(--space-2)" }} data-testid="lead-monetization">
            {accessState === "free" ? (
              <span className="caption" style={{ fontWeight: 700, color: "#166534" }}>
                FREE LEAD
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
              <div style={{ marginTop: "var(--space-2)" }}>
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
                  {unlockBusy ? "Unlocking…" : "Unlock for 1 credit"}
                </button>
              </div>
            ) : null}

            {accessState === "free" || accessState === "unlocked" ? (
              <div style={{ marginTop: "var(--space-2)" }}>
                {phone ? <p style={{ fontWeight: 700 }}>{phone}</p> : null}
                <button
                  className="btn btn--primary btn--sm"
                  onClick={() => void handleCall()}
                  disabled={!accessToken}
                >
                  {calledAt ? "Call again" : "Call now"}
                </button>
                {!calledAt ? (
                  <p
                    className="caption"
                    style={{ color: "var(--text-tertiary)", marginTop: "var(--space-1)" }}
                  >
                    Call before the timer ends or the tenant is refunded.
                  </p>
                ) : null}
              </div>
            ) : null}

            {accessState === "expired" ? (
              <p
                className="caption"
                style={{ color: "var(--text-tertiary)", marginTop: "var(--space-2)" }}
              >
                Expired — respond faster next time.
              </p>
            ) : null}

            {needsCredits && accessToken ? (
              <LeadCreditsPanel accessToken={accessToken} onPurchased={() => void handleUnlock()} />
            ) : null}
            {cardError ? (
              <p className="alert alert--error" style={{ marginTop: "var(--space-2)" }}>
                {cardError}
              </p>
            ) : null}
          </div>
        ) : null}

        {/* Dates */}
        <div className="lead-card__dates">
          <Clock size={11} aria-hidden="true" />
          <span>Enquired {formatDate(lead.createdAt)}</span>
          {lead.statusChangedAt !== lead.createdAt && (
            <span className="lead-card__dates-sep">·</span>
          )}
          {lead.statusChangedAt !== lead.createdAt && (
            <span>Updated {formatDate(lead.statusChangedAt)}</span>
          )}
        </div>

        {/* Existing notes preview */}
        {lead.ownerNotes && !showNotes && (
          <div className="lead-card__notes-preview">
            <StickyNote size={11} aria-hidden="true" />
            {lead.ownerNotes}
          </div>
        )}

        {/* Deal done terminal state */}
        {lead.status === "deal_done" && (
          <div className="lead-card__deal-done">
            <span aria-hidden="true">🎉</span>
            Deal completed — great work!
          </div>
        )}

        {/* Notes textarea */}
        {showNotes && lead.status !== "deal_done" && (
          <textarea
            className="textarea lead-card__textarea"
            value={noteText}
            onChange={(e) => setNoteText(e.target.value)}
            placeholder="Add notes about this lead…"
          />
        )}

        {/* Actions */}
        {lead.status !== "deal_done" && (
          <div className="lead-card__actions">
            <div className="lead-card__action-btns">
              {ACTIONS[lead.status].map((action) => (
                <button
                  key={action.next}
                  type="button"
                  disabled={updating || pendingStatus !== null}
                  onClick={() => void handleAction(action.next)}
                  className={`btn btn--sm btn--${action.variant}${action.variant === "primary" ? " lead-card__action-primary" : ""}`}
                >
                  {pendingStatus === action.next ? (
                    <>
                      <span className="lead-card__spinner" aria-hidden="true" />
                      Saving…
                    </>
                  ) : (
                    action.label
                  )}
                </button>
              ))}
            </div>

            <button
              type="button"
              className="lead-card__notes-toggle"
              onClick={() => setShowNotes((v) => !v)}
            >
              <StickyNote size={12} aria-hidden="true" />
              {showNotes ? "Hide notes" : lead.ownerNotes ? "Edit notes" : "Add notes"}
            </button>
          </div>
        )}
      </div>
    </article>
  );
}
