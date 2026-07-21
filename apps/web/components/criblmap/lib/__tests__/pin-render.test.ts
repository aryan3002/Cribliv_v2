import { describe, expect, it } from "vitest";
import type { MapPin } from "../../hooks/useMapState";
import {
  clusterPins,
  diffRenderItems,
  isCluster,
  pinSignature,
  renderKey,
  type ClusterGroup
} from "../pin-render";

function makePin(overrides: Partial<MapPin> & Pick<MapPin, "id" | "lat" | "lng">): MapPin {
  return {
    title: "Test listing",
    monthly_rent: 12000,
    listing_type: "flat_house",
    bhk: 2,
    verification_status: "verified",
    furnishing: "unfurnished",
    cover_photo: null,
    city: "lucknow",
    locality: null,
    locality_slug: null,
    ...overrides
  };
}

describe("clusterPins", () => {
  it("returns individual pins (never clusters) at zoom >= 14", () => {
    const pins = [
      makePin({ id: "a", lat: 26.86, lng: 80.94 }),
      makePin({ id: "b", lat: 26.8601, lng: 80.9401 })
    ];
    const result = clusterPins(pins, 14);
    expect(result).toHaveLength(2);
    expect(result.every((item) => !isCluster(item))).toBe(true);
  });

  it("groups nearby pins into a cluster below zoom 14", () => {
    const pins = [
      makePin({ id: "a", lat: 26.86, lng: 80.94 }),
      makePin({ id: "b", lat: 26.861, lng: 80.9405 }),
      makePin({ id: "c", lat: 26.862, lng: 80.9402 })
    ];
    const result = clusterPins(pins, 12);
    expect(result).toHaveLength(1);
    expect(isCluster(result[0])).toBe(true);
    expect((result[0] as ClusterGroup).pins).toHaveLength(3);
  });

  it("leaves a lone pin in its own cell as a pin, not a cluster", () => {
    const pins = [
      makePin({ id: "a", lat: 26.86, lng: 80.94 }),
      makePin({ id: "far", lat: 27.5, lng: 81.6 })
    ];
    const result = clusterPins(pins, 12);
    expect(result).toHaveLength(2);
    expect(result.every((item) => !isCluster(item))).toBe(true);
  });

  it("gives a cluster a stable id independent of pin order", () => {
    const p1 = makePin({ id: "a", lat: 26.86, lng: 80.94 });
    const p2 = makePin({ id: "b", lat: 26.861, lng: 80.9405 });
    const forward = clusterPins([p1, p2], 12)[0] as ClusterGroup;
    const reverse = clusterPins([p2, p1], 12)[0] as ClusterGroup;
    expect(isCluster(forward)).toBe(true);
    expect(forward.id).toMatch(/^cluster:/);
    expect(forward.id).toBe(reverse.id);
  });

  it("positions a cluster at the true mean of its members", () => {
    const pins = [
      makePin({ id: "a", lat: 26.86, lng: 80.94 }),
      makePin({ id: "b", lat: 26.862, lng: 80.94 }),
      makePin({ id: "c", lat: 26.864, lng: 80.94 })
    ];
    const cluster = clusterPins(pins, 12)[0] as ClusterGroup;
    expect(cluster.lat).toBeCloseTo(26.862, 5);
    expect(cluster.lng).toBeCloseTo(80.94, 5);
  });
});

describe("renderKey", () => {
  it("returns the pin id for a pin", () => {
    expect(renderKey(makePin({ id: "pin-123", lat: 1, lng: 2 }))).toBe("pin-123");
  });

  it("returns the cluster id for a cluster", () => {
    const cluster = clusterPins(
      [
        makePin({ id: "a", lat: 26.86, lng: 80.94 }),
        makePin({ id: "b", lat: 26.861, lng: 80.9405 })
      ],
      12
    )[0] as ClusterGroup;
    expect(renderKey(cluster)).toBe(cluster.id);
  });
});

describe("pinSignature", () => {
  const base = makePin({ id: "a", lat: 26.86, lng: 80.94 });

  it("is stable for two identical pins", () => {
    expect(pinSignature(base)).toBe(pinSignature({ ...base }));
  });

  it("changes when verification status changes", () => {
    expect(pinSignature(base)).not.toBe(
      pinSignature({ ...base, verification_status: "unverified" })
    );
  });

  it("changes when rent changes", () => {
    expect(pinSignature(base)).not.toBe(pinSignature({ ...base, monthly_rent: 13000 }));
  });

  it("changes when below-market flips", () => {
    expect(pinSignature(base)).not.toBe(pinSignature({ ...base, belowMarket: true }));
  });

  it("changes when a cluster's member count changes", () => {
    const two = clusterPins(
      [
        makePin({ id: "a", lat: 26.86, lng: 80.94 }),
        makePin({ id: "b", lat: 26.861, lng: 80.9405 })
      ],
      12
    )[0];
    const three = clusterPins(
      [
        makePin({ id: "a", lat: 26.86, lng: 80.94 }),
        makePin({ id: "b", lat: 26.861, lng: 80.9405 }),
        makePin({ id: "c", lat: 26.862, lng: 80.9402 })
      ],
      12
    )[0];
    expect(pinSignature(two)).not.toBe(pinSignature(three));
  });
});

describe("diffRenderItems", () => {
  it("partitions next items into add / remove / keep by key", () => {
    const kept = makePin({ id: "kept", lat: 26.86, lng: 80.94 });
    const added = makePin({ id: "added", lat: 26.87, lng: 80.95 });
    const prevKeys = ["kept", "gone"];
    const { toAdd, toRemove, toKeep } = diffRenderItems(prevKeys, [kept, added]);
    expect(toAdd.map(renderKey)).toEqual(["added"]);
    expect(toRemove).toEqual(["gone"]);
    expect(toKeep.map(renderKey)).toEqual(["kept"]);
  });
});
