import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { useReducer } from "react";

vi.mock("@/lib/pg-operator-api", () => ({
  createPgProperty: vi.fn()
}));

import { pgWizardReducer, initialPgWizardState } from "@/lib/pg-wizard-state";
import PgPropertyBasicsStep from "../PgPropertyBasicsStep";

function Harness() {
  const [state, dispatch] = useReducer(pgWizardReducer, initialPgWizardState());
  return (
    <>
      <PgPropertyBasicsStep state={state} dispatch={dispatch} locale="en" accessToken="t" />
      <pre data-testid="state">{JSON.stringify(state.draft.pg_details ?? {})}</pre>
    </>
  );
}

describe("PgPropertyBasicsStep", () => {
  it("has no internal Next button (nav is centralized)", () => {
    render(<Harness />);
    expect(screen.queryByRole("button", { name: /^Next$/ })).toBeNull();
  });
  it("sets gender via segmented control", () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "Girls" }));
    expect(screen.getByTestId("state").textContent).toContain('"gender_policy":"girls"');
  });
  it("captures display_name in the property name input", () => {
    const [state, dispatch] = [initialPgWizardState(), vi.fn()];
    const { rerender } = render(
      <PgPropertyBasicsStep state={state} dispatch={dispatch} locale="en" accessToken="t" />
    );
    fireEvent.change(screen.getByLabelText(/property name/i), { target: { value: "Acme PG" } });
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "SET_FIELD",
        path: "property.display_name",
        value: "Acme PG"
      })
    );
  });
  it("sets tenant type", () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "Students" }));
    expect(screen.getByTestId("state").textContent).toContain('"tenant_type":"students"');
  });
  it("increments total_beds via stepper", () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: /increase total beds/i }));
    expect(screen.getByTestId("state").textContent).toContain('"total_beds":1');
  });
});
