"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  DragDropContext,
  Droppable,
  Draggable,
  type DropResult,
  type DraggableProvided,
  type DraggableStateSnapshot,
  type DroppableStateSnapshot
} from "@hello-pangea/dnd";
import {
  Clock,
  GripVertical,
  Inbox,
  Phone,
  CalendarCheck,
  CheckCircle2,
  XCircle,
  StickyNote
} from "lucide-react";
import { updateLeadStatus, type LeadVm, type LeadStatus } from "../../lib/owner-api";
import { track } from "../../lib/track";
import "./lead-kanban.css";

// Mirror of VALID_TRANSITIONS in apps/api/src/modules/leads/leads.service.ts.
// Drops outside this graph snap back without a network round-trip.
const VALID_TRANSITIONS: Record<LeadStatus, LeadStatus[]> = {
  new: ["contacted", "lost"],
  contacted: ["visit_scheduled", "lost"],
  visit_scheduled: ["deal_done", "lost"],
  deal_done: [],
  lost: ["new"]
};

interface ColumnDef {
  status: LeadStatus;
  label: string;
  rail: string;
  Icon: typeof Inbox;
}

const COLUMNS: ColumnDef[] = [
  { status: "new", label: "New", rail: "#3b82f6", Icon: Inbox },
  { status: "contacted", label: "Contacted", rail: "#f59e0b", Icon: Phone },
  { status: "visit_scheduled", label: "Visit scheduled", rail: "#5046e5", Icon: CalendarCheck },
  { status: "deal_done", label: "Deal done", rail: "#22c55e", Icon: CheckCircle2 },
  { status: "lost", label: "Lost", rail: "#9ca3af", Icon: XCircle }
];

const COLUMN_LOOKUP: Record<LeadStatus, ColumnDef> = COLUMNS.reduce(
  (acc, c) => {
    acc[c.status] = c;
    return acc;
  },
  {} as Record<LeadStatus, ColumnDef>
);

const STEPPER_ACTIONS: Record<
  LeadStatus,
  Array<{ label: string; next: LeadStatus; variant: "primary" | "secondary" | "danger" }>
> = {
  new: [
    { label: "Mark Contacted", next: "contacted", variant: "primary" },
    { label: "Lost", next: "lost", variant: "danger" }
  ],
  contacted: [
    { label: "Schedule visit", next: "visit_scheduled", variant: "primary" },
    { label: "Lost", next: "lost", variant: "danger" }
  ],
  visit_scheduled: [
    { label: "Deal done", next: "deal_done", variant: "primary" },
    { label: "Lost", next: "lost", variant: "danger" }
  ],
  deal_done: [],
  lost: [{ label: "Re-open", next: "new", variant: "secondary" }]
};

