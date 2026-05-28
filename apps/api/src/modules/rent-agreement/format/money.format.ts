/**
 * Money formatting helpers for the rent-agreement PDF renderer.
 *
 * Amounts are stored as integer paise (1 rupee = 100 paise). Paise are
 * atomic; fractional paise indicate a bug upstream and are rejected.
 *
 * Formatting follows the Indian numbering convention: the first comma is
 * placed after the last three digits of the integer part, and remaining
 * digits are grouped in pairs (lakh, crore, ...).
 *
 *   12,345,678 (Western)  vs  1,23,45,678 (Indian)
 *
 * We hand-roll the grouping rather than relying on
 * `Intl.NumberFormat('en-IN')` because Intl pulls the rupees through a
 * float (losing precision near `Number.MAX_SAFE_INTEGER`), and ICU data
 * for `en-IN` is not guaranteed across Node builds.
 */

const RUPEE_SYMBOL = "₹"; // ₹

/**
 * Groups the integer-rupee part using Indian numbering (3-2-2-...).
 *
 * The input must be a non-negative integer string (no sign, no decimals).
 */
function groupIndian(intPart: string): string {
  if (intPart.length <= 3) {
    return intPart;
  }
  const last3 = intPart.slice(-3);
  let rest = intPart.slice(0, -3);
  const groups: string[] = [];
  while (rest.length > 2) {
    groups.unshift(rest.slice(-2));
    rest = rest.slice(0, -2);
  }
  if (rest.length > 0) {
    groups.unshift(rest);
  }
  return `${groups.join(",")},${last3}`;
}

/** Converts integer paise to a human-readable Indian Rupee string. */
export function paiseToRupees(paise: number): string {
  if (typeof paise !== "number" || Number.isNaN(paise) || !Number.isFinite(paise)) {
    throw new Error("paise must be a finite integer");
  }
  if (!Number.isInteger(paise)) {
    throw new Error("paise must be an integer");
  }

  const isNegative = paise < 0;
  const abs = Math.abs(paise);

  // Work in integers throughout to avoid float drift at large magnitudes.
  const rupees = Math.trunc(abs / 100);
  const remainderPaise = abs - rupees * 100;

  const rupeeStr = groupIndian(String(rupees));
  const paiseStr = String(remainderPaise).padStart(2, "0");

  return `${isNegative ? "-" : ""}${RUPEE_SYMBOL}${rupeeStr}.${paiseStr}`;
}
