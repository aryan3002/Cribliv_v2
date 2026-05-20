"use client";
import { usePlans } from "@/lib/rent-agreement/hooks/use-plans";
import type { Locale, PlanId } from "@/lib/rent-agreement/api/types";

export function PlanPicker(props: {
  value: { plan: PlanId; locale: Locale };
  onChange: (v: { plan: PlanId; locale: Locale }) => void;
}) {
  const plans = usePlans();
  if (plans.isLoading) return <p>Loading plans…</p>;
  if (plans.isError) return <p>Failed to load plans.</p>;
  return (
    <div className="space-y-2">
      <div role="radiogroup" aria-label="Plan" className="space-y-1">
        {plans.data?.map((p) => (
          <label key={p.id} className="flex items-center gap-2">
            <input
              type="radio"
              name="plan"
              value={p.id}
              checked={props.value.plan === p.id}
              onChange={() => props.onChange({ ...props.value, plan: p.id })}
            />
            <span className="font-medium">{p.display_name}</span>
            <span className="text-gray-600 text-sm">₹{(p.amount_paise / 100).toFixed(2)}</span>
          </label>
        ))}
      </div>
      <label className="flex items-center gap-2">
        <span>Locale:</span>
        <select
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
