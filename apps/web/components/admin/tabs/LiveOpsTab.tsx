"use client";

import { useEffect, useState } from "react";
import { Activity, AlertTriangle, ClipboardList, KeyRound, Mic, ShieldCheck } from "lucide-react";
import { StatCard } from "../primitives/StatCard";
import { SectionCard } from "../primitives/SectionCard";
import { EmptyState } from "../primitives/EmptyState";
import { AreaChart } from "../charts/AreaChart";
import { StatusPill } from "../primitives/StatusPill";
import {
  fetchAdminFraudFeed,
  fetchAdminLiveOps,
  fetchAdminOpsSparklines,
  fetchAdminUnlocksHourly,
  type FraudFeedItem,
  type LiveOpsCounters,
  type OpsSparklines,
  type UnlocksHourlyBucket
} from "../../../lib/admin-api";
import { formatHourBucket, formatNumber, formatRelativeTime } from "../../../lib/admin/format";

interface Props {
  accessToken: string;
  onJumpToTab: (tab: "fraud" | "verifications" | "listings") => void;
}

export function LiveOpsTab({ accessToken, onJumpToTab }: Props) {
  const [counters, setCounters] = useState<LiveOpsCounters | null>(null);
  const [sparks, setSparks] = useState<OpsSparklines | null>(null);
  const [hourly, setHourly] = useState<UnlocksHourlyBucket[] | null>(null);
  const [feed, setFeed] = useState<FraudFeedItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const [c, s, h, f] = await Promise.all([
          fetchAdminLiveOps(accessToken),
          fetchAdminOpsSparklines(accessToken),
          fetchAdminUnlocksHourly(accessToken),
          fetchAdminFraudFeed(accessToken, 8)
        ]);
        if (cancelled) return;
        setCounters(c);
        setSparks(s);
        setHourly(h.buckets);
        setFeed(f.items);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    const t = window.setInterval(load, 30_000);
    return () => {
      cancelled = true;
      window.clearInterval(t);
    };
  }, [accessToken]);

  const tiles = [
    {
      label: "Leads · 24h",
      value: counters?.leads_24h ?? 0,
      tone: "brand" as const,
      spark: sparks?.leads ?? []
    },
    {
      label: "Unlocks · today",
      value: counters?.unlocks_today ?? 0,
      tone: "trust" as const,
      spark: sparks?.unlocks ?? []
    },
    {
      label: "Fraud · open",
      value: counters?.fraud_open ?? 0,
      tone: counters && counters.fraud_open > 0 ? ("danger" as const) : ("default" as const),
      spark: sparks?.fraud ?? []
    },
    {
      label: "Verifications pending",
      value: counters?.verifications_pending ?? 0,
      tone: "warn" as const
    },
    {
      label: "Listings pending review",
      value: counters?.listings_pending_review ?? 0,
      tone: "warn" as const
    },
    {
      label: "Voice sessions live",
      value: counters?.online_voice_sessions ?? 0,
      tone: "default" as const
    }
  ];

  return (
    <div className="admin-main__section">
      <div className="admin-page-title">
        <h1>Live Operations</h1>
        <span className="admin-page-title__sub">
          {loading
            ? "loading…"
            : `polled ${formatRelativeTime(counters?.generated_at ?? new Date().toISOString())} · auto-refresh 30s`}
        </span>
      </div>

      <div className="admin-stat-grid">
        {tiles.map((t) => (
          <StatCard
            key={t.label}
            label={t.label}
            value={formatNumber(typeof t.value === "number" ? t.value : 0)}
            spark={t.spark}
            tone={t.tone}
          />
        ))}
      </div>

      <div
        style={{
          display: "grid",
          gap: 16,
          gridTemplateColumns: "minmax(0, 1.6fr) minmax(280px, 1fr)"
        }}
      >
        <SectionCard title="Contact unlocks · last 24 hours" subtitle="Hourly buckets, all sources">
          {hourly && hourly.length > 0 ? (
            <AreaChart
              data={hourly.map((h) => ({ hour: h.hour, count: h.count }))}
              xKey="hour"
              yKey="count"
              xTickFormatter={formatHourBucket}
            />
          ) : (
            <EmptyState title="No unlocks in the last 24 hours" />
          )}
        </SectionCard>

        <SectionCard
          title="Fresh signals"
          subtitle="Latest fraud + risk events"
          flush
          action={
            <button
              type="button"
              className="admin-btn admin-btn--ghost admin-btn--sm"
              onClick={() => onJumpToTab("fraud")}
            >
              View all
            </button>
          }
        >
          {feed.length === 0 ? (
            <EmptyState title="All quiet" hint="No open fraud signals right now." />
          ) : (
            <div className="admin-feed">
              {feed.slice(0, 5).map((item) => (
                <div key={item.id} className="admin-feed__item">
                  <span
                    className="admin-feed__dot"
                    data-severity={item.severity}
                    aria-hidden="true"
                  />
                  <div>
                    <div className="admin-feed__summary">{item.summary}</div>
                    <div className="admin-feed__meta">
                      <StatusPill status={item.kind} tone="muted" noDot />
                      <span>
                        {item.kind === "inactive_owner" &&
                        !(item.evidence as { last_seen?: string | null }).last_seen
                          ? "never seen"
                          : formatRelativeTime(item.detected_at)}
                      </span>
                    </div>
                  </div>
                  <span />
                </div>
              ))}
            </div>
          )}
        </SectionCard>
      </div>

      <SectionCard title="Action queue" subtitle="Jump straight to whatever needs you next" flush>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
            gap: 12,
            padding: 14
          }}
        >
          <ActionTile
            icon={<ClipboardList size={18} />}
            label="Listings pending review"
            count={counters?.listings_pending_review ?? 0}
            onClick={() => onJumpToTab("listings")}
          />
          <ActionTile
            icon={<ShieldCheck size={18} />}
            label="Verifications waiting"
            count={counters?.verifications_pending ?? 0}
            onClick={() => onJumpToTab("verifications")}
          />
          <ActionTile
            icon={<AlertTriangle size={18} />}
            label="Open fraud signals"
            count={counters?.fraud_open ?? 0}
            onClick={() => onJumpToTab("fraud")}
          />
        </div>
      </SectionCard>

      <div style={{ display: "flex", gap: 16, color: "var(--ad-text-3)", fontSize: 12 }}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          <KeyRound size={12} aria-hidden="true" /> Cmd+K to jump anywhere
        </span>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          <Mic size={12} aria-hidden="true" />
          Voice sessions are sampled every 5 minutes
        </span>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          <Activity size={12} aria-hidden="true" /> Sparklines = last 60 minutes
        </span>
      </div>
    </div>
  );
}

function ActionTile({
  icon,
  label,
  count,
  onClick
}: {
  icon: React.ReactNode;
  label: string;
  count: number;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "12px 14px",
        background: "var(--ad-surface)",
        border: "1px solid var(--ad-border)",
        borderRadius: 10,
        cursor: "pointer",
        textAlign: "left",
        fontFamily: "inherit"
      }}
    >
      <span
        style={{
          width: 32,
          height: 32,
          borderRadius: 8,
          display: "grid",
          placeItems: "center",
          background: "var(--ad-brand-soft)",
          color: "var(--ad-brand)"
        }}
      >
        {icon}
      </span>
      <span style={{ flex: 1, minWidth: 0 }}>
        <span
          style={{
            display: "block",
            fontSize: 12.5,
            color: "var(--ad-text-2)",
            fontWeight: 500
          }}
        >
          {label}
        </span>
        <span
          style={{
            display: "block",
            fontFamily: "var(--font-heading)",
            fontSize: 22,
            fontWeight: 700,
            color: "var(--ad-text)",
            letterSpacing: "-0.01em"
          }}
        >
          {count}
        </span>
      </span>
    </button>
  );
}
