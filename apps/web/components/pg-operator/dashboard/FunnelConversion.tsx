import type { PgPortfolioSummary } from "@cribliv/shared-types";
import { AlertTriangle } from "lucide-react";
import styles from "@/app/[locale]/pg-operator/dashboard/pg-dashboard.module.css";

export function FunnelConversion({
  portfolio: p,
  deals
}: {
  portfolio: PgPortfolioSummary;
  deals: number;
}) {
  const stages = [
    { label: "Appearances", value: p.appearances },
    { label: "Views", value: p.views },
    { label: "Leads", value: p.leads },
    { label: "Deals", value: deals }
  ];
  const max = Math.max(p.appearances, 1);

  const transitions = stages.slice(0, -1).map((s, i) => {
    const next = stages[i + 1];
    const ratio = s.value > 0 ? next.value / s.value : null;
    return { label: `${s.label} → ${next.label}`, ratio };
  });
  const valid = transitions.filter((t) => t.ratio !== null) as Array<{
    label: string;
    ratio: number;
  }>;
  const leak = valid.length ? valid.reduce((m, t) => (t.ratio < m.ratio ? t : m)) : null;

  return (
    <div className={styles.funnelPanel}>
      <h3 className={styles.funnelTitle}>Conversion funnel</h3>
      {stages.map((s, i) => {
        const isLast = i === stages.length - 1;
        return (
          <div key={s.label} className={styles.funnelRow}>
            <div className={styles.funnelBarWrap}>
              <div
                className={`${styles.funnelBar} ${isLast ? styles.funnelBarRed : styles.funnelBarBlue}`}
                style={{ width: `${Math.max((s.value / max) * 100, 4)}%` }}
              >
                <span className={styles.funnelBarLabel}>{s.label}</span>
              </div>
            </div>
            <span className={styles.funnelCount}>{s.value.toLocaleString()}</span>
          </div>
        );
      })}
      {leak && (
        <div className={styles.funnelLeak}>
          <AlertTriangle size={13} /> Biggest drop-off: <strong>{leak.label}</strong> (
          {Math.round((leak.ratio ?? 0) * 100)}% continue)
        </div>
      )}
    </div>
  );
}
