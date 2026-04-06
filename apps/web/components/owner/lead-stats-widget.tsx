"use client";

import { useEffect, useState, useCallback } from "react";
import { fetchLeadStats, type LeadStats } from "../../lib/owner-api";
import { Inbox, Phone, CalendarCheck, CheckCircle2, XCircle } from "lucide-react";

interface Props {
  accessToken: string;
}

const STAT_CONFIG: Array<{
  key: keyof Omit<LeadStats, "total">;
  label: string;
  color: string;
  bgColor: string;
  Icon: typeof Inbox;
}> = [
  { key: "new", label: "New", color: "#3b82f6", bgColor: "rgba(59,130,246,0.08)", Icon: Inbox },
  {
    key: "contacted",
    label: "Contacted",
    color: "#f59e0b",
    bgColor: "rgba(245,158,11,0.08)",
    Icon: Phone
  },
  {
    key: "visit_scheduled",
    label: "Visit Scheduled",
    color: "#7c3aed",
    bgColor: "rgba(124,58,237,0.08)",
    Icon: CalendarCheck
  },
  {
    key: "deal_done",
    label: "Deal Done",
    color: "#22c55e",
    bgColor: "rgba(34,197,94,0.08)",
    Icon: CheckCircle2
  },
  { key: "lost", label: "Lost", color: "#94a3b8", bgColor: "rgba(148,163,184,0.08)", Icon: XCircle }
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
          gap: "var(--space-3)"
        }}
      >
        {STAT_CONFIG.map((s) => (
          <div
            key={s.key}
            className="skeleton-card"
            style={{ height: 80, borderRadius: "var(--radius-lg)" }}
          />
        ))}
      </div>
    );
  }

  if (!stats) return null;

  const total = stats.total ?? 0;

  // When all stats are 0, show a subdued message
  if (total === 0) {
    return (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "var(--space-3)",
          padding: "var(--space-4)",
          borderRadius: "var(--radius-lg)",
          background: "var(--surface-sunken)",
          color: "var(--text-tertiary)",
          fontSize: 14
        }}
      >
        <Inbox size={18} style={{ opacity: 0.5 }} />
        <span>No leads yet — share your listings to start receiving enquiries.</span>
      </div>
    );
  }

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(5, 1fr)",
        gap: "var(--space-3)"
      }}
    >
      {STAT_CONFIG.map((s) => {
        const value = stats[s.key] ?? 0;
        const IconComponent = s.Icon;

        return (
          <div
            key={s.key}
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: "var(--space-1)",
              padding: "var(--space-4) var(--space-3)",
              borderRadius: "var(--radius-lg)",
              background: "var(--surface)",
              border: "1px solid var(--border)",
              transition: "box-shadow 150ms ease, transform 150ms ease",
              cursor: "default"
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.boxShadow = "0 4px 12px rgba(0,0,0,0.06)";
              e.currentTarget.style.transform = "translateY(-1px)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.boxShadow = "none";
              e.currentTarget.style.transform = "none";
            }}
          >
            <div
              style={{
                width: 32,
                height: 32,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                borderRadius: "var(--radius-md)",
                background: s.bgColor
              }}
            >
              <IconComponent size={16} style={{ color: s.color }} />
            </div>
            <span
              style={{
                fontFamily: "var(--font-heading)",
                fontSize: 24,
                fontWeight: 700,
                color: s.color,
                lineHeight: 1
              }}
            >
              {value}
            </span>
            <span
              style={{
                fontSize: 11,
                fontWeight: 600,
                color: "var(--text-secondary)",
                textTransform: "uppercase",
                letterSpacing: "0.04em",
                whiteSpace: "nowrap"
              }}
            >
              {s.label}
            </span>
          </div>
        );
      })}
    </div>
  );
}
