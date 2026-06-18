import "reflect-metadata";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Module } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { INestApplication, ValidationPipe } from "@nestjs/common";
import request from "supertest";
import { PgOperatorController } from "../src/modules/pg-operator/pg-operator.controller";
import { PgSegmentationService } from "../src/modules/pg-operator/services/pg-segmentation.service";
import { PgPropertiesService } from "../src/modules/pg-operator/services/pg-properties.service";
import { DatabaseService } from "../src/common/database.service";
import { AppStateService } from "../src/common/app-state.service";
import { AuthGuard } from "../src/common/auth.guard";
import { RolesGuard } from "../src/common/roles.guard";

const fakeDb = { isEnabled: () => false, query: async () => ({ rows: [] }) };
const allowAllGuard = {
  canActivate: (ctx: any) => {
    ctx.switchToHttp().getRequest().user = { id: "op-1", role: "pg_operator" };
    return true;
  }
};

@Module({
  controllers: [PgOperatorController],
  providers: [
    PgSegmentationService,
    PgPropertiesService,
    AppStateService,
    { provide: DatabaseService, useValue: fakeDb }
  ]
})
class TestPgOperatorModule {}

describe("PgOperatorController (integration)", () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [TestPgOperatorModule] })
      .overrideGuard(AuthGuard)
      .useValue(allowAllGuard)
      .overrideGuard(RolesGuard)
      .useValue(allowAllGuard)
      .compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  describe("POST /pg-operator/segment", () => {
    it("returns self_serve for 10 beds", async () => {
      const r = await request(app.getHttpServer())
        .post("/pg-operator/segment")
        .send({ total_beds: 10 });
      expect(r.status).toBe(201);
      expect(r.body.data.path).toBe("self_serve");
    });

    it("returns sales_assist for 50 beds", async () => {
      const r = await request(app.getHttpServer())
        .post("/pg-operator/segment")
        .send({ total_beds: 50 });
      expect(r.body.data.path).toBe("sales_assist");
    });

    it("400 on missing total_beds", async () => {
      const r = await request(app.getHttpServer()).post("/pg-operator/segment").send({});
      expect(r.status).toBe(400);
    });

    it("400 on total_beds=0", async () => {
      const r = await request(app.getHttpServer())
        .post("/pg-operator/segment")
        .send({ total_beds: 0 });
      expect(r.status).toBe(400);
    });
  });

  describe("GET /pg-operator/me", () => {
    it("returns operator context", async () => {
      const r = await request(app.getHttpServer()).get("/pg-operator/me");
      expect(r.status).toBe(200);
      expect(r.body.data.operator.id).toBe("op-1");
      expect(r.body.data.operator.role).toBe("pg_operator");
      expect(r.body.data.properties).toEqual([]);
    });
  });

  describe("GET /pg-operator/onboarding-state", () => {
    it("returns needs_property when no property", async () => {
      const r = await request(app.getHttpServer()).get("/pg-operator/onboarding-state");
      expect(r.status).toBe(200);
      expect(r.body.data.state).toBe("needs_property");
      expect(r.body.data.property_count).toBe(0);
    });
  });

  // 1 listing : 1 property — a pg_property is ONLY born attached to a listing via
  // publish (POST /pg-operator/listings). The old standalone create-property route
  // could mint orphan properties (none today, but it was the alternate birth path),
  // so it is removed. Guard against anyone re-adding an orphan-creating endpoint.
  describe("POST /pg-operator/properties (removed — publish is the only birth path)", () => {
    it("404: standalone property creation is no longer a route", async () => {
      const r = await request(app.getHttpServer())
        .post("/pg-operator/properties")
        .set("Idempotency-Key", "orphan-attempt")
        .send({ display_name: "Orphan PG", city_slug: "delhi" });
      expect(r.status).toBe(404);
    });
  });
});
