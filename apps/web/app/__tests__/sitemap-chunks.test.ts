import { describe, expect, it } from "vitest";

import {
  buildCityLandmarkEntries,
  buildCityLocalityEntries,
  buildCityMetroEntries,
  buildSitemapIndexXml,
  entry,
  LANDMARK_INTENTS,
  LOCALITY_INTENTS,
  METRO_INTENTS,
  metroSlug
} from "../sitemap-chunks";

const BASE_URL = "https://cribliv.test";

describe("sitemap chunk builders", () => {
  it("entry emits one row per locale with hreflang alternates", () => {
    const rows = entry(BASE_URL, "/city/lucknow", { priority: 0.8, freq: "daily" });

    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.url)).toEqual([
      "https://cribliv.test/en/city/lucknow",
      "https://cribliv.test/hi/city/lucknow"
    ]);
    expect(rows[0]).toMatchObject({
      changeFrequency: "daily",
      priority: 0.8,
      alternates: {
        languages: {
          en: "https://cribliv.test/en/city/lucknow",
          hi: "https://cribliv.test/hi/city/lucknow"
        }
      }
    });
  });

  it("entry omits lastModified so the sitemap does not fake freshness on every crawl", () => {
    const rows = entry(BASE_URL, "/city/lucknow");

    expect(rows[0].lastModified).toBeUndefined();
    expect(rows[1].lastModified).toBeUndefined();
  });

  it("entry includes lastModified only when an explicit date is provided", () => {
    const when = new Date("2026-07-01T00:00:00.000Z");
    const rows = entry(BASE_URL, "/city/lucknow", { lastModified: when });

    expect(rows[0].lastModified).toBe(when);
  });

  it("metroSlug matches the page resolver rule with no hyphen trim", () => {
    expect(metroSlug("Bhootnath Market")).toBe("bhootnath-market");
    expect(metroSlug("Bhootnath Market!")).toBe(
      "Bhootnath Market!".toLowerCase().replace(/[^a-z0-9]+/g, "-")
    );
    expect(metroSlug("Bhootnath Market!")).toBe("bhootnath-market-");
  });

  it("exposes the expected intent buckets", () => {
    expect(LOCALITY_INTENTS).toHaveLength(26);
    expect(METRO_INTENTS).toHaveLength(26);
    expect(LANDMARK_INTENTS).toHaveLength(25);
  });

  it("buildCityLocalityEntries emits hub and intent URLs for indexable localities", () => {
    const rows = buildCityLocalityEntries(BASE_URL, "lucknow", [
      { slug: "gomti-nagar", listing_count: 3 }
    ]);

    expect(rows).toHaveLength((1 + LOCALITY_INTENTS.length) * 2);
    expect(rows.some((row) => row.url.endsWith("/en/city/lucknow/gomti-nagar"))).toBe(true);
    expect(
      rows.some((row) => row.url.includes("/en/city/lucknow/gomti-nagar/") && row.priority === 0.6)
    ).toBe(true);
  });

  it("buildCityLocalityEntries fully excludes thin localities", () => {
    const rows = buildCityLocalityEntries(BASE_URL, "lucknow", [
      { slug: "thin-place", listing_count: 2 },
      { slug: "kept-place", listing_count: 4 }
    ]);

    expect(rows.some((row) => row.url.includes("thin-place"))).toBe(false);
    expect(rows.some((row) => row.url.includes("kept-place"))).toBe(true);
  });

  it("buildCityMetroEntries emits hub and intent URLs per station", () => {
    const rows = buildCityMetroEntries(BASE_URL, "lucknow", [{ station_name: "Bhootnath Market" }]);

    expect(rows).toHaveLength((1 + METRO_INTENTS.length) * 2);
    expect(rows.some((row) => row.url.endsWith("/en/city/lucknow/metro/bhootnath-market"))).toBe(
      true
    );
  });

  it("buildCityLandmarkEntries emits hub and intent URLs per landmark", () => {
    const rows = buildCityLandmarkEntries(BASE_URL, "lucknow", [{ slug: "charbagh-station" }]);

    expect(rows).toHaveLength((1 + LANDMARK_INTENTS.length) * 2);
    expect(rows.some((row) => row.url.endsWith("/en/city/lucknow/near/charbagh-station"))).toBe(
      true
    );
  });
});

describe("buildSitemapIndexXml", () => {
  it("lists one child sitemap per chunk with no per-request lastmod", () => {
    const xml = buildSitemapIndexXml(BASE_URL, 3);

    expect(xml).toContain('<?xml version="1.0" encoding="UTF-8"?>');
    expect(xml).toContain("<sitemapindex");
    expect(xml).toContain(`<loc>${BASE_URL}/sitemap/0.xml</loc>`);
    expect(xml).toContain(`<loc>${BASE_URL}/sitemap/2.xml</loc>`);
    expect(xml).not.toContain("/sitemap/3.xml");
    expect((xml.match(/<loc>/g) ?? []).length).toBe(3);

    // A per-request timestamp claims every child changed "just now" on every
    // crawl; Google then distrusts lastmod. Omitting it is the honest signal.
    expect(xml).not.toContain("<lastmod>");
  });
});
