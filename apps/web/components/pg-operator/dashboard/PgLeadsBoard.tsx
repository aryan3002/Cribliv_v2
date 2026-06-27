"use client";
import { useMemo, useRef, useState } from "react";
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
  Inbox,
  Phone,
  CalendarCheck,
  CheckCircle2,
  XCircle,
  Users,
  MapPin,
  Clock,
  Eye,
  Loader2,
  GripVertical,
  MessageSquare
} from "lucide-react";
import type { PgDashboardLead } from "@cribliv/shared-types";
import { openPgLead, updatePgLeadStatus, type PgLeadStatus } from "@/lib/pg-operator-api";
import styles from "@/app/[locale]/pg-operator/dashboard/pg-dashboard.module.css";

const VALID: Record<PgLeadStatus, PgLeadStatus[]> = {
  new: ["contacted", "lost"],
  contacted: ["visit_scheduled", "lost"],
  visit_scheduled: ["deal_done", "lost"],
  deal_done: [],
  lost: ["new"]
};

const COLUMNS: { status: PgLeadStatus; label: string; rail: string; Icon: typeof Inbox }[] = [
  { status: "new", label: "New", rail: "#3a8bff", Icon: Inbox },
  { status: "contacted", label: "Contacted", rail: "#ffb24d", Icon: Phone },
  { status: "visit_scheduled", label: "Visit scheduled", rail: "#a78bff", Icon: CalendarCheck },
  { status: "deal_done", label: "Deal done", rail: "#3ddc8b", Icon: CheckCircle2 },
  { status: "lost", label: "Lost", rail: "rgba(255,255,255,.4)", Icon: XCircle }
];
const LABEL: Record<PgLeadStatus, string> = COLUMNS.reduce(
  (a, c) => ({ ...a, [c.status]: c.label }),
  {} as Record<PgLeadStatus, string>
);

function normStatus(s: string): PgLeadStatus {
  return (["new", "contacted", "visit_scheduled", "deal_done", "lost"] as const).includes(
    s as PgLeadStatus
  )
    ? (s as PgLeadStatus)
    : "new";
}
function fmtDate(iso: string) {
  try {
    return new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short" }).format(
      new Date(iso)
    );
  } catch {
    return iso;
  }
}

type Local = PgDashboardLead & { _status: PgLeadStatus };
type Revealed = { phone: string | null; tenant_name: string };

