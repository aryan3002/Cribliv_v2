import { DESKS } from "./Masthead";

/** "Tuesday, 7 July 2026" (localised). Empty string for missing/invalid dates. */
export function formatDate(iso: string | null, locale: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat(locale === "hi" ? "hi-IN" : "en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric"
  }).format(d);
}

/** "gomti-nagar" → "Gomti Nagar" (for datelines). */
export function cityLabel(slug: string | null): string {
  if (!slug) return "";
  return slug.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Category slug → desk kicker label. */
export function deskLabel(slug: string | null, hi: boolean): string {
  const desk = DESKS.find((d) => d.slug === slug);
  if (desk) return hi ? desk.hi : desk.en;
  return hi ? "रिपोर्ट" : "Report";
}

/** ₹18,500 (Indian grouping). */
export function formatRent(rupees: number): string {
  return `₹${Math.round(rupees).toLocaleString("en-IN")}`;
}

// The paper's first edition: the day cribliv.com cut over to v2 and the Times
// started printing. Vol. rolls over each year of publication; No. is the daily
// edition count, so the masthead advances even between new stories.
const FIRST_EDITION_UTC = Date.UTC(2026, 6, 12);
const ROMAN = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X"];

/** "Vol. I · No. 29" — separator injected by the caller. */
export function editionParts(now: Date = new Date()): { vol: string; no: number } {
  const days = Math.max(0, Math.floor((now.getTime() - FIRST_EDITION_UTC) / 86_400_000));
  const years = Math.min(Math.floor(days / 365), ROMAN.length - 1);
  return { vol: ROMAN[years], no: days + 1 };
}
