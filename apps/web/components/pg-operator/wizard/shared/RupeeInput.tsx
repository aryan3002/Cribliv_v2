"use client";
import { ChangeEvent } from "react";

export default function RupeeInput({
  valuePaise,
  onChangePaise,
  ...rest
}: { valuePaise: number | null | undefined; onChangePaise: (paise: number | null) => void } & Omit<
  React.InputHTMLAttributes<HTMLInputElement>,
  "value" | "onChange"
>) {
  const rupees = valuePaise == null ? "" : String(Math.round(valuePaise / 100));
  const handle = (e: ChangeEvent<HTMLInputElement>) => {
    const v = e.target.value.replace(/[^\d]/g, "");
    if (v === "") return onChangePaise(null);
    onChangePaise(parseInt(v, 10) * 100);
  };
  return (
    <span
      className="rupee-input"
      style={{
        fontFamily: "var(--font-paper-mono), var(--font-paper-body), ui-monospace, monospace"
      }}
    >
      <span aria-hidden>₹</span>
      <input inputMode="numeric" {...rest} value={rupees} onChange={handle} />
    </span>
  );
}
