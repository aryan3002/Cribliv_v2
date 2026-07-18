import { describe, it, expect } from "vitest";
import { computeNegotiationDoors } from "../map-negotiation";
import type { MapPin } from "../../components/criblmap/hooks/useMapState";

const pin = (over: Partial<MapPin>): MapPin => ({
  id: "x",
  lat: 26.8,
  lng: 81.0,
  title: "t",
  monthly_rent: 22000,
  listing_type: "flat_house",
  bhk: 2,
  verification_status: "verified",
  furnishing: "unfurnished",
  cover_photo: null,
  city: "lucknow",
  locality: "Gomti Nagar",
  locality_slug: "gomti-nagar",
  ...over
});

describe("computeNegotiationDoors", () => {
  it("offers a budget stretch that yields the pins just above the cap", () => {
    // user wanted <= 20k, nothing qualifies; two pins sit at 21-22k
    const pins = [pin({ id: "a", monthly_rent: 21000 }), pin({ id: "b", monthly_rent: 22000 })];
    const doors = computeNegotiationDoors({
      pins,
      serverFilters: { bhk: 2, max_rent: 20000 },
      clientFilters: []
    });
    const stretch = doors.find((d) => d.id === "stretch_budget");
    expect(stretch?.gain).toBe(2);
    expect(stretch?.label).toMatch(/22/); // 20k * 1.1 = 22k
  });

  it("always ends with a subscribe door", () => {
    const doors = computeNegotiationDoors({
      pins: [],
      serverFilters: { max_rent: 20000 },
      clientFilters: []
    });
    expect(doors[doors.length - 1].id).toBe("subscribe");
  });

  it("omits doors that yield zero new homes", () => {
    const doors = computeNegotiationDoors({
      pins: [],
      serverFilters: { max_rent: 20000 },
      clientFilters: []
    });
    expect(doors.filter((d) => d.id !== "subscribe")).toHaveLength(0);
  });

  it("surfaces an allow_unverified door flagged as an estimate when verified_only is on", () => {
    const doors = computeNegotiationDoors({
      pins: [],
      serverFilters: { verified_only: true },
      clientFilters: []
    });
    const unverified = doors.find((d) => d.id === "allow_unverified");
    expect(unverified).toBeDefined();
    // gain is a placeholder sentinel, so the door must be machine-flagged as an estimate
    expect(unverified?.isEstimate).toBe(true);
  });

  it("omits the allow_unverified door when verified_only is not set", () => {
    const doors = computeNegotiationDoors({
      pins: [],
      serverFilters: { max_rent: 20000 },
      clientFilters: []
    });
    expect(doors.find((d) => d.id === "allow_unverified")).toBeUndefined();
  });
});
