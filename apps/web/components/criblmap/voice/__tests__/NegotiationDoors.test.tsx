import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { NegotiationDoors } from "../NegotiationDoors";

describe("NegotiationDoors", () => {
  it("renders gains and fires onPick", () => {
    const onPick = vi.fn();
    render(
      <NegotiationDoors
        doors={[
          { id: "stretch_budget", label: "Stretch to ₹22k", gain: 3 },
          { id: "subscribe", label: "Text me when one lists", gain: 0 }
        ]}
        onPick={onPick}
      />
    );
    expect(screen.getByText(/\+3 homes/i)).toBeTruthy();
    fireEvent.click(screen.getByText(/Stretch to ₹22k/i));
    expect(onPick).toHaveBeenCalledOnce();
  });

  it("does not render numeric gain for isEstimate doors, shows hint instead", () => {
    const onPick = vi.fn();
    render(
      <NegotiationDoors
        doors={[{ id: "allow_unverified", label: "Include unverified", gain: 1, isEstimate: true }]}
        onPick={onPick}
      />
    );
    // Should NOT contain "+1 homes" or any "+N homes" for isEstimate doors
    expect(screen.queryByText(/\+1 homes/i)).toBeFalsy();
    expect(screen.queryByText(/\+\d+ homes/i)).toBeFalsy();
    // Should contain a non-numeric hint
    expect(screen.getByText(/see how many|some more/i)).toBeTruthy();
  });
});
