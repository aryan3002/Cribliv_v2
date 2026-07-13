"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  AdminLeadBoardFilter,
  AdminLeadBoardResponse,
  AdminLeadBoardRow,
  LeadAccessState
} from "@cribliv/shared-types";
import { StatCard } from "../primitives/StatCard";
import { StatusPill, type PillTone } from "../primitives/StatusPill";
import { SectionCard } from "../primitives/SectionCard";
import { EmptyState } from "../primitives/EmptyState";
import { DataTable, type Column } from "../primitives/DataTable";
import { HealthBadge } from "../owner-health/HealthBadge";
import { LeadCountdown } from "./LeadCountdown";
import { LeadDrawer, LeadRowActions } from "./LeadDrawer";
import { ApiError } from "../../../lib/api";
import { fetchAdminLeadBoard } from "../../../lib/admin-api";
import { formatNumber, formatRelativeTime } from "../../../lib/admin/format";

interface Props {
  accessToken: string;
  onCountChange?: (count: number) => void;
  onToast: (message: string, tone?: "trust" | "warn" | "danger") => void;
}

const PAGE_SIZE = 20;

const FILTERS: Array<{ id: AdminLeadBoardFilter; label: string }> = [
  { id: "all", label: "All" },
  { id: "needs_call", label: "Uncalled" },
  { id: "expiring_6h", label: "Expiring <6h" },
  { id: "called", label: "Called" },
  { id: "refunded_today", label: "Refunded today" }
];

// StatusPill's default tone map has no entries for these lead access states,
// so every pill would otherwise render flat grey ("muted").
const ACCESS_TONE: Record<LeadAccessState, PillTone> = {
  free: "brand",
  unlocked: "trust",
  locked: "warn",
  expired: "danger"
};

