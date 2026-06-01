import { describe, it, expect, vi } from "vitest";
import { PgAnalyticsService } from "../services/pg-analytics.service";

function makeDb(opts: { enabled?: boolean; rows?: any[]; throws?: boolean } = {}) {
  const enabled = opts.enabled ?? true;
  const query = vi.fn(async () => {
    if (opts.throws) throw new Error("db down");
    return { rows: opts.rows ?? [] } as any;
  });
  return { isEnabled: () => enabled, query } as any;
}

describe("PgAnalyticsService.trackSearch", () => {
  it("inserts a row mapping all fields", async () => {
    const db = makeDb();
    const svc = new PgAnalyticsService(db);
    await svc.trackSearch({
      session_id: "s1",
      user_id: "u1",
      query: "near metro",
      city: "pune",
      filters: { gender: "girls" },
      result_count: 5,
      shown_listing_ids: ["a", "b"],
      surface: "pg_search",
      ip: "1.2.3.4",
      user_agent: "UA"
    });
    expect(db.query).toHaveBeenCalledOnce();
    const [sql, params] = db.query.mock.calls[0];
    expect(sql).toContain("INSERT INTO pg_search_events");
    expect(params[0]).toBe("s1"); // session_id
    expect(params).toContain("pune"); // city
    expect(params).toContain(JSON.stringify(["a", "b"])); // shown_listing_ids as json
  });

  it("works with only session_id (others default)", async () => {
    const db = makeDb();
    const svc = new PgAnalyticsService(db);
    await expect(svc.trackSearch({ session_id: "s2" })).resolves.toBeUndefined();
    expect(db.query).toHaveBeenCalledOnce();
  });

  it("never throws when the DB errors", async () => {
    const db = makeDb({ throws: true });
    const svc = new PgAnalyticsService(db);
    await expect(svc.trackSearch({ session_id: "s3" })).resolves.toBeUndefined();
  });

  it("skips the query when the DB is disabled", async () => {
    const db = makeDb({ enabled: false });
    const svc = new PgAnalyticsService(db);
    await svc.trackSearch({ session_id: "s4" });
    expect(db.query).not.toHaveBeenCalled();
  });
});

describe("PgAnalyticsService.getSearchAppearances", () => {
  it("returns [] with no query for empty ids", async () => {
    const db = makeDb();
    const svc = new PgAnalyticsService(db);
    const r = await svc.getSearchAppearances([], new Date());
    expect(r).toEqual([]);
    expect(db.query).not.toHaveBeenCalled();
  });

  it("maps per-listing appearances + clicks, zero-filling absent ids", async () => {
    const db = makeDb({
      rows: [
        { listing_id: "L1", appearances: 142, clicks: 11 },
        { listing_id: "L2", appearances: 0, clicks: 0 }
      ]
    });
    const svc = new PgAnalyticsService(db);
    const r = await svc.getSearchAppearances(["L1", "L2"], new Date("2026-05-25"));
    expect(r).toEqual([
      { listing_id: "L1", appearances: 142, clicks: 11 },
      { listing_id: "L2", appearances: 0, clicks: 0 }
    ]);
    const [sql, params] = db.query.mock.calls[0];
    expect(sql).toContain("shown_listing_ids"); // appearances via containment
    expect(params[0]).toEqual(["L1", "L2"]);
    expect(params[1]).toBeInstanceOf(Date);
  });

  it("returns [] (not throw) when the read fails", async () => {
    const db = makeDb({ throws: true });
    const svc = new PgAnalyticsService(db);
    await expect(svc.getSearchAppearances(["L1"], new Date())).resolves.toEqual([]);
  });
});

