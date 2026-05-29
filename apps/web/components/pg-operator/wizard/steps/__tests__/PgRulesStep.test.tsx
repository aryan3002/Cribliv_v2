import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { useReducer } from "react";
import { pgWizardReducer, initialPgWizardState } from "@/lib/pg-wizard-state";
import PgRulesStep from "../PgRulesStep";

function Harness() {
  const [state, dispatch] = useReducer(pgWizardReducer, initialPgWizardState());
  return (
    <>
      <PgRulesStep state={state} dispatch={dispatch} locale="en" />
      <pre data-testid="state">
        {JSON.stringify({
          house_rules: state.draft.pg_details?.house_rules ?? {},
          step: state.currentStep
        })}
      </pre>
    </>
  );
}

describe("PgRulesStep", () => {
  it("captures curfew time", () => {
    render(<Harness />);
    fireEvent.change(screen.getByLabelText(/curfew time/i), { target: { value: "22:00" } });
    const s = JSON.parse(screen.getByTestId("state").textContent!);
    expect(s.house_rules.curfew_time).toBe("22:00");
  });

  it("captures guests_policy text", () => {
    render(<Harness />);
    fireEvent.change(screen.getByLabelText(/guests policy/i), {
      target: { value: "No overnight guests on weekdays" }
    });
    const s = JSON.parse(screen.getByTestId("state").textContent!);
    expect(s.house_rules.guests_policy).toBe("No overnight guests on weekdays");
  });

  it.each(["smoking", "alcohol", "non veg", "pets", "cooking in room"])(
    "toggles %s rule",
    (label) => {
      render(<Harness />);
      fireEvent.click(screen.getByLabelText(new RegExp(`^${label}$`, "i")));
      const s = JSON.parse(screen.getByTestId("state").textContent!);
      const key = label.replace(/ /g, "_");
      expect(s.house_rules[key]).toBe(true);
    }
  );

  it("captures quiet_hours from + to", () => {
    render(<Harness />);
    fireEvent.change(screen.getByLabelText(/quiet from/i), { target: { value: "23:00" } });
    fireEvent.change(screen.getByLabelText(/quiet to/i), { target: { value: "07:00" } });
    const s = JSON.parse(screen.getByTestId("state").textContent!);
    expect(s.house_rules.quiet_hours).toEqual({ from: "23:00", to: "07:00" });
  });

  it("Back goes to step 3, Next goes to step 5", () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: /^back$/i }));
    expect(JSON.parse(screen.getByTestId("state").textContent!).step).toBe(3);
    fireEvent.click(screen.getByRole("button", { name: /^next$/i }));
    expect(JSON.parse(screen.getByTestId("state").textContent!).step).toBe(5);
  });

  it("enforces maxLength=400 on guests_policy textarea", () => {
    render(<Harness />);
    expect(screen.getByLabelText(/guests policy/i)).toHaveAttribute("maxlength", "400");
  });
});
