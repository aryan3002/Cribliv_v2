"use client";

import { useEffect, useState } from "react";
import { StatCard } from "../primitives/StatCard";
import { SectionCard } from "../primitives/SectionCard";
import { EmptyState } from "../primitives/EmptyState";
import { BarChart } from "../charts/BarChart";
import {
  fetchAdminAnalyticsByCity,
  fetchAdminAnalyticsFunnel,
  fetchAdminAnalyticsOverview,
  fetchAdminAnalyticsResponseRates,
  fetchAdminAnalyticsRevenue,
  type AdminAnalyticsOverview,
  type AdminCityCount,
  type AdminFunnelMetrics,
  type AdminResponseRate,
  type AdminRevenue
} from "../../../lib/admin-api";
import { formatINR, formatNumber, formatPct } from "../../../lib/admin/format";

interface Props {
  accessToken: string;
}

export function OverviewTab({ accessToken }: Props) {
  const [overview, setOverview] = useState<AdminAnalyticsOverview | null>(null);
  const [funnel, setFunnel] = useState<AdminFunnelMetrics | null>(null);
  const [response, setResponse] = useState<AdminResponseRate | null>(null);
  const [revenue, setRevenue] = useState<AdminRevenue | null>(null);
  const [cities, setCities] = useState<AdminCityCount[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all([
      fetchAdminAnalyticsOverview(accessToken).catch(() => null),
      fetchAdminAnalyticsFunnel(accessToken).catch(() => null),
      fetchAdminAnalyticsResponseRates(accessToken).catch(() => null),
      fetchAdminAnalyticsRevenue(accessToken).catch(() => null),
      fetchAdminAnalyticsByCity(accessToken).catch(() => [])
    ])
      .then(([o, f, r, rv, c]) => {
        if (cancelled) return;
        setOverview(o);
        setFunnel(f);
        setResponse(r);
        setRevenue(rv);
        setCities(c);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [accessToken]);

  return (
    <div className="admin-main__section">
      <div className="admin-page-title">
        <h1>Overview</h1>
        <span className="admin-page-title__sub">{loading ? "loading…" : "30-day window"}</span>
      </div>

      <div className="admin-stat-grid">
        <StatCard
          label="Total listings"
          value={formatNumber(overview?.totalListings ?? 0)}
          tone="brand"
        />
        <StatCard
          label="Active listings"
          value={formatNumber(overview?.activeListings ?? 0)}
          tone="trust"
        />
        <StatCard label="Total users" value={formatNumber(overview?.totalUsers ?? 0)} />
        <StatCard
          label="Contact unlocks"
          value={formatNumber(overview?.totalUnlocks ?? 0)}
          tone="warn"
        />
        <StatCard
          label="Revenue (all time)"
          value={formatINR(overview?.totalRevenuePaise ?? 0)}
          tone="trust"
        />
        <StatCard
          label="Featured revenue · 30d"
          value={formatINR(revenue?.totalPaise ?? 0)}
          tone="brand"
        />
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(0, 1.4fr) minmax(280px, 1fr)",
          gap: 16
        }}
      >
        <SectionCard title="Conversion funnel · 30 days">
          {funnel ? <FunnelView funnel={funnel} /> : <EmptyState title="No funnel data" />}
        </SectionCard>

        <SectionCard title="Owner response rate" subtitle="Last 30 days, contact unlocks">
          {response ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <div
                style={{
                  fontFamily: "var(--font-heading)",
                  fontSize: 36,
                  fontWeight: 700,
                  letterSpacing: "-0.02em",
                  color: "var(--ad-text)"
                }}
              >
                {formatPct(response.avgResponseRate, 1)}
              </div>
              <div style={{ fontSize: 12, color: "var(--ad-text-3)" }}>
                {formatNumber(response.responded)} of {formatNumber(response.totalUnlocks)} unlocks
                responded to
              </div>
            </div>
          ) : (
            <EmptyState title="No response data" />
          )}
        </SectionCard>
      </div>

      <SectionCard title="Listings by city" subtitle="Top localities, active listings only">
        {cities.length === 0 ? (
          <EmptyState title="No city data yet" />
        ) : (
          <BarChart
            data={cities
              .slice(0, 12)
              .map((c) => ({
                key: `${c.city}${c.locality ? ` · ${c.locality}` : ""}`,
                count: c.count
              }))}
            xKey="key"
            yKey="count"
            layout="vertical"
            color="#0066FF"
          />
        )}
      </SectionCard>
    </div>
  );
}

function FunnelView({ funnel }: { funnel: AdminFunnelMetrics }) {
  const steps = [
    { label: "Views", value: funnel.views },
    { label: "Enquiries", value: funnel.enquiries },
    { label: "Unlocks", value: funnel.unlocks },
    { label: "Leads", value: funnel.leadsCreated }
  ];
  const max = Math.max(...steps.map((s) => s.value), 1);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {steps.map((s, i) => {
        const pct = (s.value / max) * 100;
        const conv = i > 0 && steps[i - 1].value > 0 ? s.value / steps[i - 1].value : null;
        return (
          <div
            key={s.label}
            style={{
              display: "grid",
              gridTemplateColumns: "100px 1fr 80px",
              gap: 12,
              alignItems: "center",
              fontSize: 12.5
            }}
          >
            <span style={{ color: "var(--ad-text-2)", fontWeight: 500 }}>{s.label}</span>
            <div
              style={{
                position: "relative",
                height: 26,
                background: "var(--ad-surface-2)",
                borderRadius: 6,
                overflow: "hidden"
              }}
            >
              <div
                style={{
                  position: "absolute",
                  inset: 0,
                  width: `${pct}%`,
                  background: "linear-gradient(90deg, var(--ad-brand) 0%, #93c5fd 100%)",
                  transition: "width 320ms ease"
                }}
              />
              <span
                style={{
                  position: "absolute",
                  inset: 0,
                  display: "flex",
                  alignItems: "center",
                  paddingLeft: 10,
                  fontWeight: 700,
                  color: "#fff",
                  mixBlendMode: "multiply"
                }}
              >
                {formatNumber(s.value)}
              </span>
            </div>
            <span
              style={{
                color: "var(--ad-text-3)",
                fontFamily: "var(--font-mono)",
                fontSize: 11.5,
                textAlign: "right"
              }}
            >
              {conv == null ? "—" : formatPct(conv, 1)}
            </span>
          </div>
        );
      })}
    </div>
  );
}
