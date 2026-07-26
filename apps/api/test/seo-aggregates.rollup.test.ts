import { beforeEach, describe, expect, it, vi } from "vitest";
import { SeoAggregatesService } from "../src/modules/seo/seo-aggregates.service";

/**
 * Hierarchy rollup: a locality's listing count is "self plus all descendants".
 *
 * Without this, migration 0054 assigns listings to the *nearest* locality —
 * often a micro-locality — so a parent shows 0 and no page ever clears the
 * threshold. Six real listings across two children produce zero indexable
 * pages, which is the default outcome under a scattered-supply NCR push.
 *
 * These are unit tests over the emitted SQL and the row mapping; the rollup's
 * arithmetic itself needs a real Postgres (no TEST_DATABASE_URL here).
 */
describe("SeoAggregatesService.localitiesForCity rollup", () => {
  let query: ReturnType<typeof vi.fn>;
  let database: { isEnabled: () => boolean; query: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    query = vi.fn();
    database = { isEnabled: () => true, query };
  });

  it("rolls descendant listings up into the parent via a recursive walk", async () => {
    query.mockResolvedValueOnce({ rows: [] });
    const service = new SeoAggregatesService(database as never);

    await service.localitiesForCity("lucknow");

    const [sql, params] = query.mock.calls[0];
    expect(sql).toContain("WITH RECURSIVE");
    // Recurse on the hierarchy column, so depth is not assumed.
    expect(sql).toContain("parent_locality_id");
    // A listing reachable via both a parent and a child must not count twice.
    expect(sql).toContain("COUNT(DISTINCT l.id)");
    expect(params).toEqual(["lucknow"]);
  });

  it("exposes own_listing_count alongside the rolled-up listing_count", async () => {
    query.mockResolvedValueOnce({
      rows: [
        {
          id: 1,
          slug: "gomti-nagar",
          name_en: "Gomti Nagar",
          name_hi: "गोमती नगर",
          lat: null,
          lng: null,
          parent_locality_slug: null,
          listing_count: 4,
          own_listing_count: 0
        },
        {
          id: 2,
          slug: "vipul-khand",
          name_en: "Vipul Khand",
          name_hi: "विपुल खंड",
          lat: null,
          lng: null,
          parent_locality_slug: "gomti-nagar",
          listing_count: 2,
          own_listing_count: 2
        }
      ]
    });
    const service = new SeoAggregatesService(database as never);

    const rows = await service.localitiesForCity("lucknow");

    // The parent is credited with its children's listings while owning none.
    expect(rows[0]).toMatchObject({
      slug: "gomti-nagar",
      listing_count: 4,
      own_listing_count: 0
    });
    expect(rows[1]).toMatchObject({
      slug: "vipul-khand",
      listing_count: 2,
      own_listing_count: 2
    });
  });

  it("still orders by rolled-up count so the copy batcher's early-break stays valid", async () => {
    query.mockResolvedValueOnce({ rows: [] });
    const service = new SeoAggregatesService(database as never);

    await service.localitiesForCity("lucknow");

    const [sql] = query.mock.calls[0];
    expect(sql).toContain("ORDER BY listing_count DESC");
  });

  it("returns [] without querying when the DB is disabled", async () => {
    database = { isEnabled: () => false, query };
    const service = new SeoAggregatesService(database as never);

    await expect(service.localitiesForCity("lucknow")).resolves.toEqual([]);
    expect(query).not.toHaveBeenCalled();
  });

  it("returns [] rather than throwing when the recursive query fails", async () => {
    query.mockRejectedValueOnce(new Error("stack depth limit exceeded"));
    const service = new SeoAggregatesService(database as never);

    await expect(service.localitiesForCity("lucknow")).resolves.toEqual([]);
  });
});
