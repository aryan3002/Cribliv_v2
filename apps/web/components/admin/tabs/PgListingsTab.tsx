"use client";

import { useEffect, useState } from "react";
import {
  getAdminPgAnalytics,
  fetchAdminPgOverview,
  type PgListingAnalytics
} from "../../../lib/admin-api";
import type { PgAdminOverview } from "@cribliv/shared-types";
import { PgListingFunnel } from "../PgListingFunnel";
import { PgListingQuality } from "../PgListingQuality";
import { PgVoiceMetrics } from "../PgVoiceMetrics";
import { EmptyState } from "../primitives/EmptyState";
import { SectionCard } from "../primitives/SectionCard";
import { StatCard } from "../primitives/StatCard";
import { BarChart } from "../charts/BarChart";
import { formatINR } from "../../../lib/admin/format";

interface Props {
  accessToken: string;
}

const RANGES = [7, 30, 90] as const;

function UtilBar({ used, total, color }: { used: number; total: number; color: string }) {
  const pct = total > 0 ? Math.max(0, Math.min(100, (used / total) * 100)) : 0;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <div
        style={{
          flex: 1,
          height: 8,
          background: "#E5E7EB",
          borderRadius: 4,
          overflow: "hidden"
        }}
      >
        <div
          style={{
            width: `${pct}%`,
            height: "100%",
            background: color,
            borderRadius: 4,
            transition: "width .4s ease"
          }}
        />
      </div>
      <span
        style={{
          fontSize: 12,
          color: "#6B7280",
          fontVariantNumeric: "tabular-nums",
          flexShrink: 0
        }}
      >
        {used} / {total}
      </span>
    </div>
  );
}

function GenderBar({ boys, girls, coed }: { boys: number; girls: number; coed: number }) {
  const total = boys + girls + coed;
  if (total === 0) return <span style={{ fontSize: 12, color: "#9CA3AF" }}>No data</span>;
  const pctBoys = (boys / total) * 100;
  const pctGirls = (girls / total) * 100;
  const pctCoed = (coed / total) * 100;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <div style={{ display: "flex", height: 10, borderRadius: 5, overflow: "hidden" }}>
        <div style={{ width: `${pctBoys}%`, background: "#3B82F6" }} />
        <div style={{ width: `${pctGirls}%`, background: "#EC4899" }} />
        <div style={{ width: `${pctCoed}%`, background: "#8B5CF6" }} />
      </div>
      <div style={{ display: "flex", gap: 12, fontSize: 11, color: "#6B7280" }}>
        <span>
          <span style={{ color: "#3B82F6", fontWeight: 600 }}>●</span> Boys {boys}
        </span>
        <span>
          <span style={{ color: "#EC4899", fontWeight: 600 }}>●</span> Girls {girls}
        </span>
        <span>
          <span style={{ color: "#8B5CF6", fontWeight: 600 }}>●</span> Coed {coed}
        </span>
      </div>
    </div>
  );
}

function QueryList({
  items,
  tone
}: {
  items: Array<{ query: string; count: number }>;
  tone?: "amber";
}) {
  if (items.length === 0) {
    return <span style={{ fontSize: 12, color: "#9CA3AF" }}>None</span>;
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      {items.map((item, i) => (
        <div
          key={item.query}
          style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}
        >
          <span
            style={{
              fontSize: 13,
              color: tone === "amber" ? "#92400E" : "#374151",
              display: "flex",
              alignItems: "center",
              gap: 6
            }}
          >
            <span
              style={{
                fontSize: 11,
                color: "#9CA3AF",
                fontVariantNumeric: "tabular-nums",
                minWidth: 14
              }}
            >
              {i + 1}.
            </span>
            {item.query}
          </span>
          <span
            style={{
              fontSize: 11,
              fontWeight: 600,
              padding: "1px 8px",
              borderRadius: 10,
              background: tone === "amber" ? "#FEF3C7" : "#EFF6FF",
              color: tone === "amber" ? "#92400E" : "#1D4ED8",
              fontVariantNumeric: "tabular-nums",
              flexShrink: 0,
              marginLeft: 8
            }}
          >
            {item.count}
          </span>
        </div>
      ))}
    </div>
  );
}

