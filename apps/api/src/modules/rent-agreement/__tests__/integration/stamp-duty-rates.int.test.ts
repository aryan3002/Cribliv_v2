import { describe, expect, it } from "vitest";
import { STAMP_DUTY_SEED, StampDutyRepository } from "../../stamp-duty/stamp-duty.repository";
import { StampDutyService } from "../../stamp-duty/stamp-duty.service";

// 48-case sweep: 8 states × 3 rent levels × 2 tenures. Expected values are
// hand-derived from the seeded formulas; the test guards against:
//   • a state being mapped to the wrong formula_type in the seed
//   • a percentage typo (0.001 vs 0.01) in the seed
//   • a service dispatcher returning the wrong formula's result
//   • off-by-one tenure logic in `percentage_of_total_rent` and
//     `percentage_of_rent_plus_deposit`
//
// All amounts are in paise (atomic). Deposit is 2× monthly rent (standard
// Indian practice).

const RENTS_PAISE = [1_500_000, 3_500_000, 8_000_000]; // ₹15k, ₹35k, ₹80k
const TENURES_MONTHS = [11, 24];

interface Case {
  state: string;
  rentPaise: number;
  tenureMonths: number;
  depositPaise: number;
  expectedDutyPaise: number;
}

const CASES: Case[] = [
  // MH — percentage_of_rent_plus_deposit, 0.0025, min 10_000
  {
    state: "MH",
    rentPaise: 1_500_000,
    tenureMonths: 11,
    depositPaise: 3_000_000,
    expectedDutyPaise: 48_750
  },
  {
    state: "MH",
    rentPaise: 1_500_000,
    tenureMonths: 24,
    depositPaise: 3_000_000,
    expectedDutyPaise: 97_500
  },
  {
    state: "MH",
    rentPaise: 3_500_000,
    tenureMonths: 11,
    depositPaise: 7_000_000,
    expectedDutyPaise: 113_750
  },
  {
    state: "MH",
    rentPaise: 3_500_000,
    tenureMonths: 24,
    depositPaise: 7_000_000,
    expectedDutyPaise: 227_500
  },
  {
    state: "MH",
    rentPaise: 8_000_000,
    tenureMonths: 11,
    depositPaise: 16_000_000,
    expectedDutyPaise: 260_000
  },
  {
    state: "MH",
    rentPaise: 8_000_000,
    tenureMonths: 24,
    depositPaise: 16_000_000,
    expectedDutyPaise: 520_000
  },
  // KA — percentage_of_annual_rent, 0.01, min 2_000 (never binds at these rents)
  {
    state: "KA",
    rentPaise: 1_500_000,
    tenureMonths: 11,
    depositPaise: 3_000_000,
    expectedDutyPaise: 180_000
  },
  {
    state: "KA",
    rentPaise: 1_500_000,
    tenureMonths: 24,
    depositPaise: 3_000_000,
    expectedDutyPaise: 180_000
  },
  {
    state: "KA",
    rentPaise: 3_500_000,
    tenureMonths: 11,
    depositPaise: 7_000_000,
    expectedDutyPaise: 420_000
  },
  {
    state: "KA",
    rentPaise: 3_500_000,
    tenureMonths: 24,
    depositPaise: 7_000_000,
    expectedDutyPaise: 420_000
  },
  {
    state: "KA",
    rentPaise: 8_000_000,
    tenureMonths: 11,
    depositPaise: 16_000_000,
    expectedDutyPaise: 960_000
  },
  {
    state: "KA",
    rentPaise: 8_000_000,
    tenureMonths: 24,
    depositPaise: 16_000_000,
    expectedDutyPaise: 960_000
  },
  // DL — percentage_of_annual_rent, 0.02, min 10_000 (never binds)
  {
    state: "DL",
    rentPaise: 1_500_000,
    tenureMonths: 11,
    depositPaise: 3_000_000,
    expectedDutyPaise: 360_000
  },
  {
    state: "DL",
    rentPaise: 1_500_000,
    tenureMonths: 24,
    depositPaise: 3_000_000,
    expectedDutyPaise: 360_000
  },
  {
    state: "DL",
    rentPaise: 3_500_000,
    tenureMonths: 11,
    depositPaise: 7_000_000,
    expectedDutyPaise: 840_000
  },
  {
    state: "DL",
    rentPaise: 3_500_000,
    tenureMonths: 24,
    depositPaise: 7_000_000,
    expectedDutyPaise: 840_000
  },
  {
    state: "DL",
    rentPaise: 8_000_000,
    tenureMonths: 11,
    depositPaise: 16_000_000,
    expectedDutyPaise: 1_920_000
  },
  {
    state: "DL",
    rentPaise: 8_000_000,
    tenureMonths: 24,
    depositPaise: 16_000_000,
    expectedDutyPaise: 1_920_000
  },
  // UP — percentage_of_annual_rent, 0.02, min 1_000 (never binds)
  {
    state: "UP",
    rentPaise: 1_500_000,
    tenureMonths: 11,
    depositPaise: 3_000_000,
    expectedDutyPaise: 360_000
  },
  {
    state: "UP",
    rentPaise: 1_500_000,
    tenureMonths: 24,
    depositPaise: 3_000_000,
    expectedDutyPaise: 360_000
  },
  {
    state: "UP",
    rentPaise: 3_500_000,
    tenureMonths: 11,
    depositPaise: 7_000_000,
    expectedDutyPaise: 840_000
  },
  {
    state: "UP",
    rentPaise: 3_500_000,
    tenureMonths: 24,
    depositPaise: 7_000_000,
    expectedDutyPaise: 840_000
  },
  {
    state: "UP",
    rentPaise: 8_000_000,
    tenureMonths: 11,
    depositPaise: 16_000_000,
    expectedDutyPaise: 1_920_000
  },
  {
    state: "UP",
    rentPaise: 8_000_000,
    tenureMonths: 24,
    depositPaise: 16_000_000,
    expectedDutyPaise: 1_920_000
  },
  // TN — percentage_of_annual_rent, 0.01, min 2_000 (never binds)
  {
    state: "TN",
    rentPaise: 1_500_000,
    tenureMonths: 11,
    depositPaise: 3_000_000,
    expectedDutyPaise: 180_000
  },
  {
    state: "TN",
    rentPaise: 1_500_000,
    tenureMonths: 24,
    depositPaise: 3_000_000,
    expectedDutyPaise: 180_000
  },
  {
    state: "TN",
    rentPaise: 3_500_000,
    tenureMonths: 11,
    depositPaise: 7_000_000,
    expectedDutyPaise: 420_000
  },
  {
    state: "TN",
    rentPaise: 3_500_000,
    tenureMonths: 24,
    depositPaise: 7_000_000,
    expectedDutyPaise: 420_000
  },
  {
    state: "TN",
    rentPaise: 8_000_000,
    tenureMonths: 11,
    depositPaise: 16_000_000,
    expectedDutyPaise: 960_000
  },
  {
    state: "TN",
    rentPaise: 8_000_000,
    tenureMonths: 24,
    depositPaise: 16_000_000,
    expectedDutyPaise: 960_000
  },
  // RJ — percentage_of_total_rent, 0.01, min 2_000 (never binds at these rents)
  {
    state: "RJ",
    rentPaise: 1_500_000,
    tenureMonths: 11,
    depositPaise: 3_000_000,
    expectedDutyPaise: 165_000
  },
  {
    state: "RJ",
    rentPaise: 1_500_000,
    tenureMonths: 24,
    depositPaise: 3_000_000,
    expectedDutyPaise: 360_000
  },
  {
    state: "RJ",
    rentPaise: 3_500_000,
    tenureMonths: 11,
    depositPaise: 7_000_000,
    expectedDutyPaise: 385_000
  },
  {
    state: "RJ",
    rentPaise: 3_500_000,
    tenureMonths: 24,
    depositPaise: 7_000_000,
    expectedDutyPaise: 840_000
  },
  {
    state: "RJ",
    rentPaise: 8_000_000,
    tenureMonths: 11,
    depositPaise: 16_000_000,
    expectedDutyPaise: 880_000
  },
  {
    state: "RJ",
    rentPaise: 8_000_000,
    tenureMonths: 24,
    depositPaise: 16_000_000,
    expectedDutyPaise: 1_920_000
  },
  // GJ — percentage_of_annual_rent, 0.01, min 0
  {
    state: "GJ",
    rentPaise: 1_500_000,
    tenureMonths: 11,
    depositPaise: 3_000_000,
    expectedDutyPaise: 180_000
  },
  {
    state: "GJ",
    rentPaise: 1_500_000,
    tenureMonths: 24,
    depositPaise: 3_000_000,
    expectedDutyPaise: 180_000
  },
  {
    state: "GJ",
    rentPaise: 3_500_000,
    tenureMonths: 11,
    depositPaise: 7_000_000,
    expectedDutyPaise: 420_000
  },
  {
    state: "GJ",
    rentPaise: 3_500_000,
    tenureMonths: 24,
    depositPaise: 7_000_000,
    expectedDutyPaise: 420_000
  },
  {
    state: "GJ",
    rentPaise: 8_000_000,
    tenureMonths: 11,
    depositPaise: 16_000_000,
    expectedDutyPaise: 960_000
  },
  {
    state: "GJ",
    rentPaise: 8_000_000,
    tenureMonths: 24,
    depositPaise: 16_000_000,
    expectedDutyPaise: 960_000
  },
  // HR — percentage_of_annual_rent, 0.015, min 0
  {
    state: "HR",
    rentPaise: 1_500_000,
    tenureMonths: 11,
    depositPaise: 3_000_000,
    expectedDutyPaise: 270_000
  },
  {
    state: "HR",
    rentPaise: 1_500_000,
    tenureMonths: 24,
    depositPaise: 3_000_000,
    expectedDutyPaise: 270_000
  },
  {
    state: "HR",
    rentPaise: 3_500_000,
    tenureMonths: 11,
    depositPaise: 7_000_000,
    expectedDutyPaise: 630_000
  },
  {
    state: "HR",
    rentPaise: 3_500_000,
    tenureMonths: 24,
    depositPaise: 7_000_000,
    expectedDutyPaise: 630_000
  },
  {
    state: "HR",
    rentPaise: 8_000_000,
    tenureMonths: 11,
    depositPaise: 16_000_000,
    expectedDutyPaise: 1_440_000
  },
  {
    state: "HR",
    rentPaise: 8_000_000,
    tenureMonths: 24,
    depositPaise: 16_000_000,
    expectedDutyPaise: 1_440_000
  }
];

