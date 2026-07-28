/**
 * Normalise the shapes a human actually types into the E.164 form the `users`
 * table stores (`+91XXXXXXXXXX`, matching the check at admin.controller.ts:873).
 *
 * Admin-entered phone numbers arrive from field workers typing on mobile
 * keyboards, so `99567 29103`, `099567...` and `+91 99567 29103` are all normal
 * input. Returns null when the value cannot be read as an Indian mobile number —
 * callers surface that as `invalid_phone` rather than guessing.
 */
export function normalizeIndianPhone(input: string): string | null {
  let s = String(input ?? "").replace(/[\s\-()]/g, "");
  if (s === "") return null;

  if (s.startsWith("+")) {
    // An explicit country code that is not India is an error, not something to
    // coerce — silently rewriting it would send OTPs to the wrong number.
    if (!s.startsWith("+91")) return null;
    s = s.slice(3);
  } else if (s.length === 12 && s.startsWith("91")) {
    s = s.slice(2);
  } else if (s.startsWith("0")) {
    s = s.replace(/^0+/, "");
  }

  if (!/^\d{10}$/.test(s)) return null;
  return `+91${s}`;
}
