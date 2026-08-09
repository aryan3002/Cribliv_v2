import { describe, it, expect } from "vitest";
import { EDITORIAL_AUTHOR } from "../src/modules/blog/blog.types";
import type { BlogPostRow, QualityBreakdown } from "../src/modules/blog/blog.types";

describe("blog.types", () => {
  it("exposes the house data-desk byline for E-E-A-T", () => {
    expect(EDITORIAL_AUTHOR.name).toBe("Cribliv Data Desk");
    expect(EDITORIAL_AUTHOR.slug).toBe("cribliv-data-desk");
  });

  it("QualityBreakdown + BlogPostRow shapes compose", () => {
    const qb: QualityBreakdown = { score: 1, passed: true, checks: [] };
    const row: Pick<BlogPostRow, "status" | "quality_breakdown"> = {
      status: "draft",
      quality_breakdown: qb
    };
    expect(row.status).toBe("draft");
    expect(row.quality_breakdown.passed).toBe(true);
  });
});
