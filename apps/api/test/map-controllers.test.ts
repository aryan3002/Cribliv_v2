import { BadRequestException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import { MapController } from "../src/modules/map/map.controller";
import { SearchController } from "../src/modules/search/search.controller";

describe("SearchController.mapSearch", () => {
  it("rejects invalid viewport bounds", async () => {
    const controller = new SearchController({ searchListingsForMap: vi.fn() } as never);

    await expect(
      controller.mapSearch({
        sw_lat: "oops",
        sw_lng: "76.84",
        ne_lat: "28.88",
        ne_lng: "77.35"
      })
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("forwards near_metro and locality-visible filters", async () => {
    const searchListingsForMap = vi.fn(async () => []);
    const controller = new SearchController({ searchListingsForMap } as never);

    await controller.mapSearch({
      sw_lat: "28.4",
      sw_lng: "76.84",
      ne_lat: "28.88",
      ne_lng: "77.35",
      bhk: "2",
      max_rent: "25000",
      listing_type: "flat_house",
      verified_only: "true",
      near_metro: "true"
    });

    expect(searchListingsForMap).toHaveBeenCalledWith(
      { sw_lat: 28.4, sw_lng: 76.84, ne_lat: 28.88, ne_lng: 77.35 },
      200,
      {
        bhk: 2,
        max_rent: 25000,
        listing_type: "flat_house",
        verified_only: true,
        near_metro: true
      }
    );
  });
});

describe("MapController.getAreaStats", () => {
  it("forwards visible map filters to area stats", async () => {
    const getAreaStats = vi.fn(async () => ({
      total_pins: 0,
      by_bhk: [],
      verified_count: 0,
      verified_pct: 0,
      trend: "stable"
    }));
    const controller = new MapController(
      { getAreaStats } as never,
      {} as never,
      {} as never
    );

    await controller.getAreaStats({
      sw_lat: "28.4",
      sw_lng: "76.84",
      ne_lat: "28.88",
      ne_lng: "77.35",
      bhk: "1",
      max_rent: "15000",
      listing_type: "pg",
      verified_only: "true",
      near_metro: "true"
    });

    expect(getAreaStats).toHaveBeenCalledWith(76.84, 28.4, 77.35, 28.88, {
      bhk: 1,
      max_rent: 15000,
      listing_type: "pg",
      verified_only: true,
      near_metro: true
    });
  });
});

describe("MapController.getSeekerPins", () => {
  it("rejects invalid seeker viewport bounds", async () => {
    const controller = new MapController(
      { getSeekerPins: vi.fn() } as never,
      {} as never,
      {} as never
    );

    await expect(
      controller.getSeekerPins({
        sw_lat: "26.7",
        sw_lng: "80.8",
        ne_lat: "not-a-number",
        ne_lng: "81.1"
      })
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
