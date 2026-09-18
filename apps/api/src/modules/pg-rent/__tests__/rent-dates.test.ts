import { describe, expect, it } from "vitest";

import {
  addDays,
  addMonthsToFirst,
  clampDayInMonth,
  dayOf,
  daysInMonthOf,
  daysInclusive,
  endOfMonth,
  firstOfMonth
} from "../pure/rent-dates";

describe("rent-dates", () => {
  it("adds days across month and year ends", () => {
    expect(addDays("2026-09-30", 1)).toBe("2026-10-01");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
    expect(addDays("2024-03-01", -1)).toBe("2024-02-29");
  });
  it("counts inclusive days", () => {
    expect(daysInclusive("2026-09-12", "2026-09-30")).toBe(19);
    expect(daysInclusive("2026-09-01", "2026-09-30")).toBe(30);
    expect(daysInclusive("2026-09-12", "2026-10-11")).toBe(30);
    expect(daysInclusive("2026-01-31", "2026-02-27")).toBe(28);
  });
  it("knows month lengths", () => {
    expect(daysInMonthOf("2026-02-10")).toBe(28);
    expect(daysInMonthOf("2024-02-10")).toBe(29);
    expect(daysInMonthOf("2026-09-01")).toBe(30);
    expect(endOfMonth("2026-09-12")).toBe("2026-09-30");
    expect(firstOfMonth("2026-09-12")).toBe("2026-09-01");
  });
  it("clamps an anchor day to the month", () => {
    expect(clampDayInMonth("2026-02-01", 31)).toBe("2026-02-28");
    expect(clampDayInMonth("2026-04-01", 31)).toBe("2026-04-30");
    expect(clampDayInMonth("2026-03-01", 31)).toBe("2026-03-31");
    expect(clampDayInMonth("2026-03-01", 5)).toBe("2026-03-05");
  });
  it("adds months to a first-of-month", () => {
    expect(addMonthsToFirst("2026-12-01", 1)).toBe("2027-01-01");
    expect(addMonthsToFirst("2026-01-01", -1)).toBe("2025-12-01");
    expect(addMonthsToFirst("2026-01-01", 14)).toBe("2027-03-01");
  });
  it("reads the day", () => {
    expect(dayOf("2026-09-12")).toBe(12);
  });
});
