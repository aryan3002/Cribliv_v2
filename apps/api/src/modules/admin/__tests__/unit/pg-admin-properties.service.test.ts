import { describe, it, expect, vi } from "vitest";
import { PgAdminPropertiesService } from "../../pg-admin-properties.service";
import type { DatabaseService } from "../../../../common/database.service";

function setup() {
  const query = vi.fn().mockResolvedValue({ rows: [], rowCount: 0 });
  const clientQuery = vi.fn().mockResolvedValue({ rows: [], rowCount: 0 });
  const release = vi.fn();
  const getClient = vi.fn(async () => ({ query: clientQuery, release }));
  const db = { isEnabled: () => true, query, getClient } as unknown as DatabaseService;
  return { svc: new PgAdminPropertiesService(db), query, clientQuery, getClient, release };
}

describe("PgAdminPropertiesService.updateProperty", () => {
  it("propagates locality + geo to listing_locations and listing coords in one transaction", async () => {
    const { svc, clientQuery, getClient, release } = setup();
    // before-state read inside the tx
    clientQuery.mockImplementation(async (sql: string) => {
      if (/SELECT .* FROM pg_properties WHERE id/i.test(sql)) {
        return {
          rows: [
            {
              id: "P1",
              display_name: "Old",
              status: "active",
              city_id: 1,
              locality_id: 2,
              lat: null,
              lng: null,
              internal_code: null,
              total_floors: null
            }
          ],
          rowCount: 1
        };
      }
      if (/SELECT id FROM cities/i.test(sql)) return { rows: [{ id: 7 }], rowCount: 1 };
      if (/SELECT id FROM localities/i.test(sql)) return { rows: [{ id: 9 }], rowCount: 1 };
      return { rows: [], rowCount: 1 };
    });
    await svc.updateProperty("admin-1", "P1", {
      city_slug: "pune",
      locality_slug: "kothrud",
      lat: 18.5,
      lng: 73.8
    });
    expect(getClient).toHaveBeenCalled();
    const sqls = clientQuery.mock.calls.map((c) => String(c[0]));
    expect(sqls.some((s) => /BEGIN/.test(s))).toBe(true);
    expect(sqls.some((s) => /UPDATE pg_properties/i.test(s))).toBe(true);
    expect(sqls.some((s) => /UPDATE listing_locations/i.test(s))).toBe(true);
    expect(sqls.some((s) => /COMMIT/.test(s))).toBe(true);
    expect(sqls.some((s) => /INSERT INTO admin_actions/i.test(s))).toBe(true);
    expect(release).toHaveBeenCalled();
  });

  it("non-locality edits do not touch listing_locations", async () => {
    const { svc, clientQuery } = setup();
    clientQuery.mockImplementation(async (sql: string) => {
      if (/SELECT .* FROM pg_properties WHERE id/i.test(sql)) {
        return {
          rows: [
            {
              id: "P1",
              display_name: "Old",
              status: "active",
              city_id: 1,
              locality_id: 2,
              lat: null,
              lng: null,
              internal_code: null,
              total_floors: null
            }
          ],
          rowCount: 1
        };
      }
      return { rows: [], rowCount: 1 };
    });
    await svc.updateProperty("admin-1", "P1", { display_name: "New Name" });
    const sqls = clientQuery.mock.calls.map((c) => String(c[0]));
    expect(sqls.some((s) => /UPDATE listing_locations/i.test(s))).toBe(false);
    expect(sqls.some((s) => /UPDATE pg_properties/i.test(s))).toBe(true);
  });
});
