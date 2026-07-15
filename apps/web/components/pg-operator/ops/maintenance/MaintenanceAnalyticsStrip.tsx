import type { PgMaintenanceAnalytics } from "@cribliv/shared-types";
import styles from "./MaintenanceQueue.module.css";

export default function MaintenanceAnalyticsStrip({
  analytics,
  inert = false
}: {
  analytics: PgMaintenanceAnalytics;
  inert?: boolean;
}) {
  const metrics = [
    { count: analytics.open, label: "open" },
    { count: analytics.overdue, label: "overdue" },
    { count: analytics.due_today, label: "due today" },
    { count: analytics.waiting_on_tenant, label: "waiting" },
    { count: analytics.resolved_pending_close, label: "resolved" },
    { count: analytics.closed_this_month, label: "closed this month" }
  ];

  return (
    <section
      className={styles.analyticsStrip}
      aria-label="Maintenance analytics"
      inert={inert ? ("" as unknown as boolean) : undefined}
    >
      {metrics.map((metric) => {
        return (
          <div key={metric.label} className={styles.metric}>
            <span>{`${metric.count} ${metric.label}`}</span>
          </div>
        );
      })}
    </section>
  );
}
