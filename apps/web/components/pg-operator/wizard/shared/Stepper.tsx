"use client";
import styles from "./pg-wizard.module.css";

export default function Stepper({
  label,
  value,
  min = 0,
  max = 9999,
  step = 1,
  onChange
}: {
  label?: string;
  value: number;
  min?: number;
  max?: number;
  step?: number;
  onChange: (v: number) => void;
}) {
  const clamp = (n: number) => Math.max(min, Math.min(max, n));
  return (
    <div>
      {label && <span className={styles.fieldLabel}>{label}</span>}
      <div className={styles.stepper}>
        <button
          type="button"
          aria-label={`decrease ${label ?? ""}`}
          className={styles.stepperBtn}
          disabled={value <= min}
          onClick={() => onChange(clamp(value - step))}
        >
          −
        </button>
        <span className={styles.stepperVal} aria-live="polite">
          {value}
        </span>
        <button
          type="button"
          aria-label={`increase ${label ?? ""}`}
          className={styles.stepperBtn}
          disabled={value >= max}
          onClick={() => onChange(clamp(value + step))}
        >
          +
        </button>
      </div>
    </div>
  );
}
