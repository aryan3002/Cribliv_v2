import { describe, expect, it } from "vitest";

import {
  firstGeneratedPeriod,
  floorDate,
  isNaturalPeriod,
  naturalDueDate,
  naturalPeriodContaining,
  nextPeriod,
  periodEndFor
} from "../pure/rent-period";

const calendar = { cycleMode: "calendar_month", anchorDay: 1 } as const;
const anniv12 = { cycleMode: "anniversary", anchorDay: 12 } as const;
const anniv31 = { cycleMode: "anniversary", anchorDay: 31 } as const;
const advance5 = { timing: "advance", dueDay: 5 } as const;
const arrears5 = { timing: "arrears", dueDay: 5 } as const;

describe("periodEndFor", () => {
  it("calendar: end of the start month", () => {
    expect(periodEndFor("2026-09-12", calendar)).toBe("2026-09-30");
    expect(periodEndFor("2026-10-01", calendar)).toBe("2026-10-31");
  });
  it("anniversary: the day before the next anchor, computed from the anchor (no drift)", () => {
    expect(periodEndFor("2026-09-12", anniv12)).toBe("2026-10-11");
    expect(periodEndFor("2026-10-12", anniv12)).toBe("2026-11-11");
    expect(periodEndFor("2026-01-31", anniv31)).toBe("2026-02-27");
    expect(periodEndFor("2026-02-28", anniv31)).toBe("2026-03-30");
    expect(periodEndFor("2026-03-31", anniv31)).toBe("2026-04-29");
  });
  it("anniversary bridge: a start that is not on the anchor ends at the next anchor − 1", () => {
    expect(periodEndFor("2026-11-01", anniv12)).toBe("2026-11-11");
    expect(periodEndFor("2026-11-12", anniv12)).toBe("2026-12-11");
  });
});

describe("naturalPeriodContaining / isNaturalPeriod", () => {
  it("calendar: the month", () => {
    expect(naturalPeriodContaining("2026-09-12", calendar)).toEqual({
      start: "2026-09-01",
      end: "2026-09-30"
    });
    expect(isNaturalPeriod({ start: "2026-09-01", end: "2026-09-30" }, calendar)).toBe(true);
    expect(isNaturalPeriod({ start: "2026-09-12", end: "2026-09-30" }, calendar)).toBe(false);
  });
  it("anniversary: anchor to anchor − 1", () => {
    expect(naturalPeriodContaining("2026-11-01", anniv12)).toEqual({
      start: "2026-10-12",
      end: "2026-11-11"
    });
    expect(naturalPeriodContaining("2026-10-12", anniv12)).toEqual({
      start: "2026-10-12",
      end: "2026-11-11"
    });
    expect(isNaturalPeriod({ start: "2026-11-01", end: "2026-11-11" }, anniv12)).toBe(false);
  });
});

describe("naturalDueDate", () => {
  it("calendar advance: due_day of the period month", () => {
    expect(naturalDueDate({ start: "2026-10-01", end: "2026-10-31" }, calendar, advance5)).toBe(
      "2026-10-05"
    );
    expect(naturalDueDate({ start: "2026-09-12", end: "2026-09-30" }, calendar, advance5)).toBe(
      "2026-09-05"
    );
  });
  it("calendar arrears: natural period → due_day next month; cut period → end + 1", () => {
    expect(naturalDueDate({ start: "2026-09-01", end: "2026-09-30" }, calendar, arrears5)).toBe(
      "2026-10-05"
    );
    expect(naturalDueDate({ start: "2026-09-12", end: "2026-09-30" }, calendar, arrears5)).toBe(
      "2026-10-01"
    );
    expect(naturalDueDate({ start: "2026-11-01", end: "2026-11-11" }, calendar, arrears5)).toBe(
      "2026-11-12"
    );
  });
  it("anniversary: advance → start, arrears → end + 1", () => {
    expect(
      naturalDueDate({ start: "2026-09-12", end: "2026-10-11" }, anniv12, {
        timing: "advance",
        dueDay: 5
      })
    ).toBe("2026-09-12");
    expect(
      naturalDueDate({ start: "2026-09-12", end: "2026-10-11" }, anniv12, {
        timing: "arrears",
        dueDay: 5
      })
    ).toBe("2026-10-12");
  });
});

describe("floorDate", () => {
  it("is the natural due date or the period start, whichever is later", () => {
    expect(floorDate({ start: "2026-09-20", end: "2026-09-30" }, calendar, advance5)).toBe(
      "2026-09-20"
    );
    expect(floorDate({ start: "2026-09-01", end: "2026-09-30" }, calendar, advance5)).toBe(
      "2026-09-05"
    );
    expect(floorDate({ start: "2026-09-01", end: "2026-09-30" }, calendar, arrears5)).toBe(
      "2026-10-05"
    );
  });
});

describe("firstGeneratedPeriod", () => {
  it("advance, enabled Sep 17, tenant since Aug 12, due 5 → October is first", () => {
    expect(firstGeneratedPeriod("2026-08-12", "2026-09-17", calendar, advance5)).toEqual({
      start: "2026-10-01",
      end: "2026-10-31"
    });
  });
  it("advance, move-in Sep 20 after the Sep 17 floor → the move-in period itself (§19 #48)", () => {
    expect(firstGeneratedPeriod("2026-09-20", "2026-09-17", calendar, advance5)).toEqual({
      start: "2026-09-20",
      end: "2026-09-30"
    });
  });
  it("arrears, enabled Sep 17, tenant since Aug 12 → September is first", () => {
    expect(firstGeneratedPeriod("2026-08-12", "2026-09-17", calendar, arrears5)).toEqual({
      start: "2026-09-01",
      end: "2026-09-30"
    });
  });
  it("anniversary advance, enabled Sep 17, move-in Aug 20 → Sep 20 period", () => {
    expect(
      firstGeneratedPeriod(
        "2026-08-20",
        "2026-09-17",
        { cycleMode: "anniversary", anchorDay: 20 },
        advance5
      )
    ).toEqual({ start: "2026-09-20", end: "2026-10-19" });
  });
  it("enabled before move-in → the move-in period", () => {
    expect(firstGeneratedPeriod("2026-09-12", "2026-09-01", calendar, advance5)).toEqual({
      start: "2026-09-12",
      end: "2026-09-30"
    });
  });
  it("gives up after 240 periods (a floor decades ahead)", () => {
    expect(firstGeneratedPeriod("2026-09-12", "2099-01-01", calendar, advance5)).toBeNull();
  });
});

describe("nextPeriod", () => {
  it("is contiguous and ends by the (possibly new) mode", () => {
    expect(nextPeriod("2026-10-31", calendar)).toEqual({ start: "2026-11-01", end: "2026-11-30" });
    expect(nextPeriod("2026-10-31", anniv12)).toEqual({ start: "2026-11-01", end: "2026-11-11" });
    expect(nextPeriod("2026-11-11", anniv12)).toEqual({ start: "2026-11-12", end: "2026-12-11" });
  });
});
