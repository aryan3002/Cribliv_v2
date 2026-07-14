"use client";

import { useEffect, useState, type MouseEvent } from "react";
import { Bell, Check, Phone, Undo2 } from "lucide-react";
import type { AdminLeadBoardRow, AdminLeadTimelineEvent } from "@cribliv/shared-types";
import { Drawer } from "../primitives/Drawer";
import { ConfirmDialog } from "../primitives/ConfirmDialog";
import { EmptyState } from "../primitives/EmptyState";
import { StatusPill, type PillTone } from "../primitives/StatusPill";
import { ApiError } from "../../../lib/api";
import {
  fetchAdminLeadTimeline,
  markAdminLeadTeamCalled,
  nudgeAdminLeadOwner,
  refundAdminLead
} from "../../../lib/admin-api";
import { formatRelativeTime } from "../../../lib/admin/format";

type ToastFn = (message: string, tone?: "trust" | "warn" | "danger") => void;

/* ── Shared row/footer actions (Call / Mark handled / Nudge owner / Refund) ──
 * Reused by LeadBoard's Actions column (compact, icon-only) and LeadDrawer's
 * footer (full labels). Always re-runs the board fetch after a successful
 * action instead of mutating local state — optimistic-refetch, not
 * optimistic mutation, per the brief. The caller's `onDone` is responsible
 * for that refetch (LeadBoard bumps a refresh nonce; LeadDrawer also chains
 * its own timeline refetch through the same callback).
 */
interface LeadActionsProps {
  row: AdminLeadBoardRow;
  accessToken: string;
  onToast: ToastFn;
  onDone: () => void;
  /** Row-cell rendering: icon-only buttons. Omit for full labelled buttons (drawer footer). */
  compact?: boolean;
}

export function LeadRowActions({ row, accessToken, onToast, onDone, compact }: LeadActionsProps) {
  const [busy, setBusy] = useState<"call" | "nudge" | "refund" | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const alreadyCalled = row.called_at != null;
  // access_state === "free" only means the owner's first-two-free-leads
  // quota hasn't been used — it says nothing about whether a refundable
  // contact_unlock exists, so it must NOT gate refund availability here.
  // The real no-unlock case is caught at click time by the backend's
  // `no_unlock` 409 handler below.
  const refundAvailable = row.refund_state === "pending";
  const sizeClass = compact ? " admin-btn--icon admin-btn--sm" : "";

  async function handleMarkCalled(e: MouseEvent) {
    e.stopPropagation();
    if (busy) return;
    setBusy("call");
    try {
      await markAdminLeadTeamCalled(accessToken, row.lead_id);
      onToast("Marked as called", "trust");
      onDone();
    } catch (err) {
      if (err instanceof ApiError && err.code === "already_called") {
        onToast("Already marked as called", "warn");
      } else {
        onToast(err instanceof Error ? err.message : "Failed to mark as called", "danger");
      }
    } finally {
      setBusy(null);
    }
  }

  async function handleNudge(e: MouseEvent) {
    e.stopPropagation();
    if (busy) return;
    setBusy("nudge");
    try {
      const res = await nudgeAdminLeadOwner(accessToken, row.lead_id);
      onToast(
        res.nudged ? "Owner nudged" : "Already nudged recently / owner unreachable",
        res.nudged ? "trust" : "warn"
      );
      onDone();
    } catch (err) {
      onToast(err instanceof Error ? err.message : "Failed to nudge owner", "danger");
    } finally {
      setBusy(null);
    }
  }

  async function handleRefundConfirm() {
    setBusy("refund");
    try {
      await refundAdminLead(accessToken, row.lead_id, "admin manual refund");
      onToast("Refunded 1 credit to the seeker", "trust");
      setConfirmOpen(false);
      onDone();
    } catch (err) {
      if (err instanceof ApiError && err.code === "already_responded") {
        onToast("Owner already responded — nothing to refund", "warn");
        setConfirmOpen(false);
      } else if (err instanceof ApiError && err.code === "already_refunded") {
        onToast("Already refunded", "warn");
        setConfirmOpen(false);
      } else if (err instanceof ApiError && err.code === "no_unlock") {
        onToast("Lead has no linked callback to refund", "warn");
        setConfirmOpen(false);
      } else {
        onToast(err instanceof Error ? err.message : "Refund failed", "danger");
      }
    } finally {
      setBusy(null);
    }
  }

  return (
    <div
      style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}
      onClick={(e) => e.stopPropagation()}
    >
      <a
        href={`tel:${row.seeker.phone_e164}`}
        className={`admin-btn admin-btn--ghost${sizeClass}`}
        aria-label={compact ? `Call ${row.seeker.name}` : undefined}
        title={compact ? `Call ${row.seeker.name}` : undefined}
        onClick={(e) => e.stopPropagation()}
      >
        <Phone size={12} aria-hidden="true" />
        {!compact && "Call"}
      </a>
      <button
        type="button"
        className={`admin-btn admin-btn--ghost${sizeClass}`}
        onClick={handleMarkCalled}
        disabled={busy != null || alreadyCalled}
        aria-label={compact ? "Mark handled" : undefined}
        title={alreadyCalled ? "Already marked as called" : compact ? "Mark handled" : undefined}
      >
        <Check size={12} aria-hidden="true" />
        {!compact && "Mark handled"}
      </button>
      <button
        type="button"
        className={`admin-btn admin-btn--ghost${sizeClass}`}
        onClick={handleNudge}
        disabled={busy != null}
        aria-label={compact ? "Nudge owner" : undefined}
        title={compact ? "Nudge owner" : undefined}
      >
        <Bell size={12} aria-hidden="true" />
        {!compact && "Nudge owner"}
      </button>
      <button
        type="button"
        className={`admin-btn admin-btn--danger${sizeClass}`}
        onClick={(e) => {
          e.stopPropagation();
          setConfirmOpen(true);
        }}
        disabled={busy != null || !refundAvailable}
        aria-label={compact ? "Refund" : undefined}
        title={
          !refundAvailable
            ? `Refund unavailable (${row.refund_state})`
            : compact
              ? "Refund"
              : undefined
        }
      >
        <Undo2 size={12} aria-hidden="true" />
        {!compact && "Refund"}
      </button>

      <ConfirmDialog
        open={confirmOpen}
        title="Refund seeker?"
        body="Refund 1 credit to the seeker? This stops the guarantee clock and expires a locked lead."
        confirmLabel="Refund"
        destructive
        busy={busy === "refund"}
        onConfirm={handleRefundConfirm}
        onCancel={() => setConfirmOpen(false)}
      />
    </div>
  );
}

