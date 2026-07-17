"use client";

import { Badge } from "@cribliv/ui";
import type { PgOccupancySummary as PgOccupancySummaryData } from "@cribliv/shared-types";
import styles from "./PgOccupancySummary.module.css";

export default function PgOccupancySummary({ summary }: { summary: PgOccupancySummaryData }) {
  const occupiedLabel = `${summary.occupied_beds} occupied`;

  return (
    <section className={styles.summary} aria-label="Occupancy summary">
      <div className={styles.primaryMetric}>
        <span className={styles.metricLabel}>Occupancy</span>
        <strong>{summary.occupancy_percent}%</strong>
        <span className={styles.metricDetail}>{occupiedLabel}</span>
      </div>
      <dl className={styles.metrics}>
        <div>
          <dt>Total beds</dt>
          <dd>{summary.total_beds}</dd>
        </div>
        <div>
          <dt>Vacant</dt>
          <dd>{summary.vacant_beds}</dd>
        </div>
        <div>
          <dt>Reserved</dt>
          <dd>{summary.reserved_beds}</dd>
        </div>
        <div>
          <dt>Blocked</dt>
          <dd>{summary.blocked_beds}</dd>
        </div>
      </dl>
      {summary.inactive_beds > 0 && <Badge tone="neutral">{summary.inactive_beds} inactive</Badge>}
    </section>
  );
}
