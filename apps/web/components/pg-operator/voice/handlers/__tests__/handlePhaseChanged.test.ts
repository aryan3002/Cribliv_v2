import { describe, it, expect, vi } from "vitest";
import { handlePhaseChanged } from "../handlePhaseChanged";

describe("handlePhaseChanged", () => {
  it("calls setPhase with the new phase", () => {
    const setPhase = vi.fn();
    handlePhaseChanged(
      { from: "greeting", to: "discovery", fields_captured_count: 3 },
      { setPhase }
    );
    expect(setPhase).toHaveBeenCalledWith("discovery");
  });

  it.each([
    ["greeting", "discovery"],
    ["discovery", "pricing"],
    ["pricing", "food"],
    ["food", "rules"],
    ["rules", "media"],
    ["media", "confirmation"],
    ["confirmation", "done"]
  ] as const)("forwards transition %s → %s", (from, to) => {
    const setPhase = vi.fn();
    handlePhaseChanged({ from, to, fields_captured_count: 0 }, { setPhase });
    expect(setPhase).toHaveBeenCalledWith(to);
  });

  it("ignores the from and count, only passes the new phase", () => {
    const setPhase = vi.fn();
    handlePhaseChanged(
      { from: "greeting", to: "confirmation", fields_captured_count: 47 },
      { setPhase }
    );
    expect(setPhase).toHaveBeenCalledOnce();
    expect(setPhase).toHaveBeenCalledWith("confirmation");
  });
});
