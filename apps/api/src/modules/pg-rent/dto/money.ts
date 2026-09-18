// The ONLY place rupees and paise meet (spec D2, §13). Services work in paise.

/** Whole rupees → paise. Throws on fractions; negatives only when allowed (discount lines). */
export function inrToPaise(inr: number, options: { allowNegative?: boolean } = {}): number {
  if (!Number.isInteger(inr)) throw new RangeError("amount_inr must be a whole rupee");
  if (inr < 0 && !options.allowNegative) throw new RangeError("amount_inr must not be negative");
  return inr * 100;
}

/** Paise (number, numeric-string from pg, or bigint) → nearest whole rupee. */
export function paiseToInr(paise: number | string | bigint): number {
  const value = typeof paise === "bigint" ? Number(paise) : Number(paise);
  return Math.round(value / 100);
}

/** Electricity rate: paise per unit → rupees with two decimals (spec §19 #49). */
export function ratePaiseToInr(paise: number | string | null): number | null {
  if (paise === null) return null;
  return Number(paise) / 100;
}

/** Rupees with at most two decimals → paise per unit. */
export function rateInrToPaise(inr: number): number {
  const paise = Math.round(inr * 100);
  if (Math.abs(paise - inr * 100) > 1e-6)
    throw new RangeError("rate must have at most two decimals");
  return paise;
}
