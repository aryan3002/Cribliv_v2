import type { PgSearchInsights } from "@cribliv/shared-types";
import styles from "@/app/[locale]/pg-operator/dashboard/pg-dashboard.module.css";

function readableFilterKey(key: string) {
  const label = key.replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim().toLowerCase();
  return label.charAt(0).toUpperCase() + label.slice(1);
}

export function SearchInsights({ insights }: { insights: PgSearchInsights }) {
  return (
    <div className={styles.siPanel}>
      <section className={styles.siCard} aria-label="Top searches">
        <h3 className={styles.siTitle}>Top searches</h3>
        <div className={styles.siList}>
          {insights.top_queries.length > 0 ? (
            insights.top_queries.map((q, i) => (
              <div key={q.query} className={styles.siRow}>
                <span className={styles.siRank}>{i + 1}</span>
                <span className={styles.siTerm}>{q.query}</span>
                <span className={styles.siCount}>{q.count}</span>
              </div>
            ))
          ) : (
            <p className={styles.siEmpty}>No searches recorded yet</p>
          )}
        </div>
      </section>

      <section className={styles.siCard} aria-label="Popular filters">
        <h3 className={styles.siTitle}>Popular filters</h3>
        <div className={styles.siList}>
          {insights.top_filters.length > 0 ? (
            insights.top_filters.map((f) => (
              <div key={`${f.key}:${f.value}`} className={styles.siRow}>
                <span className={styles.siTerm}>
                  <span className={styles.siFilterLabel}>{readableFilterKey(f.key)}</span>
                  <span className={styles.siFilterValue}>{f.value}</span>
                </span>
                <span className={styles.siCount}>{f.count}</span>
              </div>
            ))
          ) : (
            <p className={styles.siEmpty}>No filters used yet</p>
          )}
        </div>
      </section>

      <section className={`${styles.siCard} ${styles.siCardWarn}`} aria-label="Zero-result queries">
        <h3 className={styles.siTitle}>Zero-result queries</h3>
        <div className={styles.siList}>
          {insights.zero_result_queries.length > 0 ? (
            insights.zero_result_queries.map((q) => (
              <div key={q.query} className={`${styles.siRow} ${styles.siRowWarn}`}>
                <span className={styles.siTerm}>{q.query}</span>
                <span className={`${styles.siCount} ${styles.siCountWarn}`}>{q.count}</span>
              </div>
            ))
          ) : (
            <p className={styles.siEmpty}>No zero-result queries</p>
          )}
        </div>
      </section>
    </div>
  );
}