export function LeadBoard({ accessToken, onCountChange, onToast }: Props) {
  const [data, setData] = useState<AdminLeadBoardResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [featureDisabled, setFeatureDisabled] = useState(false);
  const [filter, setFilter] = useState<AdminLeadBoardFilter>("all");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [selectedLeadId, setSelectedLeadId] = useState<string | null>(null);
  // Bumped after a row/drawer action succeeds to force an immediate re-fetch
  // (optimistic-refetch, not optimistic mutation) without duplicating the
  // fetch effect below.
  const [refreshNonce, setRefreshNonce] = useState(0);
  const triggerRefetch = useCallback(() => setRefreshNonce((n) => n + 1), []);

  // Reset to page 1 whenever a filter/search changes.
  useEffect(() => {
    setPage(1);
  }, [filter, q]);

  // Fetch on filter/search/page change (debounced 300ms), then poll every 30s
  // until the next filter/search/page change tears this effect down.
  useEffect(() => {
    let cancelled = false;
    let intervalId: number | undefined;
    setLoading(true);

    async function load() {
      try {
        const res = await fetchAdminLeadBoard(accessToken, {
          filter,
          q: q || undefined,
          page,
          page_size: PAGE_SIZE
        });
        if (cancelled) return;
        setData(res);
        setFeatureDisabled(false);
        onCountChange?.(res.counters.uncalled);
      } catch (err) {
        if (cancelled) return;
        if (err instanceof ApiError && err.code === "feature_disabled") {
          // Don't toast-spam every poll tick — just switch to the empty state.
          setFeatureDisabled(true);
        } else {
          onToast(err instanceof Error ? err.message : "Failed to load lead board", "danger");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    const debounceTimer = window.setTimeout(() => {
      void load();
      intervalId = window.setInterval(load, 30_000);
    }, 300);

    return () => {
      cancelled = true;
      window.clearTimeout(debounceTimer);
      if (intervalId) window.clearInterval(intervalId);
    };
    // onCountChange/onToast are re-created every parent render (see CrmTab for
    // the same pattern) — depending on them would tear down/restart polling
    // on every unrelated AdminShell re-render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accessToken, filter, q, page, refreshNonce]);

  const counters = data?.counters ?? null;
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const generatedAt = data?.generated_at;

  const columns: Column<AdminLeadBoardRow>[] = useMemo(
    () => [
      {
        key: "seeker",
        header: "Seeker",
        render: (r) => (
          <div>
            <div>{r.seeker.name}</div>
            <a
              href={`tel:${r.seeker.phone_e164}`}
              style={{ fontSize: 12, color: "var(--ad-brand)", textDecoration: "none" }}
              // Dialling the seeker shouldn't also trigger the row click
              // (which opens the detail drawer).
              onClick={(e) => e.stopPropagation()}
            >
              {r.seeker.phone_e164}
            </a>
          </div>
        )
      },
      {
        key: "owner",
        header: "Owner",
        render: (r) => (
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span>{r.owner.name}</span>
            {r.owner.health_score != null && r.owner.health_grade != null && (
              // Wrapped so the badge's own click doesn't bubble into the
              // row's onRowClick (the badge has no action here — the
              // per-owner drill-down lives on the Analytics rollup table).
              <span onClick={(e) => e.stopPropagation()}>
                <HealthBadge score={r.owner.health_score} grade={r.owner.health_grade} />
              </span>
            )}
          </div>
        )
      },
      {
        key: "listing",
        header: "Listing",
        render: (r) => (
          <div>
            <div>{r.listing_title}</div>
            <div style={{ color: "var(--ad-text-3)", fontSize: 12 }}>{r.city ?? "-"}</div>
          </div>
        )
      },
      {
        key: "state",
        header: "State",
        render: (r) => (
          <StatusPill status={r.access_state} tone={ACCESS_TONE[r.access_state] ?? "muted"} />
        ),
        sortValue: (r) => r.access_state
      },
      {
        key: "called",
        header: "Called?",
        render: (r) => {
          if (!r.called_at) {
            return <span style={{ color: "var(--ad-text-3)" }}>✗ Not called</span>;
          }
          return (
            <span style={{ color: "var(--ad-trust)" }}>
              ✓ {r.called_by === "team" ? "team" : "owner"}
            </span>
          );
        },
        sortValue: (r) => (r.called_at ? 1 : 0)
      },
      {
        key: "refund_in",
        header: "Refund in",
        render: (r) => (
          <LeadCountdown
            secondsRemaining={r.seconds_remaining}
            generatedAt={generatedAt ?? new Date().toISOString()}
            refundState={r.refund_state}
          />
        ),
        sortValue: (r) => r.seconds_remaining ?? Number.MAX_SAFE_INTEGER
      },
      {
        key: "created",
        header: "Created",
        align: "right",
        render: (r) => formatRelativeTime(r.created_at),
        sortValue: (r) => r.created_at
      },
      {
        key: "actions",
        header: "Actions",
        render: (r) => (
          <LeadRowActions
            row={r}
            accessToken={accessToken}
            onToast={onToast}
            onDone={triggerRefetch}
            compact
          />
        )
      }
    ],
    [generatedAt, accessToken, onToast, triggerRefetch]
  );

  const selectedRow = data?.rows.find((r) => r.lead_id === selectedLeadId) ?? null;

  if (featureDisabled) {
    return (
      <EmptyState
        title="Lead Center is disabled"
        hint="Enable ff_admin_lead_center to turn on the live board."
      />
    );
  }

  return (
    <>
      <div className="admin-stat-grid">
        <StatCard label="In-flight" value={formatNumber(counters?.in_flight ?? 0)} tone="brand" />
        <StatCard label="Uncalled" value={formatNumber(counters?.uncalled ?? 0)} tone="warn" />
        <StatCard
          label="Expiring <6h"
          value={formatNumber(counters?.expiring_6h ?? 0)}
          tone="danger"
        />
        <StatCard label="Refunded today" value={formatNumber(counters?.refunded_today ?? 0)} />
        <StatCard label="Expired today" value={formatNumber(counters?.expired_today ?? 0)} />
      </div>

      <SectionCard
        title="Lead board"
        subtitle={`${formatNumber(total)} total${loading ? " · loading…" : ""}`}
        flush
      >
        <div
          style={{
            display: "flex",
            gap: 8,
            flexWrap: "wrap",
            padding: "12px 16px",
            borderBottom: "1px solid var(--ad-border)"
          }}
        >
          {FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              className="admin-chip"
              aria-pressed={f.id === filter}
              onClick={() => setFilter(f.id)}
            >
              {f.label}
            </button>
          ))}
          <input
            className="admin-input"
            placeholder="Search seeker / owner / listing"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            style={{ flex: 1, minWidth: 200 }}
            aria-label="Search leads"
          />
        </div>
        <DataTable
          columns={columns}
          rows={data?.rows ?? []}
          rowKey={(r) => r.lead_id}
          onRowClick={(r) => setSelectedLeadId(r.lead_id)}
          emptyState={loading ? "Loading…" : "No leads match the filters"}
        />
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            padding: "10px 16px"
          }}
        >
          <span style={{ fontSize: 12, color: "var(--ad-text-3)" }}>
            Page {page} of {totalPages}
          </span>
          <div style={{ display: "flex", gap: 6 }}>
            <button
              type="button"
              className="admin-btn admin-btn--ghost"
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              Prev
            </button>
            <button
              type="button"
              className="admin-btn admin-btn--ghost"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            >
              Next
            </button>
          </div>
        </div>
      </SectionCard>

      <LeadDrawer
        row={selectedRow}
        onClose={() => setSelectedLeadId(null)}
        accessToken={accessToken}
        onToast={onToast}
        onActionDone={triggerRefetch}
      />
    </>
  );
}
