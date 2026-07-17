"use client";

import { type KeyboardEvent, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { DragDropContext, Draggable, Droppable, type DropResult } from "@hello-pangea/dnd";
import { GripVertical } from "lucide-react";
import type {
  PgMaintenancePriority,
  PgMaintenanceQueuePage,
  PgMaintenanceRequest,
  PgMaintenanceStatus
} from "@cribliv/shared-types";
import { listPropertyMaintenance, updateMaintenanceStatus } from "@/lib/pg-operations-api";
import { useToast } from "@/components/ui/toast/use-toast";
import { Skeleton } from "@/components/ui/skeleton/Skeleton";
import MaintenanceResolutionSheet from "./MaintenanceResolutionSheet";
import styles from "./MaintenanceQueue.module.css";

const COLUMNS: Array<{ status: PgMaintenanceStatus; label: string }> = [
  { status: "open", label: "Open" },
  { status: "in_progress", label: "In progress" },
  { status: "waiting_on_tenant", label: "Waiting on tenant" },
  { status: "resolved", label: "Resolved" }
];

const TRANSITIONS: Record<PgMaintenanceStatus, PgMaintenanceStatus[]> = {
  open: ["in_progress", "cancelled"],
  in_progress: ["waiting_on_tenant", "resolved", "cancelled"],
  waiting_on_tenant: ["in_progress"],
  resolved: ["closed"],
  closed: [],
  cancelled: []
};

type KanbanStatus = (typeof COLUMNS)[number]["status"];
type KanbanColumnPages = Partial<Record<KanbanStatus, PgMaintenanceQueuePage>>;

const PRIORITY_LABEL: Record<PgMaintenancePriority, string> = {
  emergency: "Emergency",
  high: "High",
  normal: "Normal",
  low: "Low"
};

const ACTION_LABEL: Record<"in_progress" | "waiting_on_tenant" | "resolved", string> = {
  in_progress: "Start work",
  waiting_on_tenant: "Wait for tenant",
  resolved: "Resolve"
};

function displayDateTime(value: string): string {
  return new Intl.DateTimeFormat("en-IN", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
    timeZone: "Asia/Kolkata"
  }).format(new Date(value));
}

function locationLabel(request: PgMaintenanceRequest): string {
  const location = request.location;
  const snapshot = request.location_snapshot;
  const room = location?.room_number ?? snapshot.room_number;
  const bed = location?.bed_label ?? snapshot.bed_label;
  if (room && bed) return `Room ${room} · Bed ${bed}`;
  if (room) return `Room ${room}`;
  if (snapshot.floor !== null && snapshot.floor !== undefined) return `Floor ${snapshot.floor}`;
  if (snapshot.common_area) return snapshot.common_area.replaceAll("_", " ");
  if (snapshot.detail) return snapshot.detail;
  return snapshot.kind.replaceAll("_", " ");
}

function ticketLinkLabel(request: PgMaintenanceRequest): string {
  return `Open ${request.category} ticket at ${locationLabel(request)} (${request.id})`;
}

function canMove(request: PgMaintenanceRequest, status: PgMaintenanceStatus): boolean {
  return TRANSITIONS[request.status].includes(status);
}

function initialColumns(initialPage: PgMaintenanceQueuePage, pages?: KanbanColumnPages) {
  return COLUMNS.reduce(
    (acc, column) => {
      const page = pages?.[column.status];
      acc[column.status] = {
        rows: page?.rows ?? initialPage.rows.filter((request) => request.status === column.status),
        nextCursor: page?.next_cursor ?? null
      };
      return acc;
    },
    {} as Record<KanbanStatus, { rows: PgMaintenanceRequest[]; nextCursor: string | null }>
  );
}

