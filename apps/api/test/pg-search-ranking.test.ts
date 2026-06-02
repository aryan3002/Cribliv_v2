import { describe, it, expect, vi, afterEach } from "vitest";
import { PgSearchService } from "../src/modules/pg-operator/services/pg-search.service";

function makeService() {
  const calls: string[] = [];
  const db = {
    isEnabled: () => true,
    query: vi.fn(async (sql: string, p: unknown[]) => {
      calls.push(sql);
      if (/count\(\*\)/i.test(sql)) return { rows: [{ total: 0 }], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    })
  };
  const svc = new PgSearchService(db as never);
  return { svc, calls };
}

describe("PgSearchService score-based ranking", () => {
  const OLD_ENV = process.env;

  afterEach(() => {
    process.env = { ...OLD_ENV };
  });

  it("with ff_pg_listing_score ON: default sort JOINs listing_scores and orders by composite_score", async () => {
    process.env["FF_PG_LISTING_SCORE"] = "true";
    const { svc, calls } = makeService();
    await svc.search({});
    const rowsSql = calls.filter((s) => !/count\(\*\)/i.test(s)).join("\n");
    expect(rowsSql).toMatch(/LEFT JOIN listing_scores/i);
    expect(rowsSql).toMatch(/composite_score/i);
  });

  it("with ff_pg_listing_score OFF: default sort does NOT use composite_score", async () => {
    process.env["FF_PG_LISTING_SCORE"] = "false";
    const { svc, calls } = makeService();
    await svc.search({});
    const rowsSql = calls.filter((s) => !/count\(\*\)/i.test(s)).join("\n");
    expect(rowsSql).not.toMatch(/composite_score/i);
  });

  it("sort=newest ignores the flag and uses created_at DESC", async () => {
    process.env["FF_PG_LISTING_SCORE"] = "true";
    const { svc, calls } = makeService();
    await svc.search({ sort: "newest" });
    const rowsSql = calls.filter((s) => !/count\(\*\)/i.test(s)).join("\n");
    expect(rowsSql).toMatch(/l\.created_at DESC/);
    expect(rowsSql).not.toMatch(/composite_score/i);
  });
});
