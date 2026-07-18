import { describe, it, expect } from "vitest";
import { partitionPins } from "../map-post-filter";
import type { MapPin } from "../../components/criblmap/hooks/useMapState";

const pin = (over: Partial<MapPin>): MapPin => ({
  id: "x",
  lat: 26.8,
  lng: 81.0,
  title: "t",
  monthly_rent: 15000,
  listing_type: "flat_house",
  bhk: 2,
  verification_status: "verified",
  furnishing: "semi_furnished",
  cover_photo: null,
  city: "lucknow",
  locality: "Gomti Nagar",
  locality_slug: "gomti-nagar",
  ...over
});

describe("partitionPins", () => {
  it("min_rent keeps pins at or above the floor", () => {
    const pins = [pin({ id: "a", monthly_rent: 9000 }), pin({ id: "b", monthly_rent: 16000 })];
    const r = partitionPins(pins, [{ kind: "min_rent", value: 12000 }]);
    expect(r.matchedIds).toEqual(["b"]);
    expect(r.faded.map((p) => p.id)).toEqual(["a"]);
    expect(r.count).toBe(1);
  });

  it("furnishing matches on the enum value", () => {
    const pins = [
      pin({ id: "a", furnishing: "unfurnished" }),
      pin({ id: "b", furnishing: "fully_furnished" })
    ];
    const r = partitionPins(pins, [{ kind: "furnishing", value: "fully_furnished" }]);
    expect(r.matchedIds).toEqual(["b"]);
  });

  it("locality matches by slug case-insensitively", () => {
    const pins = [
      pin({ id: "a", locality_slug: "indira-nagar" }),
      pin({ id: "b", locality_slug: "gomti-nagar" })
    ];
    const r = partitionPins(pins, [{ kind: "locality", value: "Gomti-Nagar" }]);
    expect(r.matchedIds).toEqual(["b"]);
  });

  it("no filters → all matched, none faded", () => {
    const pins = [pin({ id: "a" }), pin({ id: "b" })];
    const r = partitionPins(pins, []);
    expect(r.matched).toHaveLength(2);
    expect(r.faded).toHaveLength(0);
  });

  it("isComplete is false only at the 500 cap", () => {
    const many = Array.from({ length: 500 }, (_, i) => pin({ id: String(i) }));
    expect(partitionPins(many, []).isComplete).toBe(false);
    expect(partitionPins(many.slice(0, 95), []).isComplete).toBe(true);
  });
});
