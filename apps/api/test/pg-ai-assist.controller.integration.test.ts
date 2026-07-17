import "reflect-metadata";
import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { Module, Injectable } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { INestApplication } from "@nestjs/common";
import request from "supertest";
import { PgListingController } from "../src/modules/pg-operator/pg-listing.controller";
import { PgListingService } from "../src/modules/pg-operator/services/pg-listing.service";
import { PgPropertiesService } from "../src/modules/pg-operator/services/pg-properties.service";
import { PgDraftService } from "../src/modules/pg-operator/services/pg-draft.service";
import { PgNearbyService } from "../src/modules/pg-operator/services/pg-nearby.service";
import { PgAiAssistService } from "../src/modules/pg-operator/services/pg-ai-assist.service";
import { DatabaseService } from "../src/common/database.service";
import { AppStateService } from "../src/common/app-state.service";
import { AuthGuard } from "../src/common/auth.guard";
import { RolesGuard } from "../src/common/roles.guard";

const fakeDb = { isEnabled: () => false, query: async () => ({ rows: [], rowCount: 0 }) };
const allowAll = {
  canActivate: (ctx: any) => {
    ctx.switchToHttp().getRequest().user = { id: "op-1", role: "pg_operator" };
    return true;
  }
};

@Injectable()
class FakeAiAssistService {
  async generateContent() {
    return { title: "Nice PG", description: "Great place." };
  }
  async pricingSuggestions() {
    return {
      suggestions: [
        { sharing: "double", p25_paise: 700000, p50_paise: 900000, p75_paise: 1100000, sample: 5 }
      ]
    };
  }
  async amenitySuggestions() {
    return { amenities: ["wifi", "cctv"], house_rules: ["no_smoking"] };
  }
}

@Module({
  controllers: [PgListingController],
  providers: [
    PgListingService,
    PgPropertiesService,
    PgDraftService,
    AppStateService,
    { provide: DatabaseService, useValue: fakeDb },
    {
      provide: PgNearbyService,
      useValue: { nearby: async () => ({ metro: [], college: [], office: [] }) }
    },
    { provide: PgAiAssistService, useClass: FakeAiAssistService }
  ]
})
class TestModule {}

const pgPayload = {
  property: { display_name: "Cozy PG", city_slug: "hyderabad" },
  pg_details: { total_beds: 6 },
  room_types: [{ sharing: "double", ac: false, monthly_rent_paise: 800000, vacancy_count: 2 }]
};

describe("PgListingController AI assist endpoints", () => {
  let app: INestApplication;
  const OLD_ENV = { ...process.env };

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [TestModule] })
      .overrideGuard(AuthGuard)
      .useValue(allowAll)
      .overrideGuard(RolesGuard)
      .useValue(allowAll)
      .compile();
    app = mod.createNestApplication();
    await app.init();
  });

  afterAll(() => app.close());
  afterEach(() => {
    process.env = { ...OLD_ENV };
  });

  describe("POST /pg-operator/listings/generate-content", () => {
    it("returns title+description when ff_pg_ai_assist=true", async () => {
      process.env["FF_PG_AI_ASSIST"] = "true";
      const res = await request(app.getHttpServer())
        .post("/pg-operator/listings/generate-content")
        .send({ payload: pgPayload });
      expect(res.status).toBe(201);
      expect(res.body.data).toHaveProperty("title");
      expect(res.body.data).toHaveProperty("description");
    });

    it("returns 404 feature_disabled when ff_pg_ai_assist=false", async () => {
      process.env["FF_PG_AI_ASSIST"] = "false";
      const res = await request(app.getHttpServer())
        .post("/pg-operator/listings/generate-content")
        .send({ payload: pgPayload });
      expect(res.status).toBe(404);
      expect(res.body.code).toBe("feature_disabled");
    });
  });

  describe("POST /pg-operator/listings/pricing-suggestions", () => {
    it("returns suggestions when ff_pg_ai_assist=true", async () => {
      process.env["FF_PG_AI_ASSIST"] = "true";
      const res = await request(app.getHttpServer())
        .post("/pg-operator/listings/pricing-suggestions")
        .send({ city_slug: "hyderabad", sharings: ["double"] });
      expect(res.status).toBe(201);
      expect(res.body.data).toHaveProperty("suggestions");
    });

    it("returns 404 when flag is off", async () => {
      process.env["FF_PG_AI_ASSIST"] = "false";
      const res = await request(app.getHttpServer())
        .post("/pg-operator/listings/pricing-suggestions")
        .send({ city_slug: "hyderabad", sharings: ["double"] });
      expect(res.status).toBe(404);
    });
  });

  describe("POST /pg-operator/listings/amenity-suggestions", () => {
    it("returns amenities+house_rules when ff_pg_ai_assist=true", async () => {
      process.env["FF_PG_AI_ASSIST"] = "true";
      const res = await request(app.getHttpServer())
        .post("/pg-operator/listings/amenity-suggestions")
        .send({ payload: pgPayload });
      expect(res.status).toBe(201);
      expect(Array.isArray(res.body.data.amenities)).toBe(true);
      expect(Array.isArray(res.body.data.house_rules)).toBe(true);
    });
  });
});