export default function MaintenanceKanban({
  propertyId,
  token,
  initialPage,
  initialColumnPages,
  ticketHrefBase
}: {
  propertyId: string;
  token?: string;
  initialPage: PgMaintenanceQueuePage;
  initialColumnPages?: KanbanColumnPages;
  ticketHrefBase?: string;
}) {
  const toast = useToast();
  const [columns, setColumns] = useState(initialColumns(initialPage, initialColumnPages));
  const [resolving, setResolving] = useState<PgMaintenanceRequest | null>(null);
  const [resolutionPending, setResolutionPending] = useState(false);
  const [pending, setPending] = useState<string | null>(null);
  const [activeColumn, setActiveColumn] = useState<KanbanStatus>("open");
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const byStatus = useMemo(
    () =>
      COLUMNS.map((column) => ({
        ...column,
        rows: columns[column.status].rows,
        nextCursor: columns[column.status].nextCursor
      })),
    [columns]
  );

  useEffect(() => {
    if (!resolving) return;
    previousFocusRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const focusable = dialogRef.current?.querySelector<HTMLElement>(
      "button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])"
    );
    focusable?.focus();
    return () => {
      previousFocusRef.current?.focus();
      previousFocusRef.current = null;
    };
  }, [resolving]);

  function handleDialogKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      if (!resolutionPending) setResolving(null);
      return;
    }
    if (event.key !== "Tab") return;
    const focusable = Array.from(
      event.currentTarget.querySelectorAll<HTMLElement>(
        "button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])"
      )
    );
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  function replaceRequest(updated: PgMaintenanceRequest) {
    setColumns((current) => {
      const next = { ...current };
      for (const column of COLUMNS) {
        next[column.status] = {
          ...next[column.status],
          rows: next[column.status].rows.filter((request) => request.id !== updated.id)
        };
      }
      if (COLUMNS.some((column) => column.status === updated.status)) {
        const target = updated.status as KanbanStatus;
        next[target] = { ...next[target], rows: [updated, ...next[target].rows] };
      }
      return next;
    });
  }

  function rollbackRequest(previous: PgMaintenanceRequest, optimisticStatus: PgMaintenanceStatus) {
    setColumns((current) => {
      const currentRequest = COLUMNS.flatMap((column) => current[column.status].rows).find(
        (request) => request.id === previous.id
      );
      if (currentRequest && currentRequest.status !== optimisticStatus) return current;

      const next = { ...current };
      for (const column of COLUMNS) {
        next[column.status] = {
          ...next[column.status],
          rows: next[column.status].rows.filter((request) => request.id !== previous.id)
        };
      }
      if (COLUMNS.some((column) => column.status === previous.status)) {
        const target = previous.status as KanbanStatus;
        next[target] = { ...next[target], rows: [previous, ...next[target].rows] };
      }
      return next;
    });
  }

  function getColumnScrollBehavior(): ScrollBehavior {
    if (typeof window === "undefined") return "smooth";
    return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";
  }

  async function move(request: PgMaintenanceRequest, status: PgMaintenanceStatus) {
    if (!canMove(request, status) || pending) return;
    if (status === "resolved") {
      setResolving(request);
      return;
    }
    const optimisticRequest = { ...request, status };
    setPending(`${request.id}:${status}`);
    replaceRequest(optimisticRequest);
    try {
      const updated = await updateMaintenanceStatus(propertyId, request.id, status, token);
      replaceRequest(updated);
      toast.success(
        `Ticket ${request.id} -> ${COLUMNS.find((column) => column.status === status)?.label ?? status}`
      );
    } catch {
      rollbackRequest(request, status);
      const label = COLUMNS.find((column) => column.status === status)?.label ?? status;
      toast.error(`Could not move ticket ${request.id} to ${label}.`, {
        action: { label: "Retry", onClick: () => void move(request, status) }
      });
    } finally {
      setPending(null);
    }
  }

  function onDragEnd(result: DropResult) {
    if (!result.destination || result.source.droppableId === result.destination.droppableId) return;
    const from = result.source.droppableId as KanbanStatus;
    const to = result.destination.droppableId as PgMaintenanceStatus;
    const request = columns[from]?.rows.find((item) => item.id === result.draggableId);
    if (!request || !canMove(request, to)) return;
    void move(request, to);
  }

  async function loadMore(status: KanbanStatus, cursor: string) {
    setPending(`load:${status}`);
    try {
      const page = await listPropertyMaintenance(propertyId, token, {
        status,
        sort: "sla_due",
        view: "kanban",
        limit: 25,
        cursor
      });
      setColumns((current) => ({
        ...current,
        [status]: {
          rows: [...current[status].rows, ...page.rows],
          nextCursor: page.next_cursor
        }
      }));
    } catch {
      toast.error("Could not load more tickets.", {
        action: { label: "Retry", onClick: () => void loadMore(status, cursor) }
      });
    } finally {
      setPending(null);
    }
  }

  return (
    <section className={styles.kanbanShell} aria-label="Maintenance kanban">
      <div className={styles.kanbanSwitcher} aria-label="Kanban columns">
        {COLUMNS.map((column) => (
          <button
            key={column.status}
            type="button"
            className={activeColumn === column.status ? styles.kanbanSwitcherActive : ""}
            aria-pressed={activeColumn === column.status}
            onClick={() => {
              setActiveColumn(column.status);
              document.getElementById(`maintenance-column-${column.status}`)?.scrollIntoView({
                behavior: getColumnScrollBehavior(),
                inline: "start",
                block: "nearest"
              });
            }}
          >
            {column.label}
          </button>
        ))}
      </div>
      <DragDropContext onDragEnd={onDragEnd}>
        <div className={styles.kanbanBoard}>
          {byStatus.map((column) => {
            const nextCursor = column.nextCursor;
            return (
              <Droppable droppableId={column.status} key={column.status}>
                {(provided, snapshot) => (
                  <section
                    id={`maintenance-column-${column.status}`}
                    ref={provided.innerRef}
                    {...provided.droppableProps}
                    className={`${styles.column} ${snapshot.isDraggingOver ? styles.columnDraggingOver : ""}`}
                    aria-label={column.label}
                  >
                    <div className={styles.columnHeader}>
                      <h3>{column.label}</h3>
                      <span>{column.rows.length}</span>
                    </div>
                    <div className={styles.cardList}>
                      {column.rows.length === 0 ? (
                        <div className={styles.empty}>No tickets</div>
                      ) : (
                        column.rows.map((request, index) => (
                          <Draggable
                            key={request.id}
                            draggableId={request.id}
                            index={index}
                            isDragDisabled={pending !== null}
                          >
                            {(dragProvided) => (
                              <article
                                ref={dragProvided.innerRef}
                                {...dragProvided.draggableProps}
                                className={styles.kanbanCard}
                              >
                                <button
                                  type="button"
                                  className={styles.dragHandle}
                                  aria-label={`Drag ${request.category} ticket`}
                                  {...dragProvided.dragHandleProps}
                                >
                                  <GripVertical size={16} aria-hidden="true" />
                                </button>
                                {ticketHrefBase ? (
                                  <Link
                                    href={`${ticketHrefBase}/${request.id}` as any}
                                    className={styles.cardTitleLink}
                                    aria-label={ticketLinkLabel(request)}
                                  >
                                    {request.category}
                                  </Link>
                                ) : (
                                  <strong className={styles.cardTitle}>{request.category}</strong>
                                )}
                                <div className={styles.badgeRow}>
                                  <span className={styles.badge}>
                                    {PRIORITY_LABEL[request.priority]}
                                  </span>
                                  <span
                                    className={request.is_overdue ? styles.danger : styles.cardMeta}
                                  >
                                    {`Due ${displayDateTime(request.sla_due_at)}`}
                                  </span>
                                </div>
                                <div className={styles.cardActions}>
                                  <button
                                    type="button"
                                    disabled={!canMove(request, "in_progress") || pending !== null}
                                    onClick={() => void move(request, "in_progress")}
                                  >
                                    {ACTION_LABEL.in_progress} {request.category}
                                  </button>
                                  <button
                                    type="button"
                                    disabled={
                                      !canMove(request, "waiting_on_tenant") || pending !== null
                                    }
                                    onClick={() => void move(request, "waiting_on_tenant")}
                                  >
                                    {ACTION_LABEL.waiting_on_tenant} {request.category}
                                  </button>
                                  <button
                                    type="button"
                                    disabled={!canMove(request, "resolved") || pending !== null}
                                    onClick={() => void move(request, "resolved")}
                                  >
                                    {ACTION_LABEL.resolved} {request.category}
                                  </button>
                                </div>
                              </article>
                            )}
                          </Draggable>
                        ))
                      )}
                      {pending === `load:${column.status}` ? (
                        <div className={styles.kanbanSkeletons} aria-label="Loading more tickets">
                          <Skeleton className={styles.kanbanSkeleton} />
                          <Skeleton className={styles.kanbanSkeleton} />
                        </div>
                      ) : null}
                      {nextCursor ? (
                        <button
                          type="button"
                          className={styles.loadMore}
                          disabled={pending !== null}
                          onClick={() => void loadMore(column.status, nextCursor)}
                        >
                          Load more
                        </button>
                      ) : null}
                    </div>
                  </section>
                )}
              </Droppable>
            );
          })}
        </div>
      </DragDropContext>

      {resolving ? (
        <div className={styles.dialogBackdrop}>
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Resolve ticket"
            className={styles.dialog}
            ref={dialogRef}
            onKeyDown={handleDialogKeyDown}
          >
            <h2>Resolve ticket</h2>
            <div className={styles.dialogActions}>
              <button type="button" disabled={resolutionPending} onClick={() => setResolving(null)}>
                Cancel
              </button>
            </div>
            <MaintenanceResolutionSheet
              request={resolving}
              propertyId={propertyId}
              token={token ?? ""}
              onOptimisticResolved={replaceRequest}
              onRollback={replaceRequest}
              onPendingChange={setResolutionPending}
              onResolved={(updated) => {
                replaceRequest(updated);
                setResolutionPending(false);
                setResolving(null);
              }}
            />
          </div>
        </div>
      ) : null}
    </section>
  );
}
