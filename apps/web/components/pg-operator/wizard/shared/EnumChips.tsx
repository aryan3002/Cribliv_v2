"use client";
import { motion } from "framer-motion";
import { Check } from "lucide-react";

export default function EnumChips<T extends string>({
  label,
  value,
  onChange,
  options
}: {
  label: string;
  value: T | undefined;
  onChange: (v: T) => void;
  options: { value: T; label: string; icon?: React.ReactNode }[];
}) {
  return (
    <div className="pgo-chips">
      <span className="pgo-chips__label">{label}</span>
      <div className="pgo-chips__grid">
        {options.map((o) => {
          const isSelected = value === o.value;
          return (
            <motion.button
              key={o.value}
              type="button"
              className={`pgo-chip ${isSelected ? "pgo-chip--selected" : ""}`}
              aria-pressed={isSelected}
              onClick={() => onChange(o.value)}
              whileHover={{ scale: 1.03 }}
              whileTap={{ scale: 0.97 }}
            >
              {o.icon && <span className="pgo-chip__icon">{o.icon}</span>}
              <span>{o.label}</span>
              <span className="pgo-chip__check">
                <Check size={14} />
              </span>
            </motion.button>
          );
        })}
      </div>
    </div>
  );
}
