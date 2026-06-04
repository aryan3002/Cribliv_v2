"use client";
import { ChangeEvent } from "react";
import styles from "./pg-wizard.module.css";

export default function RupeeInput({
  valuePaise,
  onChangePaise,
  label,
  ...rest
}: {
  valuePaise: number | null | undefined;
  onChangePaise: (paise: number | null) => void;
  label?: string;
} & Omit<React.InputHTMLAttributes<HTMLInputElement>, "value" | "onChange">) {
  const rupees = valuePaise == null ? "" : String(Math.round(valuePaise / 100));
  const handle = (e: ChangeEvent<HTMLInputElement>) => {
    const v = e.target.value.replace(/[^\d]/g, "");
    if (v === "") return onChangePaise(null);
    onChangePaise(parseInt(v, 10) * 100);
  };
  return (
    <div>
      {label && <span className={styles.fieldLabel}>{label}</span>}
      <div className={styles.rupee}>
        <span className={styles.rupeePrefix} aria-hidden>
          ₹
        </span>
        <input
          className={styles.rupeeInput}
          inputMode="numeric"
          placeholder="0"
          aria-label={label}
          {...rest}
          value={rupees}
          onChange={handle}
        />
      </div>
    </div>
  );
}
