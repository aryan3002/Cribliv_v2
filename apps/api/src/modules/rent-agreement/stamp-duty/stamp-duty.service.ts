import { calculatePercentageOfAnnualRent } from "./formulas/percentage-of-annual-rent";
import { calculatePercentageOfRentPlusDeposit } from "./formulas/percentage-of-rent-plus-deposit";
import { calculatePercentageOfTotalRent } from "./formulas/percentage-of-total-rent";
import type { Formula, FormulaBreakdown } from "./formulas/types";
import type { FormulaType, StampDutyRepository, StampDutyRule } from "./stamp-duty.repository";

export interface CalculateInput {
  stateCode: string;
  monthlyRentPaise: number;
  tenureMonths: number;
  securityDepositPaise: number;
}

export interface CalculateResult {
  dutyPaise: number;
  rule: StampDutyRule;
  breakdown: FormulaBreakdown;
}

const FORMULAS: Record<FormulaType, Formula> = {
  percentage_of_annual_rent: calculatePercentageOfAnnualRent,
  percentage_of_total_rent: calculatePercentageOfTotalRent,
  percentage_of_rent_plus_deposit: calculatePercentageOfRentPlusDeposit
};

export class StampDutyService {
  constructor(private readonly repo: StampDutyRepository) {}

  async calculate(input: CalculateInput): Promise<CalculateResult> {
    const stateCode = input.stateCode.toUpperCase();
    const rule = await this.repo.findActiveRule(stateCode);
    if (!rule) {
      throw new Error(`RENT_AGREEMENT_STATE_UNSUPPORTED:${stateCode}`);
    }
    const formula = FORMULAS[rule.formula_type];
    if (!formula) {
      throw new Error(`unsupported formula type: ${rule.formula_type}`);
    }
    const result = formula({
      monthlyRentPaise: input.monthlyRentPaise,
      tenureMonths: input.tenureMonths,
      securityDepositPaise: input.securityDepositPaise,
      percentage: rule.percentage,
      minAmountPaise: rule.min_amount_paise
    });
    return {
      dutyPaise: result.dutyPaise,
      rule,
      breakdown: result.breakdown
    };
  }
}
