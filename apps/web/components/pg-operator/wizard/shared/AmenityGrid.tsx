"use client";
import { Check } from "lucide-react";

export default function AmenityGrid({
  title,
  options,
  value,
  onChange
}: {
  title: string;
  options: readonly string[];
  value: string[];
  onChange: (v: string[]) => void;
}) {
  const toggle = (k: string) => {
    const s = new Set(value);
    s.has(k) ? s.delete(k) : s.add(k);
    onChange(Array.from(s));
  };

  const formatLabel = (k: string) => k.replace(/_/g, " ");

  return (
    <div className="pgo-form-section">
      <span className="pgo-chips__label">{title}</span>
      <div className="pgo-grid pgo-grid--auto" style={{ marginTop: 10 }}>
        {options.map((k) => {
          const checked = value.includes(k);
          return (
            <div
              key={k}
              className={`pgo-checkcard ${checked ? "pgo-checkcard--checked" : ""}`}
              onClick={() => toggle(k)}
              role="checkbox"
              aria-checked={checked}
              aria-label={formatLabel(k)}
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === " " || e.key === "Enter") {
                  e.preventDefault();
                  toggle(k);
                }
              }}
            >
              <div className="pgo-checkcard__check">{checked && <Check size={12} />}</div>
              <span className="pgo-checkcard__label">{formatLabel(k)}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
