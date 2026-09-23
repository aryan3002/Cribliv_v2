// Billing periods (spec §5.3). No I/O. Every date is an ISO string.

import {
  addDays,
  addMonthsToFirst,
  clampDayInMonth,
  compareIso,
  endOfMonth,
  firstOfMonth
} from "./rent-dates";

export interface PeriodSpec {
  cycleMode: "calendar_month" | "anniversary";
  /** anniversary only: tenant rent_due_day override ?? day(move_in_date) */
  anchorDay: number;
}

export interface DueSpec {
  timing: "advance" | "arrears";
  /** calendar only: property due_day, overridden by the tenant's rent_due_day */
  dueDay: number;
}

export interface Period {
  start: string;
  end: string;
}

/** First anchor date strictly after `iso`, clamping day 29–31 to short months. */
function nextAnchorAfter(iso: string, anchorDay: number): string {
  const thisMonth = clampDayInMonth(firstOfMonth(iso), anchorDay);
  if (compareIso(thisMonth, iso) > 0) return thisMonth;
  return clampDayInMonth(addMonthsToFirst(firstOfMonth(iso), 1), anchorDay);
}

/** Last anchor date on or before `iso`. */
function anchorOnOrBefore(iso: string, anchorDay: number): string {
  const thisMonth = clampDayInMonth(firstOfMonth(iso), anchorDay);
  if (compareIso(thisMonth, iso) <= 0) return thisMonth;
  return clampDayInMonth(addMonthsToFirst(firstOfMonth(iso), -1), anchorDay);
}

export function periodEndFor(start: string, spec: PeriodSpec): string {
  if (spec.cycleMode === "calendar_month") return endOfMonth(start);
  return addDays(nextAnchorAfter(start, spec.anchorDay), -1);
}

export function naturalPeriodContaining(iso: string, spec: PeriodSpec): Period {
  if (spec.cycleMode === "calendar_month") {
    return { start: firstOfMonth(iso), end: endOfMonth(iso) };
  }
  const start = anchorOnOrBefore(iso, spec.anchorDay);
  return { start, end: addDays(nextAnchorAfter(start, spec.anchorDay), -1) };
}

export function isNaturalPeriod(period: Period, spec: PeriodSpec): boolean {
  const natural = naturalPeriodContaining(period.start, spec);
  return natural.start === period.start && natural.end === period.end;
}

/** Spec §5.3 due-date table. */
export function naturalDueDate(period: Period, spec: PeriodSpec, due: DueSpec): string {
  if (spec.cycleMode === "anniversary") {
    return due.timing === "advance" ? period.start : addDays(period.end, 1);
  }
  if (due.timing === "advance") {
    return clampDayInMonth(firstOfMonth(period.start), due.dueDay);
  }
  if (isNaturalPeriod(period, spec)) {
    return clampDayInMonth(addMonthsToFirst(firstOfMonth(period.start), 1), due.dueDay);
  }
  return addDays(period.end, 1);
}

/** Floor test value (spec §5.3, §19 #48): a period cannot be due before it starts. */
export function floorDate(period: Period, spec: PeriodSpec, due: DueSpec): string {
  const natural = naturalDueDate(period, spec, due);
  return compareIso(natural, period.start) >= 0 ? natural : period.start;
}

const MAX_WALK = 240;

/**
 * Walk natural periods from move-in; the first whose floor date is on/after
 * `billingStartsOn` is generated. Null when nothing qualifies within 20 years.
 */
export function firstGeneratedPeriod(
  moveIn: string,
  billingStartsOn: string,
  spec: PeriodSpec,
  due: DueSpec
): Period | null {
  let period: Period = { start: moveIn, end: periodEndFor(moveIn, spec) };
  for (let i = 0; i < MAX_WALK; i += 1) {
    if (compareIso(floorDate(period, spec, due), billingStartsOn) >= 0) return period;
    period = nextPeriod(period.end, spec);
  }
  return null;
}

/** Contiguity (invariant 11): the next period starts the day after the last one ended. */
export function nextPeriod(lastEnd: string, spec: PeriodSpec): Period {
  const start = addDays(lastEnd, 1);
  return { start, end: periodEndFor(start, spec) };
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTHS_LONG = [
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
];

/** Human label for a period. Natural calendar months read "September 2026"; anything else is a range. */
export function periodLabel(period: Period, spec: PeriodSpec): string {
  const [sy, sm, sd] = [
    Number(period.start.slice(0, 4)),
    Number(period.start.slice(5, 7)),
    Number(period.start.slice(8, 10))
  ];
  const [ey, em, ed] = [
    Number(period.end.slice(0, 4)),
    Number(period.end.slice(5, 7)),
    Number(period.end.slice(8, 10))
  ];
  if (spec.cycleMode === "calendar_month" && isNaturalPeriod(period, spec)) {
    return `${MONTHS_LONG[sm - 1]} ${sy}`;
  }
  if (sy === ey) return `${sd} ${MONTHS[sm - 1]} – ${ed} ${MONTHS[em - 1]} ${sy}`;
  return `${sd} ${MONTHS[sm - 1]} ${sy} – ${ed} ${MONTHS[em - 1]} ${ey}`;
}
