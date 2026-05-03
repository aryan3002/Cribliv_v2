"use client";

import { useEffect, useMemo, useState } from "react";
import { StatCard } from "../primitives/StatCard";
import { SectionCard } from "../primitives/SectionCard";
import { EmptyState } from "../primitives/EmptyState";
import { AreaChart } from "../charts/AreaChart";
import { BarChart } from "../charts/BarChart";
import { DataTable, type Column } from "../primitives/DataTable";
import {
  fetchAdminRevenueAttribution,
  fetchAdminRevenueCohorts,
  type RevenueAttribution,
  type RevenueCohort,
  type RevenueRange
} from "../../../lib/admin-api";
import { formatINR, formatINRPrecise, formatNumber } from "../../../lib/admin/format";

interface Props {
  accessToken: string;
}

const RANGES: RevenueRange[] = ["7d", "30d", "90d"];

export function RevenueTab({ accessToken }: Props) {
  const [range, setRange] = useState<RevenueRange>("30d");
  const [daily, setDaily] = useState<RevenueAttribution | null>(null);
  const [byCity, setByCity] = useState<RevenueAttribution | null>(null);
  const [byType, setByType] = useState<RevenueAttribution | null>(null);
  const [cohorts, setCohorts] = useState<RevenueCohort[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all([
      fetchAdminRevenueAttribution(accessToken, { range, group_by: "day" }),
      fetchAdminRevenueAttribution(accessToken, { range, group_by: "city" }),
      fetchAdminRevenueAttribution(accessToken, { range, group_by: "listing_type" }),
      fetchAdminRevenueCohorts(accessToken, 6)
    ])
      .then(([d, c, t, ch]) => {
        if (cancelled) return;
        setDaily(d);
        setByCity(c);
        setByType(t);
        setCohorts(ch.cohorts);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [accessToken, range]);

  const totals = useMemo(() => {
    const total = daily?.total_revenue_paise ?? 0;
    const orders = daily?.total_orders ?? 0;
    const aov = orders > 0 ? Math.round(total / orders) : 0;
    return { total, orders, aov };
  }, [daily]);

  const cohortColumns: Column<RevenueCohort>[] = [
    {
      key: "month",
      header: "Cohort",
      render: (r) => r.cohort_month,
      sortValue: (r) => r.cohort_month
    },
    {
      key: "owners",
      header: "Owners",
      align: "right",
      render: (r) => formatNumber(r.owners_count),
      sortValue: (r) => r.owners_count
    },
    {
      key: "revenue",
      header: "Total revenue",
      align: "right",
      render: (r) => (
        <span className="admin-table__amount">{formatINR(r.total_revenue_paise)}</span>
      ),
      sortValue: (r) => r.total_revenue_paise
    },
    {
      key: "ltv",
      header: "Avg LTV",
      align: "right",
      render: (r) => <span className="admin-table__amount">{formatINR(r.avg_ltv_paise)}</span>,
      sortValue: (r) => r.avg_ltv_paise
    },
    {
      key: "churn",
      header: "30d churn",
      align: "right",
      render: (r) => formatNumber(r.churn_30d_count),
      sortValue: (r) => r.churn_30d_count
    }
  ];

  return (
    <div className="admin-main__section">
      <div className="admin-page-title">
        <h1>Revenue Attribution</h1>
        <span className="admin-page-title__sub">{loading ? "loading…" : ""}</span>
      </div>

      <div style={{ display: "flex", gap: 6 }}>
        {RANGES.map((r) => (
          <button
            key={r}
            type="button"
            className="admin-chip"
            aria-pressed={r === range}
            onClick={() => setRange(r)}
          >
            {r}
          </button>
        ))}
      </div>

      <div className="admin-stat-grid">
        <StatCard label={`Revenue · ${range}`} value={formatINR(totals.total)} tone="brand" />
        <StatCard label="Orders" value={formatNumber(totals.orders)} tone="trust" />
        <StatCard label="Avg order value" value={formatINR(totals.aov)} />
        <StatCard label="Cohorts tracked" value={formatNumber(cohorts.length)} tone="default" />
      </div>

      <SectionCard title={`Revenue per day · ${range}`}>
        {daily && daily.buckets.length > 0 ? (
          <AreaChart
            data={daily.buckets.map((b) => ({ day: b.key, revenue: b.revenue_paise / 100 }))}
            xKey="day"
            yKey="revenue"
            tooltipFormatter={(v) => `₹${v.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`}
          />
        ) : (
          <EmptyState title="No captured payments in range" />
        )}
      </SectionCard>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
          gap: 16
        }}
      >
        <SectionCard title="By city">
          {byCity && byCity.buckets.length > 0 ? (
            <BarChart
              data={byCity.buckets.map((b) => ({
                key: b.key,
                revenue: b.revenue_paise / 100
              }))}
              xKey="key"
              yKey="revenue"
              tooltipFormatter={(v) =>
                `₹${v.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`
              }
            />
          ) : (
            <EmptyState title="No city revenue yet" />
          )}
        </SectionCard>
        <SectionCard title="By listing type">
          {byType && byType.buckets.length > 0 ? (
            <BarChart
              data={byType.buckets.map((b) => ({
                key: b.key,
                revenue: b.revenue_paise / 100
              }))}
              xKey="key"
              yKey="revenue"
              color="#0D9F4F"
              tooltipFormatter={(v) =>
                `₹${v.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`
              }
            />
          ) : (
            <EmptyState title="No listing-type revenue yet" />
          )}
        </SectionCard>
      </div>

      <SectionCard title="Owner cohorts" subtitle="Last 6 months by sign-up month" flush>
        <DataTable
          columns={cohortColumns}
          rows={cohorts}
          rowKey={(r) => r.cohort_month}
          emptyState="No cohort data"
          initialSort={{ key: "month", dir: "desc" }}
        />
      </SectionCard>

      <div style={{ color: "var(--ad-text-3)", fontSize: 12 }}>
        All figures from <code>payment_orders.status = &lsquo;captured&rsquo;</code>. Avg LTV is
        total captured revenue per owner in cohort. {formatINRPrecise(totals.total)} total in{" "}
        {range}.
      </div>
    </div>
  );
}
