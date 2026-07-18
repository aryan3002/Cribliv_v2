import { describe, it, expect } from "vitest";
import { resolveArea, RADIUS_ZOOM } from "../map-area-resolver";

describe("resolveArea", () => {
  it("resolves a known locality to a centroid at locality zoom", () => {
    const r = resolveArea("Gomti Nagar");
    expect(r).not.toBeNull();
    expect(r!.center.lat).toBeGreaterThan(26); // Lucknow latitude band
    expect(r!.center.lng).toBeGreaterThan(80);
    expect(r!.zoom).toBe(RADIUS_ZOOM.locality);
    expect(r!.method).toBe("locality-radius");
  });

  it("resolves a city to a wider zoom", () => {
    const r = resolveArea("Lucknow");
    expect(r).not.toBeNull();
    expect(r!.zoom).toBe(RADIUS_ZOOM.city);
    expect(r!.method).toBe("city-bbox");
  });

  it("tolerates compaction ('Gomtinagar')", () => {
    expect(resolveArea("Gomtinagar")).not.toBeNull();
  });

  it("returns null for gibberish", () => {
    expect(resolveArea("zzxqwv")).toBeNull();
  });
});
