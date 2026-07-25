import { describe, it, expect } from "vitest";
import { RENT_CITY_CONTENT } from "../../rent-city-content";
import { HUB_CITY_SLUGS } from "../cities";

describe("RENT_CITY_CONTENT", () => {
  it("covers every hub city", () => {
    for (const slug of HUB_CITY_SLUGS) {
      expect(RENT_CITY_CONTENT[slug], `missing rent content for ${slug}`).toBeDefined();
    }
  });

  it("gives every city at least 5 popular localities for the nav column", () => {
    for (const slug of HUB_CITY_SLUGS) {
      expect(RENT_CITY_CONTENT[slug].popularLocalities.length).toBeGreaterThanOrEqual(5);
    }
  });

  it("stores localities as display names, not slugs", () => {
    expect(RENT_CITY_CONTENT.lucknow.popularLocalities.some((l) => l.includes(" "))).toBe(true);
    for (const slug of HUB_CITY_SLUGS) {
      for (const loc of RENT_CITY_CONTENT[slug].popularLocalities) {
        expect(loc, `"${loc}" looks like a slug`).not.toMatch(/^[a-z0-9-]+$/);
      }
    }
  });
});
