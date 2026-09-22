import { readFileSync } from "node:fs";
import { resolve } from "node:path";
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

// Fix 3 (final-review wave): the spec required every homepage city-card slug
// except varanasi to be a HUB_CITY_SLUGS member, so the nav never dead-ends a
// card into a page it doesn't link. That guard was promised and never
// written.
//
// app/[locale]/page.tsx's CITIES is not exported, and the page itself is an
// `async function` Server Component that calls fetchApi and pulls in
// next/dynamic, lucide-react and the ListeningHomePage tree — importing it
// here would mean rendering an async Server Component under Vitest/jsdom and
// mocking a network call just to read a 9-entry array of {name, photo, icon,
// gradient}. Two existing tests in this app already solve an equivalent
// problem the same way — home-city-cards-style.test.ts and
// home-search-mobile-style.test.ts both read a source file's text with
// readFileSync(resolve(process.cwd(), ...)) and pull the piece they need out
// with string/regex parsing rather than importing/rendering the module. This
// follows that precedent: read the page source as text and regex the `name:`
// values out of the CITIES array literal, bounded between the `const CITIES`
// and `function formatCompactCount` markers so a `name:` field anywhere else
// in this large file (FAQs, listing data, etc.) can't leak in.
function homepageCityCardSlugs(): string[] {
  const pageSource = readFileSync(resolve(process.cwd(), "app/[locale]/page.tsx"), "utf8");

  const start = pageSource.indexOf("const CITIES = [");
  if (start === -1) {
    throw new Error("app/[locale]/page.tsx: `const CITIES = [` marker not found");
  }
  const end = pageSource.indexOf("function formatCompactCount", start);
  if (end === -1) {
    throw new Error(
      "app/[locale]/page.tsx: `function formatCompactCount` marker not found after CITIES"
    );
  }
  const citiesBlock = pageSource.slice(start, end);

  return Array.from(citiesBlock.matchAll(/name:\s*"([^"]+)"/g)).map((m) => m[1].toLowerCase());
}

describe("homepage city-card drift guard", () => {
  const cardSlugs = homepageCityCardSlugs();

  it("parsed at least one city card from the homepage source", () => {
    // A guard against the regex silently matching nothing (e.g. the source
    // markers moved) and every assertion below vacuously passing on [].
    expect(cardSlugs.length).toBeGreaterThan(0);
  });

  it("still carries the deliberate varanasi exception", () => {
    // If this ever fails because varanasi was removed from the homepage
    // entirely, delete this test along with the `!== "varanasi"` carve-out
    // below — the exception no longer applies.
    expect(cardSlugs).toContain("varanasi");
  });

  it("every homepage city-card slug except varanasi is a nav hub city", () => {
    const unlinked = cardSlugs.filter(
      (slug) => slug !== "varanasi" && !HUB_CITY_SLUGS.includes(slug)
    );
    expect(
      unlinked,
      `homepage city cards with no HUB_CITY_SLUGS entry: ${unlinked.join(", ")}`
    ).toEqual([]);
  });
});
