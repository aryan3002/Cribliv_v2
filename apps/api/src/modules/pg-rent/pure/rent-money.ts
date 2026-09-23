/** Nearest whole rupee, half-up (invariant 9). Input and output are paise. */
export function roundToRupee(paise: number): number {
  return Math.round(paise / 100) * 100;
}

/**
 * Split a rupee-multiple total into `parts` rupee-multiple shares whose sum is
 * exactly the total. Largest-remainder: every share gets floor(total/parts)
 * rounded down to a rupee, then the leftover rupees go one each to the first
 * shares (spec invariant 9, §8.6).
 */
export function splitLargestRemainder(totalPaise: number, parts: number): number[] {
  if (!Number.isInteger(parts) || parts < 1) throw new RangeError("parts must be >= 1");
  if (!Number.isInteger(totalPaise) || totalPaise % 100 !== 0) {
    throw new RangeError("total must be a whole-rupee paise amount");
  }
  const totalRupees = totalPaise / 100;
  const base = Math.floor(totalRupees / parts);
  let leftover = totalRupees - base * parts;
  const shares: number[] = [];
  for (let i = 0; i < parts; i += 1) {
    const extra = leftover > 0 ? 1 : 0;
    leftover -= extra;
    shares.push((base + extra) * 100);
  }
  return shares;
}
