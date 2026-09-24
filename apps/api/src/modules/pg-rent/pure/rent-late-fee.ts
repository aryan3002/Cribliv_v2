import { addDays, compareIso, daysInclusive } from "./rent-dates";
import { roundToRupee } from "./rent-money";

export interface LateFeePolicy {
  kind: "flat" | "per_day" | "percent";
  amountPaise: number;
  percentBp: number;
  capPaise: number | null;
  graceDays: number;
}

export interface LateFeeInput {
  policy: LateFeePolicy;
  dueDate: string;
  asOf: string;
  /** unpaid balance excluding any existing late_fee line (spec §5.6) */
  chargeablePaise: number;
  overridePaise: number | null; // tenant late_fee_override_paise
  existingFeePaise: number | null; // current late_fee line, if any
  frozen: boolean; // late_fee_computed_at is set (flat/percent/override already computed)
}

export function daysPastGrace(dueDate: string, graceDays: number, asOf: string): number {
  const graceEnd = addDays(dueDate, graceDays);
  if (compareIso(asOf, graceEnd) <= 0) return 0;
  return daysInclusive(graceEnd, asOf) - 1;
}

/**
 * Spec §5.6. Pure: the caller decides what "asOf" means (today for the sweep,
 * paid_on when a payment settles the chargeable balance).
 */
export function computeLateFee(i: LateFeeInput): {
  feePaise: number;
  action: "none" | "apply" | "update" | "remove" | "freeze";
} {
  const days = daysPastGrace(i.dueDate, i.policy.graceDays, i.asOf);
  const existing = i.existingFeePaise;

  if (days === 0) {
    return existing !== null ? { feePaise: 0, action: "remove" } : { feePaise: 0, action: "none" };
  }
  if (i.chargeablePaise <= 0) {
    return existing !== null
      ? { feePaise: existing, action: "freeze" }
      : { feePaise: 0, action: "none" };
  }
  if (i.frozen && existing !== null) return { feePaise: existing, action: "none" };

  let fee: number;
  if (i.overridePaise !== null) fee = i.overridePaise;
  else if (i.policy.kind === "flat") fee = i.policy.amountPaise;
  else if (i.policy.kind === "percent")
    fee = roundToRupee((i.chargeablePaise * i.policy.percentBp) / 10000);
  else fee = i.policy.amountPaise * days;
  if (i.policy.capPaise !== null) fee = Math.min(fee, i.policy.capPaise);
  fee = roundToRupee(fee);

  if (existing === null) return { feePaise: fee, action: "apply" };
  return fee === existing ? { feePaise: fee, action: "none" } : { feePaise: fee, action: "update" };
}
