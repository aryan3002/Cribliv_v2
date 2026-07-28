import { NotFoundException } from "@nestjs/common";
import { INDEXABLE_MIN_LISTINGS } from "@cribliv/shared-types";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SeoCityConfigService } from "../src/modules/seo/seo-city-config.service";

const ENABLED_ROW = {
  city_slug: "lucknow",
  programmatic_enabled: true,
  locality_count: 2,
  landmark_count: 4,
  metro_count: 2,
  indexable_count: 1,
  enabled_at: "2026-07-03T00:00:00.000Z",
  notes: "live"
};

/**
 * Fixture shape: 2 localities (1 indexable), 2 metro stations (1 indexable),
 * 4 landmarks (1 indexable) = 8 places, 3 indexable, 5 thin.
 *
 * `indexable_count` deliberately spans all three kinds. It used to count
 * localities only, so the admin headline described ~1.6% of the surface it
 * claimed to summarise.
 */
function makeAggregates() {
  return {
    localitiesForCity: vi.fn(async () => [
      { slug: "gomti-nagar", listing_count: INDEXABLE_MIN_LISTINGS },
      { slug: "aliganj", listing_count: INDEXABLE_MIN_LISTINGS - 1 }
    ]),
    metroStationsWithCountsForCity: vi.fn(async () => [
      { id: 1, listing_count: INDEXABLE_MIN_LISTINGS },
      { id: 2, listing_count: 0 }
    ]),
    landmarksWithCountsForCity: vi.fn(async () => [
      { id: 1, listing_count: INDEXABLE_MIN_LISTINGS + 5 },
      { id: 2, listing_count: 1 },
      { id: 3, listing_count: 0 },
      { id: 4, listing_count: 0 }
    ])
  };
}

const EXPECTED_COUNTS = {
  locality_count: 2,
  landmark_count: 4,
  metro_count: 2,
  indexable_count: 3,
  thin_count: 5
};

