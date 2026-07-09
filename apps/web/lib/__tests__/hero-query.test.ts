import { describe, expect, it } from "vitest";
import type { ParsedChip } from "../smart-parser";
import { HOME_CITIES } from "../home-city-config";
import {
  buildHeroCountPath,
  buildMapHandoffUrl,
  pinMatchesChips,
  type HeroPin
} from "../hero-query";

const pin = (over: Partial<HeroPin> = {}): HeroPin => ({
  id: "p1",
  lat: 26.85,
  lng: 80.95,
  monthly_rent: 12000,
  listing_type: "flat_house",
  bhk: 2,
  verification_status: "verified",
  furnishing: "furnished",
  city: "lucknow",
  locality: "Gomti Nagar",
  locality_slug: "gomti-nagar",
  ...over
});

const chip = (kind: ParsedChip["kind"], value: string | number, label = ""): ParsedChip => ({
  kind,
  value,
  label: label || String(value)
});

describe("pinMatchesChips", () => {
  it("matches when every chip is satisfied", () => {
    expect(
      pinMatchesChips(pin(), [
        chip("bhk", 2),
        chip("max_rent", 15000),
        chip("furnishing", "furnished")
      ])
    ).toBe(true);
  });

  it("fails on bhk mismatch", () => {
    expect(pinMatchesChips(pin({ bhk: 3 }), [chip("bhk", 2)])).toBe(false);
  });

  it("fails when rent exceeds max_rent", () => {
    expect(pinMatchesChips(pin({ monthly_rent: 20000 }), [chip("max_rent", 15000)])).toBe(false);
  });

  it("matches locality by name or slug, case-insensitively", () => {
    expect(pinMatchesChips(pin(), [chip("locality", "gomti nagar")])).toBe(true);
    expect(pinMatchesChips(pin(), [chip("locality", "Gomti Nagar")])).toBe(true);
    expect(
      pinMatchesChips(pin({ locality: null, locality_slug: "gomti-nagar" }), [
        chip("locality", "gomti nagar")
      ])
    ).toBe(true);
    expect(pinMatchesChips(pin(), [chip("locality", "hazratganj")])).toBe(false);
  });

  it("never dims on amenity chips (pins carry no amenity data)", () => {
    expect(pinMatchesChips(pin(), [chip("amenity", "parking")])).toBe(true);
  });
});

describe("buildHeroCountPath", () => {
  it("builds a page_size=1 search path with chip filters and the resolved city", () => {
    const path = buildHeroCountPath([chip("bhk", 2), chip("max_rent", 15000)], "lucknow");
    const qs = new URLSearchParams(path.split("?")[1]);
    expect(path.startsWith("/listings/search?")).toBe(true);
    expect(qs.get("city")).toBe("lucknow");
    expect(qs.get("bhk")).toBe("2");
    expect(qs.get("max_rent")).toBe("15000");
    expect(qs.get("page_size")).toBe("1");
  });

  it("lets an explicit city chip override the resolved city and drops amenity q", () => {
    const path = buildHeroCountPath([chip("city", "lucknow"), chip("amenity", "parking")], "delhi");
    const qs = new URLSearchParams(path.split("?")[1]);
    expect(qs.get("city")).toBe("lucknow");
    expect(qs.get("q")).toBeNull();
  });
});

describe("buildMapHandoffUrl", () => {
  const city = HOME_CITIES.lucknow;

  it("maps chips to the map page's supported params and tags src=hero", () => {
    const url = buildMapHandoffUrl("en", [chip("bhk", 2), chip("max_rent", 15000)], city, []);
    const qs = new URLSearchParams(url.split("?")[1]);
    expect(url.startsWith("/en/map?")).toBe(true);
    expect(qs.get("city")).toBe("lucknow");
    expect(qs.get("bhk")).toBe("2");
    expect(qs.get("max_rent")).toBe("15000");
    expect(qs.get("src")).toBe("hero");
    expect(qs.get("furnishing")).toBeNull(); // map has no furnishing filter in v1
  });

  it("passes lat/lng/zoom for a locality chip using matching-pin centroid", () => {
    const pins = [pin({ lat: 26.86, lng: 80.99 }), pin({ id: "p2", lat: 26.84, lng: 80.97 })];
    const url = buildMapHandoffUrl("en", [chip("locality", "gomti nagar")], city, pins);
    const qs = new URLSearchParams(url.split("?")[1]);
    expect(Number(qs.get("lat"))).toBeCloseTo(26.85, 2);
    expect(Number(qs.get("lng"))).toBeCloseTo(80.98, 2);
    expect(qs.get("zoom")).toBe("14");
  });

  it("omits lat/lng when no pins match the locality", () => {
    const url = buildMapHandoffUrl("en", [chip("locality", "nowhere")], city, [pin()]);
    const qs = new URLSearchParams(url.split("?")[1]);
    expect(qs.get("lat")).toBeNull();
  });
});
