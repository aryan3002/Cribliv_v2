import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { PgSearchService } from "../services/pg-search.service";

function makeDb() {
  const query = vi.fn(async () => ({ rows: [] }) as any);
  return { isEnabled: () => true, query } as any;
}

describe("PgSearchService caching (PERF-H6)", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("suggest: identical term within TTL hits cache (no extra DB queries)", async () => {
    const db = makeDb();
    const svc = new PgSearchService(db);

    await svc.suggest("pune"); // miss → 3 lookup queries (city/locality/listing)
    const afterFirst = db.query.mock.calls.length;
    expect(afterFirst).toBe(3);

    await svc.suggest("pune"); // hit → no new queries
    expect(db.query.mock.calls.length).toBe(afterFirst);

    await svc.suggest("delhi"); // different key → recompute
    expect(db.query.mock.calls.length).toBe(afterFirst + 3);
  });

  it("suggest: re-queries after the TTL expires", async () => {
    const db = makeDb();
    const svc = new PgSearchService(db);

    await svc.suggest("pune");
    const n = db.query.mock.calls.length;
    vi.advanceTimersByTime(10_001); // past default 10s TTL
    await svc.suggest("pune");
    expect(db.query.mock.calls.length).toBe(n * 2);
  });

  it("search: identical query within TTL hits cache", async () => {
    const db = makeDb();
    const svc = new PgSearchService(db);

    await svc.search({ city: "pune" }); // miss → count + rows = 2 queries
    expect(db.query.mock.calls.length).toBe(2);
    await svc.search({ city: "pune" }); // hit → 0 new
    expect(db.query.mock.calls.length).toBe(2);
    await svc.search({ city: "mumbai" }); // different filter → recompute
    expect(db.query.mock.calls.length).toBe(4);
  });

  it("does not query (or cache) when below the suggest min length", async () => {
    const db = makeDb();
    const svc = new PgSearchService(db);
    expect(await svc.suggest("p")).toEqual([]);
    expect(db.query).not.toHaveBeenCalled();
  });
});

describe("PgSearchService rent filtering", () => {
  /** Run a search and return the SQL + params of the row query (call 2 of 2). */
  async function runSearch(query: Record<string, string>) {
    const db = makeDb();
    await new PgSearchService(db).search(query);
    const [sql, params] = db.query.mock.calls.at(-1) as [string, unknown[]];
    return { sql, params };
  }

  it("min_rent adds a lower bound with the numeric value bound", async () => {
    const { sql, params } = await runSearch({ city: "lucknow", min_rent: "5000" });
    expect(sql).toContain("l.monthly_rent >=");
    expect(sql).not.toContain("l.monthly_rent <=");
    expect(params).toContain(5000);
  });

  it("max_rent adds an upper bound with the numeric value bound", async () => {
    const { sql, params } = await runSearch({ city: "lucknow", max_rent: "10000" });
    expect(sql).toContain("l.monthly_rent <=");
    expect(sql).not.toContain("l.monthly_rent >=");
    expect(params).toContain(10000);
  });

  it("applies both bounds for a budget band", async () => {
    const { sql, params } = await runSearch({ min_rent: "5000", max_rent: "10000" });
    expect(sql).toContain("l.monthly_rent >=");
    expect(sql).toContain("l.monthly_rent <=");
    expect(params).toContain(5000);
    expect(params).toContain(10000);
  });

  it("omits the predicate entirely when no rent filter is supplied", async () => {
    const { sql } = await runSearch({ city: "lucknow" });
    expect(sql).not.toContain("monthly_rent >=");
    expect(sql).not.toContain("monthly_rent <=");
  });

  // Regression: `Number("abc")` is NaN. Binding NaN makes Postgres throw, which
  // runSearch's catch swallows into an empty page — a typo would read to the
  // user as "no PGs match" instead of being ignored.
  it("ignores non-numeric rent input instead of binding NaN", async () => {
    const { sql, params } = await runSearch({ min_rent: "abc", max_rent: "₹10k" });
    expect(sql).not.toContain("monthly_rent >=");
    expect(sql).not.toContain("monthly_rent <=");
    expect(params.some((p) => typeof p === "number" && Number.isNaN(p))).toBe(false);
  });
});
