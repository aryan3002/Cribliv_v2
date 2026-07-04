/**
 * Server-only helpers for fetching SEO page data from the API. Most calls
 * pass `{ server: true }` to fetchApi to ensure no client-side caching
 * during ISR builds. The enabled-city config uses Next revalidation instead.
 *
 * Every function returns a typed shape with sensible fallbacks when the API
 * is unreachable — pages always render, even if aggregates show as zero.
 */

import { fetchApi, buildSearchQuery } from "./api";

export interface PageAggregates {
  listing_count: number;
  pg_count: number;
  flat_count: number;
  median_rent_pg: number | null;
  median_rent_1bhk: number | null;
  median_rent_2bhk: number | null;
  median_rent_3bhk: number | null;
}

export interface LocalityRow {
  id: number;
  slug: string;
  name_en: string;
  name_hi: string;
  lat: number | null;
  lng: number | null;
  parent_locality_slug: string | null;
  listing_count: number;
}

export interface LandmarkRow {
  id: number;
  slug: string;
  name_en: string;
  name_hi: string;
  type: string;
  aka: string[];
  lat: number;
  lng: number;
  primary_locality_slug: string | null;
  primary_locality_name_en: string | null;
}

export interface MetroStationRow {
  id: number;
  station_name: string;
  line_name: string;
  line_color: string;
  lat: number;
  lng: number;
  sequence: number;
}

export interface ListingCard {
  id: string;
  title: string;
  city: string;
  city_name?: string;
  locality?: string | null;
  listing_type: "flat_house" | "pg";
  monthly_rent: number;
  bhk?: number | null;
  furnishing?: string | null;
  area_sqft?: number | null;
  verification_status: "unverified" | "pending" | "verified" | "failed";
  cover_photo?: string | null;
}

interface SearchResponse {
  items: ListingCard[];
  total: number;
  page: number;
  page_size: number;
}

const EMPTY_AGGREGATES: PageAggregates = {
  listing_count: 0,
  pg_count: 0,
  flat_count: 0,
  median_rent_pg: null,
  median_rent_1bhk: null,
  median_rent_2bhk: null,
  median_rent_3bhk: null
};

const FALLBACK_CITY_SLUGS = ["lucknow"];

interface SeoCityRow {
  city_slug: string;
  programmatic_enabled: boolean;
}

export async function fetchLocalities(citySlug: string): Promise<LocalityRow[]> {
  try {
    const res = await fetchApi<{ items: LocalityRow[] }>(
      `/seo/localities/${encodeURIComponent(citySlug)}`,
      undefined,
      { server: true }
    );
    return res.items ?? [];
  } catch {
    return [];
  }
}

/**
 * City slugs whose programmatic SEO pages are live. Falls back to Lucknow on
 * any API problem or empty enabled set so the reference city never goes dark.
 */
export async function fetchEnabledCities(): Promise<Set<string>> {
  try {
    const res = await fetchApi<{ items: SeoCityRow[] }>("/seo/cities", {
      next: { revalidate: 3600 }
    });
    const enabled = (res.items ?? [])
      .filter((city) => city.programmatic_enabled)
      .map((city) => city.city_slug);
    return new Set(enabled.length > 0 ? enabled : FALLBACK_CITY_SLUGS);
  } catch {
    return new Set(FALLBACK_CITY_SLUGS);
  }
}

export async function fetchLocality(
  citySlug: string,
  localitySlug: string
): Promise<{ locality: LocalityRow; aggregates: PageAggregates } | null> {
  try {
    const res = await fetchApi<{ locality: LocalityRow; aggregates: PageAggregates } | null>(
      `/seo/localities/${encodeURIComponent(citySlug)}/${encodeURIComponent(localitySlug)}`,
      undefined,
      { server: true }
    );
    return res ?? null;
  } catch {
    return null;
  }
}

