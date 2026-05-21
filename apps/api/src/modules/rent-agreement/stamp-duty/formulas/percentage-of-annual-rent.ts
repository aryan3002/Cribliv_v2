import type { Formula } from "./types";

// Tenure-independent: stamp duty is `percentage` of one year of rent, with
// a floor at `minAmountPaise`. Used by KA, DL, UP, TN, GJ, HR.
export const calculatePercentageOfAnnualRent: Formula = ({
  monthlyRentPaise,
  percentage,
  minAmountPaise
}) => {
  const baseAmountPaise = monthlyRentPaise * 12;
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
