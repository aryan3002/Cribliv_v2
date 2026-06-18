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