function makeService(): StampDutyService {
  const repo = new StampDutyRepository(
    { isEnabled: () => false, query: async () => ({ rows: [] }) },
    STAMP_DUTY_SEED
  );
  return new StampDutyService(repo);
}

describe("stamp duty rates — 48-case sweep over all 8 supported states", () => {
  it("covers exactly 48 cases", () => {
    expect(CASES.length).toBe(8 * RENTS_PAISE.length * TENURES_MONTHS.length);
  });

  it("covers every supported state", () => {
    const states = new Set(CASES.map((c) => c.state));
    expect(states).toEqual(new Set(["MH", "KA", "DL", "UP", "TN", "RJ", "GJ", "HR"]));
  });

  it.each(CASES)(
    "$state · ₹$rentPaise/mo · $tenureMonths mo → $expectedDutyPaise paise",
    async (c) => {
      const svc = makeService();
      const result = await svc.calculate({
        stateCode: c.state,
        monthlyRentPaise: c.rentPaise,
        tenureMonths: c.tenureMonths,
        securityDepositPaise: c.depositPaise
      });
      expect(result.dutyPaise).toBe(c.expectedDutyPaise);
      expect(result.rule.state_code).toBe(c.state);
    }
  );

  it("unknown state throws RENT_AGREEMENT_STATE_UNSUPPORTED", async () => {
    const svc = makeService();
    await expect(
      svc.calculate({
        stateCode: "XX",
        monthlyRentPaise: 1_500_000,
        tenureMonths: 11,
        securityDepositPaise: 3_000_000
      })
    ).rejects.toThrowError(/RENT_AGREEMENT_STATE_UNSUPPORTED/);
  });
});
