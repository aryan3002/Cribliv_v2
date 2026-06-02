import { describe, it, expect, vi } from "vitest";
import { PgPropertiesService } from "../src/modules/pg-operator/services/pg-properties.service";

function dbStub() {
  const calls: Array<{ sql: string; params: unknown[] }> = [];
  return {
    calls,
    isEnabled: () => true,
    query: vi.fn(async (sql: string, params: unknown[]) => {
      calls.push({ sql, params });
      if (/FROM cities/i.test(sql)) return { rows: [{ id: 5 }], rowCount: 1 };
      if (/FROM localities/i.test(sql)) return { rows: [{ id: 9 }], rowCount: 1 };
      if (/FROM pg_properties/i.test(sql)) return { rows: [], rowCount: 0 };
      return { rows: [{ id: "11111111-1111-1111-1111-111111111111" }], rowCount: 1 };
    })
  } as any;
}

function stateStub() {
  return {
    pgPropertiesByOperator: () => [],
    insertPgProperty: vi.fn()
  } as any;
}

describe("PgPropertiesService.createProperty geo", () => {
  it("threads lat/lng into the pg_properties insert", async () => {
    const db = dbStub();
    const svc = new PgPropertiesService(db, stateStub());
    const prop = await svc.createProperty("op-1", {
      display_name: "Sunrise PG",
      city_slug: "lucknow",
      lat: 26.8467,
      lng: 80.9462
    } as any);
    expect(prop.lat).toBe(26.8467);
    expect(prop.lng).toBe(80.9462);
    const insert = db.calls.find((c: any) => /INSERT INTO pg_properties/i.test(c.sql));
    expect(insert).toBeTruthy();
    expect(insert!.params).toContain(26.8467);
    expect(insert!.params).toContain(80.9462);
  });
});