function formatDate(iso: string) {
  try {
    return new Intl.DateTimeFormat("en-IN", {
      day: "numeric",
      month: "short"
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

interface KanbanProps {
  accessToken: string;
  leads: LeadVm[];
  onLeadsChange: (next: LeadVm[]) => void;
  searchQuery: string;
  enableDrag: boolean;
}

export function LeadKanban({
  accessToken,
  leads,
  onLeadsChange,
  searchQuery,
  enableDrag
}: KanbanProps) {
  const [updating, setUpdating] = useState<string | null>(null);
  const [toast, setToast] = useState<{ msg: string; isError?: boolean } | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function showToast(msg: string, isError = false) {
    setToast({ msg, isError });
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 3000);
  }

  useEffect(
    () => () => {
      if (toastTimer.current) clearTimeout(toastTimer.current);
    },
    []
  );

  // Filter once, then bucket by status.
  const grouped = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const filtered = q
      ? leads.filter(
          (l) =>
            l.tenantName.toLowerCase().includes(q) ||
            l.listingTitle.toLowerCase().includes(q) ||
            (l.tenantPhoneMasked ?? "").toLowerCase().includes(q)
        )
      : leads;
    const buckets: Record<LeadStatus, LeadVm[]> = {
      new: [],
      contacted: [],
      visit_scheduled: [],
      deal_done: [],
      lost: []
    };
    for (const lead of filtered) buckets[lead.status].push(lead);
    return buckets;
  }, [leads, searchQuery]);

  async function moveLead(leadId: string, from: LeadStatus, to: LeadStatus) {
    if (from === to) return;
    if (!VALID_TRANSITIONS[from].includes(to)) {
      const allowed = VALID_TRANSITIONS[from].map((s) => COLUMN_LOOKUP[s].label).join(" or ");
      showToast(
        allowed ? `Move to ${allowed} first.` : `Can't move from ${COLUMN_LOOKUP[from].label}.`,
        true
      );
      return;
    }
    const prev = leads;
    const next = leads.map((l) =>
      l.id === leadId ? { ...l, status: to, statusChangedAt: new Date().toISOString() } : l
    );
    onLeadsChange(next);
    setUpdating(leadId);
    try {
      await updateLeadStatus(accessToken, leadId, to);
      track("lead_status_changed", {
        lead_id: leadId,
        from_status: from,
        to_status: to
      });
      showToast(`Moved to ${COLUMN_LOOKUP[to].label}`);
    } catch (err) {
      onLeadsChange(prev);
      const msg = err instanceof Error ? err.message : "Failed to update lead";
      showToast(msg, true);
    } finally {
      setUpdating(null);
    }
  }

  function handleDragEnd(result: DropResult) {
    const { source, destination, draggableId } = result;
    if (!destination) return;
    const from = source.droppableId as LeadStatus;
    const to = destination.droppableId as LeadStatus;
    track("kanban_card_dragged", {
      lead_id: draggableId,
      from_status: from,
      to_status: to,
      valid: VALID_TRANSITIONS[from].includes(to)
    });
    void moveLead(draggableId, from, to);
  }

  const board = (
    <div className="lk-board" role="list" aria-label="Leads pipeline">
      {COLUMNS.map((col) => {
        const items = grouped[col.status];
        const Icon = col.Icon;
        return (
          <Droppable droppableId={col.status} key={col.status} isDropDisabled={!enableDrag}>
            {(droppableProvided, snapshot: DroppableStateSnapshot) => {
              const dragging = snapshot.isDraggingOver;
              const draggingFrom =
                snapshot.draggingFromThisWith ??
                (typeof window !== "undefined"
                  ? document
                      .querySelector("[data-rfd-draggable-id][data-rfd-dragging='true']")
                      ?.getAttribute("data-from-status")
                  : null);
              const invalid =
                dragging &&
                draggingFrom &&
                draggingFrom !== col.status &&
                !VALID_TRANSITIONS[draggingFrom as LeadStatus]?.includes(col.status);
              return (
                <section
                  className="lk-col"
                  data-dragging-over={dragging ? "true" : "false"}
                  data-invalid-drop={invalid ? "true" : "false"}
                  ref={droppableProvided.innerRef}
                  {...droppableProvided.droppableProps}
                  aria-label={`${col.label} column, ${items.length} leads`}
                >
                  <header className="lk-col__header">
                    <span
                      className="lk-col__rail"
                      style={{ background: col.rail }}
                      aria-hidden="true"
                    />
                    <Icon size={14} aria-hidden="true" style={{ color: col.rail }} />
                    <h3 className="lk-col__title">{col.label}</h3>
                    <span className="lk-col__count">{items.length}</span>
                  </header>

                  <div className="lk-col__list">
                    {items.length === 0 && <div className="lk-empty">No leads here yet</div>}
                    {items.map((lead, index) => (
                      <Draggable
                        key={lead.id}
                        draggableId={lead.id}
                        index={index}
                        isDragDisabled={!enableDrag || updating === lead.id}
                      >
                        {(provided: DraggableProvided, snap: DraggableStateSnapshot) => (
                          <article
                            className="lk-card"
                            data-dragging={snap.isDragging ? "true" : "false"}
                            data-from-status={lead.status}
                            ref={provided.innerRef}
                            {...provided.draggableProps}
                            {...provided.dragHandleProps}
                            style={{
                              ...provided.draggableProps.style,
                              opacity: updating === lead.id ? 0.6 : 1
                            }}
                          >
                            <span
                              className="lk-card__rail"
                              style={{ background: col.rail }}
                              aria-hidden="true"
                            />
                            <div className="lk-card__body">
                              <div className="lk-card__top">
                                <h4 className="lk-card__title">{lead.listingTitle}</h4>
                                {enableDrag && (
                                  <GripVertical
                                    className="lk-card__drag-grip"
                                    size={16}
                                    aria-hidden="true"
                                  />
                                )}
                              </div>

                              <div className="lk-card__tenant">
                                <div className="lk-card__avatar" aria-hidden="true">
                                  {lead.tenantName.charAt(0).toUpperCase() || "?"}
                                </div>
                                <div style={{ minWidth: 0 }}>
                                  <p className="lk-card__tenant-name">{lead.tenantName}</p>
                                  {lead.tenantPhoneMasked && (
                                    <p className="lk-card__tenant-phone">
                                      {lead.tenantPhoneMasked}
                                    </p>
                                  )}
                                </div>
                              </div>

                              <div className="lk-card__meta">
                                <Clock size={11} aria-hidden="true" />
                                <span>Enquired {formatDate(lead.createdAt)}</span>
                                {lead.statusChangedAt !== lead.createdAt && (
                                  <>
                                    <span className="lk-card__meta-dot" aria-hidden="true" />
                                    <span>Updated {formatDate(lead.statusChangedAt)}</span>
                                  </>
                                )}
                              </div>

                              {lead.ownerNotes && (
                                <div className="lk-card__notes">
                                  <StickyNote size={12} aria-hidden="true" />
                                  <span>{lead.ownerNotes}</span>
                                </div>
                              )}

                              {!enableDrag && STEPPER_ACTIONS[lead.status].length > 0 && (
                                <div className="lk-card__stepper">
                                  {STEPPER_ACTIONS[lead.status].map((act) => (
                                    <button
                                      key={act.next}
                                      type="button"
                                      data-variant={act.variant}
                                      disabled={updating === lead.id}
                                      onClick={() => void moveLead(lead.id, lead.status, act.next)}
                                    >
                                      {act.label}
                                    </button>
                                  ))}
                                </div>
                              )}
                            </div>
                          </article>
                        )}
                      </Draggable>
                    ))}
                    {droppableProvided.placeholder}
                  </div>
                </section>
              );
            }}
          </Droppable>
        );
      })}
    </div>
  );

  return (
    <div className="lk">
      {enableDrag ? <DragDropContext onDragEnd={handleDragEnd}>{board}</DragDropContext> : board}
      {toast && (
        <div
          role="status"
          aria-live="polite"
          className={`lk-toast${toast.isError ? " lk-toast--error" : ""}`}
        >
          {toast.msg}
        </div>
      )}
    </div>
  );
}

export function LeadKanbanSkeleton() {
  return (
    <div className="lk">
      <div className="lk-board" aria-hidden="true">
        {COLUMNS.map((col) => (
          <section key={col.status} className="lk-col">
            <header className="lk-col__header">
              <span className="lk-col__rail" style={{ background: col.rail }} aria-hidden="true" />
              <h3 className="lk-col__title">{col.label}</h3>
              <span className="lk-col__count">—</span>
            </header>
            <div className="lk-col__list">
              <div className="lk-skeleton" />
              <div className="lk-skeleton" />
              <div className="lk-skeleton" />
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
