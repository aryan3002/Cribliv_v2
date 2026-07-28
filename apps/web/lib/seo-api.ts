/**
 * Server-only helpers for fetching SEO page data from the API.
 *
 * Caching: pass `{ revalidate: N }` from a static/ISR page (one with
 * generateStaticParams + `export const revalidate`) so the fetch is ISR-cached
 * and the route stays static — rendered once per revalidate window and served
 * from cache, not re-rendered per request. Aligning the fetch's revalidate with
 * the page's is what actually makes "the page's ISR revalidation govern
 * freshness". Omit it (the default) on genuinely dynamic pages to keep no-store.
 * NOTE: a single no-store fetch opts the whole route back into per-request SSR,
 * so an ISR page must pass revalidate to EVERY helper it calls.
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

export async function fetchLocalities(
  citySlug: string,
  opts: { revalidate?: number } = {}
): Promise<LocalityRow[]> {
  try {
    const res = await fetchApi<{ items: LocalityRow[] }>(
      `/seo/localities/${encodeURIComponent(citySlug)}`,
      undefined,
      { server: true, revalidate: opts.revalidate }
    );
    return res.items ?? [];
  } catch {
    return [];
  }
}

/**
 * City slugs whose programmatic SEO pages are live. Falls back to Lucknow on
 * any API problem or empty enabled set so the reference city never goes dark.
 *
 * An ISR caller should pass its own `revalidate` (e.g. 3600) so this fetch is
 * cached for the same window as the page — an admin enabling a city is then
 * reflected on the next revalidation (hourly), exactly the hub's SLA, while the
 * page still serves from cache in between. Omitting revalidate keeps it no-store
 * (per-request fresh) for any caller that needs it.
 */
export async function fetchEnabledCities(opts: { revalidate?: number } = {}): Promise<Set<string>> {
  try {
    const res = await fetchApi<{ items: SeoCityRow[] }>("/seo/cities", undefined, {
      server: true,
      revalidate: opts.revalidate
    });
    const enabled = (res.items ?? [])
      .filter((city) => city.programmatic_enabled)
      .map((city) => city.city_slug);
    return new Set(enabled.length > 0 ? enabled : FALLBACK_CITY_SLUGS);
  } catch {
    return new Set(FALLBACK_CITY_SLUGS);
  }
}

export interface SeoPlace {
  slug: string;
  name_en: string;
  name_hi: string | null;
  listing_count: number;
  indexable: boolean;
}

export interface CityPlaces {
  city_slug: string;
  localities: SeoPlace[];
  metro_stations: SeoPlace[];
  landmarks: SeoPlace[];
}

/**
 * Every place in a city with a server-computed `indexable` flag. This is the
 * sitemap's only source for which programmatic URLs may be submitted — do not
 * re-apply a listing threshold on the web side, and do not go back to
 * `/map/metro`, which returns whole metro lines rather than a city's stations.
 */
export async function fetchCityPlaces(
  citySlug: string,
  opts: { revalidate?: number } = {}
): Promise<CityPlaces> {
  try {
    const res = await fetchApi<CityPlaces>(
      `/seo/cities/${encodeURIComponent(citySlug)}/places`,
      undefined,
      { server: true, revalidate: opts.revalidate }
    );
    return {
      city_slug: res.city_slug ?? citySlug,
      localities: res.localities ?? [],
      metro_stations: res.metro_stations ?? [],
      landmarks: res.landmarks ?? []
    };
  } catch {
    return { city_slug: citySlug, localities: [], metro_stations: [], landmarks: [] };
  }
}

export interface CityMetroStation extends MetroStationRow {
  /** Derived server-side by the same expression the page resolver matches on. */
  slug: string;
  listing_count: number;
}

/**
 * The city's OWN metro stations, with line topology, coordinates and counts.
 *
 * Use this for anything that renders station links or picks a nearest station.
 *
 * Do NOT reach for the map's `/map/metro` endpoint here: it returns whole metro
 * LINES that merely touch a city — correct for drawing a map, but the reason
 * phantom Delhi stations (kashmere-gate, rajiv-chowk) were once linked under
 * Faridabad and Ghaziabad and rendered as HTTP-200 soft 404s. A `seo-api`
 * wrapper around it used to live here and has been deleted so it cannot be
 * picked up again by mistake.
 */
