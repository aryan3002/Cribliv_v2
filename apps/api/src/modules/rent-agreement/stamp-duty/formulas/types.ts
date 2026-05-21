/**
 * Common input shape for every stamp-duty formula. Amounts are in paise
 * (integer). `percentage` is a fraction (0.0025 = 0.25%).
 */
export interface FormulaInput {
  monthlyRentPaise: number;
  tenureMonths: number;
  securityDepositPaise: number;
  percentage: number;
  minAmountPaise: number;
}

export interface FormulaBreakdown {
  baseAmountPaise: number;
  rawDutyPaise: number;
  appliedMinimum: boolean;
}

export interface FormulaResult {
  dutyPaise: number;
  breakdown: FormulaBreakdown;
}

/** Common shape for every formula module. */
export type Formula = (input: FormulaInput) => FormulaResult;
