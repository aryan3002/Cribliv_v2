import "reflect-metadata";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Module, INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { PgPublicController } from "../src/modules/pg-operator/pg-public.controller";
import { PgSearchService } from "../src/modules/pg-operator/services/pg-search.service";
import { PgListingService } from "../src/modules/pg-operator/services/pg-listing.service";
import { PgAnalyticsService } from "../src/modules/pg-operator/services/pg-analytics.service";

const fakeSearch = {
  search: async () => ({
    items: [
      {
        id: "11111111-1111-1111-1111-111111111111",
        title: "Sunrise PG",
        city: "lucknow",
        city_name: "Lucknow",
        locality: "Gomti Nagar",
        listing_type: "pg",
        starting_rent: 7000,
        sharing_options: ["single", "double"],
        gender_policy: "girls",
        food_included: true,
        verified: true,
        cover_photo: null
      }
    ],
    total: 1,
    page: 1,
    page_size: 20
  }),
  suggest: async () => [
    { type: "city", label: "Lucknow", value: "lucknow", listing_count: 2 },
    { type: "listing", label: "Joginder PG", value: "pg-1", city_slug: "lucknow", verified: true }
  ],
  preview: async () => ({
    type: "city",
    slug: "lucknow",
    name: "Lucknow",
    listing_count: 4,
    rent_band: { min: 2121, max: 17171 },
    verified_pct: 100,
    avg_bhk: null,
    sharing: ["single", "double"],
    sample_photos: []
  })
};

@Module({
  controllers: [PgPublicController],
  providers: [
    { provide: PgSearchService, useValue: fakeSearch },
    { provide: PgListingService, useValue: { getPublicListingDetail: async () => null } },
    { provide: PgAnalyticsService, useValue: { trackSearch: async () => undefined } }
  ]
})
class TestModule {}

describe("GET /pg/listings (integration)", () => {
  let app: INestApplication;
  beforeAll(async () => {
    const ref = await Test.createTestingModule({ imports: [TestModule] }).compile();
    app = ref.createNestApplication();
    await app.init();
  });
  afterAll(async () => app.close());

  it("returns PG cards in the data envelope", async () => {
    const res = await request(app.getHttpServer()).get("/pg/listings?city=lucknow").expect(200);
    expect(res.body.data.total).toBe(1);
    expect(res.body.data.items[0]).toMatchObject({
      listing_type: "pg",
      gender_policy: "girls",
      sharing_options: ["single", "double"]
    });
  });

  it("returns PG autocomplete suggestions (cities + listings)", async () => {
    const res = await request(app.getHttpServer()).get("/pg/suggest?q=lucknow").expect(200);
    expect(res.body.data).toHaveLength(2);
    expect(res.body.data[0]).toMatchObject({ type: "city", value: "lucknow" });
    expect(res.body.data[1]).toMatchObject({ type: "listing", city_slug: "lucknow" });
  });

  it("returns a PG-scoped city preview (sharing instead of BHK)", async () => {
    const res = await request(app.getHttpServer())
      .get("/pg/preview?type=city&value=lucknow")
      .expect(200);
    expect(res.body.data).toMatchObject({
      type: "city",
      listing_count: 4,
      rent_band: { min: 2121, max: 17171 },
      avg_bhk: null,
      sharing: ["single", "double"]
    });
  });
});
