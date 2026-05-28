/**
 * Programmatic SEO intent registry. Single source of truth shared with the
 * API. The JSON file is the canonical data; this module just types and
 * indexes it.
 *
 * Edit data/seeds/lucknow/intents.json, NOT this file.
 */

import intentsData from "../../../data/seeds/lucknow/intents.json";

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
