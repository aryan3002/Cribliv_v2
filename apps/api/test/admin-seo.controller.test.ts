import "reflect-metadata";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuthGuard } from "../src/common/auth.guard";
import { DatabaseService } from "../src/common/database.service";
import { deterministicUuidV5 } from "../src/common/deterministic-uuid";
import { RolesGuard } from "../src/common/roles.guard";
import type { Role } from "../src/common/types";
import { AdminSeoController } from "../src/modules/admin/admin-seo.controller";
import {
  type SeoCityConfigRow,
  type SeoCityConfigWithCity,
  SeoCityConfigService
} from "../src/modules/seo/seo-city-config.service";

const ADMIN_ID = "00000000-0000-4000-8000-000000000001";

const ALL: SeoCityConfigWithCity[] = [
  {
    city_slug: "lucknow",
    name_en: "Lucknow",
    name_hi: "लखनऊ",
    is_active: true,
    programmatic_enabled: true,
    locality_count: 26,
    landmark_count: 12,
    metro_count: 21,
    indexable_count: 18,
    enabled_at: "2026-07-03T00:00:00.000Z",
    notes: "reference city",
    created_at: "2026-07-03T00:00:00.000Z",
    updated_at: "2026-07-03T00:00:00.000Z"
  },
  {
    city_slug: "noida",
    name_en: "Noida",
    name_hi: "नोएडा",
    is_active: true,
    programmatic_enabled: false,
    locality_count: 0,
    landmark_count: 0,
    metro_count: 0,
    indexable_count: 0,
    enabled_at: null,
    notes: null,
    created_at: null,
    updated_at: null
  }
];

const UPDATED: SeoCityConfigRow = {
  city_slug: "noida",
  programmatic_enabled: true,
  locality_count: 28,
  landmark_count: 14,
  metro_count: 8,
  indexable_count: 16,
  enabled_at: "2026-07-03T12:00:00.000Z",
  notes: "reviewed",
  created_at: "2026-07-03T00:00:00.000Z",
  updated_at: "2026-07-03T12:00:00.000Z"
};

describe("AdminSeoController", () => {
  let app: INestApplication;
  let currentUser: { id: string; role: Role };
  let cityConfig: {
    listAllWithCounts: ReturnType<typeof vi.fn>;
    setEnabled: ReturnType<typeof vi.fn>;
  };
  let database: { query: ReturnType<typeof vi.fn> };
  let consoleLog: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    currentUser = { id: ADMIN_ID, role: "admin" };
    cityConfig = {
      listAllWithCounts: vi.fn(async () => ALL),
      setEnabled: vi.fn(async () => UPDATED)
    };
    database = {
      query: vi.fn(async () => ({ rows: [], rowCount: 1 }))
    };
    consoleLog = vi.spyOn(console, "log").mockImplementation(() => undefined);

    const moduleRef = await Test.createTestingModule({
      controllers: [AdminSeoController],
      providers: [
        RolesGuard,
        { provide: SeoCityConfigService, useValue: cityConfig },
        { provide: DatabaseService, useValue: database }
      ]
    })
      .overrideGuard(AuthGuard)
      .useValue({
        canActivate: (ctx: { switchToHttp: () => { getRequest: () => { user: unknown } } }) => {
          ctx.switchToHttp().getRequest().user = currentUser;
          return true;
        }
      })
      .compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterEach(async () => {
    consoleLog.mockRestore();
    await app?.close();
  });

  it("forbids tenants", async () => {
    currentUser = { id: "tenant-1", role: "tenant" };

    await request(app.getHttpServer()).get("/admin/seo/cities").expect(403);
  });

  it("lists all city configs for admins", async () => {
    await request(app.getHttpServer())
      .get("/admin/seo/cities")
      .expect(200)
      .expect({ data: { items: ALL } });

    expect(cityConfig.listAllWithCounts).toHaveBeenCalledTimes(1);
  });

  it("toggles a city and writes an audited admin action", async () => {
    await request(app.getHttpServer())
      .patch("/admin/seo/cities/noida")
      .send({ programmatic_enabled: true, notes: "reviewed" })
      .expect(200)
      .expect({ data: UPDATED });

    expect(cityConfig.setEnabled).toHaveBeenCalledWith("noida", true, "reviewed");
    expect(database.query).toHaveBeenCalledTimes(1);

    const [sql, params] = database.query.mock.calls[0];
    expect(sql).toContain("INSERT INTO admin_actions");
    expect(sql).toContain("'seo_city'::admin_target_type");
    expect(sql).toContain("'toggle_seo_city'::admin_action_type");
    expect(params).toEqual([
      ADMIN_ID,
      deterministicUuidV5("noida"),
      "reviewed",
      JSON.stringify(UPDATED)
    ]);
  });

  it("rejects a non-boolean programmatic_enabled payload", async () => {
    await request(app.getHttpServer())
      .patch("/admin/seo/cities/noida")
      .send({ programmatic_enabled: "true" })
      .expect(400);

    expect(cityConfig.setEnabled).not.toHaveBeenCalled();
    expect(database.query).not.toHaveBeenCalled();
  });
});
