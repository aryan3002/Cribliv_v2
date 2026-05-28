"use client";

import { useState } from "react";
import type { LeadVm, LeadStatus } from "../../lib/owner-api";
import { Clock, StickyNote } from "lucide-react";

interface LeadCardProps {
  lead: LeadVm;
  onStatusChange: (leadId: string, newStatus: LeadStatus, notes?: string) => Promise<void>;
  updating?: boolean;
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

export function LeadCard({ lead, onStatusChange, updating }: LeadCardProps) {
  const [showNotes, setShowNotes] = useState(false);
  const [noteText, setNoteText] = useState(lead.ownerNotes ?? "");
  const [pendingStatus, setPendingStatus] = useState<LeadStatus | null>(null);

  const cfg = STATUS_CONFIG[lead.status];

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