export async function fetchLandmarks(citySlug: string, type?: string): Promise<LandmarkRow[]> {
  try {
    const qs = type ? `?type=${encodeURIComponent(type)}` : "";
    const res = await fetchApi<{ items: LandmarkRow[] }>(
      `/landmarks/${encodeURIComponent(citySlug)}${qs}`,
      undefined,
      { server: true }
    );
    return res.items ?? [];
  } catch {
    return [];
  }
}

export async function fetchLandmark(
  citySlug: string,
  landmarkSlug: string
): Promise<LandmarkRow | null> {
  try {
    return await fetchApi<LandmarkRow>(
      `/landmarks/${encodeURIComponent(citySlug)}/${encodeURIComponent(landmarkSlug)}`,
      undefined,
      { server: true }
    );
  } catch {
    return null;
  }
}

export async function fetchLandmarkListings(
  citySlug: string,
  landmarkSlug: string,
  opts: { radiusKm?: number; limit?: number } = {}
): Promise<{ items: ListingCard[]; radius_km: number; landmark: LandmarkRow } | null> {
  try {
    const qs = new URLSearchParams();
    if (opts.radiusKm) qs.set("radius_km", String(opts.radiusKm));
    if (opts.limit) qs.set("limit", String(opts.limit));
    const suffix = qs.toString() ? `?${qs.toString()}` : "";
    return await fetchApi(
      `/landmarks/${encodeURIComponent(citySlug)}/${encodeURIComponent(landmarkSlug)}/listings${suffix}`,
      undefined,
      { server: true }
    );
  } catch {
    return null;
  }
}

export async function fetchMetroStation(
  city: string,
  stationSlug: string
): Promise<{ station: MetroStationRow; aggregates: PageAggregates } | null> {
  try {
    return await fetchApi(
      `/seo/metro/${encodeURIComponent(city)}/${encodeURIComponent(stationSlug)}`,
      undefined,
      { server: true }
    );
  } catch {
    return null;
  }
}

export async function fetchMetroStationsForCity(city: string): Promise<MetroStationRow[]> {
  try {
    // /map/metro returns stations keyed as `name`, not `station_name`. Map
    // them into the SEO row shape so callers can rely on station_name.
    const res = await fetchApi<{
      lines: Array<{
        line_name: string;
        line_color: string;
        stations: Array<{ id: number; name: string; lat: number; lng: number; sequence: number }>;
      }>;
    }>(`/map/metro?city=${encodeURIComponent(city)}`, undefined, { server: true });
    return (res.lines ?? []).flatMap((line) =>
      line.stations.map((s) => ({
        id: s.id,
        station_name: s.name,
        line_name: line.line_name,
        line_color: line.line_color,
        lat: s.lat,
        lng: s.lng,
        sequence: s.sequence
      }))
    );
  } catch {
    return [];
  }
}

export async function fetchListings(
  params: Record<string, string | number | boolean | undefined>
): Promise<{ items: ListingCard[]; total: number }> {
  try {
    const res = await fetchApi<SearchResponse>(
      `/listings/search?${buildSearchQuery(params)}`,
      undefined,
      { server: true }
    );
    return { items: res.items, total: res.total };
  } catch {
    return { items: [], total: 0 };
  }
}

export interface SeoCopy {
  h1: string;
  meta_title: string;
  meta_description: string;
  intro_paragraph: string;
  nearby_blurb: string | null;
  faq_items: Array<{ q: string; a: string }>;
}

export async function fetchSeoCopy(input: {
  pagePath: string;
  locale: "en" | "hi";
  placeName: { en: string; hi: string };
  placeKind: "city" | "locality" | "metro" | "landmark";
  intentLabel?: { en: string; hi: string } | null;
  aggregates: PageAggregates & {
    nearest_metro?: { name: string; walk_minutes: number } | null;
    parent_locality?: string | null;
  };
}): Promise<SeoCopy | null> {
  try {
    return await fetchApi<SeoCopy | null>(
      "/seo/copy",
      { method: "POST", body: JSON.stringify(input) },
      { server: true }
    );
  } catch {
    return null;
  }
}

export { EMPTY_AGGREGATES };
