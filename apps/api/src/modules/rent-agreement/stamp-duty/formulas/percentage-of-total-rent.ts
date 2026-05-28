import type { Formula } from "./types";

// Tenure-proportional: stamp duty is `percentage` of total rent across the
// lease term, with a floor at `minAmountPaise`. Used by RJ.
export const calculatePercentageOfTotalRent: Formula = ({
  monthlyRentPaise,
  tenureMonths,
  percentage,
  minAmountPaise
}) => {
  const baseAmountPaise = monthlyRentPaise * tenureMonths;
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
