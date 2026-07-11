"use client";

import { useMemo } from "react";
import type { PgAdminListingDetail, PgAdminListingAnalytics } from "@cribliv/shared-types";
import { SectionCard } from "../../primitives/SectionCard";
import { StatCard } from "../../primitives/StatCard";
import { AreaChart } from "../../charts/AreaChart";
import { VisibilityControls } from "../VisibilityControls";

type MetricKey = "views" | "leads" | "appearances" | "clicks";
const METRICS: Array<{ key: MetricKey; label: string; color: string }> = [
  { key: "views", label: "Views", color: "#0066FF" },
  { key: "leads", label: "Leads", color: "#0D9F4F" },
  { key: "appearances", label: "Appearances", color: "#7C3AED" },
  { key: "clicks", label: "Clicks", color: "#E88C00" }
];

const nf = (n: number) => n.toLocaleString("en-IN");
const pct = (n: number) => `${(n * 100).toFixed(1)}%`;

/** Delta % between the recent half and the prior half of a series. */
function halfDelta(series: number[]): { value: number } | null {
  if (series.length < 4) return null;
  const mid = Math.floor(series.length / 2);
  const prev = series.slice(0, mid).reduce((a, b) => a + b, 0);
  const recent = series.slice(mid).reduce((a, b) => a + b, 0);
  if (prev === 0) return recent > 0 ? { value: 100 } : null;
  return { value: Math.round(((recent - prev) / prev) * 100) };
}

function ConversionFunnel({ a }: { a: PgAdminListingAnalytics }) {
  const stages = [
    { label: "Appearances", value: a.appearances, color: "#7C3AED" },
    { label: "Clicks", value: a.clicks, color: "#E88C00" },
    { label: "Views", value: a.views, color: "#0066FF" },
    { label: "Leads", value: a.leads, color: "#0D9F4F" }
  ];
  const top = Math.max(1, ...stages.map((s) => s.value));
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {stages.map((s, i) => {
        const w = Math.max(6, (s.value / top) * 100);
        const prev = i > 0 ? stages[i - 1].value : null;
        const conv = prev && prev > 0 ? Math.round((s.value / prev) * 100) : null;
        return (
          <div key={s.label}>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "baseline",
                marginBottom: 4
              }}
            >
              <span style={{ fontSize: 12, fontWeight: 600, color: "var(--ad-text-2)" }}>
                {s.label}
              </span>
              <span style={{ display: "flex", gap: 8, alignItems: "baseline" }}>
                {conv != null && (
                  <span
                    style={{
                      fontSize: 11,
                      color: "var(--ad-text-3)",
                      fontVariantNumeric: "tabular-nums"
                    }}
                  >
                    {conv}% ↓
                  </span>
                )}
                <span
                  style={{
                    fontSize: 14,
                    fontWeight: 700,
                    color: "var(--ad-text)",
                    fontVariantNumeric: "tabular-nums"
                  }}
                >
                  {nf(s.value)}
                </span>
              </span>
            </div>
            <div
              style={{
                height: 10,
                borderRadius: 6,
                background: "var(--ad-surface-2)",
                overflow: "hidden"
              }}
            >
              <div
                style={{
                  width: `${w}%`,
                  height: "100%",
                  borderRadius: 6,
                  background: `linear-gradient(90deg, ${s.color}, ${s.color}CC)`,
                  transition: "width .5s cubic-bezier(.4,0,.2,1)"
                }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

interface Props {
  detail: PgAdminListingDetail;
  analytics: PgAdminListingAnalytics | null;
  analyticsLoading: boolean;
  rangeDays: number;
  metric: MetricKey;
  onMetric: (m: MetricKey) => void;
  accessToken: string;
  onDetailChange: (next: PgAdminListingDetail) => void;
  onToast?: (msg: string, kind?: "success" | "error") => void;
}

export function OverviewSection({
  detail,
  analytics: a,
  analyticsLoading,
  rangeDays,
  metric,
  onMetric,
  accessToken,
  onDetailChange,
  onToast
}: Props) {
  const series = useMemo(() => {
    const t = a?.trend ?? [];
    const pick = (k: MetricKey) =>
      t.map((p) => (p as unknown as Record<MetricKey, number>)[k] ?? 0);
    return {
      views: pick("views"),
      leads: pick("leads"),
      appearances: pick("appearances"),
      clicks: pick("clicks")
    };
  }, [a]);

  const activeMetric = METRICS.find((m) => m.key === metric)!;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div className="pgd-kpis">
        <StatCard
          label="Appearances"
          value={a ? nf(a.appearances) : "-"}
          spark={series.appearances}
          delta={a ? halfDelta(series.appearances) : null}
        />
        <StatCard
          label="Clicks"
          value={a ? nf(a.clicks) : "-"}
          spark={series.clicks}
          delta={a ? halfDelta(series.clicks) : null}
          tone="warn"
        />
        <StatCard
          label="Views"
          value={a ? nf(a.views) : "-"}
          spark={series.views}
          delta={a ? halfDelta(series.views) : null}
          tone="brand"
        />
        <StatCard
          label="Leads"
          value={a ? nf(a.leads) : "-"}
          spark={series.leads}
          delta={a ? halfDelta(series.leads) : null}
          tone="trust"
        />
        <StatCard
          label="CTR"
          value={a ? pct(a.ctr) : "-"}
          tone={a && a.ctr >= 0.05 ? "trust" : "warn"}
        />
        <StatCard label="Interest rate" value={a ? pct(a.interest_rate) : "-"} />
        <StatCard label="Conversion" value={a ? pct(a.conversion) : "-"} tone="brand" />
        <StatCard
          label="Listing score"
          value={a?.composite_score != null ? Math.round(a.composite_score) : "-"}
        />
      </div>

      <SectionCard
        title="Performance trend"
        subtitle={`Last ${rangeDays} days${analyticsLoading ? " · refreshing…" : ""}`}
        action={
          <div style={{ display: "flex", gap: 6 }}>
            {METRICS.map((m) => (
              <button
                key={m.key}
                type="button"
                className="admin-chip"
                aria-pressed={metric === m.key}
                onClick={() => onMetric(m.key)}
              >
                {m.label}
              </button>
            ))}
          </div>
        }
      >
        {a && a.trend.length > 0 ? (
          <AreaChart
            data={a.trend as unknown as Array<Record<string, string | number>>}
            xKey="day"
            yKey={metric}
            height={200}
            color={activeMetric.color}
            xTickFormatter={(d) => d.slice(5)}
          />
        ) : (
          <div
            style={{
              padding: "28px 0",
              textAlign: "center",
              color: "var(--ad-text-3)",
              fontSize: 13
            }}
          >
            No daily activity in this range yet.
          </div>
        )}
      </SectionCard>

      <SectionCard
        title="Conversion funnel"
        subtitle="Stage-to-stage drop-off across the discovery → lead journey."
      >
        {a ? (
          <ConversionFunnel a={a} />
        ) : (
          <div style={{ color: "var(--ad-text-3)", fontSize: 13 }}>-</div>
        )}
      </SectionCard>

      <SectionCard
        title="Analytics visibility"
        subtitle="Non-destructive, data keeps collecting; restoring shows full history instantly."
      >
        <VisibilityControls
          accessToken={accessToken}
          detail={detail}
          onChanged={onDetailChange}
          onToast={onToast}
        />
      </SectionCard>
    </div>
  );
}
