import type { IntentDefinition } from "../intent-filters";

/**
 * The SEO intent registry (data/seeds/lucknow/intents.json) speaks the search
 * API's filter vocabulary. The public PG endpoint speaks a different one, and
 * three intent keys (`tag`, `amenity`, `max_area_sqft`) are accepted by neither.
 *
 * Passing filters through untranslated produces links that silently do nothing —
 * and, for any intent carrying listing_type=pg, produces /search?listing_type=pg,
 * which app/[locale]/search/page.tsx redirects. This module is the single place
 * that prevents both.
 */
export type NavSurface = "search" | "pg";

/** GET /listings/search — apps/api/src/modules/search/search.controller.ts */
export const SEARCH_PARAMS: ReadonlySet<string> = new Set([
  "q",
  "city",
  "locality",
  "listing_type",
  "min_rent",
  "max_rent",
  "bhk",
  "furnishing",
  "verified_only",
  "sort",
  "page",
  "page_size",
  "source",
  "lat",
  "lng",
  "radius_km",
  "min_deposit",
  "max_deposit",
  "preferred_tenant",
  "availability",
  "occupancy_type",
  "food_included",
  "gender_policy",
  "tenant_type",
  "sharing",
  "ac"
]);

/** GET /pg/listings — apps/api/src/modules/pg-operator/services/pg-search.service.ts */
export const PG_PARAMS: ReadonlySet<string> = new Set([
  "city",
  "locality",
  "q",
  "min_rent",
  "max_rent",
  "gender_policy",
  "tenant_type",
  "food_included",
  "sharing",
  "ac",
  "sort",
  "page",
  "page_size"
]);

/** occupancy_type (search vocabulary) → gender_policy (PG vocabulary). */
const OCCUPANCY_TO_GENDER: Record<string, string> = {
  female: "girls",
  male: "boys",
  co_living: "coed"
};

export function isPgIntent(intent: IntentDefinition): boolean {
  return intent.filters.listing_type === "pg";
}

export function translateFilters(
  filters: IntentDefinition["filters"],
  surface: NavSurface
): Record<string, string> {
  const accepted = surface === "pg" ? PG_PARAMS : SEARCH_PARAMS;
  const out: Record<string, string> = {};

  for (const [key, rawValue] of Object.entries(filters)) {
    const value = String(rawValue);

    // listing_type=pg is the one value that triggers the /search redirect
    // (app/[locale]/search/page.tsx), so it must never survive onto that
    // surface. Other values (e.g. flat_house) are a normal accepted search
    // param and fall through to the accepted-set check below. On /pg the
    // listing type is already implied by the surface, and PG_PARAMS has no
    // listing_type key at all, so the same fallthrough drops it there too.
    if (key === "listing_type" && value === "pg") continue;

    if (key === "occupancy_type" && surface === "pg") {
      const mapped = OCCUPANCY_TO_GENDER[value];
      if (mapped) out.gender_policy = mapped;
      continue;
    }

    // No endpoint has a tag filter; fall back to free text so the link still
    // narrows something rather than silently doing nothing.
    if (key === "tag") {
      out.q = value;
      continue;
    }

    if (key === "amenity") {
      if (value === "ac") out.ac = "true";
      continue;
    }

    if (!accepted.has(key)) continue;

    out[key] = value;
  }

  return out;
}
