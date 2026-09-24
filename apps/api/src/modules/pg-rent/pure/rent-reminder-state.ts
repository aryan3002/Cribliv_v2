import type { PgRentReminderState } from "@cribliv/shared-types";

import { addDays, compareIso, daysInclusive } from "./rent-dates";

/** Spec §7.2. `overdue` is `due_date < today`, full stop; grace is a tag on it. */
export function reminderState(i: {
  dueDate: string;
  today: string;
  offsets: number[];
  graceDays: number;
}): {
  state: PgRentReminderState;
  inGrace: boolean;
  daysOverdue: number;
  daysUntilDue: number;
} {
  const cmp = compareIso(i.today, i.dueDate);
  if (cmp > 0) {
    const daysOverdue = daysInclusive(i.dueDate, i.today) - 1;
    return { state: "overdue", inGrace: daysOverdue <= i.graceDays, daysOverdue, daysUntilDue: 0 };
  }
  const daysUntilDue = daysInclusive(i.today, i.dueDate) - 1;
  // Spec §7.2: all-positive offsets ⇒ the queue shows overdue only, so no due_today either.
  if (cmp === 0)
    return {
      state: i.offsets.some((o) => o <= 0) ? "due_today" : "upcoming",
      inGrace: false,
      daysOverdue: 0,
      daysUntilDue: 0
    };
  const earliestNegative = Math.min(...i.offsets.filter((o) => o < 0), 0);
  const dueSoonFrom = addDays(i.dueDate, earliestNegative);
  const state: PgRentReminderState =
    earliestNegative < 0 && compareIso(i.today, dueSoonFrom) >= 0 ? "due_soon" : "upcoming";
  return { state, inGrace: false, daysOverdue: 0, daysUntilDue };
}

export function duePhrase(i: { dueDate: string; today: string }, locale: "en" | "hi"): string {
  const cmp = compareIso(i.today, i.dueDate);
  if (cmp === 0) return locale === "hi" ? "आज देय" : "due today";
  if (cmp < 0) {
    const n = daysInclusive(i.today, i.dueDate) - 1;
    if (locale === "hi") return n === 1 ? "कल देय" : `${n} दिनों में देय`;
    return n === 1 ? "due tomorrow" : `due in ${n} days`;
  }
  const n = daysInclusive(i.dueDate, i.today) - 1;
  if (locale === "hi") return `${n} दिन से बकाया`;
  return `overdue by ${n} ${n === 1 ? "day" : "days"}`;
}
