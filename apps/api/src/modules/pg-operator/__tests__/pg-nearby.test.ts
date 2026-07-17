import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DatabaseService } from "../../../common/database.service";
import { PgNearbyService } from "../services/pg-nearby.service";

const suite = process.env.DATABASE_URL ? describe : describe.skip;

suite("PgNearbyService.nearby", () => {
  let database: DatabaseService;
  let service: PgNearbyService;

  beforeAll(() => {
    database = new DatabaseService();
    service = new PgNearbyService(database);
  });

  afterAll(async () => {
    await database.onModuleDestroy();
  });

  it("returns seeded college or office near Gomti Nagar", async () => {
    const result = await service.nearby(26.8467, 80.9462, 5);

    expect(Array.isArray(result.college)).toBe(true);
    expect(result.college.length + result.office.length).toBeGreaterThan(0);
  });

  it("is empty and safe when DB is disabled", async () => {
    const disabled = new PgNearbyService({ isEnabled: () => false } as any);

    await expect(disabled.nearby(26.8, 80.9)).resolves.toEqual({
      metro: [],
      college: [],
      office: []
    });
  });
});
