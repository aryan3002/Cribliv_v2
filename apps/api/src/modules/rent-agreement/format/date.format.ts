/**
 * Formats an ISO-8601 date (YYYY-MM-DD or full timestamp) as an ordinal-day
 * British English legal date, e.g. "1st January, 2026".
 */

const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December"
] as const;

const DATE_PREFIX_RE = /^(\d{4})-(\d{2})-(\d{2})/;

function ordinalSuffix(day: number): string {
  const mod100 = day % 100;
  if (mod100 >= 11 && mod100 <= 13) {
    return "th";
  }
  switch (day % 10) {
    case 1:
      return "st";
    case 2:
      return "nd";
    case 3:
      return "rd";
    default:
      return "th";
  }
}

export function formatLegalDate(input: string): string {
  if (typeof input !== "string" || input.length === 0) {
    throw new Error("invalid date");
  }

  const match = DATE_PREFIX_RE.exec(input);
  if (!match) {
    throw new Error("invalid date");
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);

  // Parse via Date so timestamp forms (with T...Z) are validated too,
  // but use the YYYY-MM-DD prefix for the actual output (UTC, no tz shift).
  const parsed = new Date(input);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error("invalid date");
  }

  // Round-trip the date portion through UTC to catch impossible dates like
  // Feb 29 in a non-leap year or April 31 (JS silently rolls them forward).
  const utc = new Date(Date.UTC(year, month - 1, day));
  if (
    utc.getUTCFullYear() !== year ||
    utc.getUTCMonth() !== month - 1 ||
    utc.getUTCDate() !== day
  ) {
    throw new Error("invalid date");
  }

  if (month < 1 || month > 12) {
    throw new Error("invalid date");
  }

  const monthName = MONTH_NAMES[month - 1];
  const suffix = ordinalSuffix(day);

  return `${day}${suffix} ${monthName}, ${year}`;
}
