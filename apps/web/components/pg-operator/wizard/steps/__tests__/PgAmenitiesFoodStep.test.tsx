import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { useReducer } from "react";
import { pgWizardReducer, initialPgWizardState } from "@/lib/pg-wizard-state";
import PgAmenitiesFoodStep from "../PgAmenitiesFoodStep";

function Harness() {
  const [state, dispatch] = useReducer(pgWizardReducer, initialPgWizardState());
  return (
    <>
      <PgAmenitiesFoodStep state={state} dispatch={dispatch} locale="en" />
      <pre data-testid="state">
        {JSON.stringify({
          pg_details: state.draft.pg_details ?? {},
          step: state.currentStep
        })}
      </pre>
    </>
  );
}

describe("PgAmenitiesFoodStep", () => {
  it("toggles a core amenity (wifi)", () => {
    render(<Harness />);
    fireEvent.click(screen.getByLabelText(/^wifi$/i));
    const s = JSON.parse(screen.getByTestId("state").textContent!);
    expect(s.pg_details.amenities.core).toContain("wifi");
  });

  it("toggles a room amenity (ac)", () => {
    render(<Harness />);
    fireEvent.click(screen.getByLabelText(/^ac$/i));
    const s = JSON.parse(screen.getByTestId("state").textContent!);
    expect(s.pg_details.amenities.room).toContain("ac");
  });

  it("toggles a services amenity (housekeeping)", () => {
    render(<Harness />);
    fireEvent.click(screen.getByLabelText(/^housekeeping$/i));
    const s = JSON.parse(screen.getByTestId("state").textContent!);
    expect(s.pg_details.amenities.services).toContain("housekeeping");
  });

  it("toggles an extras amenity (gym)", () => {
    render(<Harness />);
    fireEvent.click(screen.getByLabelText(/^gym$/i));
    const s = JSON.parse(screen.getByTestId("state").textContent!);
    expect(s.pg_details.amenities.extras).toContain("gym");
  });

  it("food provided reveals meal-charge input", () => {
    render(<Harness />);
    expect(screen.queryByLabelText(/meal charges/i)).not.toBeInTheDocument();
    fireEvent.click(screen.getByLabelText(/food provided/i));
    expect(screen.getByLabelText(/meal charges/i)).toBeInTheDocument();
  });

  it("captures meal toggles (breakfast, lunch, etc.)", () => {
    render(<Harness />);
    fireEvent.click(screen.getByLabelText(/food provided/i));
    fireEvent.click(screen.getByLabelText(/^breakfast$/i));
    fireEvent.click(screen.getByLabelText(/^dinner$/i));
    fireEvent.click(screen.getByLabelText(/^veg only$/i));
    const s = JSON.parse(screen.getByTestId("state").textContent!);
    expect(s.pg_details.meals).toMatchObject({
      provided: true,
      breakfast: true,
      dinner: true,
      veg_only: true
    });
  });

  it("captures meal_charges_paise under meals (will be hoisted by buildSubmitPayload at submit)", () => {
    render(<Harness />);
    fireEvent.click(screen.getByLabelText(/food provided/i));
    fireEvent.change(screen.getByLabelText(/meal charges/i), { target: { value: "2500" } });
    const s = JSON.parse(screen.getByTestId("state").textContent!);
    expect(s.pg_details.meals.meal_charges_paise).toBe(250000);
  });

  it("Back goes to step 4, Next goes to step 6", () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: /^back$/i }));
    expect(JSON.parse(screen.getByTestId("state").textContent!).step).toBe(4);
    fireEvent.click(screen.getByRole("button", { name: /^next$/i }));
    expect(JSON.parse(screen.getByTestId("state").textContent!).step).toBe(6);
  });
});
