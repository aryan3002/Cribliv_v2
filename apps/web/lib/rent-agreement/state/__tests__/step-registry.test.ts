import { describe, expect, it } from "vitest";
import { nextStep, isValidStep, totalSteps } from "../step-registry";

describe("step-registry", () => {
  it("basic plan: 1→2→3→4→5→7", () => {
    expect(nextStep("basic", 5)).toBe(7);
    expect(nextStep("basic", 4)).toBe(5);
  });
  it("standard plan: skips 6", () => expect(nextStep("standard", 5)).toBe(7));
  it("premium plan: includes 6", () => expect(nextStep("premium", 5)).toBe(6));
  it("step 7 is terminal", () => expect(nextStep("basic", 7)).toBeNull());
  it("isValidStep rejects step 6 for basic", () => expect(isValidStep("basic", 6)).toBe(false));
  it("totalSteps", () => {
    expect(totalSteps("basic")).toBe(6);
    expect(totalSteps("premium")).toBe(7);
  });
});
