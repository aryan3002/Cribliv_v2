"use client";

import { useEffect, useMemo, useState } from "react";
import type { AdminLeadAnalytics, AdminLeadOwnerRollupRow } from "@cribliv/shared-types";
import { StatCard } from "../primitives/StatCard";
import { SectionCard } from "../primitives/SectionCard";
import { EmptyState } from "../primitives/EmptyState";
import { DataTable, type Column } from "../primitives/DataTable";
import { AreaChart } from "../charts/AreaChart";
import { BarChart } from "../charts/BarChart";
import { HealthBadge } from "../owner-health/HealthBadge";
import { OwnerDrillDrawer } from "./OwnerDrillDrawer";
import { ApiError } from "../../../lib/api";
import { fetchAdminLeadAnalytics } from "../../../lib/admin-api";
import { formatMinutes, formatNumber, formatPct } from "../../../lib/admin/format";

interface Props {
  accessToken: string;
  onToast: (message: string, tone?: "trust" | "warn" | "danger") => void;
}

const RANGE_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "7 days", label: "7d" },
  { value: "30 days", label: "30d" },
  { value: "90 days", label: "90d" }
];

function humanizeRole(role: string): string {
  return role.replace(/_/g, " ");
}

export function LeadAnalytics({ accessToken, onToast }: Props) {
  const [range, setRange] = useState("30 days");
  const [analytics, setAnalytics] = useState<AdminLeadAnalytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [featureDisabled, setFeatureDisabled] = useState(false);
  const [selectedOwnerRow, setSelectedOwnerRow] = useState<AdminLeadOwnerRollupRow | null>(null);

  // Fetch on accessToken/range change — a fresh snapshot per range, no polling
  // (unlike the live board, this is a historical rollup — see RentAgreementsTab's
  // analytics block for the same "re-fetch on range change only" pattern).
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchAdminLeadAnalytics(accessToken, range)
      .then((res) => {
        if (cancelled) return;
        setAnalytics(res);
        setFeatureDisabled(false);
      })
      .catch((err) => {
        if (cancelled) return;
        if (err instanceof ApiError && err.code === "feature_disabled") {
          setFeatureDisabled(true);
        } else {
          onToast(err instanceof Error ? err.message : "Failed to load lead analytics", "danger");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // onToast is re-created every parent render (see LeadBoard for the same
    // pattern) — depending on it would refetch on every unrelated re-render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accessToken, range]);

  const trendData = useMemo(
    () => (analytics?.trend ?? []).map((t) => ({ day: t.day, called: t.called })),
    [analytics]
  );

  const engagementData = useMemo(() => {
    const e = analytics?.engagement;
    return [
      { step: "Searches", n: e?.searches ?? 0 },
      { step: "Views", n: e?.listing_views ?? 0 },
      { step: "Signups", n: e?.signups ?? 0 },
      { step: "Callbacks", n: e?.callbacks_requested ?? 0 },
      { step: "Calls", n: e?.calls_made ?? 0 }
    ];
  }, [analytics]);

  const columns: Column<AdminLeadOwnerRollupRow>[] = useMemo(
    () => [
      {
        key: "owner",
        header: "Owner",
        render: (r) => (
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span>{r.name}</span>
            {r.health_score != null && r.health_grade != null && (
              // Wrapped so the badge's own click doesn't bubble into the
              // row's onRowClick (which opens the drill-down drawer).
              <span onClick={(e) => e.stopPropagation()}>
                <HealthBadge score={r.health_score} grade={r.health_grade} />
              </span>
            )}
          </div>
        ),
        sortValue: (r) => r.name
      },
      {
        key: "role",
        header: "Role",
        render: (r) => humanizeRole(r.role),
        sortValue: (r) => r.role
      },
      {
        key: "leads",
        header: "Leads",
        align: "right",
        render: (r) => formatNumber(r.leads),
        sortValue: (r) => r.leads
      },
      {
        key: "called_rate",
        header: "Called rate",
        align: "right",
        render: (r) => formatPct(r.called_rate),
        sortValue: (r) => r.called_rate
      },
      {
        key: "median_response",
        header: "Median resp",
        align: "right",
        render: (r) => formatMinutes(r.median_response_minutes),
        sortValue: (r) => r.median_response_minutes ?? Number.MAX_SAFE_INTEGER
      },
      {
        key: "refund_rate",
        header: "Refund rate",
        align: "right",
        render: (r) => formatPct(r.refund_rate),
        sortValue: (r) => r.refund_rate
      },
      {
        key: "health",
        header: "Health",
        align: "right",
        render: (r) => formatNumber(r.health_score),
        sortValue: (r) => r.health_score ?? -1
      }
    ],
    []
  );

  if (featureDisabled) {
    return (
      <EmptyState
        title="Lead Center is disabled"
        hint="Enable ff_admin_lead_center to turn on analytics."
      />
    );
  }

  return (
    <>
      <div style={{ display: "flex", gap: 6 }}>
        {RANGE_OPTIONS.map((r) => (
          <button
            key={r.value}
            type="button"
            className="admin-chip"
            aria-pressed={r.value === range}
            onClick={() => setRange(r.value)}
          >
            {r.label}
          </button>
        ))}
      </div>

      <div className="admin-stat-grid">
        <StatCard
          label="Callbacks requested"
          value={formatNumber(analytics?.funnel.callbacks_requested)}
          tone="trust"
        />
        <StatCard label="Leads called" value={formatNumber(analytics?.funnel.leads_called)} />
        <StatCard
          label="Deals done"
          value={formatNumber(analytics?.funnel.deals_done)}
          tone="brand"
        />
        <StatCard
          label="Refund rate"
          value={formatPct(analytics?.rates.refund_rate)}
          tone="danger"
        />
        <StatCard
          label="Team-rescue rate"
          value={formatPct(analytics?.rates.team_rescue_rate)}
          tone="warn"
        />
      </div>

      <SectionCard title="Daily lead activity" subtitle={`Calls made per day · last ${range}`}>
        {trendData.length > 0 ? (
          <AreaChart
            data={trendData}
            xKey="day"
            yKey="called"
            tooltipFormatter={(v) => `${formatNumber(v)} called`}
          />
        ) : (
          <EmptyState title={loading ? "Loading…" : "No trend data in range"} />
        )}
      </SectionCard>

      <SectionCard title="Engagement funnel" subtitle="Search → view → signup → callback → call">
        {analytics && engagementData.some((d) => d.n > 0) ? (
          <BarChart
            data={engagementData}
            xKey="step"
            yKey="n"
            tooltipFormatter={(v) => formatNumber(v)}
          />
        ) : (
          <EmptyState title={loading ? "Loading…" : "No engagement activity in range"} />
        )}
      </SectionCard>

      <SectionCard
        title="Owner performance"
        subtitle={`${formatNumber(analytics?.by_owner.length ?? 0)} owners · last ${range}${loading ? " · loading…" : ""}`}
        flush
      >
        <DataTable
          columns={columns}
          rows={analytics?.by_owner ?? []}
          rowKey={(r) => r.owner_user_id}
          onRowClick={(r) => setSelectedOwnerRow(r)}
          emptyState={loading ? "Loading…" : "No owner activity in range"}
        />
      </SectionCard>

      <OwnerDrillDrawer
        row={selectedOwnerRow}
        range={range}
        accessToken={accessToken}
        onClose={() => setSelectedOwnerRow(null)}
      />
    </>
  );
}
