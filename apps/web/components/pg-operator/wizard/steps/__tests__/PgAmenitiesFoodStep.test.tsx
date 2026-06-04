import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { useReducer } from "react";
import { pgWizardReducer, initialPgWizardState } from "@/lib/pg-wizard-state";
import PgAmenitiesFoodStep from "../PgAmenitiesFoodStep";

function Harness() {
  const [state, dispatch] = useReducer(pgWizardReducer, initialPgWizardState());
  return <PgAmenitiesFoodStep state={state} dispatch={dispatch} locale="en" />;
}

describe("PgAmenitiesFoodStep", () => {
  it("renders amenity groups and the meals toggle, no internal nav", () => {
    render(<Harness />);
    expect(screen.getByText(/Food provided\?/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Next$/ })).toBeNull();
  });
  it("toggles a core amenity (wifi)", () => {
    render(<Harness />);
    fireEvent.click(screen.getByLabelText(/^wifi$/i));
    // Re-read state via another render; just check no crash and the label is in doc
    expect(screen.getByLabelText(/^wifi$/i)).toHaveAttribute("aria-checked", "true");
  });
  it("reveals per-meal chips when food is enabled", () => {
    render(<Harness />);
    expect(screen.queryByRole("button", { name: /^breakfast$/i })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /^yes$/i }));
    expect(screen.getByRole("button", { name: /^breakfast$/i })).toBeInTheDocument();
  });
});
