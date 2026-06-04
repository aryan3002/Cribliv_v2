"use client";
import { Coffee, Sun, Cookie, Moon, Leaf } from "lucide-react";
import type { PgMeals } from "@cribliv/shared-types";
import Toggle from "./Toggle";
import ChipMultiSelect from "./ChipMultiSelect";
import styles from "./pg-wizard.module.css";

const MEAL_OPTS = [
  { value: "breakfast", label: "Breakfast", icon: <Coffee size={15} /> },
  { value: "lunch", label: "Lunch", icon: <Sun size={15} /> },
  { value: "snack", label: "Snack", icon: <Cookie size={15} /> },
  { value: "dinner", label: "Dinner", icon: <Moon size={15} /> }
];
const MEAL_KEYS = ["breakfast", "lunch", "snack", "dinner"] as const;

export default function MealsToggle({
  value,
  onChange
}: {
  value: PgMeals | undefined;
  onChange: (v: PgMeals) => void;
}) {
  const v: PgMeals = value ?? { provided: false };
  const selectedMeals = MEAL_KEYS.filter((k) => !!v[k]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div className={styles.toggleRow}>
        <div>
          <span className={styles.subLabel} style={{ marginBottom: 2 }}>
            Food provided
          </span>
          <p className={styles.sectionSub}>Meals included for tenants</p>
        </div>
        <Toggle
          checked={!!v.provided}
          label="food provided"
          onChange={(on) => onChange(on ? { ...v, provided: true } : { provided: false })}
        />
      </div>

      {v.provided && (
        <>
          <div className={styles.toggleRow}>
            <span
              className={styles.subLabel}
              style={{ display: "inline-flex", alignItems: "center", gap: 7 }}
            >
              <Leaf size={15} /> Pure vegetarian kitchen
            </span>
            <Toggle
              checked={!!v.veg_only}
              label="veg only"
              onChange={(on) => onChange({ ...v, veg_only: on })}
            />
          </div>

          <ChipMultiSelect
            label="Meals provided"
            value={selectedMeals}
            options={MEAL_OPTS}
            onChange={(vals) => {
              const set = new Set(vals);
              const next: PgMeals = { ...v };
              MEAL_KEYS.forEach((k) => {
                next[k] = set.has(k);
              });
              onChange(next);
            }}
          />
        </>
      )}
    </div>
  );
}
