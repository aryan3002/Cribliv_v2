"use client";
import { ChangeEvent } from "react";

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
    <div className="pgo-field pgo-field--rupee">
      <input
        className="pgo-field__input"
        inputMode="numeric"
        placeholder=" "
        {...rest}
        value={rupees}
        onChange={handle}
      />
      <span className="pgo-field__prefix" aria-hidden>
        ₹
      </span>
      {label && (
        <label className="pgo-field__label" style={{ left: 36 }}>
          {label}
        </label>
      )}
      <span className="pgo-field__bar" />
    </div>
  );
}
