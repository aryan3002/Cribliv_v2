import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { useReducer } from "react";
import { pgWizardReducer, initialPgWizardState } from "@/lib/pg-wizard-state";
import PgAmenitiesFoodStep from "../PgAmenitiesFoodStep";

// The food UI moved into <MealsToggle> (a role="switch" Toggle) and amenities
// render as <ChipMultiSelect> buttons with humanized labels + aria-pressed.
function Harness() {
  const [state, dispatch] = useReducer(pgWizardReducer, initialPgWizardState());
  return <PgAmenitiesFoodStep state={state} dispatch={dispatch} locale="en" />;
}

describe("PgAmenitiesFoodStep", () => {
  it("renders the meals toggle and amenity groups, no internal nav", () => {
    render(<Harness />);
    expect(screen.getByText(/Food provided/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Next$/ })).toBeNull();
  });

  it("toggles a core amenity (WiFi)", () => {
    render(<Harness />);
    const wifi = screen.getByRole("button", { name: /High-Speed WiFi/i });
    expect(wifi).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(wifi);
    expect(screen.getByRole("button", { name: /High-Speed WiFi/i })).toHaveAttribute(
      "aria-pressed",
      "true"
    );
  });

  it("reveals per-meal chips when food is enabled", () => {
    render(<Harness />);
    expect(screen.queryByRole("button", { name: /^Breakfast$/i })).toBeNull();
    fireEvent.click(screen.getByRole("switch", { name: /food provided/i }));
    expect(screen.getByRole("button", { name: /^Breakfast$/i })).toBeInTheDocument();
  });
});
