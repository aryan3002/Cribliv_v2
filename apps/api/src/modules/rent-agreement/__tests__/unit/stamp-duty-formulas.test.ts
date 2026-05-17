import { describe, expect, it } from "vitest";
import { calculatePercentageOfAnnualRent } from "../../stamp-duty/formulas/percentage-of-annual-rent";
import { calculatePercentageOfRentPlusDeposit } from "../../stamp-duty/formulas/percentage-of-rent-plus-deposit";
import { calculatePercentageOfTotalRent } from "../../stamp-duty/formulas/percentage-of-total-rent";

const BASE = {
  monthlyRentPaise: 2_500_000, // ₹25,000
  tenureMonths: 11,
  securityDepositPaise: 5_000_000, // ₹50,000
  percentage: 0.01,
  minAmountPaise: 2000
};

describe("calculatePercentageOfAnnualRent", () => {
  it("computes 1% of 12× monthly rent (tenure-independent)", () => {
    // base = 2.5M × 12 = 30M; raw = 30M × 0.01 = 300,000; min=2000 → 300,000
    const r = calculatePercentageOfAnnualRent(BASE);
    expect(r.dutyPaise).toBe(300_000);
    expect(r.breakdown.baseAmountPaise).toBe(30_000_000);
    expect(r.breakdown.appliedMinimum).toBe(false);
  });

  it("ignores tenure even when very long", () => {
    const short = calculatePercentageOfAnnualRent({ ...BASE, tenureMonths: 1 });
    const long = calculatePercentageOfAnnualRent({ ...BASE, tenureMonths: 132 });
    expect(short.dutyPaise).toBe(long.dutyPaise);
  });

  it("applies minimum floor when raw duty is lower", () => {
    const r = calculatePercentageOfAnnualRent({
      ...BASE,
      monthlyRentPaise: 100, // base = 1200; raw = 12 paise
      minAmountPaise: 50_000
    });
    expect(r.dutyPaise).toBe(50_000);
    expect(r.breakdown.appliedMinimum).toBe(true);
  });

  it("rounds raw duty to nearest paise", () => {
    const r = calculatePercentageOfAnnualRent({
      ...BASE,
      monthlyRentPaise: 1_000_001, // base = 12,000,012; raw = 120,000.12 → 120,000
      percentage: 0.01,
      minAmountPaise: 0
    });
    expect(r.dutyPaise).toBe(120_000);
  });
});

describe("calculatePercentageOfTotalRent", () => {
  it("scales with tenure", () => {
    // base = 2.5M × 11 = 27.5M; raw = 275,000
    const r = calculatePercentageOfTotalRent(BASE);
    expect(r.dutyPaise).toBe(275_000);
    expect(r.breakdown.baseAmountPaise).toBe(27_500_000);
  });

  it("doubles base when tenure doubles", () => {
    const a = calculatePercentageOfTotalRent({ ...BASE, tenureMonths: 12 });
    const b = calculatePercentageOfTotalRent({ ...BASE, tenureMonths: 24 });
    expect(b.breakdown.baseAmountPaise).toBe(a.breakdown.baseAmountPaise * 2);
  });

  it("applies minimum floor", () => {
    const r = calculatePercentageOfTotalRent({
      ...BASE,
      monthlyRentPaise: 100,
      tenureMonths: 1,
      minAmountPaise: 10_000
    });
    expect(r.dutyPaise).toBe(10_000);
    expect(r.breakdown.appliedMinimum).toBe(true);
  });
});

describe("calculatePercentageOfRentPlusDeposit", () => {
  it("includes security deposit in the base", () => {
    // base = 2.5M × 11 + 5M = 32.5M; raw = 325,000 (at 1%)
    const r = calculatePercentageOfRentPlusDeposit(BASE);
    expect(r.dutyPaise).toBe(325_000);
    expect(r.breakdown.baseAmountPaise).toBe(32_500_000);
  });

  it("matches Maharashtra at the spec percentage (0.25%)", () => {
    // base = 2.5M × 24 + 5M = 65M; raw = 0.0025 × 65M = 162,500
    const r = calculatePercentageOfRentPlusDeposit({
      ...BASE,
      tenureMonths: 24,
      percentage: 0.0025,
      minAmountPaise: 10_000
    });
    expect(r.dutyPaise).toBe(162_500);
    expect(r.breakdown.appliedMinimum).toBe(false);
  });

  it("falls back to minimum on zero rent + zero deposit", () => {
    const r = calculatePercentageOfRentPlusDeposit({
      ...BASE,
      monthlyRentPaise: 0,
      securityDepositPaise: 0,
      minAmountPaise: 10_000
    });
    expect(r.dutyPaise).toBe(10_000);
    expect(r.breakdown.appliedMinimum).toBe(true);
  });
});