describe("PgAnalyticsService.getFunnelTimeseries", () => {
  it("returns [] for empty ids", async () => {
    const db = makeDb();
    const svc = new PgAnalyticsService(db);
    expect(await svc.getFunnelTimeseries([], 7)).toEqual([]);
    expect(db.query).not.toHaveBeenCalled();
  });

  it("zero-fills the full day grid and merges grouped rows", async () => {
    // Two raw rows for L1 on two days; service must emit exactly `days` points.
    const db = makeDb({
      rows: [
        { listing_id: "L1", day: "2026-05-30", appearances: 10, clicks: 2, views: 4, leads: 1 },
        { listing_id: "L1", day: "2026-05-31", appearances: 5, clicks: 1, views: 2, leads: 0 }
      ]
    });
    const svc = new PgAnalyticsService(db);
    const r = await svc.getFunnelTimeseries(["L1"], 7);
    expect(r).toHaveLength(1);
    expect(r[0].listing_id).toBe("L1");
    expect(r[0].series).toHaveLength(7); // exactly `days`
    expect(r[0].series.every((p) => p.day && typeof p.appearances === "number")).toBe(true);
    const filled = r[0].series.find((p) => p.day === "2026-05-30");
    expect(filled).toMatchObject({ appearances: 10, clicks: 2, views: 4, leads: 1 });
    const empty = r[0].series.filter((p) => p.appearances === 0);
    expect(empty.length).toBeGreaterThan(0); // gaps zero-filled
  });

  it("returns [] (not throw) on read failure", async () => {
    const db = makeDb({ throws: true });
    const svc = new PgAnalyticsService(db);
    await expect(svc.getFunnelTimeseries(["L1"], 7)).resolves.toEqual([]);
  });
});

describe("PgAnalyticsService.getSearchInsights", () => {
  function seqDb(seq: any[][]) {
    const query = vi.fn();
    seq.forEach((rows) => query.mockResolvedValueOnce({ rows }));
    return { isEnabled: () => true, query } as any;
  }

  it("returns empty insights with no query for empty cities", async () => {
    const db = { isEnabled: () => true, query: vi.fn() } as any;
    const svc = new PgAnalyticsService(db);
    const r = await svc.getSearchInsights([], new Date());
    expect(r).toEqual({ top_queries: [], top_filters: [], zero_result_queries: [] });
    expect(db.query).not.toHaveBeenCalled();
  });

  it("returns empty insights when the DB is disabled", async () => {
    const db = { isEnabled: () => false, query: vi.fn() } as any;
    const svc = new PgAnalyticsService(db);
    expect(await svc.getSearchInsights(["pune"], new Date())).toEqual({
      top_queries: [],
      top_filters: [],
      zero_result_queries: []
    });
    expect(db.query).not.toHaveBeenCalled();
  });

  it("maps top_queries, top_filters and zero_result_queries", async () => {
    const db = seqDb([
      [
        { query: "ac pg near metro", count: 12 },
        { query: "girls pg", count: 7 }
      ],
      [
        { key: "gender_policy", value: "girls", count: 9 },
        { key: "ac", value: "true", count: 5 }
      ],
      [{ query: "single room with ac", count: 4 }]
    ]);
    const svc = new PgAnalyticsService(db);
    const since = new Date("2026-05-25");
    const r = await svc.getSearchInsights(["pune", "mumbai"], since);
    expect(r.top_queries[0]).toEqual({ query: "ac pg near metro", count: 12 });
    expect(r.top_filters[0]).toEqual({ key: "gender_policy", value: "girls", count: 9 });
    expect(r.zero_result_queries[0]).toEqual({ query: "single room with ac", count: 4 });
    // all three queries scoped by cities + since
    for (const call of db.query.mock.calls) {
      expect(call[1][0]).toEqual(["pune", "mumbai"]);
      expect(call[1][1]).toBeInstanceOf(Date);
    }
  });

  it("returns empty insights (not throw) when a read fails", async () => {
    const db = {
      isEnabled: () => true,
      query: vi.fn(async () => {
        throw new Error("db down");
      })
    } as any;
    const svc = new PgAnalyticsService(db);
    await expect(svc.getSearchInsights(["pune"], new Date())).resolves.toEqual({
      top_queries: [],
      top_filters: [],
      zero_result_queries: []
    });
  });
});
