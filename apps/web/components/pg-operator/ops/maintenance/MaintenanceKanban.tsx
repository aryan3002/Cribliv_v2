"use client";

import { useMemo, useState } from "react";
import type {
  PgMaintenancePriority,
  PgMaintenanceQueuePage,
  PgMaintenanceRequest,
  PgMaintenanceStatus
} from "@cribliv/shared-types";
import { listPropertyMaintenance, updateMaintenanceStatus } from "@/lib/pg-operations-api";
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
  initialColumnPages
}: {
  propertyId: string;
  token?: string;
  initialPage: PgMaintenanceQueuePage;
  initialColumnPages?: KanbanColumnPages;
}) {
  const [columns, setColumns] = useState(initialColumns(initialPage, initialColumnPages));
  const [resolving, setResolving] = useState<PgMaintenanceRequest | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const byStatus = useMemo(
    () =>
      COLUMNS.map((column) => ({
        ...column,
        rows: columns[column.status].rows,
        nextCursor: columns[column.status].nextCursor
      })),
    [columns]
  );

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

  async function move(request: PgMaintenanceRequest, status: PgMaintenanceStatus) {
    if (!canMove(request, status) || pending) return;
    if (status === "resolved") {
      setResolving(request);
      return;
    }
    setPending(`${request.id}:${status}`);
    try {
      const updated = await updateMaintenanceStatus(propertyId, request.id, status, token);
      replaceRequest(updated);
    } finally {
      setPending(null);
    }
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
    } finally {
      setPending(null);
    }
  }

  return (
    <section className={styles.kanbanShell} aria-label="Maintenance kanban">
      <div className={styles.kanbanBoard}>
        {byStatus.map((column) => {
          const nextCursor = column.nextCursor;
          return (
            <section key={column.status} className={styles.column} aria-label={column.label}>
              <div className={styles.columnHeader}>
                <h3>{column.label}</h3>
                <span>{column.rows.length}</span>
              </div>
              <div className={styles.cardList}>
                {column.rows.length === 0 ? (
                  <div className={styles.empty}>No tickets</div>
                ) : (
                  column.rows.map((request) => (
                    <article key={request.id} className={styles.kanbanCard}>
                      <strong className={styles.cardTitle}>{request.category}</strong>
                      <div className={styles.badgeRow}>
                        <span className={styles.badge}>{PRIORITY_LABEL[request.priority]}</span>
                        <span className={request.is_overdue ? styles.danger : styles.cardMeta}>
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
                          disabled={!canMove(request, "waiting_on_tenant") || pending !== null}
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
                  ))
                )}
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
          );
        })}
      </div>

      {resolving ? (
        <div className={styles.dialogBackdrop}>
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Resolve ticket"
            className={styles.dialog}
          >
            <h2>Resolve ticket</h2>
            <label>
              <span>Resolution note</span>
              <textarea />
            </label>
            <div className={styles.dialogActions}>
              <button type="button" onClick={() => setResolving(null)}>
                Cancel
              </button>
              <button type="button" disabled>
                Resolve
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
