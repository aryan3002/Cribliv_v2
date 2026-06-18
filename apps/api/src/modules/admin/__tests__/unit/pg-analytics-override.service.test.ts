import { describe, it, expect, vi } from "vitest";
import { PgAnalyticsOverrideService } from "../../pg-analytics-override.service";
import type { DatabaseService } from "../../../../common/database.service";

function setup(dbEnabled = true) {
  const query = vi.fn();
  const db = { isEnabled: () => dbEnabled, query } as unknown as DatabaseService;
  return { svc: new PgAnalyticsOverrideService(db), query };
}

describe("PgAnalyticsOverrideService", () => {
  it("getActiveForOperator returns empty when DB disabled", async () => {
    const { svc } = setup(false);
    expect(await svc.getActiveForOperator("op-1")).toEqual({ global: false, listing_ids: [] });
  });

  it("getActiveForOperator splits global vs per-listing active rows", async () => {
    const { svc, query } = setup();
    query.mockResolvedValueOnce({
      rows: [{ listing_id: null }, { listing_id: "L1" }, { listing_id: "L2" }]
    });
    const r = await svc.getActiveForOperator("op-1");
    expect(r.global).toBe(true);
    expect(r.listing_ids.sort()).toEqual(["L1", "L2"]);
  });

  it("set upserts an active row and writes an admin_actions audit row", async () => {
    const { svc, query } = setup();
    query.mockResolvedValue({ rows: [], rowCount: 0 });
    await svc.set("admin-1", "op-1", { listingId: "L1" }, "spam");
    const sqls = query.mock.calls.map((c) => String(c[0]));
    expect(sqls.some((s) => /pg_analytics_overrides/i.test(s))).toBe(true);
    expect(sqls.some((s) => /INSERT INTO admin_actions/i.test(s))).toBe(true);
  });

  it("set per-listing audits with target_type 'listing'", async () => {
    const { svc, query } = setup();
    query.mockResolvedValue({ rows: [], rowCount: 0 });
    await svc.set("admin-1", "op-1", { listingId: "L1" }, null);
    const auditCall = query.mock.calls.find((c) => /INSERT INTO admin_actions/i.test(String(c[0])));
    expect(auditCall?.[1]).toContain("listing"); // targetType param
  });

  it("clear (global) deactivates, audits, and targets the operator (user)", async () => {
    const { svc, query } = setup();
    query.mockResolvedValue({ rows: [], rowCount: 1 });
    await svc.clear("admin-1", "op-1", { listingId: null }, "resolved");
    const sqls = query.mock.calls.map((c) => String(c[0]));
    expect(sqls.some((s) => /UPDATE pg_analytics_overrides/i.test(s))).toBe(true);
    const auditCall = query.mock.calls.find((c) => /INSERT INTO admin_actions/i.test(String(c[0])));
    expect(auditCall?.[1]).toContain("user"); // global => target_type 'user'
  });
});
