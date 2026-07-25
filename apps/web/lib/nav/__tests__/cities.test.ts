import { describe, it, expect } from "vitest";
import { HUB_CITIES, HUB_CITY_SLUGS } from "../cities";
import { PG_CITY_CONTENT } from "../../pg-city-content";
import { resolveCity } from "../../search-segment";

describe("HUB_CITIES", () => {
  it("has the 8 hub cities in a stable order", () => {
    expect(HUB_CITY_SLUGS).toEqual([
      "delhi",
      "gurugram",
      "noida",
      "ghaziabad",
      "faridabad",
      "chandigarh",
      "jaipur",
      "lucknow"
    ]);
  });

  it("does not include varanasi", () => {
    expect(HUB_CITY_SLUGS).not.toContain("varanasi");
  });

  it("gives every city a human label", () => {
    for (const city of HUB_CITIES) {
      expect(city.label.length).toBeGreaterThan(0);
      expect(city.label).not.toBe(city.slug);
    }
  });

  it("slugs are lowercase and hyphen-safe", () => {
    for (const slug of HUB_CITY_SLUGS) {
      expect(slug).toMatch(/^[a-z][a-z0-9-]*$/);
    }
  });

  it("every hub city has PG content, so /pg/{city} never 404s from a nav link", () => {
    for (const slug of HUB_CITY_SLUGS) {
      expect(PG_CITY_CONTENT[slug], `PG_CITY_CONTENT missing ${slug}`).toBeDefined();
    }
  });
});

describe("city-list drift guards", () => {
  it("every alias in search-segment resolves to a hub city slug", () => {
    const aliases = [
      "delhi",
      "new delhi",
      "gurugram",
      "gurgaon",
      "noida",
      "ghaziabad",
      "faridabad",
      "chandigarh",
      "jaipur",
      "lucknow"
    ];
    for (const alias of aliases) {
      const slug = resolveCity(alias);
      expect(slug, `alias "${alias}" did not resolve`).toBeDefined();
      expect(HUB_CITY_SLUGS, `alias "${alias}" resolved to non-hub "${slug}"`).toContain(slug);
    }
  });

  it("resolveCity rejects a city the nav does not offer", () => {
    expect(resolveCity("varanasi")).toBeUndefined();
  });

  it("every hub city is reachable by its own name", () => {
    for (const city of HUB_CITIES) {
      expect(resolveCity(city.label), `no alias for ${city.label}`).toBe(city.slug);
    }
  });
});
