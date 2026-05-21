import { describe, expect, it } from "vitest";
import {
  STAMP_DUTY_SEED,
  StampDutyRepository,
  type StampDutyRule
} from "../../stamp-duty/stamp-duty.repository";
import { StampDutyService } from "../../stamp-duty/stamp-duty.service";

function repoFromSeed(rows: StampDutyRule[] = STAMP_DUTY_SEED): StampDutyRepository {
  const db = {
    isEnabled: () => false,
    query: async () => ({ rows: [] })
  };
  return new StampDutyRepository(db, rows);
}

describe("StampDutyService", () => {
  it("computes Maharashtra (percentage_of_rent_plus_deposit, 0.25%)", async () => {
    const svc = new StampDutyService(repoFromSeed());
    // base = 25000 * 24 + 50000 = 6,50,000 ₹ → 65,000,000 paise
    //   in paise: 2500000 * 24 + 5000000 = 65,000,000
    // raw = 65,000,000 * 0.0025 = 162,500 paise
    const result = await svc.calculate({
      stateCode: "MH",
      monthlyRentPaise: 2_500_000,
      tenureMonths: 24,
      securityDepositPaise: 5_000_000
    });
    expect(result.dutyPaise).toBe(162_500);
    expect(result.rule.state_code).toBe("MH");
    expect(result.rule.formula_type).toBe("percentage_of_rent_plus_deposit");
    expect(result.breakdown.baseAmountPaise).toBe(65_000_000);
  });

  it("computes Karnataka (percentage_of_annual_rent, 1%)", async () => {
    const svc = new StampDutyService(repoFromSeed());
    // base = 25000 * 12 = 3,00,000 ₹ → 30,000,000 paise; raw = 300,000
    const result = await svc.calculate({
      stateCode: "KA",
      monthlyRentPaise: 2_500_000,
      tenureMonths: 11,
      securityDepositPaise: 5_000_000
    });
    expect(result.dutyPaise).toBe(300_000);
  });

  it("computes Rajasthan (percentage_of_total_rent, 1%)", async () => {
    const svc = new StampDutyService(repoFromSeed());
    // base = 25000 * 11 = 2,75,000 ₹ → 27,500,000 paise; raw = 275,000
    const result = await svc.calculate({
      stateCode: "RJ",
      monthlyRentPaise: 2_500_000,
      tenureMonths: 11,
      securityDepositPaise: 0
    });
    expect(result.dutyPaise).toBe(275_000);
  });

  it("throws RENT_AGREEMENT_STATE_UNSUPPORTED for unknown state", async () => {
    const svc = new StampDutyService(repoFromSeed());
    await expect(
      svc.calculate({
        stateCode: "XX",
        monthlyRentPaise: 2_500_000,
        tenureMonths: 11,
        securityDepositPaise: 0
      })
    ).rejects.toThrowError(/RENT_AGREEMENT_STATE_UNSUPPORTED/);
  });

  it("throws on unknown formula_type (defensive — DB drift)", async () => {
    const rogueRule: StampDutyRule = {
      ...STAMP_DUTY_SEED[0],
      formula_type: "some_unsupported_formula" as StampDutyRule["formula_type"]
    };
    const svc = new StampDutyService(repoFromSeed([rogueRule]));
    await expect(
      svc.calculate({
        stateCode: rogueRule.state_code,
        monthlyRentPaise: 2_500_000,
        tenureMonths: 11,
        securityDepositPaise: 0
      })
    ).rejects.toThrowError(/unsupported formula/i);
  });

  it("normalises lowercase state codes to uppercase", async () => {
    const svc = new StampDutyService(repoFromSeed());
    const lower = await svc.calculate({
      stateCode: "ka",
      monthlyRentPaise: 2_500_000,
      tenureMonths: 11,
      securityDepositPaise: 5_000_000
    });
    const upper = await svc.calculate({
      stateCode: "KA",
      monthlyRentPaise: 2_500_000,
      tenureMonths: 11,
      securityDepositPaise: 5_000_000
    });
    expect(lower.dutyPaise).toBe(upper.dutyPaise);
  });
});
