"use client";

import { useEffect, useState, useCallback } from "react";
import { fetchLeadStats, type LeadStats } from "../../lib/owner-api";

interface Props {
  accessToken: string;
}

const STAT_CONFIG: Array<{
  key: keyof Omit<LeadStats, "total">;
  label: string;
  color: string;
  bgColor: string;
  icon: string;
}> = [
  { key: "new", label: "New", color: "#3b82f6", bgColor: "rgba(59,130,246,0.08)", icon: "✉️" },
  {
    key: "contacted",
    label: "Contacted",
    color: "#f59e0b",
    bgColor: "rgba(245,158,11,0.08)",
    icon: "📞"
  },
  {
    key: "visit_scheduled",
    label: "Visit Scheduled",
    color: "#5046e5",
    bgColor: "rgba(80,70,229,0.08)",
    icon: "📅"
  },
  {
    key: "deal_done",
    label: "Deal Done",
    color: "#22c55e",
    bgColor: "rgba(34,197,94,0.08)",
    icon: "✅"
  },
  { key: "lost", label: "Lost", color: "#94a3b8", bgColor: "rgba(148,163,184,0.08)", icon: "❌" }
];

export function LeadStatsWidget({ accessToken }: Props) {
  const [stats, setStats] = useState<LeadStats | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const data = await fetchLeadStats(accessToken);
      setStats(data);
    } catch {
      // silent — don't block the dashboard
    } finally {
      setLoading(false);
    }
  }, [accessToken]);

  useEffect(() => {
    void load();
    const id = setInterval(() => void load(), 60_000);
    return () => clearInterval(id);
  }, [load]);

  if (loading) {
    return (
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(5, 1fr)",
          gap: "var(--space-3)",
          marginBottom: "var(--space-5)"
        }}
      >
        {STAT_CONFIG.map((s) => (
          <div
            key={s.key}
            className="skeleton-card"
            style={{ height: 88, borderRadius: "var(--radius-lg)" }}
          />
        ))}
      </div>
    );
  }

  if (!stats) return null;

  const total = stats.total ?? 0;

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(5, 1fr)",
        gap: "var(--space-3)",
        marginBottom: "var(--space-5)"
      }}
    >
      {STAT_CONFIG.map((s) => {
        const value = stats[s.key] ?? 0;
        const pct = total > 0 ? Math.round((value / total) * 100) : 0;

        return (
          <div
            key={s.key}
            className="card"
            style={{
              padding: "var(--space-4)",
              borderRadius: "var(--radius-lg)",
              background: "var(--surface)",
              cursor: "default",
              transition: "transform var(--transition-base), box-shadow var(--transition-base)"
            }}
          >
            {/* Icon + value row */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                marginBottom: "var(--space-2)"
              }}
            >
              <span
                style={{
                  fontSize: 18,
                  width: 36,
                  height: 36,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  borderRadius: "var(--radius-md)",
                  background: s.bgColor
                }}
              >
                {s.icon}
              </span>
              <span
                style={{
                  fontFamily: "var(--font-heading)",
                  fontSize: 26,
                  fontWeight: 700,
                  color: s.color,
                  lineHeight: 1
                }}
              >
                {value}
              </span>
            </div>

            {/* Label */}
            <p
              style={{
                fontSize: 12,
                fontWeight: 600,
                color: "var(--text-secondary)",
                marginBottom: "var(--space-2)",
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis"
              }}
            >
              {s.label}
            </p>

            {/* Progress bar */}
            <div
              style={{
                height: 3,
                borderRadius: 99,
                background: "var(--surface-sunken)",
                overflow: "hidden"
              }}
            >
              <div
                style={{
                  height: "100%",
                  width: `${pct}%`,
                  borderRadius: 99,
                  background: s.color,
                  transition: "width 0.6s cubic-bezier(0.4,0,0.2,1)"
                }}
              />
            </div>
            <p style={{ fontSize: 10, color: "var(--text-tertiary)", marginTop: 4 }}>
              {pct}% of {total}
            </p>
          </div>
        );
      })}
    </div>
  );
}
