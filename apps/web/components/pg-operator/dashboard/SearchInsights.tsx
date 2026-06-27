import type { PgSearchInsights } from "@cribliv/shared-types";
import styles from "@/app/[locale]/pg-operator/dashboard/pg-dashboard.module.css";

export function SearchInsights({ insights }: { insights: PgSearchInsights }) {
  return (
    <div className={styles.siPanel}>
      <div className={styles.siGroup}>
        <p className={styles.siLabel}>Top searches</p>
        <div className={styles.siChips}>
          {insights.top_queries.length > 0 ? (
            insights.top_queries.map((q) => (
              <span key={q.query} className={`${styles.siChip} ${styles.siChipBlue}`}>
                {q.query}
                <span className={styles.siCount}>{q.count}</span>
              </span>
            ))
          ) : (
            <span className={styles.siEmpty}>No searches yet</span>
          )}
        </div>
      </div>
      <div className={styles.siGroup}>
        <p className={styles.siLabel}>Popular filters</p>
        <div className={styles.siChips}>
          {insights.top_filters.length > 0 ? (
            insights.top_filters.map((f) => (
              <span key={`${f.key}:${f.value}`} className={`${styles.siChip} ${styles.siChipBlue}`}>
                {f.key}: {f.value}
                <span className={styles.siCount}>{f.count}</span>
              </span>
            ))
          ) : (
            <span className={styles.siEmpty}>No filters yet</span>
          )}
        </div>
      </div>
      <div className={styles.siGroup}>
        <p className={styles.siLabel}>Zero-result queries</p>
        <div className={styles.siChips}>
          {insights.zero_result_queries.length > 0 ? (
            insights.zero_result_queries.map((q) => (
              <span key={q.query} className={`${styles.siChip} ${styles.siChipRed}`}>
                {q.query}
                <span className={styles.siCount}>{q.count}</span>
              </span>
            ))
          ) : (
            <span className={styles.siEmpty}>No unmet demand yet</span>
          )}
        </div>
      </div>
    </div>
  );
}
