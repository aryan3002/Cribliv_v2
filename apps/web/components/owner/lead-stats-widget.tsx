"use client";

import { useEffect, useState, useCallback } from "react";
import { fetchLeadStats, type LeadStats } from "../../lib/owner-api";
import { Inbox, Phone, CalendarCheck, CheckCircle2, XCircle, TrendingUp } from "lucide-react";

interface Props {
  accessToken: string;
}

const STAT_CONFIG: Array<{
  key: keyof Omit<LeadStats, "total">;
  label: string;
  color: string;
  bg: string;
  Icon: typeof Inbox;
}> = [
  { key: "new", label: "New", color: "#3b82f6", bg: "rgba(59,130,246,0.1)", Icon: Inbox },
  {
    key: "contacted",
    label: "Contacted",
    color: "#f59e0b",
    bg: "rgba(245,158,11,0.1)",
    Icon: Phone
  },
  {
    key: "visit_scheduled",
    label: "Visit Scheduled",
    color: "#7c3aed",
    bg: "rgba(124,58,237,0.1)",
    Icon: CalendarCheck
  },
  {
    key: "deal_done",
    label: "Deal Done",
    color: "#22c55e",
    bg: "rgba(34,197,94,0.1)",
    Icon: CheckCircle2
  },
  { key: "lost", label: "Lost", color: "#94a3b8", bg: "rgba(148,163,184,0.1)", Icon: XCircle }
];

export function LeadStatsWidget({ accessToken }: Props) {
  const [stats, setStats] = useState<LeadStats | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      setStats(await fetchLeadStats(accessToken));
    } catch {
      // silent
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
      <div className="lead-stats-grid">
        {STAT_CONFIG.map((s) => (
          <div key={s.key} className="skeleton-card lead-stats-skeleton" />
        ))}
      </div>
    );
  }

  if (!stats || stats.total === 0) {
    return (
      <div className="lead-stats-empty">
        <Inbox size={20} className="lead-stats-empty__icon" aria-hidden="true" />
        <div>
          <p className="lead-stats-empty__title">No leads yet</p>
          <p className="lead-stats-empty__sub">
            Share your listings to start receiving tenant enquiries.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div>
      {/* Total headline */}
      <div className="lead-stats-total">
        <TrendingUp size={16} className="lead-stats-total__icon" aria-hidden="true" />
        <span className="lead-stats-total__num">{stats.total}</span>
        <span className="lead-stats-total__label">total enquiries</span>
      </div>

      {/* Stat cards */}
      <div className="lead-stats-grid">
        {STAT_CONFIG.map((s) => {
          const value = stats[s.key] ?? 0;
          const pct = stats.total > 0 ? Math.round((value / stats.total) * 100) : 0;
          const Ico = s.Icon;
          return (
            <div key={s.key} className="lead-stat-card">
              <div className="lead-stat-card__icon" style={{ background: s.bg }}>
                <Ico size={16} style={{ color: s.color }} aria-hidden="true" />
              </div>
              <span className="lead-stat-card__num" style={{ color: s.color }}>
                {value}
              </span>
              <span className="lead-stat-card__label">{s.label}</span>
              {/* Progress bar */}
              <div className="lead-stat-card__bar-track">
                <div
                  className="lead-stat-card__bar-fill"
                  style={{ width: `${pct}%`, background: s.color }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
