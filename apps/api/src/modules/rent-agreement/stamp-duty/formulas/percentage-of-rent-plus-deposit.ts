import type { Formula } from "./types";

// Tenure-proportional plus deposit: stamp duty is `percentage` of
// (totalRent + securityDeposit), with a floor at `minAmountPaise`.
// Used by MH (the only state with `includes_deposit = true`).
export const calculatePercentageOfRentPlusDeposit: Formula = ({
  monthlyRentPaise,
  tenureMonths,
  securityDepositPaise,
  percentage,
  minAmountPaise
}) => {
  const baseAmountPaise = monthlyRentPaise * tenureMonths + securityDepositPaise;
  const rawDutyPaise = Math.round(baseAmountPaise * percentage);
  const dutyPaise = Math.max(rawDutyPaise, minAmountPaise);
  return {
    dutyPaise,
    breakdown: {
      baseAmountPaise,
      rawDutyPaise,
      appliedMinimum: dutyPaise === minAmountPaise && rawDutyPaise < minAmountPaise
    }
  };
};
