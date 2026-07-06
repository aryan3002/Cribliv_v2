import { NotFoundException } from "@nestjs/common";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { INDEXABLE_MIN, SeoCityConfigService } from "../src/modules/seo/seo-city-config.service";

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

describe("SeoCityConfigService", () => {
  let query: ReturnType<typeof vi.fn>;
  let database: { isEnabled: () => boolean; query: ReturnType<typeof vi.fn> };
  let aggregates: {
    localitiesForCity: ReturnType<typeof vi.fn>;
    metroStationsForCity: ReturnType<typeof vi.fn>;
  };
  let indexing: { enqueue: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    query = vi.fn();
    database = { isEnabled: () => true, query };
    aggregates = {
      localitiesForCity: vi.fn(async () => [
        { slug: "gomti-nagar", listing_count: INDEXABLE_MIN },
        { slug: "aliganj", listing_count: INDEXABLE_MIN - 1 }
      ]),
      metroStationsForCity: vi.fn(async () => [{ id: 1 }, { id: 2 }])
    };
    indexing = { enqueue: vi.fn(async () => null) };
  });

  it("returns empty lists without querying when DB is disabled", async () => {
    database = { isEnabled: () => false, query };
    const service = new SeoCityConfigService(
      database as never,
      aggregates as never,
      indexing as never
    );

    await expect(service.listEnabled()).resolves.toEqual([]);
    await expect(service.listAllWithCounts()).resolves.toEqual([]);

    expect(query).not.toHaveBeenCalled();
  });

  it("returns null from setEnabled without querying when DB is disabled", async () => {
    database = { isEnabled: () => false, query };
    const service = new SeoCityConfigService(
      database as never,
      aggregates as never,
      indexing as never
    );

    await expect(service.setEnabled("noida", true, "reviewed")).resolves.toBeNull();

    expect(query).not.toHaveBeenCalled();
  });

  it("lists enabled city config rows without joining cities", async () => {
    query.mockResolvedValueOnce({ rows: [ENABLED_ROW] });
    const service = new SeoCityConfigService(
      database as never,
      aggregates as never,
      indexing as never
    );

    await expect(service.listEnabled()).resolves.toEqual([ENABLED_ROW]);

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
      const service = new SeoCityConfigService(
        database as never,
        aggregates as never,
        indexing as never
      );

      await expect(service.listEnabled()).resolves.toEqual([]);

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
    const baseRow = {
      ...ENABLED_ROW,
      name_en: "Lucknow",
      name_hi: "लखनऊ",
      is_active: true
    };
    // Base cities query returns the row first; computeCounts then issues one
    // landmark-count query per city against the same mocked `query` fn.
    query
      .mockResolvedValueOnce({ rows: [baseRow] })
      .mockResolvedValueOnce({ rows: [{ count: 4 }] });
    const service = new SeoCityConfigService(
      database as never,
      aggregates as never,
      indexing as never
    );

    await expect(service.listAllWithCounts()).resolves.toEqual([
      {
        ...baseRow,
        // Live counts come from computeCounts (aggregates + landmark query),
        // NOT from the stored ENABLED_ROW count columns.
        locality_count: 2,
        landmark_count: 4,
        metro_count: 2,
        indexable_count: 1
      }
    ]);

    expect(aggregates.localitiesForCity).toHaveBeenCalledWith("lucknow");
    expect(aggregates.metroStationsForCity).toHaveBeenCalledWith("lucknow");

    const [sql, params] = query.mock.calls[0];
    expect(sql).toContain("FROM cities");
    expect(sql).toContain("LEFT JOIN seo_city_config");
    expect(sql).toContain("COALESCE(scc.programmatic_enabled, false)");
    expect(params).toEqual([]);

    const [landmarkSql, landmarkParams] = query.mock.calls[1];
    expect(landmarkSql).toContain("FROM landmarks");
    expect(landmarkParams).toEqual(["lucknow"]);
  });

  it("returns live non-zero counts for a city whose stored counts are 0 (e.g. never toggled)", async () => {
    const neverToggledRow = {
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
    };
    query
      .mockResolvedValueOnce({ rows: [neverToggledRow] })
      .mockResolvedValueOnce({ rows: [{ count: 4 }] });
    const service = new SeoCityConfigService(
      database as never,
      aggregates as never,
      indexing as never
    );

    const [result] = await service.listAllWithCounts();

    expect(result.locality_count).toBe(2);
    expect(result.landmark_count).toBe(4);
    expect(result.metro_count).toBe(2);
    expect(result.indexable_count).toBe(1);
  });

  it("computes indexable counts from locality listing counts and counts landmarks", async () => {
    query.mockResolvedValueOnce({ rows: [{ count: 4 }] });
    const service = new SeoCityConfigService(
      database as never,
      aggregates as never,
      indexing as never
    );

    await expect(service.computeCounts("lucknow")).resolves.toEqual({
      locality_count: 2,
      landmark_count: 4,
      metro_count: 2,
      indexable_count: 1
    });

    const [sql, params] = query.mock.calls[0];
    expect(sql).toContain("FROM landmarks");
    expect(params).toEqual(["lucknow"]);
  });

  it("upserts toggle state with refreshed counts and returns the config row", async () => {
    query
      .mockResolvedValueOnce({ rows: [{ count: 4 }] })
      .mockResolvedValueOnce({ rows: [ENABLED_ROW] });
    const service = new SeoCityConfigService(
      database as never,
      aggregates as never,
      indexing as never
    );

    await expect(service.setEnabled("noida", true, "reviewed")).resolves.toEqual(ENABLED_ROW);

    const [sql, params] = query.mock.calls[1];
    expect(sql).toContain("INSERT INTO seo_city_config");
    expect(sql).toContain("enabled_at = CASE WHEN $2 THEN now() ELSE NULL END");
    expect(sql).toContain("ON CONFLICT (city_slug) DO UPDATE");
    expect(params).toEqual(["noida", true, "reviewed", 2, 4, 2, 1]);
  });

  it("maps an unknown city (FK violation) to NotFoundException, not a raw 500", async () => {
    const fkError = Object.assign(new Error("violates foreign key constraint"), { code: "23503" });
    query.mockResolvedValueOnce({ rows: [{ count: 0 }] }).mockRejectedValueOnce(fkError);
    const service = new SeoCityConfigService(
      database as never,
      aggregates as never,
      indexing as never
    );

    await expect(service.setEnabled("does-not-exist", true, "x")).rejects.toBeInstanceOf(
      NotFoundException
    );
  });

  it("enqueues the city hub URL (en + hi) for fast indexing when enabling a city", async () => {
    query
      .mockResolvedValueOnce({ rows: [{ count: 4 }] })
      .mockResolvedValueOnce({ rows: [ENABLED_ROW] });
    const service = new SeoCityConfigService(
      database as never,
      aggregates as never,
      indexing as never
    );

    await service.setEnabled("noida", true, "reviewed");

    expect(indexing.enqueue).toHaveBeenCalledTimes(2);
    expect(indexing.enqueue).toHaveBeenCalledWith("/en/city/noida", "city_enabled");
    expect(indexing.enqueue).toHaveBeenCalledWith("/hi/city/noida", "city_enabled");
  });

  it("does NOT enqueue indexing when disabling a city", async () => {
    query
      .mockResolvedValueOnce({ rows: [{ count: 4 }] })
      .mockResolvedValueOnce({ rows: [{ ...ENABLED_ROW, programmatic_enabled: false }] });
    const service = new SeoCityConfigService(
      database as never,
      aggregates as never,
      indexing as never
    );

    await service.setEnabled("noida", false, "paused");

    expect(indexing.enqueue).not.toHaveBeenCalled();
  });

  it("does not let an indexing enqueue failure break the city toggle response", async () => {
    query
      .mockResolvedValueOnce({ rows: [{ count: 4 }] })
      .mockResolvedValueOnce({ rows: [ENABLED_ROW] });
    indexing.enqueue = vi.fn(async () => {
      throw new Error("db blip");
    });
    const service = new SeoCityConfigService(
      database as never,
      aggregates as never,
      indexing as never
    );

    await expect(service.setEnabled("noida", true, "reviewed")).resolves.toEqual(ENABLED_ROW);
  });
});