/* ── Timeline event display helpers ─────────────────────────────────────── */

// event.source has no entry in StatusPill's default tone map, so it would
// otherwise render flat grey for every event — same reasoning as LeadBoard's
// ACCESS_TONE constant.
const SOURCE_TONE: Record<AdminLeadTimelineEvent["source"], PillTone> = {
  lead: "brand",
  contact: "trust",
  admin: "warn"
};

function humanizeKind(kind: string): string {
  return kind.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());
}

/* ── Human-readable event lines ──────────────────────────────────────────
 * The timeline unions three sources (lead_events / contact_events /
 * admin_actions), so `kind` is a status, an event_type, or an action, and
 * `detail` is a status, a reason, or a raw metadata JSON blob. Rendering
 * `detail` verbatim leaked JSON like `owner responded — {"channel":"call"}`
 * onto an admin surface. describeEvent maps each known event to a plain
 * label + optional note, and falls back to a humanized kind for anything
 * new so an unmapped event still reads sensibly (never as JSON).
 */
const LEAD_STATUS_LABEL: Record<string, string> = {
  new: "Lead created",
  contacted: "Owner marked contacted",
  visit_scheduled: "Visit scheduled",
  deal_done: "Deal done",
  lost: "Lead lost"
};

const CONTACT_EVENT_LABEL: Record<string, string> = {
  unlock_created: "Unlock created",
  owner_responded: "Owner responded",
  refund_issued: "Refund issued"
};

const ADMIN_ACTION_LABEL: Record<string, string> = {
  nudge_owner: "Admin nudged owner",
  lead_manual_refund: "Admin refunded seeker",
  mark_team_called: "Team marked as called"
};

const CHANNEL_LABEL: Record<string, string> = {
  call: "call",
  whatsapp: "WhatsApp",
  sms: "SMS"
};

