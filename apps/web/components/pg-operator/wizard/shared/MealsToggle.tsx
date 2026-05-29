"use client";
import RupeeInput from "./RupeeInput";

const MEALS = ["breakfast", "lunch", "snack", "dinner"] as const;

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
    <fieldset>
      <legend>Meals</legend>
      <label>
        <input
          type="checkbox"
          aria-label="food provided"
          checked={!!v.provided}
          onChange={(e) => set({ provided: e.target.checked })}
        />{" "}
        Food provided
      </label>
      {v.provided && (
        <>
          {MEALS.map((m) => (
            <label key={m}>
              <input
                type="checkbox"
                aria-label={m}
                checked={!!v[m]}
                onChange={(e) => set({ [m]: e.target.checked })}
              />{" "}
              {m}
            </label>
          ))}
          <label>
            <input
              type="checkbox"
              aria-label="veg only"
              checked={!!v.veg_only}
              onChange={(e) => set({ veg_only: e.target.checked })}
            />{" "}
            Veg only
          </label>
          <label>
            Meal charges
            <RupeeInput
              aria-label="meal charges"
              valuePaise={v.meal_charges_paise ?? null}
              onChangePaise={(p) => set({ meal_charges_paise: p })}
            />
          </label>
        </>
      )}
    </fieldset>
  );
}
