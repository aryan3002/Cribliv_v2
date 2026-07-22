import { describe, it, expect, vi } from "vitest";
import { PgAdminPropertiesService } from "../../pg-admin-properties.service";
import type { PgAdminListingsParams } from "@cribliv/shared-types";

const PARAMS: PgAdminListingsParams = {
  verification: "verified",
  status: "active",
  sort: "leads",
  page: 1,
  page_size: 25
};

function makeService(rows: { list: any[]; cities: any[]; summary: any }) {
  const query = vi.fn(async (sql: string) => {
    if (/count\(\*\) OVER/i.test(sql)) return { rows: rows.list, rowCount: rows.list.length };
    if (/GROUP BY c\.slug/i.test(sql)) return { rows: rows.cities, rowCount: rows.cities.length };
    return { rows: [rows.summary], rowCount: 1 };
  });
  const db = { isEnabled: () => true, query } as any;
  return { service: new PgAdminPropertiesService(db), query };
}

const BASE_ROW = {
  listing_id: "11111111-1111-1111-1111-111111111111",
  title: "Green Nest PG",
  status: "active",
  pg_property_id: "p1",
  property_name: "Green Nest",
  city_slug: "lucknow",
  locality_slug: "gomti-nagar",
  owner_id: "o1",
  owner_name: "Asha",
  owner_phone_masked: "+9199***901",
  leads_7d: 4,
  analytics_cut: false,
  verification_status: "verified",
  cover_blob: "pg/cover1.jpg",
  starting_rent_paise: "700000", // pg driver returns bigint as string
  gender_policy: "girls",
  updated_at: "2026-07-10 00:00:00+00",
  total: 1
};

describe("PgAdminPropertiesService.listListings", () => {
  it("returns an empty envelope when the DB is disabled", async () => {
    const db = { isEnabled: () => false, query: vi.fn() } as any;
    const res = await new PgAdminPropertiesService(db).listListings(PARAMS);
    expect(res.items).toEqual([]);
    expect(res.total).toBe(0);
    expect(res.available_cities).toEqual([]);
    expect(res.summary).toEqual({ verified: 0, active: 0, cities: 0 });
    expect(res.filters.verification).toBe("verified");
    expect(db.query).not.toHaveBeenCalled();
  });

  it("maps rows: bigint rent -> number, cover -> url, city -> public_path", async () => {
    const { service } = makeService({
      list: [BASE_ROW],
      cities: [{ slug: "lucknow", name: "Lucknow", count: 1 }],
      summary: { verified: 1, active: 1, cities: 1 }
    });
    const res = await service.listListings(PARAMS);

    expect(res.total).toBe(1);
    const item = res.items[0];
    expect(item.starting_rent_paise).toBe(700000);
    expect(typeof item.starting_rent_paise).toBe("number");
    expect(item.gender_policy).toBe("girls");
    expect(item.public_path).toBe("/en/pg/lucknow/11111111-1111-1111-1111-111111111111");
    expect(item.cover_photo_url).not.toBeNull();
    expect((item as any).cover_blob).toBeUndefined(); // raw blob path not leaked
    expect((item as any).total).toBeUndefined(); // window-count not leaked
    expect(res.available_cities).toEqual([{ slug: "lucknow", name: "Lucknow", count: 1 }]);
    expect(res.summary).toEqual({ verified: 1, active: 1, cities: 1 });
  });

  it("nulls public_path when the listing has no city slug", async () => {
    const { service } = makeService({
      list: [{ ...BASE_ROW, city_slug: null, cover_blob: null }],
      cities: [],
      summary: { verified: 1, active: 0, cities: 0 }
    });
    const res = await service.listListings(PARAMS);
    expect(res.items[0].public_path).toBeNull();
    expect(res.items[0].cover_photo_url).toBeNull();
  });

  it("nulls public_path for a non-active listing (shareability = active + city)", async () => {
    const { service } = makeService({
      list: [{ ...BASE_ROW, status: "draft" }],
      cities: [],
      summary: { verified: 0, active: 0, cities: 0 }
    });
    const res = await service.listListings({ ...PARAMS, status: "draft" });
    expect(res.items[0].public_path).toBeNull();
  });

  it("reads verification from the listings projection, not the pg head (D1)", async () => {
    const { service, query } = makeService({
      list: [BASE_ROW],
      cities: [],
      summary: { verified: 1, active: 1, cities: 1 }
    });
    await service.listListings(PARAMS);
    const pageSql = String(query.mock.calls[0][0]);
    expect(pageSql).toMatch(/LEFT JOIN listings l ON l\.id = pl\.id/i);
    expect(pageSql).toMatch(/COALESCE\(l\.verification_status::text/i);
  });

  it("never SELECTs a raw phone column", async () => {
    const { service, query } = makeService({
      list: [BASE_ROW],
      cities: [],
      summary: { verified: 1, active: 1, cities: 1 }
    });
    await service.listListings(PARAMS);
    const pageSql = String(query.mock.calls[0][0]);
    const selectClause = pageSql.slice(0, pageSql.search(/\bFROM\b/i));
    expect(selectClause).not.toMatch(/AS\s+owner_phone\b/i);
    expect(selectClause).toMatch(/owner_phone_masked/i);
  });

  it("parameterizes sort — ORDER BY never contains raw input", async () => {
    const { service, query } = makeService({
      list: [BASE_ROW],
      cities: [],
      summary: { verified: 1, active: 1, cities: 1 }
    });
    await service.listListings({ ...PARAMS, sort: "rent_desc" as any });
    const pageSql = String(query.mock.calls[0][0]);
    expect(pageSql).toMatch(/ORDER BY pl\.starting_rent_paise DESC NULLS LAST/i);
  });
});
