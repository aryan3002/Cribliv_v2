"use client";

import { useState } from "react";
import { type LeadVm, type LeadStatus } from "../../lib/owner-api";
import { Clock, StickyNote } from "lucide-react";
import { LeadMonetizationControls } from "./lead-monetization-controls";
import { t, type Locale } from "../../lib/i18n";

interface LeadCardProps {
  lead: LeadVm;
  locale: Locale;
  onStatusChange: (leadId: string, newStatus: LeadStatus, notes?: string) => Promise<void>;
  updating?: boolean;
  accessToken?: string | null;
  onLeadPatch?: (leadId: string, patch: Partial<LeadVm>) => void;
}

const STATUS_CONFIG: Record<
  LeadStatus,
  { labelKey: string; color: string; bg: string; dot: string }
> = {
  new: { labelKey: "ownerLeadStatusNew", color: "#1d4ed8", bg: "#eff6ff", dot: "#3b82f6" },
  contacted: {
    labelKey: "ownerLeadStatusContacted",
    color: "#92400e",
    bg: "#fffbeb",
    dot: "#f59e0b"
  },
  visit_scheduled: {
    labelKey: "ownerLeadStatusVisitScheduled",
    color: "#3730a3",
    bg: "#eef2ff",
    dot: "#5046e5"
  },
  deal_done: {
    labelKey: "ownerLeadStatusDealDone",
    color: "#166534",
    bg: "#f0fdf4",
    dot: "#22c55e"
  },
  lost: { labelKey: "ownerLeadStatusLost", color: "#4b5563", bg: "#f9fafb", dot: "#9ca3af" }
};

const ACTIONS: Record<
  LeadStatus,
  Array<{ labelKey: string; next: LeadStatus; variant: "primary" | "secondary" | "danger" }>
> = {
  new: [
    { labelKey: "ownerLeadActionMarkContacted", next: "contacted", variant: "primary" },
    { labelKey: "ownerLeadActionMarkLost", next: "lost", variant: "danger" }
  ],
  contacted: [
    { labelKey: "ownerLeadActionScheduleVisit", next: "visit_scheduled", variant: "primary" },
    { labelKey: "ownerLeadActionMarkLost", next: "lost", variant: "danger" }
  ],
  visit_scheduled: [
    { labelKey: "ownerLeadActionDealDone", next: "deal_done", variant: "primary" },
    { labelKey: "ownerLeadActionMarkLost", next: "lost", variant: "danger" }
  ],
  deal_done: [],
  lost: [{ labelKey: "ownerLeadActionReopen", next: "new", variant: "secondary" }]
};

function formatDate(iso: string, locale: Locale) {
  try {
    return new Intl.DateTimeFormat(locale === "hi" ? "hi-IN" : "en-IN", {
      day: "numeric",
      month: "short",
      year: "numeric"
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

export function LeadCard({
  lead,
  locale,
  onStatusChange,
  updating,
  accessToken,
  onLeadPatch
}: LeadCardProps) {
  const [showNotes, setShowNotes] = useState(false);
  const [noteText, setNoteText] = useState(lead.ownerNotes ?? "");
  const [pendingStatus, setPendingStatus] = useState<LeadStatus | null>(null);

  const cfg = STATUS_CONFIG[lead.status];
  const statusLabel = t(locale, cfg.labelKey);

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
            {statusLabel}
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
        {accessToken ? (
          <LeadMonetizationControls
            lead={lead}
            accessToken={accessToken}
            locale={locale}
            onLeadPatch={(patch) => onLeadPatch?.(lead.id, patch)}
          />
        ) : null}

        {/* Dates */}
        <div className="lead-card__dates">
          <Clock size={11} aria-hidden="true" />
          <span>
            {t(locale, "ownerLeadEnquired").replace("{date}", formatDate(lead.createdAt, locale))}
          </span>
          {lead.statusChangedAt !== lead.createdAt && (
            <span className="lead-card__dates-sep">·</span>
          )}
          {lead.statusChangedAt !== lead.createdAt && (
            <span>
              {t(locale, "ownerLeadUpdated").replace(
                "{date}",
                formatDate(lead.statusChangedAt, locale)
              )}
            </span>
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
            {t(locale, "ownerLeadDealDoneMessage")}
          </div>
        )}

        {/* Notes textarea */}
        {showNotes && lead.status !== "deal_done" && (
          <textarea
            className="textarea lead-card__textarea"
            value={noteText}
            onChange={(e) => setNoteText(e.target.value)}
            placeholder={t(locale, "ownerLeadNotesPlaceholder")}
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
                      {t(locale, "ownerLeadSaving")}
                    </>
                  ) : (
                    t(locale, action.labelKey)
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
              {showNotes
                ? t(locale, "ownerLeadHideNotes")
                : lead.ownerNotes
                  ? t(locale, "ownerLeadEditNotes")
                  : t(locale, "ownerLeadAddNotes")}
            </button>
          </div>
        )}
      </div>
    </article>
  );
}
