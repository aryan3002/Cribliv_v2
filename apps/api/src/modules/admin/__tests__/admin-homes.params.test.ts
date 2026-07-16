import { describe, expect, it } from "vitest";
import { sanitizeAdminHomesParams } from "../admin-homes.params";

describe("sanitizeAdminHomesParams", () => {
  it("uses the inventory defaults", () => {
    expect(sanitizeAdminHomesParams({})).toEqual({
      status: "active",
      sort: "leads",
      page: 1,
      page_size: 25
    });
  });

  it("accepts supported filters and caps search at 200 characters", () => {
    const q = `  ${"x".repeat(220)}  `;
    expect(
      sanitizeAdminHomesParams({
        status: "archived",
        city: " Lucknow ",
        q,
        sort: "conversion",
        page: "3",
        page_size: "100"
      })
    ).toEqual({
      status: "archived",
      city: "lucknow",
      q: "x".repeat(200),
      sort: "conversion",
      page: 3,
      page_size: 100
    });
  });

  it("falls back for invalid enums, page numbers, and page sizes", () => {
    expect(
      sanitizeAdminHomesParams({
        status: "rented",
        sort: "random",
        page: "-4",
        page_size: "75"
      })
    ).toEqual({
      status: "active",
      sort: "leads",
      page: 1,
      page_size: 25
    });
  });
});
