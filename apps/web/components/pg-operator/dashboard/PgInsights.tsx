import type { PgDashboardData } from "@cribliv/shared-types";
import { Building2, Gauge, DoorOpen, Target, Inbox, TrendingUp, ArrowUp } from "lucide-react";
import styles from "@/app/[locale]/pg-operator/dashboard/pg-dashboard.module.css";

/**
 * Operator insights derived entirely from the existing dashboard payload — no
 * extra fetch. Surfaces portfolio health an operator acts on: live inventory,
 * avg quality, open vacancies, lead conversion, fresh leads, and top performer.
 */
export default function PgInsights({ data }: { data: PgDashboardData }) {
  const lh = data.listing_health;
  if (lh.length === 0) return null;

  const active = lh.filter((l) => l.status === "active").length;
  const scored = lh.filter((l) => l.composite_score != null);
  const avgScore = scored.length
    ? Math.round(scored.reduce((n, l) => n + (l.composite_score ?? 0), 0) / scored.length)
    : null;
  const vacancies = lh.reduce((n, l) => n + (l.total_vacancy ?? 0), 0);
  const newLeads = data.leads_inbox.filter((l) => l.status === "new").length;
  const conversion = Math.round((data.portfolio.conversion ?? 0) * 100);
  const top = lh.reduce<(typeof lh)[number] | null>(
    (best, l) => (best == null || l.views_7d > best.views_7d ? l : best),
    null
  );
  const topName = top?.title?.trim() || (top ? `PG #${top.listing_id.slice(0, 8)}` : "—");

  const scoreColor =
    avgScore == null
      ? "#9ca3af"
      : avgScore >= 70
        ? "#3ddc8b"
        : avgScore >= 40
          ? "#ffb24d"
          : "#ff8e92";

  const cards = [
    {
      icon: <Building2 size={18} />,
      tint: "#3a8bff",
      bg: "rgba(58,139,255,.14)",
      val: `${active}/${lh.length}`,
      label: "Live listings",
      sub: `${lh.length - active} hidden or in review`
    },
    {
      icon: <Gauge size={18} />,
      tint: scoreColor,
      bg: "rgba(61,220,139,.12)",
      val: avgScore != null ? `${avgScore}` : "—",
      label: "Avg listing quality",
      sub:
        avgScore != null && avgScore < 70 ? "Improve listings to rank higher" : "Strong portfolio"
    },
    {
      icon: <DoorOpen size={18} />,
      tint: "#3a8bff",
      bg: "rgba(58,139,255,.14)",
      val: `${vacancies}`,
      label: "Open vacancies",
      sub: "Beds available to fill"
    },
    {
      icon: <Target size={18} />,
      tint: "#3ddc8b",
      bg: "rgba(61,220,139,.12)",
      val: `${conversion}%`,
      label: "Lead conversion",
      sub: "Leads per search appearance (7d)"
    },
    {
      icon: <Inbox size={18} />,
      tint: "#ffb24d",
      bg: "rgba(255,178,77,.14)",
      val: `${newLeads}`,
      label: "New leads",
      sub: "Awaiting your first response"
    },
    {
      icon: <TrendingUp size={18} />,
      tint: "#a78bff",
      bg: "rgba(167,139,255,.14)",
      val: top ? `${top.views_7d}` : "—",
      label: "Top performer (views)",
      sub: topName
    }
  ];

  return (
    <div className={styles.insights}>
      {cards.map((c) => (
        <div key={c.label} className={styles.insight}>
          <span className={styles.insightIcon} style={{ background: c.bg, color: c.tint }}>
            {c.icon}
          </span>
          <div
            className={styles.insightVal}
            style={c.label === "Avg listing quality" ? { color: scoreColor } : undefined}
          >
            {c.val}
            {c.label === "New leads" && newLeads > 0 && (
              <span
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 3,
                  marginLeft: 6,
                  fontSize: 12,
                  fontWeight: 700,
                  color: "#3ddc8b"
                }}
              >
                <ArrowUp size={11} />
                {newLeads}
              </span>
            )}
          </div>
          <div className={styles.insightLabel}>{c.label}</div>
          <div className={styles.insightSub}>{c.sub}</div>
        </div>
      ))}
    </div>
  );
}
