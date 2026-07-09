/** Normalize a raw Indian phone to E.164 (+91XXXXXXXXXX) or null if invalid. */
export function normalizeE164(raw: string | number | null | undefined): string | null {
  if (raw === null || raw === undefined) return null;
  // Excel stores mobiles as floats (e.g. 9998887776.0) — drop any decimal.
  let s = typeof raw === "number" ? Math.trunc(raw).toString() : String(raw);
  s = s.trim().replace(/\s+/g, "").replace(/[()-]/g, "");
  if (!s) return null;
  if (s.startsWith("+91")) s = s.slice(3);
  else if (s.startsWith("91") && s.length === 12) s = s.slice(2);
  s = s.replace(/^0+/, "");
  if (!/^[6-9]\d{9}$/.test(s)) return null;
  return `+91${s}`;
}
