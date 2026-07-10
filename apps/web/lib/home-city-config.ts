// Single source of city truth for the listening-hero homepage. Nothing in
// the hero may hardcode a city slug — adding a city later must be one entry
// here plus one generated backdrop asset (scripts/generate-home-map.mjs).

import { CITY_BBOXES } from "./city-bboxes";
import type { GeoBounds, GeoPoint } from "./geo";

export interface HomeCityConfig {
  slug: string;
  label: { en: string; hi: string };
  // Public path prefix of the backdrop asset, without extension.
  // `${backdrop}.png` (landscape) and `${backdrop}-mobile.png` (portrait).
  backdrop: string;
  // EXACT geographic bounds of the generated backdrop image. Image and
  // bounds are only valid as a pair — regenerate both together with
  // scripts/generate-home-map.mjs, which prints this object.
  bounds: GeoBounds;
  center: GeoPoint;
  zoom: number;
  // Below this listing count the hero hides the counter and pins and shows
  // the "growing in {city}" subline instead. Small numbers never render.
  minHeroInventory: number;
}

export const DEFAULT_HOME_CITY = "lucknow";
export const HOME_CITY_COOKIE = "cribliv_home_city";

export const HOME_CITIES: Record<string, HomeCityConfig> = {
  lucknow: {
    slug: "lucknow",
    label: { en: "Lucknow", hi: "लखनऊ" },
    backdrop: "/images/home/lucknow-dusk",
    // Provisional: CITY_BBOXES until the asset script replaces it (Task 4).
    bounds: CITY_BBOXES.lucknow,
    center: { lat: 26.8467, lng: 80.9462 },
    zoom: 12,
    minHeroInventory: 25
  }
};

export function resolveHomeCity(input: {
  chipCity?: string | null;
  cookieCity?: string | null;
  geoCity?: string | null;
}): HomeCityConfig {
  for (const candidate of [input.chipCity, input.cookieCity, input.geoCity]) {
    const slug = candidate?.trim().toLowerCase();
    if (slug && HOME_CITIES[slug]) return HOME_CITIES[slug];
  }
  return HOME_CITIES[DEFAULT_HOME_CITY];
}
