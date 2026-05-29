"use client";
import { Dispatch } from "react";
import { PgWizardState, PgWizardAction } from "@/lib/pg-wizard-state";
import RupeeInput from "../shared/RupeeInput";
import EnumChips from "../shared/EnumChips";

const ELECTRICITY = [
  { value: "flat", label: "Flat" },
  { value: "submetered", label: "Submetered" },
  { value: "split_equally", label: "Split equally" }
] as const;
const PAYMENT = ["upi", "bank_transfer", "cash"] as const;

export default function PgPaymentStep({
  state,
  dispatch
}: {
  state: PgWizardState;
  dispatch: Dispatch<PgWizardAction>;
  locale: string;
}) {
  const d = state.draft.pg_details ?? ({} as any);
  const setF = (path: string, value: unknown) => dispatch({ type: "SET_FIELD", path, value });
  const togglePayment = (m: string) => {
    const cur = new Set<string>((d as any).payment_modes ?? []);
    cur.has(m) ? cur.delete(m) : cur.add(m);
    setF("pg_details.payment_modes", Array.from(cur));
  };

  return (
    <section className="pg-step pg-step--payment">
      <h2>Payment</h2>
      <label>
        Notice period (days)
        <input
          type="number"
          aria-label="notice period"
          value={d.notice_period_days ?? ""}
          onChange={(e) =>
            setF("pg_details.notice_period_days", parseInt(e.target.value, 10) || null)
          }
        />
      </label>
      <label>
        Lock-in (months)
        <input
          type="number"
          aria-label="lock-in"
          value={d.lock_in_months ?? ""}
          onChange={(e) => setF("pg_details.lock_in_months", parseInt(e.target.value, 10) || null)}
        />
      </label>
      <EnumChips
        label="Electricity"
        value={(d as any).electricity_mode}
        onChange={(v) => setF("pg_details.electricity_mode", v)}
        options={ELECTRICITY as unknown as { value: string; label: string }[]}
      />
      <label>
        Maintenance (₹/month)
        <RupeeInput
          aria-label="maintenance"
          valuePaise={(d as any).maintenance_paise ?? null}
          onChangePaise={(v) => setF("pg_details.maintenance_paise", v)}
        />
      </label>
      <label>
        Rent due day (1-28)
        <input
          type="number"
          min={1}
          max={28}
          aria-label="rent due day"
          value={(d as any).rent_due_day ?? ""}
          onChange={(e) => setF("pg_details.rent_due_day", parseInt(e.target.value, 10) || null)}
        />
      </label>
      <fieldset>
        <legend>Payment modes</legend>
        {PAYMENT.map((m) => {
          const active = ((d as any).payment_modes ?? []).includes(m);
          return (
            <button key={m} type="button" aria-pressed={active} onClick={() => togglePayment(m)}>
              {m}
            </button>
          );
        })}
      </fieldset>
      <label>
        <input
          type="checkbox"
          aria-label="price negotiable"
          checked={!!(d as any).price_negotiable}
          onChange={(e) => setF("pg_details.price_negotiable", e.target.checked)}
        />{" "}
        Price negotiable
      </label>
      <label>
        Late fee policy
        <textarea
          aria-label="late fee policy"
          value={(d as any).late_fee_policy?.note ?? ""}
          onChange={(e) => setF("pg_details.late_fee_policy", { note: e.target.value })}
        />
      </label>
      <button type="button" onClick={() => dispatch({ type: "GOTO_STEP", step: 2 })}>
        Back
      </button>
      <button type="button" onClick={() => dispatch({ type: "GOTO_STEP", step: 4 })}>
        Next
      </button>
    </section>
  );
}
