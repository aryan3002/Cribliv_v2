import type { MetadataRoute } from "next";

import { ALL_INTENTS } from "../lib/intent-filters";

type ChangeFrequency = NonNullable<MetadataRoute.Sitemap[number]["changeFrequency"]>;

export const THIN_LISTING_THRESHOLD = 3;
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
  options: { priority?: number; freq?: ChangeFrequency } = {}
): MetadataRoute.Sitemap {
  const priority = options.priority ?? 0.5;
  const changeFrequency = options.freq ?? "weekly";

  return LOCALES.map((locale) => ({
    url: `${baseUrl}/${locale}${path}`,
    lastModified: new Date(),
    changeFrequency,
    priority,
    alternates: { languages: altLanguages(baseUrl, path) }
  }));
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
