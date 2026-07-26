import { INDEXABLE_MIN_LISTINGS } from "@cribliv/shared-types";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SeoPlacesService } from "../src/modules/seo/seo-places.service";

describe("SeoPlacesService", () => {
  let aggregates: {
    localitiesForCity: ReturnType<typeof vi.fn>;
    metroStationsWithCountsForCity: ReturnType<typeof vi.fn>;
    landmarksWithCountsForCity: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    aggregates = {
      localitiesForCity: vi.fn(async () => [
        { slug: "gomti-nagar", name_en: "Gomti Nagar", name_hi: "गोमती नगर", listing_count: 4 },
        { slug: "aliganj", name_en: "Aliganj", name_hi: "अलीगंज", listing_count: 2 }
      ]),
      metroStationsWithCountsForCity: vi.fn(async () => [
        { slug: "munshipulia", station_name: "Munshipulia", listing_count: 3 },
        { slug: "ccs-airport", station_name: "CCS Airport", listing_count: 0 }
      ]),
      landmarksWithCountsForCity: vi.fn(async () => [
        { slug: "kgmu", name_en: "KGMU", name_hi: "केजीएमयू", listing_count: 9 }
      ])
    };
  });

  it("marks a place indexable only at or above the shared threshold", async () => {
    const service = new SeoPlacesService(aggregates as never);

    const places = await service.placesForCity("lucknow");

    expect(INDEXABLE_MIN_LISTINGS).toBe(3);
    expect(places.city_slug).toBe("lucknow");
    expect(places.localities).toEqual([
      {
        slug: "gomti-nagar",
        name_en: "Gomti Nagar",
        name_hi: "गोमती नगर",
        listing_count: 4,
        indexable: true
      },
      {
        slug: "aliganj",
        name_en: "Aliganj",
        name_hi: "अलीगंज",
        listing_count: 2,
        indexable: false
      }
    ]);
  });

  it("gates metro stations and landmarks on their own counts, not the city's", async () => {
    const service = new SeoPlacesService(aggregates as never);

    const places = await service.placesForCity("lucknow");

    expect(places.metro_stations.map((p) => [p.slug, p.indexable])).toEqual([
      ["munshipulia", true],
      ["ccs-airport", false]
    ]);
    expect(places.landmarks[0]).toMatchObject({ slug: "kgmu", indexable: true });
  });

  it("uses the metro station name as the display name", async () => {
    const service = new SeoPlacesService(aggregates as never);

    const places = await service.placesForCity("lucknow");

    expect(places.metro_stations[0].name_en).toBe("Munshipulia");
  });

  it("returns empty place lists for a city with nothing configured", async () => {
    aggregates.localitiesForCity = vi.fn(async () => []);
    aggregates.metroStationsWithCountsForCity = vi.fn(async () => []);
    aggregates.landmarksWithCountsForCity = vi.fn(async () => []);
    const service = new SeoPlacesService(aggregates as never);

    await expect(service.placesForCity("chandigarh")).resolves.toEqual({
      city_slug: "chandigarh",
      localities: [],
      metro_stations: [],
      landmarks: []
    });
  });

  it("queries all three place kinds for the requested city", async () => {
    const service = new SeoPlacesService(aggregates as never);

    await service.placesForCity("noida");

    expect(aggregates.localitiesForCity).toHaveBeenCalledWith("noida");
    expect(aggregates.metroStationsWithCountsForCity).toHaveBeenCalledWith("noida");
    expect(aggregates.landmarksWithCountsForCity).toHaveBeenCalledWith("noida");
  });
});
