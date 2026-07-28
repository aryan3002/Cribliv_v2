import "reflect-metadata";
import { INestApplication } from "@nestjs/common";
import { GUARDS_METADATA } from "@nestjs/common/constants";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuthGuard } from "../src/common/auth.guard";
import { SeoController } from "../src/modules/seo/seo.controller";
import { SeoAggregatesService } from "../src/modules/seo/seo-aggregates.service";
import { SeoCityConfigRow, SeoCityConfigService } from "../src/modules/seo/seo-city-config.service";
import { SeoCopyService } from "../src/modules/seo/seo-copy.service";
import { SeoPlacesService } from "../src/modules/seo/seo-places.service";

const ENABLED: SeoCityConfigRow[] = [
  {
    city_slug: "lucknow",
    programmatic_enabled: true,
    locality_count: 26,
    landmark_count: 12,
    metro_count: 21,
    indexable_count: 18,
    enabled_at: "2026-07-03T00:00:00.000Z",
    notes: "reference city",
    created_at: "2026-07-03T00:00:00.000Z",
    updated_at: "2026-07-03T00:00:00.000Z"
  }
];

describe("GET /seo/cities", () => {
  let app: INestApplication;
  let cityConfig: { listEnabled: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    cityConfig = { listEnabled: vi.fn(async () => ENABLED) };
    const moduleBuilder = Test.createTestingModule({
      controllers: [SeoController],
      providers: [
        { provide: SeoAggregatesService, useValue: {} },
        { provide: SeoCopyService, useValue: {} },
        { provide: SeoPlacesService, useValue: {} },
        { provide: SeoCityConfigService, useValue: cityConfig }
      ]
    });
    const moduleRef = await moduleBuilder
      .overrideGuard(AuthGuard)
      .useValue({ canActivate: () => true })
      .compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterEach(async () => {
    await app?.close();
  });

  it("is public and has no route guards", () => {
    expect(SeoController.prototype.listCities).toBeTypeOf("function");
    expect(
      Reflect.getMetadata(GUARDS_METADATA, SeoController.prototype.listCities)
    ).toBeUndefined();
  });

  it("returns enabled city configs", async () => {
    await request(app.getHttpServer())
      .get("/seo/cities")
      .expect(200)
      .expect({ data: { items: ENABLED } });

    expect(cityConfig.listEnabled).toHaveBeenCalledTimes(1);
  });
});

describe("GET /seo/cities/:citySlug/places", () => {
  let app: INestApplication;
  let places: { placesForCity: ReturnType<typeof vi.fn> };

  const PLACES = {
    city_slug: "lucknow",
    localities: [
      {
        slug: "gomti-nagar",
        name_en: "Gomti Nagar",
        name_hi: null,
        listing_count: 4,
        indexable: true
      }
    ],
    metro_stations: [],
    landmarks: []
  };

  beforeEach(async () => {
    places = { placesForCity: vi.fn(async () => PLACES) };
    const moduleRef = await Test.createTestingModule({
      controllers: [SeoController],
      providers: [
        { provide: SeoAggregatesService, useValue: {} },
        { provide: SeoCopyService, useValue: {} },
        { provide: SeoPlacesService, useValue: places },
        { provide: SeoCityConfigService, useValue: { listEnabled: vi.fn(async () => []) } }
      ]
    })
      .overrideGuard(AuthGuard)
      .useValue({ canActivate: () => true })
      .compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterEach(async () => {
    await app?.close();
  });

  it("is public — the sitemap fetches it unauthenticated during SSR", () => {
    expect(SeoController.prototype.listCityPlaces).toBeTypeOf("function");
    expect(
      Reflect.getMetadata(GUARDS_METADATA, SeoController.prototype.listCityPlaces)
    ).toBeUndefined();
  });

  it("returns places for the requested city without shadowing GET /seo/cities", async () => {
    await request(app.getHttpServer())
      .get("/seo/cities/lucknow/places")
      .expect(200)
      .expect({ data: PLACES });

    expect(places.placesForCity).toHaveBeenCalledWith("lucknow");

    // The sibling route must still resolve to listCities, not the places handler.
    await request(app.getHttpServer())
      .get("/seo/cities")
      .expect(200)
      .expect({ data: { items: [] } });
  });
});
