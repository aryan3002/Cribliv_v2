import { describe, it, expect, vi } from "vitest";
import { PgSearchService } from "../src/modules/pg-operator/services/pg-search.service";

function makeService(rows: Record<string, unknown>[] = []) {
  const calls: string[] = [];
  const params: unknown[][] = [];
  const database = {
    isEnabled: () => true,
    query: vi.fn(async (sql: string, p: unknown[]) => {
      calls.push(sql);
      params.push(p);
      if (/count\(\*\)/i.test(sql)) return { rows: [{ total: rows.length }], rowCount: 1 };
      return { rows, rowCount: rows.length };
    })
  };
  const svc = new PgSearchService(database as never);
  return { svc, calls, params, database };
}

describe("PgSearchService.search", () => {
  it("constrains to active PG listings over the projection + pg aggregate", async () => {
    const { svc, calls } = makeService();
    await svc.search({});
    const sql = calls.join("\n");
    expect(sql).toMatch(/l\.listing_type = 'pg'/);
    expect(sql).toMatch(/l\.status = 'active'/);
    expect(sql).toMatch(/JOIN pg_details pgd/);
  });

  it("selects PG card columns: sharing_options, gender_policy, food_included", async () => {
    const { svc, calls } = makeService();
    await svc.search({});
    const sql = calls.join("\n");
    expect(sql).toMatch(/array_agg\(DISTINCT rt\.sharing/);
    expect(sql).toMatch(/pgd\.gender_policy/);
    expect(sql).toMatch(/pgd\.food_included/);
  });

  it("applies gender, tenant_type, food, sharing and ac filters", async () => {
    const { svc, calls } = makeService();
    await svc.search({
      gender_policy: "girls",
      tenant_type: "students",
      food_included: "true",
      sharing: "double",
      ac: "true"
    });
    const sql = calls.join("\n");
    expect(sql).toMatch(/pgd\.gender_policy = \$/);
    expect(sql).toMatch(/pgd\.tenant_type = \$/);
    expect(sql).toMatch(/pgd\.food_included = true/);
    expect(sql).toMatch(/rt\.sharing = \$/);
    expect(sql).toMatch(/rt\.ac = true/);
  });

  it("matches city/locality (not just title) for free-text q", async () => {
    const { svc, calls } = makeService();
    await svc.search({ q: "lucknow" });
    const sql = calls.join("\n");
    expect(sql).toMatch(/l\.title_en ILIKE/);
    expect(sql).toMatch(/c\.name_en ILIKE/);
    expect(sql).toMatch(/loc\.name_en ILIKE/);
  });

  it("sorts by rent ascending when sort=rent", async () => {
    const { svc, calls } = makeService();
    await svc.search({ sort: "rent" });
    expect(calls.join("\n")).toMatch(/ORDER BY l\.monthly_rent ASC/);
  });

  it("maps a row into a PgCard with verified flag and sharing options", async () => {
    const { svc } = makeService([
      {
        id: "11111111-1111-1111-1111-111111111111",
        title: "Sunrise PG",
        city: "lucknow",
        city_name: "Lucknow",
        locality: "Gomti Nagar",
        starting_rent: 7000,
        verification_status: "verified",
        gender_policy: "girls",
        food_included: true,
        sharing_options: ["single", "double"],
        cover_photo: "https://cdn/x.jpg"
      }
    ]);
    const out = await svc.search({});
    expect(out.total).toBe(1);
    expect(out.items[0]).toMatchObject({
      id: "11111111-1111-1111-1111-111111111111",
      listing_type: "pg",
      starting_rent: 7000,
      sharing_options: ["single", "double"],
      gender_policy: "girls",
      food_included: true,
      verified: true,
      cover_photo: "https://cdn/x.jpg"
    });
  });

  it("suggest is scoped to PG and returns city + listing rows with city_slug", async () => {
    const calls: string[] = [];
    const database = {
      isEnabled: () => true,
      query: vi.fn(async (sql: string) => {
        calls.push(sql);
        if (/FROM cities c/.test(sql)) {
          return {
            rows: [
              {
                slug: "lucknow",
                name_en: "Lucknow",
                listing_count: 2,
                min_rent: 2000,
                max_rent: 7000
              }
            ],
            rowCount: 1
          };
        }
        if (/FROM localities loc/.test(sql)) return { rows: [], rowCount: 0 };
        return {
          rows: [
            {
              id: "abc",
              title: "Joginder PG",
              city: "lucknow",
              locality: "Gomti Nagar",
              monthly_rent: 2121,
              verification_status: "verified",
              cover_path: null,
              created_at: "2026-01-01"
            }
          ],
          rowCount: 1
        };
      })
    };
    const svc = new PgSearchService(database as never);
    const rows = await svc.suggest("lucknow");
    const sql = calls.join("\n");
    expect(sql).toMatch(/l\.listing_type = 'pg'/);
    expect(rows.find((r) => r.type === "city")?.value).toBe("lucknow");
    const listing = rows.find((r) => r.type === "listing");
    expect(listing?.value).toBe("abc");
    expect(listing?.city_slug).toBe("lucknow");
    expect(listing?.verified).toBe(true);
  });

  it("suggest includes seeded city localities when the term matches city slug", async () => {
    const calls: string[] = [];
    const database = {
      isEnabled: () => true,
      query: vi.fn(async (sql: string) => {
        calls.push(sql);
        if (/FROM cities c/.test(sql)) {
          return {
            rows: [
              {
                slug: "noida",
                name_en: "Noida",
                listing_count: 0,
                min_rent: null,
                max_rent: null
              }
            ],
            rowCount: 1
          };
        }
        if (/FROM localities loc/.test(sql)) {
          const hasCityMatchPredicate =
            /c\.slug ILIKE '%' \|\| \$1 \|\| '%'/i.test(sql) &&
            /c\.name_en ILIKE '%' \|\| \$1 \|\| '%'/i.test(sql);
          if (!hasCityMatchPredicate) return { rows: [], rowCount: 0 };
          return {
            rows: [
              {
                slug: "sector-62",
                name_en: "Sector 62",
                city_slug: "noida",
                listing_count: 0,
                min_rent: null,
                max_rent: null
              }
            ],
            rowCount: 1
          };
        }
        return { rows: [], rowCount: 0 };
      })
    };
    const svc = new PgSearchService(database as never);

    const rows = await svc.suggest("noi", 6);
    const citySql = calls.find((sql) => /FROM cities c/.test(sql)) ?? "";
    const localitySql = calls.find((sql) => /FROM localities loc/.test(sql)) ?? "";

    expect(citySql).toMatch(/LEFT JOIN LATERAL/);
    expect(citySql).not.toMatch(/stats\.listing_count > 0/);
    expect(localitySql).toMatch(/LEFT JOIN LATERAL/);
    expect(localitySql).not.toMatch(/stats\.listing_count > 0/);
    expect(localitySql).toMatch(/c\.slug ILIKE '%' \|\| \$1 \|\| '%'/);
    expect(localitySql).toMatch(/c\.name_en ILIKE '%' \|\| \$1 \|\| '%'/);
    expect(rows).toEqual([
      { type: "city", label: "Noida", value: "noida", listing_count: 0 },
      {
        type: "locality",
        label: "Sector 62, noida",
        value: "sector-62",
        city_slug: "noida",
        listing_count: 0
      }
    ]);
  });

  it("suggest returns [] for short terms", async () => {
    const svc = new PgSearchService({ isEnabled: () => true, query: vi.fn() } as never);
    expect(await svc.suggest("a")).toEqual([]);
  });

  it("preview is PG-scoped and returns count, rent band, verified %, and sharing", async () => {
    const calls: string[] = [];
    const database = {
      isEnabled: () => true,
      query: vi.fn(async (sql: string) => {
        calls.push(sql);
        if (/FROM cities WHERE slug/.test(sql))
          return { rows: [{ name_en: "Lucknow" }], rowCount: 1 };
        if (/count\(\*\)::int AS listing_count/.test(sql)) {
          return {
            rows: [
              {
                listing_count: 4,
                min_rent: 2121,
                max_rent: 17171,
                verified_count: 4,
                sharing: ["double", "single"]
              }
            ],
            rowCount: 1
          };
        }
        return { rows: [{ blob_path: "covers/a.jpg" }], rowCount: 1 };
      })
    };
    const svc = new PgSearchService(database as never);
    const out = await svc.preview("city", "lucknow");
    const sql = calls.join("\n");
    expect(sql).toMatch(/l\.listing_type = 'pg'/);
    expect(sql).toMatch(/rt\.sharing/);
    expect(out).toMatchObject({
      type: "city",
      slug: "lucknow",
      name: "Lucknow",
      listing_count: 4,
      rent_band: { min: 2121, max: 17171 },
      verified_pct: 100,
      avg_bhk: null,
      sharing: ["double", "single"]
    });
  });

  it("preview scopes duplicate PG locality slugs by city when city is provided", async () => {
    const calls: string[] = [];
    const params: unknown[][] = [];
    const database = {
      isEnabled: () => true,
      query: vi.fn(async (sql: string, p: unknown[] = []) => {
        calls.push(sql);
        params.push(p);
        if (/FROM localities loc JOIN cities c/.test(sql)) {
          return {
            rows: [{ id: 42, name_en: "Sector 62", city_slug: "noida" }],
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
                sharing: null
              }
            ],
            rowCount: 1
          };
        }
        return { rows: [], rowCount: 0 };
      })
    };
    const svc = new PgSearchService(database as never);

    const out = await svc.preview("locality", "sector-62", "noida");

    expect(calls[0]).toMatch(/c\.slug = \$2/);
    expect(params[0]).toEqual(["sector-62", "noida"]);
    expect(calls[1]).toMatch(/ll\.locality_id = \$1/);
    expect(params[1]).toEqual([42]);
    expect(out).toMatchObject({
      type: "locality",
      slug: "sector-62",
      name: "Sector 62",
      city_slug: "noida",
      listing_count: 0,
      rent_band: null,
      verified_pct: null,
      avg_bhk: null,
      sharing: []
    });
  });

  it("preview returns null for an unknown city", async () => {
    const database = {
      isEnabled: () => true,
      query: vi.fn(async () => ({ rows: [], rowCount: 0 }))
    };
    const svc = new PgSearchService(database as never);
    expect(await svc.preview("city", "nowhere")).toBeNull();
  });

  it("returns empty when the database is disabled", async () => {
    const database = { isEnabled: () => false, query: vi.fn() };
    const svc = new PgSearchService(database as never);
    const out = await svc.search({ page: "2", page_size: "10" });
    expect(out).toEqual({ items: [], total: 0, page: 2, page_size: 10 });
    expect(database.query).not.toHaveBeenCalled();
  });
});
