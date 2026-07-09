import { describe, expect, it } from "vitest";
import {
  boundsFromCenterZoom,
  centroidOf,
  projectToBounds,
  zoomToFitBounds,
  type GeoBounds
} from "../geo";

const LUCKNOW: GeoBounds = {
  sw: { lat: 26.7, lng: 80.8 },
  ne: { lat: 26.95, lng: 81.1 }
};

describe("projectToBounds", () => {
  it("projects the exact SW corner to (0, 100)", () => {
    const p = projectToBounds(26.7, 80.8, LUCKNOW);
    expect(p.xPct).toBeCloseTo(0, 5);
    expect(p.yPct).toBeCloseTo(100, 5);
  });

  it("projects the exact NE corner to (100, 0)", () => {
    const p = projectToBounds(26.95, 81.1, LUCKNOW);
    expect(p.xPct).toBeCloseTo(100, 5);
    expect(p.yPct).toBeCloseTo(0, 5);
  });

  it("projects the horizontal middle to xPct 50", () => {
    const p = projectToBounds(26.8, 80.95, LUCKNOW);
    expect(p.xPct).toBeCloseTo(50, 5);
  });

  it("returns out-of-range values for points outside the bounds", () => {
    const p = projectToBounds(28.6, 77.2, LUCKNOW); // Delhi
    expect(p.xPct).toBeLessThan(0);
  });
});

describe("centroidOf", () => {
  it("returns null for an empty list", () => {
    expect(centroidOf([])).toBeNull();
  });

  it("averages coordinates", () => {
    const c = centroidOf([
      { lat: 26.8, lng: 80.9 },
      { lat: 26.9, lng: 81.0 }
    ]);
    expect(c).not.toBeNull();
    expect(c!.lat).toBeCloseTo(26.85, 10);
    expect(c!.lng).toBeCloseTo(80.95, 10);
  });
});

describe("boundsFromCenterZoom", () => {
  it("centers the bounds on the given point", () => {
    const b = boundsFromCenterZoom({ lat: 26.85, lng: 80.95 }, 12, 1280, 800);
    const p = projectToBounds(26.85, 80.95, b);
    expect(p.xPct).toBeCloseTo(50, 3);
    expect(p.yPct).toBeCloseTo(50, 3);
  });

  it("produces bounds that contain the center and shrink with zoom", () => {
    const wide = boundsFromCenterZoom({ lat: 26.85, lng: 80.95 }, 10, 1280, 800);
    const tight = boundsFromCenterZoom({ lat: 26.85, lng: 80.95 }, 13, 1280, 800);
    expect(wide.ne.lng - wide.sw.lng).toBeGreaterThan(tight.ne.lng - tight.sw.lng);
  });
});

describe("zoomToFitBounds", () => {
  it("returns a zoom whose image bounds contain the target bounds", () => {
    const z = zoomToFitBounds(LUCKNOW, 1280, 800);
    const img = boundsFromCenterZoom(
      { lat: (LUCKNOW.sw.lat + LUCKNOW.ne.lat) / 2, lng: (LUCKNOW.sw.lng + LUCKNOW.ne.lng) / 2 },
      z,
      1280,
      800
    );
    expect(img.sw.lat).toBeLessThanOrEqual(LUCKNOW.sw.lat);
    expect(img.ne.lat).toBeGreaterThanOrEqual(LUCKNOW.ne.lat);
    expect(img.sw.lng).toBeLessThanOrEqual(LUCKNOW.sw.lng);
    expect(img.ne.lng).toBeGreaterThanOrEqual(LUCKNOW.ne.lng);
  });

  it("zoom+1 would NOT fit (i.e. it picks the largest fitting zoom)", () => {
    const z = zoomToFitBounds(LUCKNOW, 1280, 800);
    const img = boundsFromCenterZoom(
      { lat: (LUCKNOW.sw.lat + LUCKNOW.ne.lat) / 2, lng: (LUCKNOW.sw.lng + LUCKNOW.ne.lng) / 2 },
      z + 1,
      1280,
      800
    );
    const fits =
      img.sw.lat <= LUCKNOW.sw.lat &&
      img.ne.lat >= LUCKNOW.ne.lat &&
      img.sw.lng <= LUCKNOW.sw.lng &&
      img.ne.lng >= LUCKNOW.ne.lng;
    expect(fits).toBe(false);
  });
});
