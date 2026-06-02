import { describe, it, expect } from "vitest";
import { computePgListingScore } from "../../packages/shared-types/src/pg-listing-score";
import type { PgListingPayload } from "../../packages/shared-types/src/pg-operator";

const base: PgListingPayload = {
  property: { display_name: "Sunrise PG", city_slug: "lucknow" },
  pg_details: { total_beds: 10 },
  room_types: []
} as any;
const sig = { verification_status: "unverified" as const, has_exact_geo: false, photo_count: 0 };

describe("computePgListingScore", () => {
  it("empty listing scores low with recommendations", () => {
    const r = computePgListingScore(base, sig);
    expect(r.composite).toBeLessThan(40);
    expect(r.recommendations.length).toBeGreaterThan(0);
    expect(r.recommendations[0].points).toBeGreaterThanOrEqual(r.recommendations[1]?.points ?? 0);
  });

  it("adding photos raises composite + drops the photo rec", () => {
    const low = computePgListingScore(base, { ...sig, photo_count: 0 });
    const high = computePgListingScore(base, { ...sig, photo_count: 6 });
    expect(high.composite).toBeGreaterThan(low.composite);
    expect(high.recommendations.find((x) => x.id === "add_photos")).toBeUndefined();
  });

  it("exact geo beats centroid", () => {
    const a = computePgListingScore(base, { ...sig, has_exact_geo: false });
    const b = computePgListingScore(base, { ...sig, has_exact_geo: true });
    expect(b.composite).toBeGreaterThan(a.composite);
  });

  it("factor weights sum to ~1", () => {
    const r = computePgListingScore(base, sig);
    const sum = r.factors.reduce((s, f) => s + f.weight, 0);
    expect(sum).toBeGreaterThan(0.98);
    expect(sum).toBeLessThan(1.02);
  });

  it("amenity count uses string array lengths not boolean values", () => {
    const withAmenities: PgListingPayload = {
      ...base,
      pg_details: {
        ...base.pg_details,
        amenities: { core: ["wifi", "hot_water", "power_backup"], room: ["ac", "tv", "wardrobe"] }
      }
    } as any;
    const without = computePgListingScore(base, sig);
    const withA = computePgListingScore(withAmenities, sig);
    expect(withA.composite).toBeGreaterThan(without.composite);
  });
});
