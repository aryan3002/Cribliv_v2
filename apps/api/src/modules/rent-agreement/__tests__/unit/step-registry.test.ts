import { describe, expect, it } from "vitest";

import {
  STEP_SEQUENCES,
  isValidStep,
  nextStep,
  previousStep,
  getStepSequence,
  requiresSignatureStep,
  type PlanId
} from "../../drafts/step-registry";

describe("step-registry: per-plan sequences", () => {
  it("basic plan skips step 6", () => {
    expect(STEP_SEQUENCES.basic).toEqual([1, 2, 3, 4, 5, 7]);
  });

  it("standard plan skips step 6", () => {
    expect(STEP_SEQUENCES.standard).toEqual([1, 2, 3, 4, 5, 7]);
  });

  it("premium plan includes step 6", () => {
    expect(STEP_SEQUENCES.premium).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it("getStepSequence returns a fresh copy (no shared-array mutation)", () => {
    const a = getStepSequence("premium");
    const b = getStepSequence("premium");
    expect(a).toEqual(b);
    a.push(99);
    expect(getStepSequence("premium")).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });
});

describe("step-registry: isValidStep", () => {
  it("basic plan: 1..5 and 7 valid, 6 invalid", () => {
    expect(isValidStep("basic", 1)).toBe(true);
    expect(isValidStep("basic", 5)).toBe(true);
    expect(isValidStep("basic", 6)).toBe(false);
    expect(isValidStep("basic", 7)).toBe(true);
  });

  it("standard plan: 6 invalid", () => {
    expect(isValidStep("standard", 6)).toBe(false);
  });

  it("premium plan: every step 1..7 valid", () => {
    for (const s of [1, 2, 3, 4, 5, 6, 7]) {
      expect(isValidStep("premium", s)).toBe(true);
    }
  });

  it("out-of-range steps invalid for every plan", () => {
    for (const plan of ["basic", "standard", "premium"] as PlanId[]) {
      expect(isValidStep(plan, 0)).toBe(false);
      expect(isValidStep(plan, 8)).toBe(false);
      expect(isValidStep(plan, -1)).toBe(false);
    }
  });
});

describe("step-registry: nextStep", () => {
  it("basic plan: 5 → 7 (skips 6)", () => {
    expect(nextStep("basic", 5)).toBe(7);
  });

  it("standard plan: 5 → 7 (skips 6)", () => {
    expect(nextStep("standard", 5)).toBe(7);
  });

  it("premium plan: 5 → 6, 6 → 7", () => {
    expect(nextStep("premium", 5)).toBe(6);
    expect(nextStep("premium", 6)).toBe(7);
  });

  it("returns null at terminal step 7", () => {
    expect(nextStep("basic", 7)).toBeNull();
    expect(nextStep("standard", 7)).toBeNull();
    expect(nextStep("premium", 7)).toBeNull();
  });

  it("returns null when current is invalid for plan", () => {
    expect(nextStep("basic", 6)).toBeNull();
    expect(nextStep("basic", 99)).toBeNull();
  });

  it("walks the whole basic sequence end to end", () => {
    let cur: number | null = 1;
    const path: number[] = [];
    while (cur !== null) {
      path.push(cur);
      cur = nextStep("basic", cur);
    }
    expect(path).toEqual([1, 2, 3, 4, 5, 7]);
  });

  it("walks the whole premium sequence end to end", () => {
    let cur: number | null = 1;
    const path: number[] = [];
    while (cur !== null) {
      path.push(cur);
      cur = nextStep("premium", cur);
    }
    expect(path).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });
});

describe("step-registry: previousStep", () => {
  it("basic plan: 7 → 5 (skips 6 going back)", () => {
    expect(previousStep("basic", 7)).toBe(5);
  });

  it("premium plan: 7 → 6 → 5", () => {
    expect(previousStep("premium", 7)).toBe(6);
    expect(previousStep("premium", 6)).toBe(5);
  });

  it("returns null at first step 1", () => {
    expect(previousStep("basic", 1)).toBeNull();
    expect(previousStep("premium", 1)).toBeNull();
  });

  it("returns null when current is invalid for plan", () => {
    expect(previousStep("basic", 6)).toBeNull();
  });
});

describe("step-registry: requiresSignatureStep", () => {
  it("only premium requires the signature step", () => {
    expect(requiresSignatureStep("premium")).toBe(true);
    expect(requiresSignatureStep("basic")).toBe(false);
    expect(requiresSignatureStep("standard")).toBe(false);
  });
});
