import { describe, it, expect, vi } from "vitest";
import { AnalyticsService } from "../analytics.service";

function makeDb(opts: { enabled?: boolean; rows?: any[] } = {}) {
  const enabled = opts.enabled ?? true;
  const query = vi.fn(async () => ({ rows: opts.rows ?? [] }) as any);
  return { isEnabled: () => enabled, query } as any;
}

describe("AnalyticsService.getListingEventCountsBatch", () => {
  it("returns an empty map (no query) for empty ids", async () => {
    const db = makeDb();
    const svc = new AnalyticsService(db);
    const r = await svc.getListingEventCountsBatch([]);
    expect(r.size).toBe(0);
    expect(db.query).not.toHaveBeenCalled();
  });

  it("returns an empty map (no query) when the DB is disabled", async () => {
    const db = makeDb({ enabled: false });
    const svc = new AnalyticsService(db);
    const r = await svc.getListingEventCountsBatch(["L1"]);
    expect(r.size).toBe(0);
    expect(db.query).not.toHaveBeenCalled();
  });

  it("counts many listings in ONE query (no N+1) and maps per event_type", async () => {
    const db = makeDb({
      rows: [
        { listing_id: "L1", event_type: "view", count: 42 },
        { listing_id: "L1", event_type: "enquiry", count: 3 },
        { listing_id: "L2", event_type: "shortlist", count: 7 }
      ]
    });
    const svc = new AnalyticsService(db);
    const r = await svc.getListingEventCountsBatch(["L1", "L2", "L3"]);

    // The whole point of PERF-H3: a single set-based query regardless of id count.
    expect(db.query).toHaveBeenCalledOnce();
    const [sql, params] = db.query.mock.calls[0];
    expect(sql).toContain("listing_id = ANY($1::uuid[])");
    expect(sql).toContain("GROUP BY listing_id, event_type");
    expect(params[0]).toEqual(["L1", "L2", "L3"]);

    expect(r.get("L1")).toEqual({ views: 42, enquiries: 3, shortlists: 0 });
    expect(r.get("L2")).toEqual({ views: 0, enquiries: 0, shortlists: 7 });
    expect(r.has("L3")).toBe(false); // ids with no events are absent (callers zero-fill)
  });

  it("appends a since-clause + param when a window is supplied", async () => {
    const db = makeDb({ rows: [] });
    const svc = new AnalyticsService(db);
    const since = new Date("2026-06-08T00:00:00.000Z");
    await svc.getListingEventCountsBatch(["L1"], since);
    const [sql, params] = db.query.mock.calls[0];
    expect(sql).toContain("created_at >= $2");
    expect(params[1]).toBe(since.toISOString());
  });
});
