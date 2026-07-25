/**
 * Programmatic SEO intent registry. Single source of truth shared with the
 * API. The JSON file is the canonical data; this module just types and
 * indexes it.
 *
 * Edit data/seeds/lucknow/intents.json, NOT this file.
 */

import intentsData from "../../../data/seeds/lucknow/intents.json";
import citiesData from "../../../data/seeds/cities.json";

export interface IntentDefinition {
  slug: string;
  category: "property-type" | "audience" | "budget" | "lifestyle";
  label_en: string;
  label_hi: string;
  h1_en: string;
  h1_hi: string;
  applies_to: Array<"locality" | "metro" | "landmark">;
  filters: Record<string, string | number | boolean>;
}

export interface IntentCategory {
  slug: string;
  label_en: string;
  label_hi: string;
}

const RAW = intentsData as unknown as {
  categories: IntentCategory[];
  intents: IntentDefinition[];
};

export const INTENT_CATEGORIES: IntentCategory[] = RAW.categories;
export const ALL_INTENTS: IntentDefinition[] = RAW.intents;

const BY_SLUG = new Map<string, IntentDefinition>(ALL_INTENTS.map((i) => [i.slug, i]));

export function getIntent(slug: string): IntentDefinition | null {
  return BY_SLUG.get(slug) ?? null;
}

export function intentsFor(surface: "locality" | "metro" | "landmark"): IntentDefinition[] {
  return ALL_INTENTS.filter((i) => i.applies_to.includes(surface));
}

export function intentsByCategory(
  surface: "locality" | "metro" | "landmark"
): Array<{ category: IntentCategory; intents: IntentDefinition[] }> {
  return INTENT_CATEGORIES.map((cat) => ({
    category: cat,
    intents: intentsFor(surface).filter((i) => i.category === cat.slug)
  })).filter((group) => group.intents.length > 0);
}

/**
 * Turn an intent's filter object into a query-string param map for the
 * /listings/search endpoint. Stays close to the JSON schema so adding a new
 * intent never requires code changes.
 */
export function intentToSearchParams(intent: IntentDefinition): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(intent.filters)) {
    out[key] = String(value);
  }
  return out;
}

/** Renders an intent's H1 by filling the {place} placeholder. */
export function renderIntentH1(
  intent: IntentDefinition,
  placeName: string,
  locale: "en" | "hi"
): string {
  const template = locale === "hi" ? intent.h1_hi : intent.h1_en;
  return template.replace("{place}", placeName);
}

/**
 * "Gomti Nagar" + "Lucknow" → "Gomti Nagar, Lucknow", but "IET Lucknow" is left
 * alone. Plenty of landmarks already carry the city in their name, and repeating
 * it reads as a typo while burning characters SERPs will truncate.
 */
export function placeWithCity(placeName: string, city: string): string {
  if (!city) return placeName;
  if (placeName.toLowerCase().includes(city.toLowerCase())) return placeName;
  return `${placeName}, ${city}`;
}

export type PlaceKind = "locality" | "metro" | "landmark";

export interface IntentTitlePlace {
  name: string;
  kind: PlaceKind;
  /** Display name of the city, e.g. "Lucknow". Appended unless `name` already carries it. */
  city: string;
}

/** "greater-noida" → "Greater Noida". Fallback for any city not in the seed. */
export function cityLabelFromSlug(slug: string): string {
  return slug
    .split("-")
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

const CITY_LABELS = new Map(
  (citiesData as Array<{ slug: string; name_en: string; name_hi: string }>).map((city) => [
    city.slug,
    { en: city.name_en, hi: city.name_hi }
  ])
);

/**
 * Display name of a city. Seeded cities get their proper name in the requested
 * locale so Hindi titles don't end up half in Latin script; anything not seeded
 * yet degrades to the title-cased slug rather than throwing.
 */
export function cityLabel(slug: string, locale: "en" | "hi"): string {
  return CITY_LABELS.get(slug)?.[locale] ?? cityLabelFromSlug(slug);
}

/**
 * Renders the <title> for a programmatic intent page.
 *
 * Deliberately not the same string as the H1. Two things the H1 gets to skip
 * because the surrounding page supplies them, but a SERP result does not:
 *
 * 1. The city. Nearly every real query carries it ("girls pg near integral
 *    university *lucknow*"), so a title without it matches worse.
 * 2. Proximity. Every h1 template reads "… in {place}", which is right for a
 *    locality but wrong for a landmark or metro station — nobody lives *in*
 *    a university. Searchers type "near".
 *
 * Never append the brand here: the root layout's `title.template` does that,
 * and doing both is what produced "… · Cribliv | Cribliv".
 */
export function renderIntentTitle(
  intent: IntentDefinition,
  place: IntentTitlePlace,
  locale: "en" | "hi"
): string {
  const placePhrase = placeWithCity(place.name, place.city);
  const isProximate = place.kind !== "locality";

  if (locale === "hi") {
    const template = isProximate
      ? intent.h1_hi.replace("{place} में ", "{place} के पास ")
      : intent.h1_hi;
    return template.replace("{place}", placePhrase);
  }

  const template = isProximate
    ? intent.h1_en.replace(/ in \{place\}$/, " near {place}")
    : intent.h1_en;
  return template.replace("{place}", placePhrase);
}
