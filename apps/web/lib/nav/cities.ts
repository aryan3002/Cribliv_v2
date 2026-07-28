/**
 * Canonical hub-city list. Before this module the same 8 slugs were repeated in
 * sitemap.ts, city/[citySlug]/page.tsx, search/page.tsx, the homepage grid and
 * (as an alias map) search-segment.ts — in four different shapes.
 *
 * Order is meaningful: it is the order cities appear in the nav's city chip.
 * `varanasi` is deliberately absent — the homepage shows a card for it, but it
 * has no programmatic SEO support, no PG_CITY_CONTENT entry and no rent-in
 * entry, so the nav must not offer it.
 */
export interface HubCity {
  slug: string;
  label: string;
}

export const HUB_CITIES: ReadonlyArray<HubCity> = [
  { slug: "delhi", label: "Delhi" },
  { slug: "gurugram", label: "Gurugram" },
  { slug: "noida", label: "Noida" },
  { slug: "ghaziabad", label: "Ghaziabad" },
  { slug: "faridabad", label: "Faridabad" },
  { slug: "chandigarh", label: "Chandigarh" },
  { slug: "jaipur", label: "Jaipur" },
  { slug: "lucknow", label: "Lucknow" }
];

export const HUB_CITY_SLUGS: ReadonlyArray<string> = HUB_CITIES.map((c) => c.slug);
