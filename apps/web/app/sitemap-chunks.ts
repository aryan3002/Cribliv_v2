import { INDEXABLE_MIN_LISTINGS } from "@cribliv/shared-types";
import type { MetadataRoute } from "next";

import { ALL_INTENTS } from "../lib/intent-filters";

type ChangeFrequency = NonNullable<MetadataRoute.Sitemap[number]["changeFrequency"]>;

/**
 * @deprecated Import `INDEXABLE_MIN_LISTINGS` from `@cribliv/shared-types`
 * directly. Kept as a local alias only so the call sites in this module read
 * naturally. Never reassign this to a literal — the API computes indexability
 * from the shared constant and the two must not drift.
 */
export const THIN_LISTING_THRESHOLD = INDEXABLE_MIN_LISTINGS;
export const LOCALES = ["en", "hi"] as const;

export const LOCALITY_INTENTS = ALL_INTENTS.filter((intent) =>
  intent.applies_to.includes("locality")
);
export const METRO_INTENTS = ALL_INTENTS.filter((intent) => intent.applies_to.includes("metro"));
export const LANDMARK_INTENTS = ALL_INTENTS.filter((intent) =>
  intent.applies_to.includes("landmark")
);

function altLanguages(baseUrl: string, path: string): Record<(typeof LOCALES)[number], string> {
  return Object.fromEntries(
    LOCALES.map((locale) => [locale, `${baseUrl}/${locale}${path}`])
  ) as Record<(typeof LOCALES)[number], string>;
}

export function entry(
  baseUrl: string,
  path: string,
  options: { priority?: number; freq?: ChangeFrequency; lastModified?: Date } = {}
): MetadataRoute.Sitemap {
  const priority = options.priority ?? 0.5;
  const changeFrequency = options.freq ?? "weekly";

  return LOCALES.map((locale) => {
    const row: MetadataRoute.Sitemap[number] = {
      url: `${baseUrl}/${locale}${path}`,
      changeFrequency,
      priority,
      alternates: { languages: altLanguages(baseUrl, path) }
    };
    // Only emit lastmod when we have a real content-change date. A per-request
    // `new Date()` marks every URL "changed just now" on every crawl, which
    // teaches Google to ignore our lastmod entirely — worse than omitting it.
    if (options.lastModified) row.lastModified = options.lastModified;
    return row;
  });
}

/**
 * Renders the `<sitemapindex>` that points at each generated child sitemap
 * (`/sitemap/0.xml` … `/sitemap/{count-1}.xml`).
 *
 * Intentionally emits no `<lastmod>`: the child list is derived per request, so
 * any timestamp here would be "now" on every fetch — an unreliable signal that
 * Google discards. Omission is the honest default.
 */
export function buildSitemapIndexXml(baseUrl: string, count: number): string {
  const entries = Array.from(
    { length: count },
    (_, id) => `  <sitemap><loc>${baseUrl}/sitemap/${id}.xml</loc></sitemap>`
  ).join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${entries}\n</sitemapindex>`;
}

/** Byte-identical to the template link + API resolver rule — NO hyphen trim. */
export function metroSlug(stationName: string): string {
  return stationName.toLowerCase().replace(/[^a-z0-9]+/g, "-");
}

export function buildCityLocalityEntries(
  baseUrl: string,
  citySlug: string,
  localities: Array<{ slug: string; listing_count?: number | null }>
): MetadataRoute.Sitemap {
  const rows: MetadataRoute.Sitemap = [];

  for (const locality of localities) {
    if ((locality.listing_count ?? 0) < THIN_LISTING_THRESHOLD) continue;

    rows.push(...entry(baseUrl, `/city/${citySlug}/${locality.slug}`, { priority: 0.75 }));
    for (const intent of LOCALITY_INTENTS) {
      rows.push(
        ...entry(baseUrl, `/city/${citySlug}/${locality.slug}/${intent.slug}`, {
          priority: 0.6
        })
      );
    }
  }

  return rows;
}

export function buildCityMetroEntries(
  baseUrl: string,
  citySlug: string,
  stations: Array<{ station_name: string }>
): MetadataRoute.Sitemap {
  const rows: MetadataRoute.Sitemap = [];

  for (const station of stations) {
    const slug = metroSlug(station.station_name);
    rows.push(...entry(baseUrl, `/city/${citySlug}/metro/${slug}`, { priority: 0.7 }));
    for (const intent of METRO_INTENTS) {
      rows.push(
        ...entry(baseUrl, `/city/${citySlug}/metro/${slug}/${intent.slug}`, {
          priority: 0.55
        })
      );
    }
  }

  return rows;
}

export function buildCityLandmarkEntries(
  baseUrl: string,
  citySlug: string,
  landmarks: Array<{ slug: string }>
): MetadataRoute.Sitemap {
  const rows: MetadataRoute.Sitemap = [];

  for (const landmark of landmarks) {
    rows.push(...entry(baseUrl, `/city/${citySlug}/near/${landmark.slug}`, { priority: 0.7 }));
    for (const intent of LANDMARK_INTENTS) {
      rows.push(
        ...entry(baseUrl, `/city/${citySlug}/near/${landmark.slug}/${intent.slug}`, {
          priority: 0.55
        })
      );
    }
  }

  return rows;
}
