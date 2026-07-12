import { describe, it, expect } from "vitest";
import { sanitizeBoardParams } from "../board-params";

describe("sanitizeBoardParams", () => {
  it("defaults everything when input is empty", () => {
    const p = sanitizeBoardParams({});
    expect(p.filter).toBe("needs_call");
    expect(p.page).toBe(1);
    expect(p.pageSize).toBe(50);
    expect(p.status).toBeUndefined();
    expect(p.range).toBe("30 days");
  });

  it("drops an invalid status instead of passing it to the enum cast", () => {
    expect(sanitizeBoardParams({ status: "xyz" }).status).toBeUndefined();
    expect(sanitizeBoardParams({ status: "contacted" }).status).toBe("contacted");
  });

  it("falls back to a safe range on garbage (prevents ::interval 500)", () => {
    expect(sanitizeBoardParams({ range: "garbage" }).range).toBe("30 days");
    expect(sanitizeBoardParams({ range: "7 days" }).range).toBe("7 days");
    expect(sanitizeBoardParams({ range: "90 days" }).range).toBe("90 days");
  });

  it("coerces non-numeric page/page_size to defaults (prevents LIMIT NaN)", () => {
    const p = sanitizeBoardParams({ page: "abc", page_size: "abc" });
    expect(p.page).toBe(1);
    expect(p.pageSize).toBe(50);
    expect(sanitizeBoardParams({ page: "3", page_size: "25" })).toMatchObject({
      page: 3,
      pageSize: 25
    });
  });

  it("clamps page_size to 100 and page to >=1", () => {
    expect(sanitizeBoardParams({ page_size: "9999" }).pageSize).toBe(100);
    expect(sanitizeBoardParams({ page: "-5" }).page).toBe(1);
  });

  it("passes an invalid filter through as needs_call default", () => {
    expect(sanitizeBoardParams({ filter: "nonsense" }).filter).toBe("needs_call");
    expect(sanitizeBoardParams({ filter: "expiring_6h" }).filter).toBe("expiring_6h");
  });
});
