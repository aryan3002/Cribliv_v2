import { describe, expect, it } from "vitest";
import { DEFAULT_HOME_CITY, HOME_CITIES, resolveHomeCity } from "../home-city-config";

describe("HOME_CITIES", () => {
  it("has a default city entry with sane bounds", () => {
    const city = HOME_CITIES[DEFAULT_HOME_CITY];
    expect(city).toBeDefined();
    expect(city.bounds.ne.lat).toBeGreaterThan(city.bounds.sw.lat);
    expect(city.bounds.ne.lng).toBeGreaterThan(city.bounds.sw.lng);
    expect(city.minHeroInventory).toBeGreaterThan(0);
    expect(city.backdrop.startsWith("/images/home/")).toBe(true);
  });
});

describe("resolveHomeCity", () => {
  it("prefers the query chip city over everything", () => {
    expect(resolveHomeCity({ chipCity: "Lucknow", cookieCity: "nope", geoCity: "nope" }).slug).toBe(
      "lucknow"
    );
  });

  it("falls back chip → cookie → geo → default", () => {
    expect(resolveHomeCity({ chipCity: "atlantis", cookieCity: "lucknow" }).slug).toBe("lucknow");
    expect(resolveHomeCity({ geoCity: "LUCKNOW" }).slug).toBe("lucknow");
    expect(resolveHomeCity({}).slug).toBe(DEFAULT_HOME_CITY);
  });

  it("ignores cities that are not configured", () => {
    // Delhi exists in CITY_BBOXES but is not a configured HOME city in v1.
    expect(resolveHomeCity({ chipCity: "delhi" }).slug).toBe(DEFAULT_HOME_CITY);
  });
});
