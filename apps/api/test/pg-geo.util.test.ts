import { describe, it, expect } from "vitest";
import { resolvePgMapPoint } from "../src/modules/pg-operator/services/pg-geo.util";

const base = {
  loc_lat: 26.8467,
  loc_lng: 80.9462,
  city_slug: "lucknow",
  locality_slug: "gomti-nagar",
  city_name: "Lucknow",
  locality_name: "Gomti Nagar"
};

describe("resolvePgMapPoint", () => {
  it("coord that differs from the locality centroid → exact", () => {
    const p = resolvePgMapPoint({ ...base, ll_lat: 26.8551, ll_lng: 80.941 });
    expect(p).toMatchObject({
      lat: 26.8551,
      lng: 80.941,
      source: "exact",
      label: "Gomti Nagar, Lucknow",
      city_slug: "lucknow",
      locality_slug: "gomti-nagar"
    });
  });
  it("coord equal to the locality centroid → locality", () => {
    const p = resolvePgMapPoint({ ...base, ll_lat: 26.8467, ll_lng: 80.9462 });
    expect(p!.source).toBe("locality");
    expect(p!.label).toBe("Gomti Nagar, Lucknow");
  });
  it("no projection coord → null (city handled web-side)", () => {
    const p = resolvePgMapPoint({ ...base, ll_lat: null, ll_lng: null });
    expect(p).toBeNull();
  });
});
