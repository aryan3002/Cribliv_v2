import { describe, it, expect } from "vitest";
import { buildReasonLedger } from "../ListingReasonCard";
import type { MapPin } from "../../hooks/useMapState";

const pin: MapPin = {
  id: "a",
  lat: 26.8,
  lng: 81,
  title: "t",
  monthly_rent: 17000,
  listing_type: "flat_house",
  bhk: 2,
  verification_status: "verified",
  furnishing: "semi_furnished",
  cover_photo: null,
  city: "lucknow",
  locality: "Gomti Nagar",
  locality_slug: "gomti-nagar"
};

describe("buildReasonLedger", () => {
  it("makes a ✓ row per applied chip and a ✕ row per unsupported chip", () => {
    const rows = buildReasonLedger(pin, [
      { kind: "bhk", label: "2 BHK", status: "applied", quotedSource: "2 bhk" },
      {
        kind: "amenity",
        label: "parking",
        status: "unsupported",
        reason: "can't filter parking yet"
      }
    ]);
    expect(rows.find((r) => r.ok && /2 bhk/i.test(r.text))).toBeTruthy();
    const flaw = rows.find((r) => !r.ok);
    expect(flaw?.text).toMatch(/parking/i);
  });

  it("never emits a below-market or demand claim", () => {
    const rows = buildReasonLedger(pin, []);
    expect(rows.some((r) => /below market|people asked/i.test(r.text))).toBe(false);
  });
});
