import { describe, expect, it, vi } from "vitest";
import { SearchService } from "../src/modules/search/search.service";

function makeSearchService(rows: Record<string, unknown>[] = []) {
  const calls: Array<{ sql: string; params: unknown[] }> = [];
  const database = {
    isEnabled: () => true,
    query: vi.fn(async (sql: string, params: unknown[]) => {
      calls.push({ sql, params });
      return { rows, rowCount: rows.length };
    })
  };

  const service = new SearchService(
    {} as never,
    database as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never
  );

  return { service, calls, database };
}

describe("SearchService.searchListingsForMap", () => {
  it("returns locality fields for map pins", async () => {
    const { service } = makeSearchService([
      {
        id: "11111111-1111-1111-1111-111111111111",
        lat: 26.86,
        lng: 80.94,
        title: "Gomti PG",
        monthly_rent: 12000,
        listing_type: "pg",
        bhk: null,
        verification_status: "verified",
        furnishing: "fully_furnished",
        cover_photo: null,
        city: "lucknow",
        locality: "Gomti Nagar",
        locality_slug: "gomti-nagar"
      }
    ]);

    const pins = await service.searchListingsForMap(
      { sw_lat: 26.7, sw_lng: 80.8, ne_lat: 26.95, ne_lng: 81.1 },
      20
    );

    expect(pins[0]).toMatchObject({
      city: "lucknow",
      locality: "Gomti Nagar",
      locality_slug: "gomti-nagar"
    });
  });

  it("applies near_metro to the SQL and params", async () => {
    const { service, calls } = makeSearchService();
    await service.searchListingsForMap(
      { sw_lat: 28.4, sw_lng: 76.84, ne_lat: 28.88, ne_lng: 77.35 },
      100,
      { near_metro: true, verified_only: true }
    );

    expect(calls[0].sql).toMatch(/EXISTS \(\s*SELECT 1 FROM metro_stations ms/);
    expect(calls[0].sql).toMatch(/LEFT JOIN localities loc/);
    expect(calls[0].params).toEqual([
      76.84,
      28.4,
      77.35,
      28.88,
      100,
      null,
      null,
      null,
      true,
      true
    ]);
  });
});
