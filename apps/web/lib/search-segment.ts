import { buildSearchQuery } from "./api";

/**
 * The Homes | PG segment is the single source of truth for the split search
 * surfaces. Homes lives at `/[locale]/search` (flats & houses); PG lives at
 * `/[locale]/pg`. Each surface hard-filters its own listing type, so the two
 * never bleed into each other.
 */
export type SearchSegment = "homes" | "pg";

/** Derive the active segment from the current route. PG owns the `/pg` subtree. */
export function segmentFromPathname(locale: string, pathname: string | null): SearchSegment {
  if (!pathname) return "homes";
  return pathname === `/${locale}/pg` || pathname.startsWith(`/${locale}/pg/`) ? "pg" : "homes";
}

/** Known city name/alias → canonical slug. The search bar resolves a typed place to `city`. */
const CITY_ALIASES: Record<string, string> = {
  delhi: "delhi",
  "new delhi": "delhi",
  gurugram: "gurugram",
  gurgaon: "gurugram",
  noida: "noida",
  ghaziabad: "ghaziabad",
  faridabad: "faridabad",
  chandigarh: "chandigarh",
  jaipur: "jaipur",
  lucknow: "lucknow"
};

/** Slugify any text to a city-slug shape (lowercase, hyphenated). */
export function slugifyCity(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Resolve typed text to a canonical city slug — ONLY for known cities/aliases.
 * Returns `undefined` for anything else (a locality, a keyword), so callers can
 * fall back to a free-text `q` search instead of dead-ending on a bogus
 * `city=<slug>` that matches no city.
 */
export function resolveCity(input: string): string | undefined {
  const key = input.trim().toLowerCase();
  if (!key) return undefined;
  return CITY_ALIASES[key] ?? CITY_ALIASES[slugifyCity(key)];
}

/**
 * Turn a typed place into the right search param: a known city → `{ city }`,
 * anything else → `{ q }` (free-text, matched against title/city/locality by the
 * backend). Empty input → `{}`.
 */
export function placeSearchParam(input: string): { city?: string; q?: string } {
  const city = resolveCity(input);
  if (city) return { city };
  const t = input.trim();
  return t ? { q: t } : {};
}

/**
 * Build the URL for a segment. `listing_type` is intentionally dropped — the
 * segment *is* the type, enforced server-side per surface — and `page` is reset
 * because the params changed. Empty/undefined params are omitted.
 */
export function hrefForSegment(
  locale: string,
  segment: SearchSegment,
  params: Record<string, string | undefined> = {}
): string {
  const base = segment === "pg" ? `/${locale}/pg` : `/${locale}/search`;
  const { listing_type: _listingType, page: _page, ...rest } = params;
  const qs = buildSearchQuery(rest);
  return qs ? `${base}?${qs}` : base;
}
