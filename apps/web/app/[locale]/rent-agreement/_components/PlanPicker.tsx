"use client";
import { usePlans } from "@/lib/rent-agreement/hooks/use-plans";
import type { Locale, PlanCatalogEntry, PlanId } from "@/lib/rent-agreement/api/types";

export function PlanPicker(props: {
  value: { plan: PlanId; locale: Locale };
  onChange: (v: { plan: PlanId; locale: Locale }) => void;
  /** Server-side prefetched catalog. When provided, skips the client fetch + loading flash. */
  initialPlans?: PlanCatalogEntry[];
}) {
  const plans = usePlans(props.initialPlans);
  if (plans.isLoading) return <p className="ra-loading">Loading plans…</p>;
  if (plans.isError) return <p className="ra-error">Failed to load plans.</p>;
  return (
    <div>
      <div role="radiogroup" aria-label="Plan" className="ra-plan-grid">
        {plans.data?.map((p) => (
          <label
            key={p.id}
            className={`ra-plan-card${props.value.plan === p.id ? " ra-plan-card--selected" : ""}`}
          >
            <input
              type="radio"
              name="plan"
              value={p.id}
              checked={props.value.plan === p.id}
              onChange={() => props.onChange({ ...props.value, plan: p.id })}
            />
            <span className="ra-plan-name">{p.display_name}</span>
            <div className="ra-plan-price">₹{(p.amount_paise / 100).toFixed(0)}</div>
            {p.features.length > 0 && (
              <ul className="ra-plan-feature-list">
                {p.features.map((feature) => (
                  <li key={feature}>{feature}</li>
                ))}
              </ul>
            )}
          </label>
        ))}
      </div>
      <label className="ra-locale-row">
        <span>
          <b>Agreement language</b>
          <span className="ra-hint">Choose the language printed in the generated document.</span>
        </span>
        <select
          className="ra-select"
          value={props.value.locale}
          onChange={(e) => props.onChange({ ...props.value, locale: e.target.value as Locale })}
        >
          <option value="en">English</option>
          <option value="hi">हिन्दी</option>
        </select>
      </label>
    </div>
  );
}
