import { describe, expect, it, vi } from "vitest";
import { SearchService } from "../src/modules/search/search.service";

function makeService(
  query: (sql: string, params?: unknown[]) => Promise<{ rows: any[]; rowCount: number }>
) {
  const database = {
    isEnabled: () => true,
    query: vi.fn(query)
  };
  const service = new SearchService(
    {} as any,
    database as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any
  );
  return { service, database };
}

describe("SearchService.getSearchPreview", () => {
  it("scopes duplicate locality slugs by city when city is provided", async () => {
    const calls: string[] = [];
    const params: unknown[][] = [];
    const { service } = makeService(async (sql: string, p: unknown[] = []) => {
      calls.push(sql);
      params.push(p);
      if (/FROM localities loc\s+JOIN cities c/.test(sql)) {
        return {
          rows: [{ id: 42, city_id: 7, slug: "sector-62", name_en: "Sector 62", city_slug: "noida" }],
          rowCount: 1
        };
      }
      if (/count\(DISTINCT l\.id\)::int AS listing_count/.test(sql)) {
        return {
          rows: [
            {
              listing_count: 0,
              min_rent: null,
              max_rent: null,
              verified_count: 0,
              avg_bhk: null
            }
          ],
          rowCount: 1
        };
      }
      return { rows: [], rowCount: 0 };
    });

    const out = await service.getSearchPreview("locality", "sector-62", "noida");

    expect(calls[0]).toMatch(/c\.slug = \$2/);
    expect(params[0]).toEqual(["sector-62", "noida"]);
    expect(calls[1]).toMatch(/ll\.city_id = \$2/);
    expect(params[1]).toEqual([42, 7, "Sector 62"]);
    expect(out).toMatchObject({
      type: "locality",
      slug: "sector-62",
      name: "Sector 62",
      city_slug: "noida",
      listing_count: 0,
      rent_band: null,
      verified_pct: null,
      avg_bhk: null
    });
  });
});