export default function PgLeadsBoard({
  leads,
  token
}: {
  leads: PgDashboardLead[];
  token?: string;
}) {
  const [items, setItems] = useState<Local[]>(() =>
    leads.map((l) => ({ ...l, _status: normStatus(l.status) }))
  );
  const [revealed, setRevealed] = useState<Record<string, Revealed>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [updating, setUpdating] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [toast, setToast] = useState<{ msg: string; err?: boolean } | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = (msg: string, err = false) => {
    setToast({ msg, err });
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2800);
  };

  const grouped = useMemo(() => {
    const b: Record<PgLeadStatus, Local[]> = {
      new: [],
      contacted: [],
      visit_scheduled: [],
      deal_done: [],
      lost: []
    };
    for (const l of items) b[l._status].push(l);
    return b;
  }, [items]);

  async function reveal(leadId: string) {
    if (revealed[leadId] || busy) return;
    setBusy(leadId);
    setErrors((e) => ({ ...e, [leadId]: "" }));
    try {
      const r = await openPgLead(leadId, token);
      setRevealed((p) => ({ ...p, [leadId]: { phone: r.phone, tenant_name: r.tenant_name } }));
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Could not open lead";
      setErrors((e) => ({
        ...e,
        [leadId]: /payment_required/i.test(msg) ? "Requires a plan to open (coming soon)" : msg
      }));
    } finally {
      setBusy(null);
    }
  }

  async function move(leadId: string, from: PgLeadStatus, to: PgLeadStatus) {
    if (from === to) return;
    if (!VALID[from].includes(to)) {
      const allowed = VALID[from].map((s) => LABEL[s]).join(" or ");
      showToast(allowed ? `Move to ${allowed} first.` : `Can't move from ${LABEL[from]}.`, true);
      return;
    }
    // optimistic move; revert if the server rejects it
    const prev = items;
    setItems((cur) => cur.map((l) => (l.lead_id === leadId ? { ...l, _status: to } : l)));
    setUpdating(leadId);
    try {
      await updatePgLeadStatus(leadId, to, token);
      showToast(`Moved to ${LABEL[to]}`);
    } catch (err) {
      setItems(prev);
      const msg = err instanceof Error ? err.message : "Couldn't update lead";
      showToast(msg, true);
    } finally {
      setUpdating(null);
    }
  }

  function onDragEnd(r: DropResult) {
    if (!r.destination) return;
    void move(
      r.draggableId,
      r.source.droppableId as PgLeadStatus,
      r.destination.droppableId as PgLeadStatus
    );
  }

  if (items.length === 0) {
    return (
      <div className={styles.empty}>
        <Users size={26} style={{ color: "var(--d-text-soft)" }} />
        <p className={styles.emptyTitle}>No leads yet</p>
        <p className={styles.emptyText}>
          Tenant enquiries will appear here. Drag cards across the pipeline as you work them.
        </p>
      </div>
    );
  }

  return (
    <div className={styles.kb}>
      <DragDropContext onDragEnd={onDragEnd}>
        <div className={styles.kbBoard}>
          {COLUMNS.map((col) => {
            const list = grouped[col.status];
            const Icon = col.Icon;
            return (
              <Droppable droppableId={col.status} key={col.status}>
                {(dp, snap: DroppableStateSnapshot) => {
                  return (
                    <section
                      ref={dp.innerRef}
                      {...dp.droppableProps}
                      className={`${styles.kbCol} ${snap.isDraggingOver ? styles.kbColOver : ""}`}
                      aria-label={`${col.label}, ${list.length} leads`}
                    >
                      <header className={styles.kbColHead}>
                        <span className={styles.kbRail} style={{ background: col.rail }} />
                        <Icon size={14} style={{ color: col.rail }} />
                        <span className={styles.kbColTitle}>{col.label}</span>
                        <span className={styles.kbCount}>{list.length}</span>
                      </header>
                      <div className={styles.kbList}>
                        {list.length === 0 && (
                          <div className={styles.kbEmpty}>
                            <MessageSquare size={18} style={{ color: "rgba(255,255,255,.2)" }} />
                            Drop leads here
                          </div>
                        )}
                        {list.map((lead, i) => {
                          const open = revealed[lead.lead_id];
                          const err = errors[lead.lead_id];
                          return (
                            <Draggable
                              key={lead.lead_id}
                              draggableId={lead.lead_id}
                              index={i}
                              isDragDisabled={updating === lead.lead_id}
                            >
                              {(prov: DraggableProvided, ds: DraggableStateSnapshot) => (
                                <article
                                  ref={prov.innerRef}
                                  {...prov.draggableProps}
                                  {...prov.dragHandleProps}
                                  className={`${styles.kbCard} ${ds.isDragging ? styles.kbCardDragging : ""} ${lead._status === "deal_done" ? styles.kbCardDeal : ""}`}
                                  style={{
                                    ...prov.draggableProps.style,
                                    opacity: updating === lead.lead_id ? 0.6 : 1
                                  }}
                                >
                                  <div className={styles.kbCardTop}>
                                    <span className={styles.kbAvatar}>
                                      <Phone size={15} />
                                    </span>
                                    <div style={{ minWidth: 0, flex: 1 }}>
                                      <div className={styles.kbPhone}>
                                        {open
                                          ? (open.phone ?? "No phone")
                                          : lead.contact.phone_masked}
                                      </div>
                                      {open && (
                                        <div className={styles.kbName}>{open.tenant_name}</div>
                                      )}
                                    </div>
                                    <GripVertical
                                      size={15}
                                      style={{ color: "var(--d-text-soft)" }}
                                    />
                                  </div>

                                  <div className={styles.kbMeta}>
                                    <span className={styles.kbMetaItem}>
                                      <MapPin size={11} /> {lead.source}
                                    </span>
                                    <span className={styles.kbMetaItem}>
                                      <Clock size={11} /> {fmtDate(lead.created_at)}
                                    </span>
                                  </div>

                                  {err && <span className={styles.kbErr}>{err}</span>}

                                  {!open && (
                                    <button
                                      type="button"
                                      className={styles.kbReveal}
                                      disabled={busy === lead.lead_id}
                                      onClick={() => reveal(lead.lead_id)}
                                    >
                                      {busy === lead.lead_id ? (
                                        <Loader2 size={13} className="pgo-spin" />
                                      ) : (
                                        <>
                                          <Eye size={13} /> Reveal contact
                                        </>
                                      )}
                                    </button>
                                  )}
                                </article>
                              )}
                            </Draggable>
                          );
                        })}
                        {dp.placeholder}
                      </div>
                    </section>
                  );
                }}
              </Droppable>
            );
          })}
        </div>
      </DragDropContext>
      {toast && (
        <div role="status" className={`${styles.kbToast} ${toast.err ? styles.kbToastErr : ""}`}>
          {toast.msg}
        </div>
      )}
    </div>
  );
}
