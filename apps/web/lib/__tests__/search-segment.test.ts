import { describe, it, expect } from "vitest";
import {
  segmentFromPathname,
  hrefForSegment,
  resolveCity,
  placeSearchParam
} from "../search-segment";

describe("segmentFromPathname", () => {
  it("treats /[locale]/pg and nested PG routes as the pg segment", () => {
    expect(segmentFromPathname("en", "/en/pg")).toBe("pg");
    expect(segmentFromPathname("en", "/en/pg/lucknow")).toBe("pg");
    expect(segmentFromPathname("en", "/en/pg/lucknow/abc")).toBe("pg");
  });
  it("treats everything else as the homes segment", () => {
    expect(segmentFromPathname("en", "/en/search")).toBe("homes");
    expect(segmentFromPathname("en", "/en")).toBe("homes");
    expect(segmentFromPathname("en", null)).toBe("homes");
  });
});

describe("hrefForSegment", () => {
  it("routes the pg segment to /[locale]/pg carrying q + city", () => {
    const href = hrefForSegment("en", "pg", { q: "lucknow", city: "lucknow" });
    expect(href.startsWith("/en/pg?")).toBe(true);
    expect(href).toContain("q=lucknow");
    expect(href).toContain("city=lucknow");
  });
  it("routes the homes segment to /[locale]/search", () => {
    expect(hrefForSegment("en", "homes", {})).toBe("/en/search");
  });
  it("never carries listing_type or page across (segment owns the type; new search resets page)", () => {
    const href = hrefForSegment("en", "homes", { q: "x", listing_type: "pg", page: "3" });
    expect(href).not.toContain("listing_type");
    expect(href).not.toContain("page=");
  });
});

describe("resolveCity", () => {
  it("maps known names and aliases to canonical slugs", () => {
    expect(resolveCity("Lucknow")).toBe("lucknow");
    expect(resolveCity("Gurgaon")).toBe("gurugram");
    expect(resolveCity("New Delhi")).toBe("delhi");
  });
  it("returns undefined for an unknown place (locality/keyword)", () => {
    expect(resolveCity("Gomti Nagar")).toBeUndefined();
  });
  it("returns undefined for blank input", () => {
    expect(resolveCity("   ")).toBeUndefined();
  });
});

describe("placeSearchParam", () => {
  it("maps a known city to { city }", () => {
    expect(placeSearchParam("Lucknow")).toEqual({ city: "lucknow" });
  });
  it("maps a locality/keyword to { q }", () => {
    expect(placeSearchParam("Gomti Nagar")).toEqual({ q: "Gomti Nagar" });
  });
  it("returns {} for blank input", () => {
    expect(placeSearchParam("  ")).toEqual({});
  });
});
