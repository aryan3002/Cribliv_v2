import { daysInclusive } from "./rent-dates";
import { roundToRupee } from "./rent-money";
import {
  isNaturalPeriod,
  naturalPeriodContaining,
  type Period,
  type PeriodSpec
} from "./rent-period";

/**
 * Spec §5.3 "Proration". A natural period is never prorated (factor null).
 * actual_days divides by the length of the natural period that contains the
 * partial one; flat_30 divides by 30. Result rounded to the rupee.
 */
export function prorate(
  rentPaise: number,
  period: Period,
  spec: PeriodSpec,
  mode: "actual_days" | "flat_30"
): { amountPaise: number; factor: number | null } {
  if (isNaturalPeriod(period, spec)) return { amountPaise: rentPaise, factor: null };
  const days = daysInclusive(period.start, period.end);
  const denominator =
    mode === "flat_30"
      ? 30
      : (() => {
          const natural = naturalPeriodContaining(period.start, spec);
          return daysInclusive(natural.start, natural.end);
        })();
  const factor = days / denominator;
  return { amountPaise: roundToRupee((rentPaise * days) / denominator), factor };
}
