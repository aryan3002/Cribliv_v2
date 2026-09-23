// Status-aware billing window (spec §5.2). `active` ignores notice_end_date on
// purpose: cancelMoveOut left it populated on production rows before slice 0.

import { compareIso } from "./rent-dates";
import type { Period } from "./rent-period";

export interface WindowAssignment {
  status:
    | "reserved"
    | "active"
    | "notice_served"
    | "move_out_requested"
    | "move_out_pending_confirmation"
    | "moved_out"
    | "cancelled";
  move_in_date: string | null;
  notice_end_date: string | null;
  move_out_date: string | null;
}

export interface BillingWindow {
  start: string;
  /** null = open-ended */
  end: string | null;
}

export function billingWindow(a: WindowAssignment): BillingWindow | null {
  if (a.move_in_date === null) return null;
  switch (a.status) {
    case "active":
      return { start: a.move_in_date, end: null };
    case "notice_served":
    case "move_out_requested":
    case "move_out_pending_confirmation":
      return { start: a.move_in_date, end: a.notice_end_date };
    case "moved_out":
      return { start: a.move_in_date, end: a.move_out_date };
    default:
      return null;
  }
}

/** Trim a period to the window end. Null when the period starts after the end. */
export function cutToWindow(
  period: Period,
  window: BillingWindow
): { period: Period; cut: boolean } | null {
  if (window.end === null) return { period, cut: false };
  if (compareIso(period.start, window.end) > 0) return null;
  if (compareIso(period.end, window.end) <= 0) return { period, cut: false };
  return { period: { start: period.start, end: window.end }, cut: true };
}
