// Pure helpers behind the listening hero: pin dim predicate, the debounced
// counter's API path, and the submit handoff URL into CriblMap. Pure and
// unit-tested; the component (home-listening-hero.tsx) stays thin.

import { chipsToFilters, type ParsedChip } from "./smart-parser";
import { buildSearchQuery } from "./api";
import { centroidOf } from "./geo";
import type { HomeCityConfig } from "./home-city-config";

export interface HeroPin {
  id: string;
  lat: number;
  lng: number;
  monthly_rent: number;
  listing_type: string;
  bhk: number | null;
  verification_status: string;
  furnishing: string | null;
  city: string;
  locality: string | null;
  locality_slug: string | null;
}

export function pinMatchesChips(pin: HeroPin, chips: ParsedChip[]): boolean {
  for (const chip of chips) {
    switch (chip.kind) {
      case "bhk":
        if (pin.bhk !== Number(chip.value)) return false;
        break;
      case "max_rent":
        if (!(pin.monthly_rent <= Number(chip.value))) return false;
        break;
      case "min_rent":
        if (!(pin.monthly_rent >= Number(chip.value))) return false;
        break;
      case "listing_type":
        if (pin.listing_type !== String(chip.value)) return false;
        break;
      case "furnishing":
        if ((pin.furnishing ?? "") !== String(chip.value)) return false;
        break;
      case "city":
        if (pin.city.toLowerCase() !== String(chip.value).toLowerCase()) return false;
        break;
      case "locality": {
        const wanted = String(chip.value).toLowerCase();
        const name = (pin.locality ?? "").toLowerCase();
        const slug = (pin.locality_slug ?? "").toLowerCase();
        if (name !== wanted && slug !== wanted && slug !== wanted.replace(/\s+/g, "-")) {
          return false;
        }
        break;
      }
      case "amenity":
        // Pins carry no amenity data — an amenity chip must never dim pins.
        break;
    }
  }
  return true;
}

export function buildHeroCountPath(chips: ParsedChip[], citySlug: string): string {
  const filters = chipsToFilters(chips);
  // Amenity words land in `q`; they'd narrow the count via FTS in ways the
  // pins can't mirror, so the counter ignores them.
  delete filters.q;
  if (typeof filters.city !== "string" || !filters.city) filters.city = citySlug;
  return `/listings/search?${buildSearchQuery({ ...filters, page: 1, page_size: 1 })}`;
}

export function buildMapHandoffUrl(
  locale: string,
  chips: ParsedChip[],
  city: HomeCityConfig,
  pins: HeroPin[]
): string {
  const filters = chipsToFilters(chips);
  const params: Record<string, string | number | boolean | undefined> = {
    city: typeof filters.city === "string" && filters.city ? filters.city : city.slug,
    bhk: typeof filters.bhk === "number" ? filters.bhk : undefined,
    max_rent: typeof filters.max_rent === "number" ? filters.max_rent : undefined,
    listing_type:
      filters.listing_type === "pg" || filters.listing_type === "flat_house"
        ? (filters.listing_type as string)
        : undefined,
    src: "hero"
  };

  // The map page has no `locality` param; center it on the locality instead
  // by passing the centroid of the hero pins that match the locality chip.
  const localityChips = chips.filter((c) => c.kind === "locality");
  if (localityChips.length > 0) {
    const matches = pins.filter((p) => pinMatchesChips(p, localityChips));
    const centroid = centroidOf(matches);
    if (centroid) {
      params.lat = centroid.lat.toFixed(5);
      params.lng = centroid.lng.toFixed(5);
      params.zoom = 14;
    }
  }

  return `/${locale}/map?${buildSearchQuery(params)}`;
}
