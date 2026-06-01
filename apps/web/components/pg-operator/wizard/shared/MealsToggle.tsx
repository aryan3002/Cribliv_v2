"use client";
import { AnimatePresence, motion } from "framer-motion";
import { Check } from "lucide-react";
import RupeeInput from "./RupeeInput";

const MEALS = [
  { key: "breakfast", emoji: "🌅" },
  { key: "lunch", emoji: "🍛" },
  { key: "snack", emoji: "🍪" },
  { key: "dinner", emoji: "🌙" }
] as const;

export default function MealsToggle({
  value,
  onChange
}: {
  value: any;
  onChange: (v: any) => void;
}) {
  const v = value ?? { provided: false };
  const set = (patch: any) => onChange({ ...v, ...patch });

  return (
    <div className="pgo-meals-section">
      <div className="pgo-section-header" style={{ marginBottom: 16 }}>
        <div className="pgo-section-header__text">
          <h3 className="pgo-heading pgo-heading--sm">Food & Meals</h3>
        </div>
      </div>

      {/* Toggle switch */}
      <label className={`pgo-switch ${v.provided ? "pgo-switch--on" : ""}`}>
        <input
          type="checkbox"
          checked={!!v.provided}
          onChange={(e) => set({ provided: e.target.checked })}
          aria-label="food provided"
        />
        <div className="pgo-switch__track">
          <div className="pgo-switch__thumb" />
        </div>
        <span className="pgo-switch__label">Food provided</span>
        <span className="pgo-switch__emoji">{v.provided ? "🍽️" : "❌"}</span>
      </label>

      <AnimatePresence>
        {v.provided && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.3, ease: [0.4, 0, 0.2, 1] }}
            style={{ overflow: "hidden", marginTop: 20 }}
          >
            <span className="pgo-chips__label">Meals offered</span>
            <div className="pgo-meals-grid" style={{ marginTop: 10 }}>
              {MEALS.map(({ key: m, emoji }) => {
                const selected = !!v[m];
                return (
                  <div
                    key={m}
                    className={`pgo-meal-chip ${selected ? "pgo-meal-chip--selected" : ""}`}
                    onClick={() => set({ [m]: !v[m] })}
                    role="checkbox"
                    aria-checked={selected}
                    aria-label={m}
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === " " || e.key === "Enter") {
                        e.preventDefault();
                        set({ [m]: !v[m] });
                      }
                    }}
                  >
                    <span>{emoji}</span>
                    <span>{m}</span>
                    {selected && <Check size={14} />}
                  </div>
                );
              })}
            </div>

            <div className="pgo-form-row" style={{ marginTop: 16 }}>
              <label className={`pgo-switch ${v.veg_only ? "pgo-switch--on" : ""}`}>
                <input
                  type="checkbox"
                  checked={!!v.veg_only}
                  onChange={(e) => set({ veg_only: e.target.checked })}
                  aria-label="veg only"
                />
                <div className="pgo-switch__track">
                  <div className="pgo-switch__thumb" />
                </div>
                <span className="pgo-switch__label">Veg only</span>
                <span className="pgo-switch__emoji">🥬</span>
              </label>

              <RupeeInput
                aria-label="meal charges"
                label="Meal charges / month"
                valuePaise={v.meal_charges_paise ?? null}
                onChangePaise={(p) => set({ meal_charges_paise: p })}
                placeholder=" "
              />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
