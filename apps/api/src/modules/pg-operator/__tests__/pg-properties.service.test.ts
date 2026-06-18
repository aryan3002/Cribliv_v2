import { describe, it, expect, vi } from "vitest";
import { PgPropertiesService } from "../services/pg-properties.service";
import { DatabaseService } from "../../../common/database.service";
import { AppStateService } from "../../../common/app-state.service";

function makeDeps(opts: { dbEnabled?: boolean } = {}) {
  const db = {
    isEnabled: () => opts.dbEnabled ?? false,
    query: vi.fn()
  } as unknown as DatabaseService;
  const appState = new AppStateService();
  return { db, appState };
}

describe("PgPropertiesService", () => {
  describe("createProperty()", () => {
    it("creates the first property as is_primary=true (in-memory path)", async () => {
      const { db, appState } = makeDeps();
      const svc = new PgPropertiesService(db, appState);
      const p = await svc.createProperty("op-1", {
        display_name: "Hostel A",
        city_slug: "delhi",
        locality_slug: "saket"
      });
      expect(p.is_primary).toBe(true);
      expect(p.operator_id).toBe("op-1");
      expect(p.display_name).toBe("Hostel A");
    });

    it("1:1: allows creating multiple properties for the same operator (distinct ids)", async () => {
      const { db, appState } = makeDeps();
      const svc = new PgPropertiesService(db, appState);
      const a = await svc.createProperty("op-1", { display_name: "A", city_slug: "delhi" });
      const b = await svc.createProperty("op-1", { display_name: "B", city_slug: "delhi" });
      expect(a.id).not.toBe(b.id);
      expect((await svc.listProperties("op-1")).length).toBe(2);
    });

    it("rejects empty display_name", async () => {
      const { db, appState } = makeDeps();
      const svc = new PgPropertiesService(db, appState);
      await expect(
        svc.createProperty("op-1", { display_name: "   ", city_slug: "delhi" })
      ).rejects.toThrow(/missing_display_name|display_name/i);
    });
  });

  describe("listProperties()", () => {
    it("returns empty array when operator has no properties", async () => {
      const { db, appState } = makeDeps();
      const svc = new PgPropertiesService(db, appState);
      expect(await svc.listProperties("op-none")).toEqual([]);
    });

    it("returns all properties for an operator", async () => {
      const { db, appState } = makeDeps();
      const svc = new PgPropertiesService(db, appState);
      await svc.createProperty("op-1", { display_name: "A", city_slug: "delhi" });
      const all = await svc.listProperties("op-1");
      expect(all.length).toBe(1);
    });
  });

  describe("getActiveProperty()", () => {
    it("returns the primary property for V1", async () => {
      const { db, appState } = makeDeps();
      const svc = new PgPropertiesService(db, appState);
      const created = await svc.createProperty("op-1", { display_name: "A", city_slug: "delhi" });
      const active = await svc.getActiveProperty("op-1");
      expect(active?.id).toBe(created.id);
    });

    it("returns null when operator has no properties", async () => {
      const { db, appState } = makeDeps();
      const svc = new PgPropertiesService(db, appState);
      expect(await svc.getActiveProperty("op-none")).toBeNull();
    });
  });

  describe("getOwnedProperty()", () => {
    it("returns a property owned by the operator (in-memory path)", async () => {
      const { db, appState } = makeDeps();
      const svc = new PgPropertiesService(db, appState);
      const created = await svc.createProperty("op-1", { display_name: "A", city_slug: "delhi" });
      const got = await svc.getOwnedProperty("op-1", created.id);
      expect(got?.id).toBe(created.id);
    });

    it("returns null when the property belongs to a different operator (IDOR guard)", async () => {
      const { db, appState } = makeDeps();
      const svc = new PgPropertiesService(db, appState);
      const created = await svc.createProperty("op-1", { display_name: "A", city_slug: "delhi" });
      expect(await svc.getOwnedProperty("op-2", created.id)).toBeNull();
    });

    it("returns null for an unknown property id", async () => {
      const { db, appState } = makeDeps();
      const svc = new PgPropertiesService(db, appState);
      expect(await svc.getOwnedProperty("op-1", "does-not-exist")).toBeNull();
    });
  });
});
