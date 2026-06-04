"use client";
import styles from "./pg-wizard.module.css";

export default function TimeRange({
  label,
  from,
  to,
  onChange
}: {
  label?: string;
  from: string;
  to: string;
  onChange: (v: { from: string; to: string }) => void;
}) {
  return (
    <div>
      {label && <span className={styles.fieldLabel}>{label}</span>}
      <div className={styles.timeRange}>
        <input
          aria-label={`${label ?? ""} from`}
          type="time"
          className={styles.timeInput}
          value={from}
          onChange={(e) => onChange({ from: e.target.value, to })}
        />
        <span className={styles.timeSep} aria-hidden>
          –
        </span>
        <input
          aria-label={`${label ?? ""} to`}
          type="time"
          className={styles.timeInput}
          value={to}
          onChange={(e) => onChange({ from, to: e.target.value })}
        />
      </div>
    </div>
  );
}