function parseMeta(detail: string | null): Record<string, unknown> | null {
  const t = detail?.trim();
  if (!t || !t.startsWith("{")) return null;
  try {
    const v = JSON.parse(t);
    return v && typeof v === "object" ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export function describeEvent(ev: AdminLeadTimelineEvent): { label: string; note?: string } {
  if (ev.source === "contact") {
    const label = CONTACT_EVENT_LABEL[ev.kind] ?? humanizeKind(ev.kind);
    if (ev.kind === "unlock_created") return { label, note: "seeker spent 1 credit" };
    if (ev.kind === "refund_issued") return { label, note: "1 credit returned to seeker" };
    if (ev.kind === "owner_responded") {
      const meta = parseMeta(ev.detail);
      const channel = typeof meta?.channel === "string" ? meta.channel : null;
      const note = channel ? `via ${CHANNEL_LABEL[channel] ?? channel}` : undefined;
      return { label, note };
    }
    return { label };
  }
  if (ev.source === "admin") {
    const label = ADMIN_ACTION_LABEL[ev.kind] ?? humanizeKind(ev.kind);
    // detail here is admin_actions.reason — a human string, never JSON.
    const reason = ev.detail?.trim();
    return { label, note: reason && !reason.startsWith("{") ? reason : undefined };
  }
  // lead_events: kind is a note (e.g. "admin_nudged_owner") or a to_status.
  if (ev.kind === "admin_nudged_owner") return { label: "Owner nudged" };
  const statusLabel = LEAD_STATUS_LABEL[ev.kind];
  if (statusLabel) return { label: statusLabel };
  return { label: humanizeKind(ev.kind) };
}

// `actor` is sometimes a raw user uuid (lead_events.actor_user_id /
// admin_actions.admin_user_id) and sometimes a short role string
// (contact_events.actor_role, e.g. "owner"/"seeker") — truncate only the
// former so the chip stays compact without mangling the latter.
function shortActor(actor: string): string {
  return actor.length > 12 ? `${actor.slice(0, 8)}…` : actor;
}

/* ── LeadDrawer ────────────────────────────────────────────────────────── */

interface DrawerProps {
  row: AdminLeadBoardRow | null;
  onClose: () => void;
  accessToken: string;
  onToast: ToastFn;
  /** Called after any row action succeeds — the parent should re-run the board fetch. */
  onActionDone: () => void;
}

export function LeadDrawer({ row, onClose, accessToken, onToast, onActionDone }: DrawerProps) {
  const [events, setEvents] = useState<AdminLeadTimelineEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshNonce, setRefreshNonce] = useState(0);

  const leadId = row?.lead_id ?? null;

  useEffect(() => {
    if (!leadId) {
      setEvents([]);
      setError(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    setEvents([]); // drop the previously-viewed lead's timeline (or the pre-refresh one)
    fetchAdminLeadTimeline(accessToken, leadId)
      .then((res) => {
        if (cancelled) return;
        setEvents(res.events ?? []);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Failed to load timeline");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [leadId, accessToken, refreshNonce]);

  function handleActionDone() {
    onActionDone(); // parent: refetch the board (row's called_at/refund_state flow back as new props)
    setRefreshNonce((n) => n + 1); // local: refetch this lead's timeline to show the new event
  }

  return (
    <Drawer
      open={row != null}
      onClose={onClose}
      title={row?.seeker.name}
      subtitle={row?.listing_title}
      footer={
        row ? (
          <LeadRowActions
            row={row}
            accessToken={accessToken}
            onToast={onToast}
            onDone={handleActionDone}
          />
        ) : undefined
      }
    >
      {loading && <div style={{ color: "var(--ad-text-3)" }}>Loading…</div>}
      {!loading && error && <EmptyState title="Couldn't load timeline" hint={error} />}
      {!loading && !error && events.length === 0 && (
        <EmptyState
          title="No activity yet"
          hint="Events will appear here as this lead progresses."
        />
      )}
      {!loading && !error && events.length > 0 && (
        <div className="admin-feed">
          {events.map((ev, i) => {
            const { label, note } = describeEvent(ev);
            return (
              <div className="admin-feed__item" key={`${ev.source}-${ev.at}-${i}`}>
                <span className="admin-feed__dot" aria-hidden="true" />
                <div>
                  <div className="admin-feed__summary">
                    <strong>{label}</strong>
                    {note && <span style={{ color: "var(--ad-text-2)" }}> · {note}</span>}
                  </div>
                  <div className="admin-feed__meta">
                    <StatusPill status={ev.source} tone={SOURCE_TONE[ev.source] ?? "muted"} noDot />
                    {ev.actor && <span className="admin-feed__chip">{shortActor(ev.actor)}</span>}
                  </div>
                </div>
                <span className="admin-feed__time">{formatRelativeTime(ev.at)}</span>
              </div>
            );
          })}
        </div>
      )}
    </Drawer>
  );
}
