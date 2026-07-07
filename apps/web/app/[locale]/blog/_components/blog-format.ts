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
