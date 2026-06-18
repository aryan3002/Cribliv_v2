import "reflect-metadata";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { Module } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { INestApplication } from "@nestjs/common";
import request from "supertest";
import { PgListingController } from "../src/modules/pg-operator/pg-listing.controller";
import { PgListingService } from "../src/modules/pg-operator/services/pg-listing.service";
import { PgPropertiesService } from "../src/modules/pg-operator/services/pg-properties.service";
import { PgDraftService } from "../src/modules/pg-operator/services/pg-draft.service";
import { AuthGuard } from "../src/common/auth.guard";
import { RolesGuard } from "../src/common/roles.guard";

// Mocked services so we test ROUTING + idempotency + validation + response shape
// for the new edit routes, independent of the DB.
const listings = {
  getEditPayload: vi.fn(),
  updateListing: vi.fn()
};
const allowAllGuard = {
  canActivate: (ctx: any) => {
    ctx.switchToHttp().getRequest().user = { id: "op-1", role: "pg_operator" };
    return true;
  }
};

@Module({
  controllers: [PgListingController],
  providers: [
    { provide: PgListingService, useValue: listings },
    { provide: PgPropertiesService, useValue: { createProperty: vi.fn() } },
    { provide: PgDraftService, useValue: {} }
  ]
})
class TestModule {}

const validPayload = {
  property: { display_name: "Sunrise PG", city_slug: "delhi" },
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

describe("PgListingController — edit routes", () => {
  let app: INestApplication;

  beforeEach(async () => {
    listings.getEditPayload.mockReset();
    listings.updateListing.mockReset();
    const moduleRef = await Test.createTestingModule({ imports: [TestModule] })
      .overrideGuard(AuthGuard)
      .useValue(allowAllGuard)
      .overrideGuard(RolesGuard)
      .useValue(allowAllGuard)
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  describe("GET /pg-operator/listings/:id/edit", () => {
    it("200 returns the reconstructed payload (ownership-scoped to the caller)", async () => {
      listings.getEditPayload.mockResolvedValueOnce(validPayload);
      const r = await request(app.getHttpServer()).get("/pg-operator/listings/L1/edit");
      expect(r.status).toBe(200);
      expect(r.body.data.property.display_name).toBe("Sunrise PG");
      expect(listings.getEditPayload).toHaveBeenCalledWith("op-1", "L1");
    });

    it("404 when the listing isn't owned / doesn't exist (payload null)", async () => {
      listings.getEditPayload.mockResolvedValueOnce(null);
      const r = await request(app.getHttpServer()).get("/pg-operator/listings/nope/edit");
      expect(r.status).toBe(404);
      expect(JSON.stringify(r.body)).toMatch(/listing_not_found/);
    });
  });

  describe("PUT /pg-operator/listings/:id", () => {
    it("200 updates and returns { listing_id, status } (matches the create contract)", async () => {
      listings.updateListing.mockResolvedValueOnce({ id: "L1", status: "pending_review" });
      const r = await request(app.getHttpServer())
        .put("/pg-operator/listings/L1")
        .set("Idempotency-Key", "edit-1")
        .send(validPayload);
      expect(r.status).toBe(200);
      expect(r.body.data).toEqual({ listing_id: "L1", status: "pending_review" });
      expect(listings.updateListing).toHaveBeenCalledWith("op-1", "L1", expect.any(Object));
    });

    it("400 when the Idempotency-Key header is missing", async () => {
      const r = await request(app.getHttpServer())
        .put("/pg-operator/listings/L1")
        .send(validPayload);
      expect(r.status).toBe(400);
      expect(JSON.stringify(r.body)).toMatch(/idempotency/i);
      expect(listings.updateListing).not.toHaveBeenCalled();
    });

    it("400 on an invalid payload (missing room_types)", async () => {
      const r = await request(app.getHttpServer())
        .put("/pg-operator/listings/L1")
        .set("Idempotency-Key", "edit-bad")
        .send({
          property: { display_name: "A", city_slug: "delhi" },
          pg_details: { total_beds: 1 }
        });
      expect(r.status).toBe(400);
      expect(listings.updateListing).not.toHaveBeenCalled();
    });
  });
});
