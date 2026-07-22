import { describe, it, expect } from "vitest";
import { sanitizeAdminPgListingsParams } from "../../admin-pg-listings.params";

describe("sanitizeAdminPgListingsParams", () => {
  it("applies defaults for empty input (verified + active landing view)", () => {
    expect(sanitizeAdminPgListingsParams({})).toEqual({
      verification: "verified",
      status: "active",
      sort: "leads",
      page: 1,
      page_size: 25
    });
  });

  it("clamps unknown enums to defaults and truncates oversized q / page_size", () => {
    const out = sanitizeAdminPgListingsParams({
      verification: "bogus",
      status: "weird",
      sort: "hax",
      page: "-3",
      page_size: "999",
      q: "x".repeat(500),
      city: "  LucKnow  "
    });
    expect(out.verification).toBe("verified");
    expect(out.status).toBe("active");
    expect(out.sort).toBe("leads");
    expect(out.page).toBe(1);
    expect(out.page_size).toBe(25);
    expect(out.q?.length).toBe(200);
    expect(out.city).toBe("lucknow");
  });

  it("accepts draft and pending_review statuses (Decision D2)", () => {
    expect(sanitizeAdminPgListingsParams({ status: "draft" }).status).toBe("draft");
    expect(sanitizeAdminPgListingsParams({ status: "pending_review" }).status).toBe(
      "pending_review"
    );
  });

  it("rejects 'rejected' status (not surfaced in this tab)", () => {
    expect(sanitizeAdminPgListingsParams({ status: "rejected" }).status).toBe("active");
  });

  it("passes through valid values", () => {
    expect(
      sanitizeAdminPgListingsParams({
        verification: "all",
        status: "paused",
        sort: "rent_desc",
        page: "3",
        page_size: "50",
        q: "green nest",
        city: "delhi"
      })
    ).toEqual({
      verification: "all",
      status: "paused",
      city: "delhi",
      q: "green nest",
      sort: "rent_desc",
      page: 3,
      page_size: 50
    });
  });
});
