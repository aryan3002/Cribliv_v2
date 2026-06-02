import "reflect-metadata";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Module } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { INestApplication } from "@nestjs/common";
import request from "supertest";
import { PgListingController } from "../src/modules/pg-operator/pg-listing.controller";
import { PgListingService } from "../src/modules/pg-operator/services/pg-listing.service";
import { PgPropertiesService } from "../src/modules/pg-operator/services/pg-properties.service";
import { PgDraftService } from "../src/modules/pg-operator/services/pg-draft.service";
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
  controllers: [PgListingController],
  providers: [
    PgListingService,
    PgPropertiesService,
    PgDraftService,
    AppStateService,
    // No OwnerService: PG owns its write end-to-end after the split.
    { provide: DatabaseService, useValue: fakeDb }
  ]
})
class TestPgListingModule {}

describe("PgListingController (integration)", () => {
  let app: INestApplication;
  let propsService: PgPropertiesService;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [TestPgListingModule] })
      .overrideGuard(AuthGuard)
      .useValue(allowAllGuard)
      .overrideGuard(RolesGuard)
      .useValue(allowAllGuard)
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();
    propsService = moduleRef.get(PgPropertiesService);
    await propsService.createProperty("op-1", { display_name: "Hostel A", city_slug: "delhi" });
  });

  afterAll(async () => {
    await app.close();
  });

  const validPayload = {
    property: { display_name: "Hostel A", city_slug: "delhi" },
    pg_details: { total_beds: 10 },
    room_types: [
      {
        sharing: "double",
        ac: true,
        bathroom_kind: "attached_western",
        furnishing: "semi_furnished",
        monthly_rent_paise: 1_200_000,
        vacancy_count: 4
      }
    ]
  };

  it("400 missing Idempotency-Key", async () => {
    const r = await request(app.getHttpServer()).post("/pg-operator/listings").send(validPayload);
    expect(r.status).toBe(400);
    expect(JSON.stringify(r.body)).toMatch(/idempotency/i);
  });

  it("400 on invalid payload (missing room_types)", async () => {
    const r = await request(app.getHttpServer())
      .post("/pg-operator/listings")
      .set("Idempotency-Key", "test-bad")
      .send({ property: { display_name: "A", city_slug: "delhi" }, pg_details: { total_beds: 1 } });
    expect(r.status).toBe(400);
  });

  it("creates listing with valid payload + Idempotency-Key", async () => {
    const r = await request(app.getHttpServer())
      .post("/pg-operator/listings")
      .set("Idempotency-Key", "test-good")
      .send(validPayload);
    expect(r.status).toBe(201);
    // Contract the web wizard consumes (pg-operator-api.ts): { listing_id, status }.
    // The publish redirect reads listing_id — it must never be undefined.
    expect(typeof r.body.data.listing_id).toBe("string");
    expect(r.body.data.listing_id.length).toBeGreaterThan(0);
    // Publish = submit for review → lands in the admin queue (go-live funnel).
    expect(r.body.data.status).toBe("pending_review");
  });

  it("400 on rent below ₹2k (Zod boundary)", async () => {
    const bad = {
      ...validPayload,
      room_types: [{ ...validPayload.room_types[0], monthly_rent_paise: 100_000 }]
    };
    const r = await request(app.getHttpServer())
      .post("/pg-operator/listings")
      .set("Idempotency-Key", "test-rent-low")
      .send(bad);
    expect(r.status).toBe(400);
    expect(JSON.stringify(r.body)).toMatch(/monthly_rent/);
  });
});