describe("SeoCityConfigService", () => {
  let query: ReturnType<typeof vi.fn>;
  let database: { isEnabled: () => boolean; query: ReturnType<typeof vi.fn> };
  let aggregates: ReturnType<typeof makeAggregates>;
  let indexing: { enqueue: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    query = vi.fn();
    database = { isEnabled: () => true, query };
    aggregates = makeAggregates();
    indexing = { enqueue: vi.fn(async () => null) };
  });

  function makeService() {
    return new SeoCityConfigService(database as never, aggregates as never, indexing as never);
  }

  it("returns empty lists without querying when DB is disabled", async () => {
    database = { isEnabled: () => false, query };
    const service = makeService();

    await expect(service.listEnabled()).resolves.toEqual([]);
    await expect(service.listAllWithCounts()).resolves.toEqual([]);

    expect(query).not.toHaveBeenCalled();
  });

  it("returns zeroed counts without querying when DB is disabled", async () => {
    database = { isEnabled: () => false, query };

    await expect(makeService().computeCounts("lucknow")).resolves.toEqual({
      locality_count: 0,
      landmark_count: 0,
      metro_count: 0,
      indexable_count: 0,
      thin_count: 0
    });
  });

  it("returns null from setEnabled without querying when DB is disabled", async () => {
    database = { isEnabled: () => false, query };

    await expect(makeService().setEnabled("noida", true, "reviewed")).resolves.toBeNull();

    expect(query).not.toHaveBeenCalled();
  });

  it("lists enabled city config rows without joining cities", async () => {
    query.mockResolvedValueOnce({ rows: [ENABLED_ROW] });

    await expect(makeService().listEnabled()).resolves.toEqual([ENABLED_ROW]);

    const [sql, params] = query.mock.calls[0];
    expect(sql).toContain("FROM seo_city_config");
    expect(sql).toContain("programmatic_enabled = true");
    expect(sql).not.toMatch(/\bjoin\b/i);
    expect(params).toEqual([]);
  });

  it("short-circuits listEnabled to [] without querying when the kill-switch flag is off", async () => {
    const original = process.env.FF_PROGRAMMATIC_SEO_CITIES_ENABLED;
    process.env.FF_PROGRAMMATIC_SEO_CITIES_ENABLED = "false";
    try {
      await expect(makeService().listEnabled()).resolves.toEqual([]);
      expect(query).not.toHaveBeenCalled();
    } finally {
      if (original === undefined) {
        delete process.env.FF_PROGRAMMATIC_SEO_CITIES_ENABLED;
      } else {
        process.env.FF_PROGRAMMATIC_SEO_CITIES_ENABLED = original;
      }
    }
  });

  it("lists every city with config defaults and refreshed count columns", async () => {
    const baseRow = { ...ENABLED_ROW, name_en: "Lucknow", name_hi: "लखनऊ", is_active: true };
    query.mockResolvedValueOnce({ rows: [baseRow] });

    await expect(makeService().listAllWithCounts()).resolves.toEqual([
      // Live counts from computeCounts win over the stored count columns, so a
      // city that was never toggled does not show stale zeros.
      { ...baseRow, ...EXPECTED_COUNTS }
    ]);

    expect(aggregates.localitiesForCity).toHaveBeenCalledWith("lucknow");
    expect(aggregates.metroStationsWithCountsForCity).toHaveBeenCalledWith("lucknow");
    expect(aggregates.landmarksWithCountsForCity).toHaveBeenCalledWith("lucknow");

    const [sql, params] = query.mock.calls[0];
    expect(sql).toContain("FROM cities");
    expect(sql).toContain("LEFT JOIN seo_city_config");
    expect(sql).toContain("COALESCE(scc.programmatic_enabled, false)");
    expect(params).toEqual([]);
  });

  it("returns live non-zero counts for a city whose stored counts are 0 (e.g. never toggled)", async () => {
    query.mockResolvedValueOnce({
      rows: [
        {
          city_slug: "lucknow",
          programmatic_enabled: false,
          locality_count: 0,
          landmark_count: 0,
          metro_count: 0,
          indexable_count: 0,
          enabled_at: null,
          notes: null,
          created_at: null,
          updated_at: null,
          name_en: "Lucknow",
          name_hi: "लखनऊ",
          is_active: true
        }
      ]
    });

    const [result] = await makeService().listAllWithCounts();

    expect(result).toMatchObject(EXPECTED_COUNTS);
  });

  it("counts indexable places across localities, metro AND landmarks", async () => {
    await expect(makeService().computeCounts("lucknow")).resolves.toEqual(EXPECTED_COUNTS);
  });

  it("reports thin places — the number that should gate an Enable decision", async () => {
    aggregates.localitiesForCity = vi.fn(async () => [
      { slug: "a", listing_count: 0 },
      { slug: "b", listing_count: 1 }
    ]);
    aggregates.metroStationsWithCountsForCity = vi.fn(async () => [{ id: 1, listing_count: 0 }]);
    aggregates.landmarksWithCountsForCity = vi.fn(async () => [{ id: 1, listing_count: 2 }]);

    // A city with places but zero indexable ones adds nothing to the surface.
    await expect(makeService().computeCounts("noida")).resolves.toMatchObject({
      indexable_count: 0,
      thin_count: 4
    });
  });

  it("upserts toggle state with refreshed counts and returns the config row", async () => {
    query.mockResolvedValueOnce({ rows: [ENABLED_ROW] });

    await expect(makeService().setEnabled("noida", true, "reviewed")).resolves.toEqual(ENABLED_ROW);

    const [sql, params] = query.mock.calls[0];
    expect(sql).toContain("INSERT INTO seo_city_config");
    expect(sql).toContain("ON CONFLICT (city_slug) DO UPDATE");
    // thin_count is computed live and has no column, so it must not be written.
    expect(params).toEqual(["noida", true, "reviewed", 2, 4, 2, 3]);
  });

  it("preserves the original enabled_at across a disable then re-enable", async () => {
    query.mockResolvedValueOnce({ rows: [ENABLED_ROW] });

    await makeService().setEnabled("noida", true, "reviewed");

    const [sql] = query.mock.calls[0];
    // Disabling used to NULL enabled_at outright, destroying the date the admin
    // table shows. COALESCE stamps only the first enable; disable leaves it.
    expect(sql).toContain("COALESCE(seo_city_config.enabled_at, now())");
    expect(sql).not.toContain("enabled_at = CASE WHEN $2 THEN now() ELSE NULL END");
  });

  it("maps an unknown city (FK violation) to NotFoundException, not a raw 500", async () => {
    const fkError = Object.assign(new Error("violates foreign key constraint"), { code: "23503" });
    query.mockRejectedValueOnce(fkError);

    await expect(makeService().setEnabled("does-not-exist", true, "x")).rejects.toBeInstanceOf(
      NotFoundException
    );
  });

  it("enqueues the city hub URL (en + hi) for fast indexing when enabling a city", async () => {
    query.mockResolvedValueOnce({ rows: [ENABLED_ROW] });

    await makeService().setEnabled("noida", true, "reviewed");

    expect(indexing.enqueue).toHaveBeenCalledTimes(2);
    expect(indexing.enqueue).toHaveBeenCalledWith("/en/city/noida", "city_enabled");
    expect(indexing.enqueue).toHaveBeenCalledWith("/hi/city/noida", "city_enabled");
  });

  it("does NOT enqueue indexing when disabling a city", async () => {
    query.mockResolvedValueOnce({
      rows: [{ ...ENABLED_ROW, programmatic_enabled: false }]
    });

    await makeService().setEnabled("noida", false, "paused");

    expect(indexing.enqueue).not.toHaveBeenCalled();
  });

  it("does not let an indexing enqueue failure break the city toggle response", async () => {
    query.mockResolvedValueOnce({ rows: [ENABLED_ROW] });
    indexing.enqueue = vi.fn(async () => {
      throw new Error("db blip");
    });

    await expect(makeService().setEnabled("noida", true, "reviewed")).resolves.toEqual(ENABLED_ROW);
  });
});