function PgOverviewSection({ overview, days }: { overview: PgAdminOverview; days: number }) {
  const { supply, distribution, operators, demand } = overview;
  const topCities = distribution.slice(0, 5);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
          gap: 14
        }}
      >
        {/* Supply card */}
        <SectionCard title="Supply">
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {(["active", "paused", "archived"] as const).map((s) => (
                <span
                  key={s}
                  className="admin-pill"
                  data-tone={s === "active" ? "trust" : s === "paused" ? "warn" : "muted"}
                  style={{ fontSize: 12 }}
                >
                  {s} {supply.properties_by_status[s]}
                </span>
              ))}
            </div>
            <div>
              <div
                style={{
                  fontSize: 11,
                  fontWeight: 600,
                  color: "#9CA3AF",
                  textTransform: "uppercase",
                  letterSpacing: "0.05em",
                  marginBottom: 6
                }}
              >
                Bed utilisation
              </div>
              <UtilBar
                used={supply.total_beds - supply.vacant_beds}
                total={supply.total_beds}
                color="#10B981"
              />
              <div style={{ fontSize: 11, color: "#9CA3AF", marginTop: 3 }}>
                {supply.vacant_beds} vacant · {Math.round(supply.vacancy_rate * 100)}% vacancy rate
              </div>
            </div>
            <div>
              <div
                style={{
                  fontSize: 11,
                  fontWeight: 600,
                  color: "#9CA3AF",
                  textTransform: "uppercase",
                  letterSpacing: "0.05em",
                  marginBottom: 6
                }}
              >
                Gender mix
              </div>
              <GenderBar
                boys={supply.gender_mix.boys}
                girls={supply.gender_mix.girls}
                coed={supply.gender_mix.coed}
              />
            </div>
            {supply.avg_starting_rent_paise != null && (
              <div>
                <div
                  style={{
                    fontSize: 11,
                    fontWeight: 600,
                    color: "#9CA3AF",
                    textTransform: "uppercase",
                    letterSpacing: "0.05em",
                    marginBottom: 4
                  }}
                >
                  Avg starting rent
                </div>
                <div style={{ fontSize: 16, fontWeight: 700, color: "#111827" }}>
                  {formatINR(supply.avg_starting_rent_paise)}/mo
                </div>
              </div>
            )}
          </div>
        </SectionCard>

        {/* Operators card */}
        <SectionCard title="Operators">
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: 12
            }}
          >
            <StatCard label="Total operators" value={operators.total} />
            <StatCard
              label="No live listing"
              value={operators.without_live_listing}
              tone={operators.without_live_listing > 0 ? "warn" : "default"}
            />
          </div>
          {operators.without_live_listing > 0 && (
            <div
              style={{
                marginTop: 12,
                padding: "8px 12px",
                background: "#FFFBEB",
                border: "1px solid #FDE68A",
                borderRadius: 6,
                fontSize: 12,
                color: "#92400E"
              }}
            >
              {operators.without_live_listing} operator
              {operators.without_live_listing !== 1 ? "s have" : " has"} no active listing yet.
            </div>
          )}
        </SectionCard>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
          gap: 14
        }}
      >
        {/* Distribution card */}
        {topCities.length > 0 && (
          <SectionCard title="Top cities">
            <BarChart
              data={topCities.map((d) => ({ city: d.city, count: d.count }))}
              xKey="city"
              yKey="count"
              layout="horizontal"
              height={160}
              color="#0066FF"
            />
          </SectionCard>
        )}

        {/* Demand card */}
        <SectionCard title={`Demand (last ${days}d)`}>
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <div>
              <div
                style={{
                  fontSize: 11,
                  fontWeight: 600,
                  color: "#9CA3AF",
                  textTransform: "uppercase",
                  letterSpacing: "0.05em",
                  marginBottom: 8
                }}
              >
                Top queries
              </div>
              <QueryList items={demand.top_queries.slice(0, 5)} />
            </div>
            {demand.zero_result_queries.length > 0 && (
              <div>
                <div
                  style={{
                    fontSize: 11,
                    fontWeight: 600,
                    color: "#B45309",
                    textTransform: "uppercase",
                    letterSpacing: "0.05em",
                    marginBottom: 8
                  }}
                >
                  Zero-result queries
                </div>
                <QueryList items={demand.zero_result_queries.slice(0, 5)} tone="amber" />
              </div>
            )}
          </div>
        </SectionCard>
      </div>
    </div>
  );
}

export function PgListingsTab({ accessToken }: Props) {
  const [days, setDays] = useState<(typeof RANGES)[number]>(30);
  const [data, setData] = useState<PgListingAnalytics | null>(null);
  const [overview, setOverview] = useState<PgAdminOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [disabled, setDisabled] = useState(false);
  const [overviewOpen, setOverviewOpen] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setDisabled(false);

    Promise.allSettled([
      getAdminPgAnalytics(accessToken, days),
      fetchAdminPgOverview(accessToken, days)
    ]).then(([analyticsResult, overviewResult]) => {
      if (cancelled) return;
      if (analyticsResult.status === "fulfilled") {
        setData(analyticsResult.value);
      } else {
        setDisabled(true);
      }
      if (overviewResult.status === "fulfilled") {
        setOverview(overviewResult.value);
      }
      setLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, [accessToken, days]);

  return (
    <div className="admin-main__section">
      <div className="admin-page-title">
        <h1>PG Listings</h1>
        <span className="admin-page-title__sub">{loading ? "loading…" : ""}</span>
      </div>

      <div style={{ display: "flex", gap: 6, marginBottom: 20 }}>
        {RANGES.map((r) => (
          <button
            key={r}
            type="button"
            className="admin-chip"
            aria-pressed={r === days}
            onClick={() => setDays(r)}
          >
            {r}d
          </button>
        ))}
      </div>

      {/* PG Supply & Demand collapsible overview */}
      {overview && (
        <div style={{ marginBottom: 16 }}>
          <button
            type="button"
            style={{
              all: "unset",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              gap: 8,
              fontSize: 13,
              fontWeight: 600,
              color: "#374151",
              marginBottom: overviewOpen ? 12 : 0,
              padding: "4px 0"
            }}
            onClick={() => setOverviewOpen((v) => !v)}
          >
            <span
              style={{
                display: "inline-block",
                transition: "transform .2s",
                transform: overviewOpen ? "rotate(90deg)" : "rotate(0deg)",
                fontSize: 11
              }}
            >
              ▶
            </span>
            PG Supply &amp; Demand
          </button>
          {overviewOpen && <PgOverviewSection overview={overview} days={days} />}
        </div>
      )}

      {disabled ? (
        <EmptyState
          title="Analytics unavailable"
          hint="Enable ff_pg_admin_analytics to view the PG listing funnel."
        />
      ) : data ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <PgListingFunnel data={data} />
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(340px, 1fr))",
              gap: 16
            }}
          >
            <PgListingQuality data={data} />
            <PgVoiceMetrics data={data} />
          </div>
        </div>
      ) : (
        !loading && <EmptyState title="No PG listing activity yet" />
      )}
    </div>
  );
}
