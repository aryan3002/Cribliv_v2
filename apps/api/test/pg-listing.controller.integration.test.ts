import "reflect-metadata";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
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
    // Create lands the listing as a DRAFT. The wizard uploads photos next, then
    // calls POST :id/submit to transition draft → pending_review, so a listing
    // never enters the admin queue without its photos.
    expect(r.body.data.status).toBe("draft");
  });

  it("accepts an explicit per-listing title distinct from the property name", async () => {
    const r = await request(app.getHttpServer())
      .post("/pg-operator/listings")
      .set("Idempotency-Key", "test-title")
      .send({ ...validPayload, title: "Hostel A — Boys Block near Metro" });
    expect(r.status).toBe(201);
    expect(typeof r.body.data.listing_id).toBe("string");
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

// The wizard redesign centralized navigation and dropped the per-step
// createPgProperty call, so a first-time operator reaches Review with NO
// pg_property and publish 404'd with code "no_property". The controller now
// creates the operator's single V1 property lazily on first publish, using the
// property basics + location already carried in the publish payload.
describe("PgListingController — lazy property creation on first publish", () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [TestPgListingModule] })
      .overrideGuard(AuthGuard)
      .useValue(allowAllGuard)
      .overrideGuard(RolesGuard)
      .useValue(allowAllGuard)
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();
    // NOTE: no property pre-created — this is a brand-new operator.
  });

  afterAll(async () => {
    await app.close();
  });

  it("publishes (201) by auto-creating the property when the operator has none", async () => {
    const r = await request(app.getHttpServer())
      .post("/pg-operator/listings")
      .set("Idempotency-Key", "test-no-property")
      .send({
        property: { display_name: "Fresh PG", city_slug: "delhi", locality_slug: "saket" },
        pg_details: { total_beds: 8 },
        room_types: [
          {
            sharing: "double",
            ac: true,
            bathroom_kind: "attached_western",
            furnishing: "semi_furnished",
            monthly_rent_paise: 1_000_000,
            vacancy_count: 3
          }
        ]
      });
    expect(r.status).toBe(201);
    expect(typeof r.body.data.listing_id).toBe("string");
    expect(r.body.data.status).toBe("draft");
  });
});

// 1 listing : 1 property — each publish mints its OWN fresh pg_property; the old
// single-property reuse (getActiveProperty) is gone. Two publishes by the same
// operator must produce two distinct pg_property ids passed into createDraft.
describe("PgListingController — one fresh property per listing (1:1)", () => {
  let app: INestApplication;
  let listingService: PgListingService;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [TestPgListingModule] })
      .overrideGuard(AuthGuard)
      .useValue(allowAllGuard)
      .overrideGuard(RolesGuard)
      .useValue(allowAllGuard)
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();
    listingService = moduleRef.get(PgListingService);
  });

  afterAll(async () => {
    await app.close();
  });

  const payload = {
    property: { display_name: "Twin PG", city_slug: "delhi" },
    pg_details: { total_beds: 6 },
    room_types: [
      {
        sharing: "double",
        ac: true,
        bathroom_kind: "attached_western",
        furnishing: "semi_furnished",
        monthly_rent_paise: 1_000_000,
        vacancy_count: 2
      }
    ]
  };

  it("mints a distinct pg_property per new listing", async () => {
    const spy = vi.spyOn(listingService, "createDraft");
    await request(app.getHttpServer())
      .post("/pg-operator/listings")
      .set("Idempotency-Key", "one-to-one-a")
      .send(payload)
      .expect(201);
    await request(app.getHttpServer())
      .post("/pg-operator/listings")
      .set("Idempotency-Key", "one-to-one-b")
      .send(payload)
      .expect(201);

    expect(spy).toHaveBeenCalledTimes(2);
    const propId1 = spy.mock.calls[0][1];
    const propId2 = spy.mock.calls[1][1];
    expect(propId1).not.toBe(propId2);
  });
});
