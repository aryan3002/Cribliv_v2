import { describe, it, expect, vi } from "vitest";
import { SearchService } from "../src/modules/search/search.service";

/**
 * PG search reads the shared `listings` PROJECTION (listing_type='pg') and joins
 * the PG aggregate (pg_details / pg_room_types) for PG-only filters. This is the
 * read side of the split: maps/property search are untouched; PG gets its own
 * filters over the same projection. We assert the generated SQL carries them.
 */
function makeService() {
  const calls: string[] = [];
  const database = {
    isEnabled: () => true,
    query: vi.fn(async (sql: string) => {
      calls.push(sql);
      if (/count\(\*\)/i.test(sql)) return { rows: [{ total: 0 }], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    })
  };
  const noop = {} as any;
  const svc = new SearchService(noop, database as any, noop, noop, noop, noop);
  return { svc, calls };
}

describe("searchListings — PG filters (projection read)", () => {
  it("applies gender_policy, tenant_type, sharing and ac filters", async () => {
    const { svc, calls } = makeService();
    await svc.searchListings({
      listing_type: "pg",
      gender_policy: "girls",
      tenant_type: "students",
      sharing: "double",
      ac: "true"
    });
    const sql = calls.join("\n");
    expect(sql).toMatch(/gender_policy/);
    expect(sql).toMatch(/tenant_type/);
    // sharing + ac filter the normalized pricing matrix via EXISTS
    expect(sql).toMatch(/pg_room_types/);
    expect(sql).toMatch(/rt\.sharing/);
    expect(sql).toMatch(/rt\.ac = true/);
  });

  it("does not add PG clauses when none are passed", async () => {
    const { svc, calls } = makeService();
    await svc.searchListings({ listing_type: "pg", city: "delhi" });
    const sql = calls.join("\n");
    expect(sql).not.toMatch(/gender_policy/);
    expect(sql).not.toMatch(/rt\.sharing/);
  });
});
