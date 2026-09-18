import { describe, expect, it } from "vitest";

import { IST_TODAY_SQL, compareIsoDates, isIsoDate, todayIst } from "../date";

describe("todayIst", () => {
  it("returns the IST calendar date, not the UTC one, across the 18:30 UTC boundary", () => {
    // 2026-09-16 23:00 UTC is 2026-09-17 04:30 IST
    expect(todayIst(new Date("2026-09-16T23:00:00.000Z"))).toBe("2026-09-17");
    // 2026-09-16 18:29 UTC is still 2026-09-16 23:59 IST
    expect(todayIst(new Date("2026-09-16T18:29:59.000Z"))).toBe("2026-09-16");
    // 2026-09-16 18:30 UTC is 2026-09-17 00:00 IST
    expect(todayIst(new Date("2026-09-16T18:30:00.000Z"))).toBe("2026-09-17");
  });

  it("formats with zero padding", () => {
    expect(todayIst(new Date("2026-01-05T10:00:00.000Z"))).toBe("2026-01-05");
  });
});

describe("IST_TODAY_SQL", () => {
  it("is the exact fragment the spec mandates", () => {
    expect(IST_TODAY_SQL).toBe("(now() AT TIME ZONE 'Asia/Kolkata')::date");
  });
});

describe("isIsoDate", () => {
  it("accepts real calendar dates only", () => {
    expect(isIsoDate("2026-02-28")).toBe(true);
    expect(isIsoDate("2024-02-29")).toBe(true);
    expect(isIsoDate("2026-02-29")).toBe(false);
    expect(isIsoDate("2026-13-01")).toBe(false);
    expect(isIsoDate("2026-9-1")).toBe(false);
    expect(isIsoDate("2026-09-01T00:00:00Z")).toBe(false);
    expect(isIsoDate(20260901)).toBe(false);
    expect(isIsoDate(null)).toBe(false);
  });
});

describe("compareIsoDates", () => {
  it("orders lexically, which is chronological for ISO dates", () => {
    expect(compareIsoDates("2026-09-01", "2026-09-02")).toBe(-1);
    expect(compareIsoDates("2026-09-02", "2026-09-02")).toBe(0);
    expect(compareIsoDates("2026-10-01", "2026-09-30")).toBe(1);
  });
});
