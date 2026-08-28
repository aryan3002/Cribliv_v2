import { describe, expect, it } from "vitest";
import { selectHeroMarkers } from "../hero-map-markers";
import type { HeroPin } from "../hero-query";
import type { GeoBounds } from "../geo";

const BOUNDS: GeoBounds = { sw: { lat: 26.76, lng: 80.85 }, ne: { lat: 26.95, lng: 81.05 } };

function pin(overrides: Partial<HeroPin>): HeroPin {
  return {
    id: Math.random().toString(36).slice(2),
    lat: 26.85,
    lng: 80.95,
    monthly_rent: 12000,
    listing_type: "flat_house",
    bhk: 2,
    verification_status: "verified",
    furnishing: null,
    city: "lucknow",
    locality: null,
    locality_slug: null,
    ...overrides
  };
}

describe("selectHeroMarkers", () => {
  it("projects an in-bounds pin to percentage coordinates with an ₹ label", () => {
    const [m] = selectHeroMarkers([pin({ id: "a", monthly_rent: 14000 })], BOUNDS);
    expect(m.id).toBe("a");
    expect(m.xPct).toBeGreaterThan(0);
    expect(m.xPct).toBeLessThan(100);
    expect(m.yPct).toBeGreaterThan(0);
    expect(m.yPct).toBeLessThan(100);
    expect(m.rentLabel).toBe("₹14,000");
  });

  it("skips pins outside bounds, without coords, or without a positive rent", () => {
    const markers = selectHeroMarkers(
      [
        pin({ id: "out", lat: 28.6, lng: 77.2 }),
        pin({ id: "nan", lat: Number.NaN }),
        pin({ id: "free", monthly_rent: 0 }),
        pin({ id: "ok" })
      ],
      BOUNDS
    );
    expect(markers.map((m) => m.id)).toEqual(["ok"]);
  });

  it("keeps at most maxMarkers and enforces a minimum gap between pills", () => {
    const cluster = Array.from({ length: 20 }, (_, i) =>
      pin({ id: `c${i}`, lat: 26.85 + i * 0.0001, lng: 80.95 + i * 0.0001 })
    );
    const spread = selectHeroMarkers(cluster, BOUNDS, { maxMarkers: 8, minGapPct: 8 });
    expect(spread.length).toBeLessThanOrEqual(8);
    // clustered pins collapse to a single marker under the gap rule
    expect(spread.length).toBe(1);
  });

  it("samples the whole rent range instead of only the cheapest pins", () => {
    const rents = [2200, 3000, 3500, 4000, 14000, 16000, 20000, 25000];
    const pins = rents.map((rent, i) =>
      pin({ id: `r${rent}`, monthly_rent: rent, lat: 26.78 + i * 0.02, lng: 80.87 + i * 0.02 })
    );
    const labels = selectHeroMarkers(pins, BOUNDS, { maxMarkers: 4, minGapPct: 2 }).map(
      (m) => m.rentLabel
    );
    expect(labels).toContain("₹2,200");
    expect(labels).toContain("₹25,000");
  });

  it("prefers verified pins when thinning", () => {
    const markers = selectHeroMarkers(
      [
        pin({ id: "unv", lat: 26.85, lng: 80.95, verification_status: "pending" }),
        pin({ id: "ver", lat: 26.851, lng: 80.951, verification_status: "verified" })
      ],
      BOUNDS,
      { minGapPct: 50 }
    );
    expect(markers.map((m) => m.id)).toEqual(["ver"]);
  });
});
