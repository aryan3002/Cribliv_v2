// ISO-date arithmetic on strings. Everything runs in UTC on purpose: the
// strings are IST calendar dates already, and we never want the host zone to
// shift a day. No Date object escapes this file.

function parse(iso: string): [number, number, number] {
  const y = Number(iso.slice(0, 4));
  const m = Number(iso.slice(5, 7));
  const d = Number(iso.slice(8, 10));
  return [y, m, d];
}

function format(y: number, m: number, d: number): string {
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function toUtc(iso: string): number {
  const [y, m, d] = parse(iso);
  return Date.UTC(y, m - 1, d);
}

function fromUtc(ms: number): string {
  const date = new Date(ms);
  return format(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
}

const DAY_MS = 24 * 60 * 60 * 1000;

export function addDays(iso: string, n: number): string {
  return fromUtc(toUtc(iso) + n * DAY_MS);
}

/** Inclusive count: the period Sep 12–30 has 19 days. */
export function daysInclusive(startIso: string, endIso: string): number {
  return Math.round((toUtc(endIso) - toUtc(startIso)) / DAY_MS) + 1;
}

export function daysInMonthOf(iso: string): number {
  const [y, m] = parse(iso);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

export function endOfMonth(iso: string): string {
  const [y, m] = parse(iso);
  return format(y, m, daysInMonthOf(iso));
}

export function firstOfMonth(iso: string): string {
  const [y, m] = parse(iso);
  return format(y, m, 1);
}

/** The `day`-th of the month containing `yearMonthIso`, clamped to that month's length. */
export function clampDayInMonth(yearMonthIso: string, day: number): string {
  const [y, m] = parse(yearMonthIso);
  return format(y, m, Math.min(day, daysInMonthOf(yearMonthIso)));
}

export function addMonthsToFirst(firstOfMonthIso: string, n: number): string {
  const [y, m] = parse(firstOfMonthIso);
  const index = y * 12 + (m - 1) + n;
  return format(Math.floor(index / 12), (index % 12) + 1, 1);
}

export function dayOf(iso: string): number {
  return parse(iso)[2];
}

export { compareIsoDates as compareIso } from "../../../common/date";
