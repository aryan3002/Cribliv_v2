"use client";

import { useState } from "react";
import type {
  PgMaintenanceAnalytics,
  PgMaintenanceCategory,
  PgMaintenancePriority,
  PgMaintenanceQueuePage,
  PgMaintenanceRequest,
  PgMaintenanceStatus
} from "@cribliv/shared-types";
import { listPropertyMaintenance } from "@/lib/pg-operations-api";
import MaintenanceAnalyticsStrip from "./MaintenanceAnalyticsStrip";
import MaintenanceQueueFilters, {
  DEFAULT_QUEUE_FILTERS,
  toMaintenanceQueueFilters,
  type MaintenanceQueueFilterState
} from "./MaintenanceQueueFilters";
import styles from "./MaintenanceQueue.module.css";

const STATUS_LABEL: Record<PgMaintenanceStatus, string> = {
  open: "Open",
  in_progress: "In progress",
  waiting_on_tenant: "Waiting on tenant",
  resolved: "Resolved",
  closed: "Closed",
  cancelled: "Cancelled"
};

const PRIORITY_LABEL: Record<PgMaintenancePriority, string> = {
  emergency: "Emergency",
  high: "High",
  normal: "Normal",
  low: "Low"
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

function tenantLabel(request: PgMaintenanceRequest): string {
  return request.location?.tenant_name ?? "Unassigned";
}

export default function MaintenanceQueueList({
  propertyId,
  token,
  categories,
  analytics,
  initialPage
}: {
  propertyId: string;
  token?: string;
  categories: PgMaintenanceCategory[];
  analytics: PgMaintenanceAnalytics;
  initialPage: PgMaintenanceQueuePage;
}) {
  const [filters, setFilters] = useState<MaintenanceQueueFilterState>(DEFAULT_QUEUE_FILTERS);
  const [rows, setRows] = useState(initialPage.rows);
  const [nextCursor, setNextCursor] = useState(initialPage.next_cursor);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function query(nextFilters: MaintenanceQueueFilterState, cursor?: string) {
    setLoading(true);
    setError(null);
    try {
      const result = await listPropertyMaintenance(
        propertyId,
        token,
        toMaintenanceQueueFilters(nextFilters, "list", cursor)
      );
      setRows((current) => (cursor ? [...current, ...result.rows] : result.rows));
      setNextCursor(result.next_cursor);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load maintenance tickets.");
    } finally {
      setLoading(false);
    }
  }

  function updateFilters(nextFilters: MaintenanceQueueFilterState) {
    setFilters(nextFilters);
    setNextCursor(null);
    void query(nextFilters);
  }

  return (
    <section className={styles.queueShell} aria-label="Maintenance queue">
      <MaintenanceAnalyticsStrip analytics={analytics} />
      <MaintenanceQueueFilters categories={categories} value={filters} onChange={updateFilters} />
      {error ? (
        <p role="alert" className={styles.empty}>
          {error}
        </p>
      ) : null}
      {rows.length === 0 ? (
        <div className={styles.empty}>No maintenance tickets match this view.</div>
      ) : (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Ticket</th>
                <th>SLA</th>
                <th>Priority</th>
                <th>Status</th>
                <th>Location</th>
                <th>Tenant</th>
                <th>Last update</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((request) => (
                <tr key={request.id}>
                  <td>
                    <div className={styles.primaryCell}>
                      <strong>{request.category}</strong>
                      <span>{request.description}</span>
                    </div>
                  </td>
                  <td>
                    <span className={request.is_overdue ? styles.danger : undefined}>
                      {`Due ${displayDateTime(request.sla_due_at)}`}
                    </span>
                  </td>
                  <td>
                    <span className={styles.badge}>{PRIORITY_LABEL[request.priority]}</span>
                  </td>
                  <td>
                    <span className={styles.badge}>{STATUS_LABEL[request.status]}</span>
                  </td>
                  <td>{locationLabel(request)}</td>
                  <td>{tenantLabel(request)}</td>
                  <td className={styles.cellSubtle}>
                    {`Updated ${displayDateTime(request.updated_at)}`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {nextCursor ? (
        <button
          type="button"
          className={styles.loadMore}
          disabled={loading}
          onClick={() => void query(filters, nextCursor)}
        >
          Load more
        </button>
      ) : null}
    </section>
  );
}
