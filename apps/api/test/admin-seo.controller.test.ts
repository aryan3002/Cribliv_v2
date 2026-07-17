import "reflect-metadata";
import type { INestApplication } from "@nestjs/common";
import { NotFoundException } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuthGuard } from "../src/common/auth.guard";
import { DatabaseService } from "../src/common/database.service";
import { deterministicUuidV5 } from "../src/common/deterministic-uuid";
import { RolesGuard } from "../src/common/roles.guard";
import type { Role } from "../src/common/types";
import { AdminSeoController } from "../src/modules/admin/admin-seo.controller";
import { SeoAggregatesService } from "../src/modules/seo/seo-aggregates.service";
import { SeoCopyService } from "../src/modules/seo/seo-copy.service";
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
  let aggregates: {
    localitiesForCity: ReturnType<typeof vi.fn>;
    aggregatesForLocality: ReturnType<typeof vi.fn>;
    findLocality: ReturnType<typeof vi.fn>;
  };
  let copy: {
    getProvenance: ReturnType<typeof vi.fn>;
    generateAndCache: ReturnType<typeof vi.fn>;
    getOrGenerate: ReturnType<typeof vi.fn>;
    upsertOverride: ReturnType<typeof vi.fn>;
    deleteOverride: ReturnType<typeof vi.fn>;
    hasFreshCopy: ReturnType<typeof vi.fn>;
    deleteCopy: ReturnType<typeof vi.fn>;
  };
  let consoleLog: ReturnType<typeof vi.spyOn>;

  const SAMPLE_COPY = {
    h1: "AI H1",
    meta_title: "MT",
    meta_description: "MD",
    intro_paragraph: "intro",
    nearby_blurb: null,
    faq_items: []
  };

  beforeEach(async () => {
    currentUser = { id: ADMIN_ID, role: "admin" };
    cityConfig = {
      listAllWithCounts: vi.fn(async () => ALL),
      setEnabled: vi.fn(async () => UPDATED)
    };
    database = {
      query: vi.fn(async () => ({ rows: [], rowCount: 1 }))
    };
    aggregates = {
      localitiesForCity: vi.fn(async () => []),
      aggregatesForLocality: vi.fn(async () => ({
        listing_count: 5,
        pg_count: 2,
        flat_count: 3,
        median_rent_pg: null,
        median_rent_1bhk: null,
        median_rent_2bhk: null,
        median_rent_3bhk: null
      })),
      findLocality: vi.fn(async () => ({
        id: 1,
        slug: "gomti-nagar",
        name_en: "Gomti Nagar",
        name_hi: "गोमती नगर",
        lat: null,
        lng: null,
        parent_locality_slug: null,
        listing_count: 5
      }))
    };
    copy = {
      getProvenance: vi.fn(async () => "template"),
      generateAndCache: vi.fn(async () => SAMPLE_COPY),
      getOrGenerate: vi.fn(async () => SAMPLE_COPY),
      upsertOverride: vi.fn(async () => undefined),
      deleteOverride: vi.fn(async () => undefined),
      hasFreshCopy: vi.fn(async () => false),
      deleteCopy: vi.fn(async () => undefined)
    };
    consoleLog = vi.spyOn(console, "log").mockImplementation(() => undefined);

    const moduleRef = await Test.createTestingModule({
      controllers: [AdminSeoController],
      providers: [
        RolesGuard,
        { provide: SeoCityConfigService, useValue: cityConfig },
        { provide: DatabaseService, useValue: database },
        { provide: SeoAggregatesService, useValue: aggregates },
        { provide: SeoCopyService, useValue: copy }
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

  it("returns 404 when the city does not exist", async () => {
    cityConfig.setEnabled = vi.fn(async () => {
      throw new NotFoundException({ code: "city_not_found", message: "Unknown city: nope" });
    });

    await request(app.getHttpServer())
      .patch("/admin/seo/cities/nope")
      .send({ programmatic_enabled: true })
      .expect(404);

    expect(database.query).not.toHaveBeenCalled();
  });

  describe("GET copy-status", () => {
    it("returns per-locale provenance for every locality in the city", async () => {
      aggregates.localitiesForCity = vi.fn(async () => [
        { slug: "gomti-nagar", name_en: "Gomti Nagar", name_hi: "गोमती नगर", listing_count: 6 },
        { slug: "hazratganj", name_en: "Hazratganj", name_hi: "हज़रतगंज", listing_count: 4 }
      ]);
      copy.getProvenance = vi.fn(async (path: string, locale: string) => {
        if (path.endsWith("gomti-nagar")) return locale === "en" ? "override" : "ai";
        return "template";
      });

      const res = await request(app.getHttpServer())
        .get("/admin/seo/copy-status?citySlug=lucknow")
        .expect(200);

      expect(res.body.data.items).toEqual([
        { slug: "gomti-nagar", en: "override", hi: "ai" },
        { slug: "hazratganj", en: "template", hi: "template" }
      ]);
      expect(aggregates.localitiesForCity).toHaveBeenCalledWith("lucknow");
    });

    it("400s without citySlug", async () => {
      await request(app.getHttpServer()).get("/admin/seo/copy-status").expect(400);
    });

    it("forbids tenants", async () => {
      currentUser = { id: "t", role: "tenant" };
      await request(app.getHttpServer()).get("/admin/seo/copy-status?citySlug=lucknow").expect(403);
    });
  });

  describe("POST copy/generate-one", () => {
    it("regenerates both locales for a locality and audits the action", async () => {
      const res = await request(app.getHttpServer())
        .post("/admin/seo/copy/generate-one")
        .send({ citySlug: "lucknow", localitySlug: "gomti-nagar" })
        .expect(200);

      expect(copy.generateAndCache).toHaveBeenCalledTimes(2);
      const firstInputs = copy.generateAndCache.mock.calls[0][0];
      expect(firstInputs.pagePath).toBe("/city/lucknow/gomti-nagar");
      expect(firstInputs.placeName).toEqual({ en: "Gomti Nagar", hi: "गोमती नगर" });
      expect(firstInputs.placeKind).toBe("locality");
      expect(firstInputs.aggregates.parent_locality).toBeNull();
      expect(res.body.data.en).toBeTruthy();
      expect(res.body.data.hi).toBeTruthy();

      const audit = database.query.mock.calls.find(([sql]: [string]) =>
        /INSERT INTO admin_actions/.test(sql)
      );
      expect(audit).toBeTruthy();
      expect(audit[0]).toContain("'seo_copy'::admin_target_type");
      expect(audit[1][2]).toBe("seo_copy_generate");
    });

    it("400s without slugs", async () => {
      await request(app.getHttpServer())
        .post("/admin/seo/copy/generate-one")
        .send({ citySlug: "lucknow" })
        .expect(400);
      expect(copy.generateAndCache).not.toHaveBeenCalled();
    });

    it("404s when the locality is unknown", async () => {
      aggregates.findLocality = vi.fn(async () => null);
      await request(app.getHttpServer())
        .post("/admin/seo/copy/generate-one")
        .send({ citySlug: "lucknow", localitySlug: "nope" })
        .expect(404);
      expect(copy.generateAndCache).not.toHaveBeenCalled();
    });
  });

  describe("PUT copy/override", () => {
    const validBody = {
      citySlug: "lucknow",
      localitySlug: "gomti-nagar",
      locale: "en",
      copy: {
        h1: "Custom H1",
        meta_title: "Custom",
        meta_description: "Custom desc",
        intro_paragraph: "custom intro",
        nearby_blurb: "around",
        faq_items: [{ q: "Q", a: "A" }]
      },
      notes: "manual"
    };

    it("upserts an override and audits it", async () => {
      await request(app.getHttpServer())
        .put("/admin/seo/copy/override")
        .send(validBody)
        .expect(200);

      expect(copy.upsertOverride).toHaveBeenCalledWith(
        "/city/lucknow/gomti-nagar",
        "en",
        validBody.copy,
        "manual"
      );
      const audit = database.query.mock.calls.find(([sql]: [string]) =>
        /INSERT INTO admin_actions/.test(sql)
      );
      expect(audit[1][2]).toBe("seo_copy_override");
    });

    it("400s on invalid locale", async () => {
      await request(app.getHttpServer())
        .put("/admin/seo/copy/override")
        .send({ ...validBody, locale: "fr" })
        .expect(400);
      expect(copy.upsertOverride).not.toHaveBeenCalled();
    });

    it("400s when faq_items exceeds 6", async () => {
      const tooMany = Array.from({ length: 7 }, (_, i) => ({ q: `q${i}`, a: `a${i}` }));
      await request(app.getHttpServer())
        .put("/admin/seo/copy/override")
        .send({ ...validBody, copy: { ...validBody.copy, faq_items: tooMany } })
        .expect(400);
      expect(copy.upsertOverride).not.toHaveBeenCalled();
    });
  });

  describe("DELETE copy/override", () => {
    it("deletes the override for the given path + locale", async () => {
      await request(app.getHttpServer())
        .delete("/admin/seo/copy/override?path=/city/lucknow/gomti-nagar&locale=en")
        .expect(200);
      expect(copy.deleteOverride).toHaveBeenCalledWith("/city/lucknow/gomti-nagar", "en");
    });

    it("400s without a path", async () => {
      await request(app.getHttpServer()).delete("/admin/seo/copy/override?locale=en").expect(400);
      expect(copy.deleteOverride).not.toHaveBeenCalled();
    });
  });

  describe("POST copy/generate-batch (city)", () => {
    it("generates missing copy for localities with >= 3 listings and returns counts", async () => {
      aggregates.localitiesForCity = vi.fn(async () => [
        { slug: "a", name_en: "A", name_hi: "A", parent_locality_slug: null, listing_count: 6 },
        { slug: "b", name_en: "B", name_hi: "B", parent_locality_slug: null, listing_count: 4 },
        { slug: "c", name_en: "C", name_hi: "C", parent_locality_slug: null, listing_count: 2 }
      ]);

      const res = await request(app.getHttpServer())
        .post("/admin/seo/copy/generate-batch")
        .send({ citySlug: "lucknow" })
        .expect(200);

      // a + b => 2 localities x 2 locales = 4 generations; c is thin (breaks scan)
      expect(res.body.data.generated).toBe(4);
      expect(copy.getOrGenerate).toHaveBeenCalledTimes(4);
    });

    it("400s without citySlug", async () => {
      await request(app.getHttpServer())
        .post("/admin/seo/copy/generate-batch")
        .send({})
        .expect(400);
    });
  });
});
