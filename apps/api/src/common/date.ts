/**
 * IST calendar-date helpers. The rent module (and the assignment writers it
 * depends on) reason in Indian calendar days; Postgres sessions on Azure run in
 * UTC, so `CURRENT_DATE` is one day early between 00:00 and 05:30 IST. Every
 * "today" in SQL or TypeScript goes through this file.
 */

/** SQL fragment for today's IST date. Embed verbatim; it takes no parameters. */
export const IST_TODAY_SQL = "(now() AT TIME ZONE 'Asia/Kolkata')::date";

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

/** `YYYY-MM-DD` of the IST calendar date for `now` (default: the real clock). */
export function todayIst(now: Date = new Date()): string {
  const shifted = new Date(now.getTime() + IST_OFFSET_MS);
  const year = shifted.getUTCFullYear();
  const month = String(shifted.getUTCMonth() + 1).padStart(2, "0");
  const day = String(shifted.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** True only for `YYYY-MM-DD` strings that name a real calendar date. */
export function isIsoDate(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const match = ISO_DATE.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1) return false;
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return day <= daysInMonth;
}

/** Lexical order of ISO dates is chronological order. */
export function compareIsoDates(a: string, b: string): -1 | 0 | 1 {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}
