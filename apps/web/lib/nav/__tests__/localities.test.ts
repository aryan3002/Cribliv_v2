import { describe, it, expect } from "vitest";
import { RENT_CITY_CONTENT } from "../../rent-city-content";
import { HUB_CITY_SLUGS } from "../cities";
import { localityLinks } from "../localities";
import microLocalities from "../../../../../data/seeds/lucknow/micro-localities.json";

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

const LUCKNOW_PARENTS = new Set(
  (microLocalities as Array<{ parent_slug: string }>).map((m) => m.parent_slug)
);

describe("localityLinks", () => {
  it("links Lucknow localities to real /city/lucknow/{slug} SEO pages", () => {
    const links = localityLinks("en", "lucknow");
    expect(links.length).toBeGreaterThan(0);
    for (const link of links) {
      expect(link.href).toMatch(/^\/en\/city\/lucknow\/[a-z0-9-]+$/);
      const slug = link.href.split("/").pop()!;
      expect(LUCKNOW_PARENTS, `${slug} is not a seeded locality`).toContain(slug);
    }
  });

  it("uses the search fallback for cities with no verified slugs", () => {
    for (const city of ["delhi", "jaipur", "noida"]) {
      const links = localityLinks("en", city);
      expect(links.length).toBeGreaterThan(0);
      for (const link of links) {
        expect(link.href).toMatch(new RegExp(`^/en/search\\?city=${city}&q=`));
      }
    }
  });

  it("never emits a /city/{city}/{locality} URL for a non-Lucknow city", () => {
    for (const city of [
      "delhi",
      "gurugram",
      "noida",
      "ghaziabad",
      "faridabad",
      "chandigarh",
      "jaipur"
    ]) {
      for (const link of localityLinks("en", city)) {
        expect(link.href).not.toContain(`/city/${city}/`);
      }
    }
  });

  it("url-encodes locality names in the fallback", () => {
    const links = localityLinks("en", "delhi");
    const multiword = links.find((l) => l.label.includes(" "));
    expect(multiword).toBeDefined();
    expect(multiword!.href).toContain(encodeURIComponent(multiword!.label));
    expect(multiword!.href).not.toMatch(/q=[^&]* /);
  });

  it("honours the locale prefix", () => {
    for (const link of localityLinks("hi", "lucknow"))
      expect(link.href.startsWith("/hi/")).toBe(true);
    for (const link of localityLinks("hi", "delhi"))
      expect(link.href.startsWith("/hi/")).toBe(true);
  });

  it("respects the limit and defaults to 8", () => {
    expect(localityLinks("en", "delhi").length).toBeLessThanOrEqual(8);
    expect(localityLinks("en", "delhi", 3)).toHaveLength(3);
  });

  it("returns an empty list for an unknown city rather than throwing", () => {
    expect(localityLinks("en", "varanasi")).toEqual([]);
    expect(localityLinks("en", "atlantis")).toEqual([]);
  });

  // RENT_CITY_CONTENT is a plain object literal, so these keys resolve up the
  // prototype chain to something truthy. A bare `if (!city)` guard lets them
  // past and then throws on `.popularLocalities`.
  it("returns an empty list for prototype-chain keys rather than throwing", () => {
    for (const key of ["__proto__", "constructor", "toString", "hasOwnProperty", "valueOf"]) {
      expect(() => localityLinks("en", key), `localityLinks threw on "${key}"`).not.toThrow();
      expect(localityLinks("en", key), `localityLinks returned links for "${key}"`).toEqual([]);
    }
  });
});
