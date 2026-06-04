"use client";
import { Check } from "lucide-react";
import type { ReactNode } from "react";
import styles from "./pg-wizard.module.css";

export interface ChipOption {
  value: string;
  label: string;
  icon?: ReactNode;
}

export default function ChipMultiSelect({
  label,
  value,
  options,
  onChange
}: {
  label?: string;
  value: string[] | undefined;
  options: ChipOption[];
  onChange: (v: string[]) => void;
}) {
  const set = new Set(value ?? []);
  const toggle = (v: string) => {
    const next = new Set(set);
    if (next.has(v)) next.delete(v);
    else next.add(v);
    onChange(options.filter((o) => next.has(o.value)).map((o) => o.value));
  };
  return (
    <div>
      {label && <span className={styles.subLabel}>{label}</span>}
      <div className={styles.chipWrap}>
        {options.map((o) => {
          const active = set.has(o.value);
          return (
            <button
              key={o.value}
              type="button"
              aria-pressed={active}
              className={`${styles.chip} ${active ? styles.chipActive : ""}`}
              onClick={() => toggle(o.value)}
            >
              {active ? (
                <span className={styles.chipCheck}>
                  <Check size={14} strokeWidth={3} />
                </span>
              ) : (
                o.icon && <span className={styles.chipIcon}>{o.icon}</span>
              )}
              {o.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
