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
  });

  it("returns empty lists without querying when DB is disabled", async () => {
    database = { isEnabled: () => false, query };
    const service = new SeoCityConfigService(database as never, aggregates as never);

    await expect(service.listEnabled()).resolves.toEqual([]);
    await expect(service.listAllWithCounts()).resolves.toEqual([]);

    expect(query).not.toHaveBeenCalled();
  });

  it("returns null from setEnabled without querying when DB is disabled", async () => {
    database = { isEnabled: () => false, query };
    const service = new SeoCityConfigService(database as never, aggregates as never);

    await expect(service.setEnabled("noida", true, "reviewed")).resolves.toBeNull();

    expect(query).not.toHaveBeenCalled();
  });

  it("lists enabled city config rows without joining cities", async () => {
    query.mockResolvedValueOnce({ rows: [ENABLED_ROW] });
    const service = new SeoCityConfigService(database as never, aggregates as never);

    await expect(service.listEnabled()).resolves.toEqual([ENABLED_ROW]);

    const [sql, params] = query.mock.calls[0];
    expect(sql).toContain("FROM seo_city_config");
    expect(sql).toContain("programmatic_enabled = true");
    expect(sql).not.toMatch(/\bjoin\b/i);
    expect(params).toEqual([]);
  });

  it("lists every city with config defaults and refreshed count columns", async () => {
    const rows = [
      {
        ...ENABLED_ROW,
        name_en: "Lucknow",
        name_hi: "लखनऊ",
        is_active: true
      }
    ];
    query.mockResolvedValueOnce({ rows });
    const service = new SeoCityConfigService(database as never, aggregates as never);

    await expect(service.listAllWithCounts()).resolves.toEqual(rows);

    const [sql, params] = query.mock.calls[0];
    expect(sql).toContain("FROM cities");
    expect(sql).toContain("LEFT JOIN seo_city_config");
    expect(sql).toContain("COALESCE(scc.programmatic_enabled, false)");
    expect(sql).toContain("locality_count");
    expect(sql).toContain("landmark_count");
    expect(sql).toContain("metro_count");
    expect(sql).toContain("indexable_count");
    expect(params).toEqual([]);
  });

  it("computes indexable counts from locality listing counts and counts landmarks", async () => {
    query.mockResolvedValueOnce({ rows: [{ count: 4 }] });
    const service = new SeoCityConfigService(database as never, aggregates as never);

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
    const service = new SeoCityConfigService(database as never, aggregates as never);

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
    const service = new SeoCityConfigService(database as never, aggregates as never);

    await expect(service.setEnabled("does-not-exist", true, "x")).rejects.toBeInstanceOf(
      NotFoundException
    );
  });
});
