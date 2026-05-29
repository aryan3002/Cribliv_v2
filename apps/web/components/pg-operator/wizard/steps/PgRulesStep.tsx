"use client";
import { Dispatch } from "react";
import { PgWizardState, PgWizardAction } from "@/lib/pg-wizard-state";

const RULES = ["smoking", "alcohol", "non_veg", "pets", "cooking_in_room"] as const;

export default function PgRulesStep({
  state,
  dispatch
}: {
  state: PgWizardState;
  dispatch: Dispatch<PgWizardAction>;
  locale: string;
}) {
  const r = state.draft.pg_details?.house_rules ?? ({} as any);
  const setF = (path: string, value: unknown) => dispatch({ type: "SET_FIELD", path, value });
  const toggleRule = (k: string) => setF(`pg_details.house_rules.${k}`, !r[k]);

  return (
    <section className="pg-step pg-step--rules">
      <h2>Rules</h2>
      <label>
        Curfew time
        <input
          type="time"
          aria-label="curfew time"
          value={r.curfew_time ?? ""}
          onChange={(e) => setF("pg_details.house_rules.curfew_time", e.target.value)}
        />
      </label>
      <label>
        Guests policy
        <textarea
          aria-label="guests policy"
          maxLength={400}
          value={r.guests_policy ?? ""}
          onChange={(e) => setF("pg_details.house_rules.guests_policy", e.target.value)}
        />
      </label>
      {RULES.map((k) => (
        <label key={k}>
          <input
            type="checkbox"
            aria-label={k.replace(/_/g, " ")}
            checked={!!r[k]}
            onChange={() => toggleRule(k)}
          />{" "}
          {k.replace(/_/g, " ")}
        </label>
      ))}
      <fieldset>
        <legend>Quiet hours</legend>
        <input
          type="time"
          aria-label="quiet from"
          value={r.quiet_hours?.from ?? ""}
          onChange={(e) => setF("pg_details.house_rules.quiet_hours.from", e.target.value)}
        />
        <input
          type="time"
          aria-label="quiet to"
          value={r.quiet_hours?.to ?? ""}
          onChange={(e) => setF("pg_details.house_rules.quiet_hours.to", e.target.value)}
        />
      </fieldset>
      <button type="button" onClick={() => dispatch({ type: "GOTO_STEP", step: 3 })}>
        Back
      </button>
      <button type="button" onClick={() => dispatch({ type: "GOTO_STEP", step: 5 })}>
        Next
      </button>
    </section>
  );
}
