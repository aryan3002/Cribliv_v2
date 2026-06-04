"use client";
import styles from "./pg-wizard.module.css";

export default function SegmentedControl<T extends string>({
  label,
  value,
  options,
  onChange
}: {
  label?: string;
  value: T | undefined;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div>
      {label && <span className={styles.fieldLabel}>{label}</span>}
      <div className={styles.segmented} role="group" aria-label={label}>
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            aria-pressed={value === o.value}
            className={`${styles.segmentedBtn} ${value === o.value ? styles.segmentedBtnActive : ""}`}
            onClick={() => onChange(o.value)}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}