export async function fetchCityMetroStations(
  citySlug: string,
  opts: { revalidate?: number } = {}
): Promise<CityMetroStation[]> {
  try {
    const res = await fetchApi<{ items: CityMetroStation[] }>(
      `/seo/cities/${encodeURIComponent(citySlug)}/metro-stations`,
      undefined,
      { server: true, revalidate: opts.revalidate }
    );
    return res.items ?? [];
  } catch {
    return [];
  }
}

export async function fetchLocality(
  citySlug: string,
  localitySlug: string,
  opts: { revalidate?: number } = {}
): Promise<{ locality: LocalityRow; aggregates: PageAggregates } | null> {
  try {
    const res = await fetchApi<{ locality: LocalityRow; aggregates: PageAggregates } | null>(
      `/seo/localities/${encodeURIComponent(citySlug)}/${encodeURIComponent(localitySlug)}`,
      undefined,
      { server: true, revalidate: opts.revalidate }
    );
    return res ?? null;
  } catch {
    return null;
  }
}

export async function fetchLandmarks(
  citySlug: string,
  type?: string,
  opts: { revalidate?: number } = {}
): Promise<LandmarkRow[]> {
  try {
    const qs = type ? `?type=${encodeURIComponent(type)}` : "";
    const res = await fetchApi<{ items: LandmarkRow[] }>(
      `/landmarks/${encodeURIComponent(citySlug)}${qs}`,
      undefined,
      { server: true, revalidate: opts.revalidate }
    );
    return res.items ?? [];
  } catch {
    return [];
  }
}

export async function fetchLandmark(
  citySlug: string,
  landmarkSlug: string,
  opts: { revalidate?: number } = {}
): Promise<LandmarkRow | null> {
  try {
    return await fetchApi<LandmarkRow>(
      `/landmarks/${encodeURIComponent(citySlug)}/${encodeURIComponent(landmarkSlug)}`,
      undefined,
      { server: true, revalidate: opts.revalidate }
    );
  } catch {
    return null;
  }
}

export async function fetchLandmarkListings(
  citySlug: string,
  landmarkSlug: string,
  opts: { radiusKm?: number; limit?: number; revalidate?: number } = {}
): Promise<{ items: ListingCard[]; radius_km: number; landmark: LandmarkRow } | null> {
  try {
    const qs = new URLSearchParams();
    if (opts.radiusKm) qs.set("radius_km", String(opts.radiusKm));
    if (opts.limit) qs.set("limit", String(opts.limit));
    const suffix = qs.toString() ? `?${qs.toString()}` : "";
    return await fetchApi(
      `/landmarks/${encodeURIComponent(citySlug)}/${encodeURIComponent(landmarkSlug)}/listings${suffix}`,
      undefined,
      { server: true, revalidate: opts.revalidate }
    );
  } catch {
    return null;
  }
}

export async function fetchMetroStation(
  city: string,
  stationSlug: string,
  opts: { revalidate?: number } = {}
): Promise<{ station: MetroStationRow; aggregates: PageAggregates } | null> {
  try {
    return await fetchApi(
      `/seo/metro/${encodeURIComponent(city)}/${encodeURIComponent(stationSlug)}`,
      undefined,
      { server: true, revalidate: opts.revalidate }
    );
  } catch {
    return null;
  }
}

export async function fetchListings(
  params: Record<string, string | number | boolean | undefined>,
  opts: { revalidate?: number } = {}
): Promise<{ items: ListingCard[]; total: number }> {
  try {
    const res = await fetchApi<SearchResponse>(
      `/listings/search?${buildSearchQuery(params)}`,
      undefined,
      { server: true, revalidate: opts.revalidate }
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
  revalidate?: number;
}): Promise<SeoCopy | null> {
  try {
    // Public read only — the batch generator (admin) pre-populates copy; the
    // render never triggers the LLM and needs no auth. Only path + locale are
    // used; the rest of the input stays for the caller's own convenience.
    const params = new URLSearchParams({ path: input.pagePath, locale: input.locale });
    return await fetchApi<SeoCopy | null>(`/seo/copy?${params.toString()}`, undefined, {
      server: true,
      revalidate: input.revalidate
    });
  } catch {
    return null;
  }
}

export { EMPTY_AGGREGATES };
