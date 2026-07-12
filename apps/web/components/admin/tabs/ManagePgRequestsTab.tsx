"use client";

import { useEffect, useRef, useState } from "react";
import type { PgManageRequestStatus } from "@cribliv/shared-types";
import {
  approveAdminPgManageRequest,
  fetchAdminPgManageRequests,
  rejectAdminPgManageRequest,
  type AdminPgManageRequest
} from "@/lib/pg-operations-api";
import { DataTable, type Column } from "../primitives/DataTable";
import { StatusPill } from "../primitives/StatusPill";
import { EmptyState } from "../primitives/EmptyState";

interface Props {
  accessToken: string;
  onToast: (message: string, tone: "trust" | "danger") => void;
}

type StatusFilter = "all" | PgManageRequestStatus;

const FILTERS: Array<{ label: string; value: StatusFilter }> = [
  { label: "All", value: "all" },
  { label: "Pending", value: "pending" },
  { label: "Approved", value: "approved" },
  { label: "Rejected", value: "rejected" }
];

function formatRequestedAt(value: string): string {
  return new Intl.DateTimeFormat("en-IN", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(value));
}

export function ManagePgRequestsTab({ accessToken, onToast }: Props) {
  const [rows, setRows] = useState<AdminPgManageRequest[]>([]);
  const [status, setStatus] = useState<StatusFilter>("pending");
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [decidingId, setDecidingId] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const onToastRef = useRef(onToast);

  useEffect(() => {
    onToastRef.current = onToast;
  }, [onToast]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    fetchAdminPgManageRequests(status === "all" ? undefined : status, accessToken)
      .then((result) => {
        if (!cancelled) setRows(result.items ?? []);
      })
      .catch((error) => {
        if (!cancelled) {
          setRows([]);
          onToastRef.current(
            error instanceof Error ? error.message : "Could not load Manage PG requests",
            "danger"
          );
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [accessToken, reloadKey, status]);

  async function decide(requestId: string, decision: "approve" | "reject") {
    setDecidingId(requestId);
    try {
      const body = notes[requestId]?.trim() ? { notes: notes[requestId].trim() } : {};
      if (decision === "approve") {
        await approveAdminPgManageRequest(requestId, body, accessToken);
        onToast("Manage PG request approved", "trust");
      } else {
        await rejectAdminPgManageRequest(requestId, body, accessToken);
        onToast("Manage PG request rejected", "trust");
      }
      setReloadKey((current) => current + 1);
    } catch (error) {
      onToast(
        error instanceof Error ? error.message : "Could not update Manage PG request",
        "danger"
      );
    } finally {
      setDecidingId(null);
    }
  }

  const columns: Column<AdminPgManageRequest>[] = [
    {
      key: "operator",
      header: "Operator",
      render: (row) => (
        <div>
          <div style={{ color: "#111827", fontSize: 13, fontWeight: 600 }}>
            {row.operator_name ?? "Unnamed operator"}
          </div>
          {row.operator_phone && (
            <div className="admin-table__id" style={{ marginTop: 2 }}>
              {row.operator_phone}
            </div>
          )}
        </div>
      ),
      sortValue: (row) => row.operator_name ?? ""
    },
    {
      key: "listing",
      header: "Listing",
      render: (row) => row.listing_title || "Untitled listing",
      sortValue: (row) => row.listing_title
    },
    {
      key: "requested_at",
      header: "Requested",
      render: (row) => formatRequestedAt(row.created_at),
      sortValue: (row) => row.created_at
    },
    {
      key: "status",
      header: "Status",
      render: (row) => (
        <StatusPill
          status={row.status}
          tone={
            row.status === "approved"
              ? "trust"
              : row.status === "pending"
                ? "warn"
                : row.status === "rejected"
                  ? "danger"
                  : "muted"
          }
        />
      ),
      sortValue: (row) => row.status
    },
    {
      key: "decision",
      header: "Decision",
      width: "280px",
      render: (row) =>
        row.status === "pending" ? (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            <input
              aria-label={`Decision notes for ${row.listing_title || "listing"}`}
              className="admin-input"
              placeholder="Notes (optional)"
              value={notes[row.id] ?? ""}
              onChange={(event) =>
                setNotes((current) => ({ ...current, [row.id]: event.target.value }))
              }
              style={{ flex: "1 1 150px", minWidth: 0 }}
            />
            <button
              type="button"
              className="admin-btn admin-btn--primary admin-btn--sm"
              disabled={decidingId === row.id}
              onClick={() => void decide(row.id, "approve")}
            >
              {decidingId === row.id ? "Saving..." : "Approve"}
            </button>
            <button
              type="button"
              className="admin-btn admin-btn--danger admin-btn--sm"
              disabled={decidingId === row.id}
              onClick={() => void decide(row.id, "reject")}
            >
              Reject
            </button>
          </div>
        ) : (
          (row.decision_notes ?? "-")
        )
    }
  ];

  return (
    <div className="admin-main__section">
      <div className="admin-page-title">
        <h1>Manage PG Requests</h1>
        <span className="admin-page-title__sub">
          {loading ? "loading..." : `${rows.length} shown`}
        </span>
      </div>

      <div className="admin-chip-row" style={{ paddingLeft: 0, paddingRight: 0 }}>
        {FILTERS.map((filter) => (
          <button
            key={filter.value}
            type="button"
            className="admin-chip"
            onClick={() => setStatus(filter.value)}
            aria-pressed={status === filter.value}
          >
            {filter.label}
          </button>
        ))}
      </div>

      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(row) => row.id}
        initialSort={{ key: "requested_at", dir: "desc" }}
        emptyState={
          loading ? "Loading Manage PG requests..." : <EmptyState title="No Manage PG requests" />
        }
      />
    </div>
  );
}
