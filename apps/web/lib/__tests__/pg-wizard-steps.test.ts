import { describe, it, expect } from "vitest";
import { PG_STEP_ORDER, STEP_META, nextStep, prevStep, pgStepLabel } from "../pg-wizard-steps";

describe("pg-wizard-steps", () => {
  it("orders steps Basics→Location→Rooms→Food→Rules→Photos→Review", () => {
    expect(PG_STEP_ORDER).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(pgStepLabel(4)).toBe("Food & Amenities");
    expect(pgStepLabel(5)).toBe("Rules & Agreement");
    expect(pgStepLabel(6)).toBe("Photos");
    expect(pgStepLabel(7)).toBe("Review");
  });
  it("computes next/prev within bounds", () => {
    expect(nextStep(1)).toBe(2);
    expect(nextStep(7)).toBe(7);
    expect(prevStep(1)).toBe(1);
    expect(prevStep(5)).toBe(4);
  });
  it("has meta title+desc for every step", () => {
    for (const s of PG_STEP_ORDER) {
      expect(STEP_META[s].title.length).toBeGreaterThan(0);
      expect(STEP_META[s].desc.length).toBeGreaterThan(0);
    }
  });
});
