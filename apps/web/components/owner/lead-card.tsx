"use client";

import { useState } from "react";
import type { LeadVm, LeadStatus } from "../../lib/owner-api";

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
    lost: { label: "Lost", color: "#6b7280", bg: "#f9fafb", dot: "#9ca3af" }
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
    <article
      className="card"
      style={{
        borderRadius: "var(--radius-lg)",
        overflow: "hidden",
        opacity: updating ? 0.6 : 1,
        transition: "opacity var(--transition-fast)"
      }}
    >
      {/* Top color accent bar */}
      <div style={{ height: 3, background: cfg.dot }} />

      <div className="card__body" style={{ padding: "var(--space-4)" }}>
        {/* Header: listing title + status pill */}
        <div
          style={{
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "space-between",
            gap: "var(--space-2)",
            marginBottom: "var(--space-3)"
          }}
        >
          <h4
            style={{
              fontFamily: "var(--font-heading)",
              fontSize: 14,
              fontWeight: 600,
              color: "var(--text-primary)",
              lineHeight: 1.3,
              margin: 0,
              flex: 1,
              display: "-webkit-box",
              WebkitLineClamp: 2,
              WebkitBoxOrient: "vertical",
              overflow: "hidden"
            }}
          >
            {lead.listingTitle}
          </h4>
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 5,
              padding: "3px 10px",
              borderRadius: "var(--radius-full)",
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: "0.02em",
              background: cfg.bg,
              color: cfg.color,
              flexShrink: 0,
              whiteSpace: "nowrap"
            }}
          >
            <span
              style={{
                width: 6,
                height: 6,
                borderRadius: "50%",
                background: cfg.dot,
                flexShrink: 0
              }}
            />
            {cfg.label}
          </span>
        </div>

        {/* Tenant info */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "var(--space-3)",
            padding: "var(--space-3)",
            background: "var(--surface-sunken)",
            borderRadius: "var(--radius-md)",
            marginBottom: "var(--space-3)"
          }}
        >
          <div
            style={{
              width: 36,
              height: 36,
              borderRadius: "50%",
              background: "var(--brand-light)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 14,
              fontWeight: 700,
              color: "var(--brand)",
              flexShrink: 0
            }}
          >
            {lead.tenantName.charAt(0).toUpperCase()}
          </div>
          <div style={{ minWidth: 0 }}>
            <p
              style={{
                fontSize: 14,
                fontWeight: 600,
                color: "var(--text-primary)",
                margin: 0,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap"
              }}
            >
              {lead.tenantName}
            </p>
            {lead.tenantPhoneMasked && (
              <p style={{ fontSize: 12, color: "var(--text-secondary)", margin: 0 }}>
                {lead.tenantPhoneMasked}
              </p>
            )}
          </div>
        </div>

        {/* Dates */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: "var(--space-3)",
            fontSize: 12,
            color: "var(--text-tertiary)"
          }}
        >
          <span>Enquired {formatDate(lead.createdAt)}</span>
          {lead.statusChangedAt !== lead.createdAt && (
            <span>Updated {formatDate(lead.statusChangedAt)}</span>
          )}
        </div>

        {/* Existing notes preview */}
        {lead.ownerNotes && !showNotes && (
          <div
            style={{
              padding: "var(--space-2) var(--space-3)",
              background: "var(--amber-light)",
              borderRadius: "var(--radius-sm)",
              fontSize: 12,
              color: "#78350f",
              marginBottom: "var(--space-3)",
              borderLeft: "3px solid var(--amber)"
            }}
          >
            {lead.ownerNotes}
          </div>
        )}

        {/* Deal Done terminal state */}
        {lead.status === "deal_done" && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "var(--space-2)",
              padding: "var(--space-3)",
              background: "rgba(34,197,94,0.08)",
              borderRadius: "var(--radius-md)",
              fontSize: 13,
              fontWeight: 600,
              color: "#166534"
            }}
          >
            <span style={{ fontSize: 16 }}>✅</span>
            Deal completed
          </div>
        )}

        {/* Notes textarea (collapsible) */}
        {showNotes && lead.status !== "deal_done" && (
          <div style={{ marginBottom: "var(--space-3)" }}>
            <textarea
              className="textarea"
              value={noteText}
              onChange={(e) => setNoteText(e.target.value)}
              placeholder="Add notes about this lead…"
              style={{ minHeight: 72, fontSize: 13 }}
            />
          </div>
        )}

        {/* Action buttons */}
        {lead.status !== "deal_done" && (
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: "var(--space-2)",
              marginTop: "var(--space-2)"
            }}
          >
            <div style={{ display: "flex", gap: "var(--space-2)", flexWrap: "wrap" }}>
              {ACTIONS[lead.status].map((action) => (
                <button
                  key={action.next}
                  type="button"
                  disabled={updating || pendingStatus !== null}
                  onClick={() => void handleAction(action.next)}
                  className={`btn btn--sm btn--${action.variant}`}
                  style={{ flex: action.variant === "primary" ? 1 : "none", minWidth: 0 }}
                >
                  {pendingStatus === action.next ? (
                    <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <span
                        style={{
                          width: 12,
                          height: 12,
                          border: "2px solid currentColor",
                          borderTopColor: "transparent",
                          borderRadius: "50%",
                          display: "inline-block",
                          animation: "spin 0.7s linear infinite"
                        }}
                      />
                      Saving…
                    </span>
                  ) : (
                    action.label
                  )}
                </button>
              ))}
            </div>

            <button
              type="button"
              onClick={() => setShowNotes((v) => !v)}
              style={{
                background: "none",
                border: "none",
                cursor: "pointer",
                fontSize: 12,
                color: "var(--text-tertiary)",
                textAlign: "left",
                padding: 0,
                display: "flex",
                alignItems: "center",
                gap: 4
              }}
            >
              <span style={{ fontSize: 10 }}>{showNotes ? "▲" : "▼"}</span>
              {showNotes ? "Hide notes" : lead.ownerNotes ? "Edit notes" : "Add notes"}
            </button>
          </div>
        )}
      </div>

      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
      `}</style>
    </article>
  );
}
