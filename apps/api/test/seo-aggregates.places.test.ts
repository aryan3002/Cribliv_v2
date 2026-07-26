import { beforeEach, describe, expect, it, vi } from "vitest";
import { SeoAggregatesService } from "../src/modules/seo/seo-aggregates.service";

describe("SeoAggregatesService place counts", () => {
  let query: ReturnType<typeof vi.fn>;
  let database: { isEnabled: () => boolean; query: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    query = vi.fn();
    database = { isEnabled: () => true, query };
  });

  it("returns [] without querying when the DB is disabled", async () => {
    database = { isEnabled: () => false, query };
    const service = new SeoAggregatesService(database as never);

    await expect(service.metroStationsWithCountsForCity("lucknow")).resolves.toEqual([]);
    await expect(service.landmarksWithCountsForCity("lucknow")).resolves.toEqual([]);

    expect(query).not.toHaveBeenCalled();
  });

  it("counts listings within 1.5 km of each metro station and derives the slug in SQL", async () => {
    query.mockResolvedValueOnce({
      rows: [
        {
          id: 1,
          station_name: "Bhootnath Market",
          slug: "bhootnath-market",
          line_name: "Red",
          line_color: "#f00",
          lat: 26.8,
          lng: 80.9,
          sequence: 4,
          listing_count: 5
        }
      ]
    });
    const service = new SeoAggregatesService(database as never);

    const rows = await service.metroStationsWithCountsForCity("lucknow");

    expect(rows[0]).toMatchObject({ slug: "bhootnath-market", listing_count: 5 });

    const [sql, params] = query.mock.calls[0];
    // Slug must be derived with the SAME expression findMetroStation resolves,
    // otherwise the sitemap emits URLs the page cannot resolve.
    expect(sql).toContain("REGEXP_REPLACE(ms.station_name, '[^a-zA-Z0-9]+', '-', 'g')");
    expect(sql).toContain("ST_DWithin");
    expect(params).toEqual(["lucknow", 1500]);
  });

  it("counts listings within 2 km of each landmark", async () => {
    query.mockResolvedValueOnce({
      rows: [{ id: 7, slug: "kgmu", name_en: "KGMU", name_hi: "केजीएमयू", listing_count: 0 }]
    });
    const service = new SeoAggregatesService(database as never);

    const rows = await service.landmarksWithCountsForCity("lucknow");

    expect(rows[0]).toMatchObject({ slug: "kgmu", listing_count: 0 });

    const [sql, params] = query.mock.calls[0];
    expect(sql).toContain("FROM landmarks");
    expect(sql).toContain("lm.is_active = true");
    expect(params).toEqual(["lucknow", 2000]);
  });

  it("scopes the metro count to the requested city so other cities' listings never leak in", async () => {
    query.mockResolvedValueOnce({ rows: [] });
    const service = new SeoAggregatesService(database as never);

    await service.metroStationsWithCountsForCity("lucknow");

    const [sql] = query.mock.calls[0];
    expect(sql).toContain("c.slug = $1");
    expect(sql).toContain("WHERE ms.city = $1");
  });

  it("returns [] rather than throwing when PostGIS is unavailable", async () => {
    query.mockRejectedValueOnce(new Error("function st_dwithin does not exist"));
    const service = new SeoAggregatesService(database as never);

    await expect(service.metroStationsWithCountsForCity("lucknow")).resolves.toEqual([]);
  });

  it("returns [] rather than throwing when the landmark query fails", async () => {
    query.mockRejectedValueOnce(new Error('relation "landmarks" does not exist'));
    const service = new SeoAggregatesService(database as never);

    await expect(service.landmarksWithCountsForCity("lucknow")).resolves.toEqual([]);
  });
});
