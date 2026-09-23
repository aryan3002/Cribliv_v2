import { describe, expect, it } from "vitest";

import { prorate } from "../pure/rent-proration";
import { invoiceStatus } from "../pure/rent-status";
import { billingWindow, cutToWindow } from "../pure/rent-window";

const base = { move_in_date: "2026-09-12", notice_end_date: null, move_out_date: null };

describe("billingWindow (spec §5.2)", () => {
  it("is open-ended for active and IGNORES a stale notice_end_date", () => {
    expect(billingWindow({ ...base, status: "active", notice_end_date: "2026-10-15" })).toEqual({
      start: "2026-09-12",
      end: null
    });
  });
  it("ends at notice_end_date in the notice family, open-ended when unset", () => {
    expect(
      billingWindow({ ...base, status: "notice_served", notice_end_date: "2026-10-15" })
    ).toEqual({
      start: "2026-09-12",
      end: "2026-10-15"
    });
    expect(billingWindow({ ...base, status: "move_out_requested" })).toEqual({
      start: "2026-09-12",
      end: null
    });
    expect(
      billingWindow({
        ...base,
        status: "move_out_pending_confirmation",
        notice_end_date: "2026-10-15"
      })?.end
    ).toBe("2026-10-15");
  });
  it("ends at move_out_date when moved out (moved_out IS eligible — §19 #37)", () => {
    expect(billingWindow({ ...base, status: "moved_out", move_out_date: "2026-10-15" })).toEqual({
      start: "2026-09-12",
      end: "2026-10-15"
    });
  });
  it("is null for reserved, cancelled, or no move-in", () => {
    expect(billingWindow({ ...base, status: "reserved" })).toBeNull();
    expect(billingWindow({ ...base, status: "cancelled" })).toBeNull();
    expect(billingWindow({ ...base, status: "active", move_in_date: null })).toBeNull();
  });
});

describe("cutToWindow", () => {
  const window = { start: "2026-09-12", end: "2026-10-15" };
  it("returns the period untouched when it ends inside the window", () => {
    expect(cutToWindow({ start: "2026-09-12", end: "2026-09-30" }, window)).toEqual({
      period: { start: "2026-09-12", end: "2026-09-30" },
      cut: false
    });
  });
  it("cuts a period that straddles the end", () => {
    expect(cutToWindow({ start: "2026-10-01", end: "2026-10-31" }, window)).toEqual({
      period: { start: "2026-10-01", end: "2026-10-15" },
      cut: true
    });
  });
  it("is null when the period starts after the window ends", () => {
    expect(cutToWindow({ start: "2026-11-01", end: "2026-11-30" }, window)).toBeNull();
  });
  it("never cuts against an open-ended window", () => {
    expect(
      cutToWindow({ start: "2026-10-01", end: "2026-10-31" }, { start: "2026-09-12", end: null })
        ?.cut
    ).toBe(false);
  });
});

describe("prorate (spec §5.3)", () => {
  const calendar = { cycleMode: "calendar_month", anchorDay: 1 } as const;
  const anniv12 = { cycleMode: "anniversary", anchorDay: 12 } as const;
  it("charges the full rent for a natural period with factor null", () => {
    expect(
      prorate(900000, { start: "2026-10-01", end: "2026-10-31" }, calendar, "actual_days")
    ).toEqual({
      amountPaise: 900000,
      factor: null
    });
  });
  it("actual_days: days ÷ days in the containing natural period, rounded to the rupee", () => {
    expect(
      prorate(900000, { start: "2026-09-12", end: "2026-09-30" }, calendar, "actual_days")
    ).toEqual({
      amountPaise: 570000,
      factor: 19 / 30
    });
    // anniversary bridge Nov 1–11 belongs to Oct 12–Nov 11 (31 days)
    expect(
      prorate(900000, { start: "2026-11-01", end: "2026-11-11" }, anniv12, "actual_days")
    ).toEqual({
      amountPaise: 319400,
      factor: 11 / 31
    });
  });
  it("flat_30: days ÷ 30", () => {
    expect(
      prorate(900000, { start: "2026-09-12", end: "2026-09-30" }, calendar, "flat_30")
    ).toEqual({
      amountPaise: 570000,
      factor: 19 / 30
    });
    expect(
      prorate(900000, { start: "2026-10-01", end: "2026-10-15" }, calendar, "flat_30")
    ).toEqual({
      amountPaise: 450000,
      factor: 15 / 30
    });
  });
  it("rounds an exact half-rupee tie up (spec invariant 9), not down via float drift", () => {
    const calendar = { cycleMode: "calendar_month" as const, anchorDay: 1 };
    // Feb 2026 has 28 days; 1400 × 17 ÷ 28 = 850 paise exactly → ₹9
    expect(
      prorate(1400, { start: "2026-02-01", end: "2026-02-17" }, calendar, "actual_days")
    ).toEqual({
      amountPaise: 900,
      factor: 17 / 28
    });
  });
});

describe("invoiceStatus (invariant 4, equality not ≥)", () => {
  it("covers every combination", () => {
    expect(invoiceStatus({ draft: true, cancelled: false, totalPaise: 100, paidPaise: 0 })).toBe(
      "draft"
    );
    expect(invoiceStatus({ draft: false, cancelled: true, totalPaise: 100, paidPaise: 50 })).toBe(
      "cancelled"
    );
    expect(invoiceStatus({ draft: false, cancelled: false, totalPaise: 0, paidPaise: 0 })).toBe(
      "paid"
    );
    expect(
      invoiceStatus({ draft: false, cancelled: false, totalPaise: 900000, paidPaise: 900000 })
    ).toBe("paid");
    expect(
      invoiceStatus({ draft: false, cancelled: false, totalPaise: 900000, paidPaise: 400000 })
    ).toBe("partially_paid");
    expect(
      invoiceStatus({ draft: false, cancelled: false, totalPaise: 900000, paidPaise: 0 })
    ).toBe("issued");
    expect(() =>
      invoiceStatus({ draft: false, cancelled: false, totalPaise: 900000, paidPaise: 900100 })
    ).toThrow(/amount_paid exceeds total/);
  });
});
