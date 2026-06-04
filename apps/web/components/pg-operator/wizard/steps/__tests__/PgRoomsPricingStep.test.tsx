import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { useReducer } from "react";
import { pgWizardReducer, initialPgWizardState } from "@/lib/pg-wizard-state";
import PgRoomsPricingStep from "../PgRoomsPricingStep";

function Harness() {
  const [state, dispatch] = useReducer(pgWizardReducer, initialPgWizardState());
  return (
    <>
      <PgRoomsPricingStep state={state} dispatch={dispatch} locale="en" />
      <pre data-testid="state">{JSON.stringify(state.draft.room_types ?? [])}</pre>
    </>
  );
}

describe("PgRoomsPricingStep", () => {
  it("adds a room type card via Add room", () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: /add room/i }));
    expect(JSON.parse(screen.getByTestId("state").textContent!).length).toBe(1);
  });
  it("editing AC on an existing room does NOT create a duplicate", () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: /add room/i }));
    // toggling AC changes cellKey — the step must remove-old + upsert-new, not append
    fireEvent.click(screen.getByRole("button", { name: "AC" }));
    expect(JSON.parse(screen.getByTestId("state").textContent!).length).toBe(1);
  });
  it("has no internal Next button", () => {
    render(<Harness />);
    expect(screen.queryByRole("button", { name: /^Next$/ })).toBeNull();
  });
});
