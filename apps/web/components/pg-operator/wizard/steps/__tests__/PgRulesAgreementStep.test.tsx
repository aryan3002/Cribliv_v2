import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { useReducer } from "react";
import { pgWizardReducer, initialPgWizardState } from "@/lib/pg-wizard-state";
import PgRulesAgreementStep from "../PgRulesAgreementStep";

function Harness() {
  const [state, dispatch] = useReducer(pgWizardReducer, initialPgWizardState());
  return (
    <>
      <PgRulesAgreementStep state={state} dispatch={dispatch} locale="en" />
      <pre data-testid="state">{JSON.stringify(state.draft.pg_details ?? {})}</pre>
    </>
  );
}

describe("PgRulesAgreementStep", () => {
  it("applies the Standard PG rules preset in one tap", () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: /standard pg rules/i }));
    const s = JSON.parse(screen.getByTestId("state").textContent!);
    expect(s.house_rules.smoking).toBe(false);
  });
  it("captures notice period (agreement clause)", () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: /30 days/i }));
    expect(screen.getByTestId("state").textContent).toContain('"notice_period_days":30');
  });
});
