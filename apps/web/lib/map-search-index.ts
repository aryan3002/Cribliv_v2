import cities from "../../../data/seeds/cities.json";
import localities from "../../../data/seeds/localities.json";
import lucknowMicroLocalities from "../../../data/seeds/lucknow/micro-localities.json";
import { cityCentroid } from "./city-bboxes";

export interface MapSearchHit {
  id: string;
  label: string;
  detail: string;
  lat: number;
  lng: number;
  city: string;
  kind: "city" | "locality";
}

interface CitySeed {
  slug: string;
  name_en: string;
  name_hi?: string;
  state_en?: string;
}

interface LocalitySeed {
  city_slug?: string;
  slug: string;
  name_en: string;
  name_hi?: string;
  parent_slug?: string;
  lat?: number;
  lng?: number;
  seo_aliases?: string[];
}

function normalize(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\u0900-\u097f]+/g, " ")
    .trim();
}

function compact(value: string): string {
  return normalize(value).replace(/\s+/g, "");
}

function slugLabel(slug: string): string {
  return slug
    .split("-")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

const cityBySlug = new Map((cities as CitySeed[]).map((city) => [city.slug, city]));

const cityHits: MapSearchHit[] = (cities as CitySeed[])
  .map((city): MapSearchHit | null => {
    const center = cityCentroid(city.slug);
    if (!center) return null;
    return {
      id: `city:${city.slug}`,
      label: city.name_en,
      detail: city.state_en ?? "India",
      lat: center.lat,
      lng: center.lng,
      city: city.slug,
      kind: "city" as const
    };
  })
  .filter((hit): hit is MapSearchHit => hit !== null);

// Both seed sources, normalized so every entry carries an explicit city_slug.
const localitySeeds: LocalitySeed[] = [
  ...(localities as LocalitySeed[]),
  ...(lucknowMicroLocalities as LocalitySeed[]).map((locality) => ({
    ...locality,
    city_slug: "lucknow"
  }))
];

const localityHits: MapSearchHit[] = localitySeeds
  .map((locality): MapSearchHit | null => {
    const citySlug = locality.city_slug;
    if (!citySlug || locality.lat == null || locality.lng == null) return null;
    const city = cityBySlug.get(citySlug);
    return {
      id: `locality:${citySlug}:${locality.slug}`,
      label: locality.name_en,
      detail: city
        ? `${city.name_en}${locality.parent_slug ? ` · ${slugLabel(locality.parent_slug)}` : ""}`
        : citySlug,
      lat: locality.lat,
      lng: locality.lng,
      city: citySlug,
      kind: "locality" as const
    };
  })
  .filter((hit): hit is MapSearchHit => hit !== null);

// Parent areas (e.g. "Alambagh", "Aliganj") are referenced only as `parent_slug`
// on their child localities — they have no seed row of their own, so previously
// typing the area name surfaced nothing but its children. Synthesize a selectable
// area hit per parent, centred on the mean of its children, and dedupe against any
// parent that already exists as a real locality or city.
const localitySlugKeys = new Set(
  localitySeeds.filter((l) => l.city_slug).map((l) => `${l.city_slug}:${l.slug}`)
);

const areaAccumulators = new Map<
  string,
  { citySlug: string; parentSlug: string; latSum: number; lngSum: number; count: number }
>();
for (const locality of localitySeeds) {
  const { city_slug: citySlug, parent_slug: parentSlug, lat, lng } = locality;
  if (!citySlug || !parentSlug || lat == null || lng == null) continue;
  const key = `${citySlug}:${parentSlug}`;
  if (localitySlugKeys.has(key) || cityBySlug.has(parentSlug)) continue; // already selectable
  const acc = areaAccumulators.get(key) ?? { citySlug, parentSlug, latSum: 0, lngSum: 0, count: 0 };
  acc.latSum += lat;
  acc.lngSum += lng;
  acc.count += 1;
  areaAccumulators.set(key, acc);
}

const areaHits: MapSearchHit[] = [...areaAccumulators.values()].map((acc) => {
  const city = cityBySlug.get(acc.citySlug);
  return {
    id: `area:${acc.citySlug}:${acc.parentSlug}`,
    label: slugLabel(acc.parentSlug),
    detail: city ? city.name_en : acc.citySlug,
    lat: acc.latSum / acc.count,
    lng: acc.lngSum / acc.count,
    city: acc.citySlug,
    kind: "locality" as const
  };
});

// Static (network-free) slug lists for callers that haven't wired up a live
// search dictionary (e.g. GET /listings/search/dictionary) — notably
// buildMapIntent's defaults in map-intent.ts, which must stay a pure module.
// Computed once at import time from the same bundled seed JSON this file
// already parses, so they never drift from what searchMapIndex can resolve.
export const KNOWN_CITY_SLUGS: string[] = cityHits.map((hit) => hit.city);
export const KNOWN_LOCALITY_SLUGS: string[] = [...localityHits, ...areaHits].map(
  (hit) => hit.id.split(":").pop() as string
);

// Scoring tiers. A "name" alias is the place's own identity (its name/slug/aliases);
// a "context" alias is a broader container (its city or parent area). Context matches
// must always rank below name matches so that typing a city name surfaces the CITY
// first, followed by its localities — never an alphabetical dump of localities that
// merely share the city (the previous bug, where the city slug was a full-weight alias).
const NAME_TIER = { exact: 100, prefix: 80, includes: 55 };
const CONTEXT_TIER = { exact: 40, prefix: 34, includes: 22 };

function aliasSet(tokens: (string | undefined)[]): string[] {
  return Array.from(
    new Set(
      tokens
        .filter((t): t is string => Boolean(t))
        .flatMap((token) => [normalize(token), compact(token)])
        .filter(Boolean)
    )
  );
}

interface IndexedHit {
  hit: MapSearchHit;
  nameAliases: string[];
  contextAliases: string[];
}

const seedByKey = new Map(
  localitySeeds.filter((l) => l.city_slug).map((l) => [`${l.city_slug}:${l.slug}`, l])
);

const indexed: IndexedHit[] = [
  ...cityHits.map((hit) => ({
    hit,
    // A city's slug *is* its name, so it belongs in the name tier.
    nameAliases: aliasSet([hit.label, hit.city]),
    contextAliases: aliasSet([hit.detail])
  })),
  ...localityHits.map((hit) => {
    const slug = hit.id.split(":").at(-1);
    const seed = seedByKey.get(`${hit.city}:${slug}`);
    const cityName = cityBySlug.get(hit.city)?.name_en;
    return {
      hit,
      nameAliases: aliasSet([hit.label, slug, ...(seed?.seo_aliases ?? [])]),
      contextAliases: aliasSet([
        cityName,
        hit.city,
        seed?.parent_slug,
        seed?.parent_slug ? slugLabel(seed.parent_slug) : undefined
      ])
    };
  }),
  ...areaHits.map((hit) => ({
    hit,
    nameAliases: aliasSet([hit.label, hit.id.split(":").at(-1)]),
    contextAliases: aliasSet([cityBySlug.get(hit.city)?.name_en, hit.city])
  }))
];

function tierScore(
  aliases: string[],
  needles: string[],
  tier: { exact: number; prefix: number; includes: number }
): number {
  let score = 0;
  for (const alias of aliases) {
    for (const needle of needles) {
      if (alias === needle) score = Math.max(score, tier.exact);
      else if (alias.startsWith(needle)) score = Math.max(score, tier.prefix);
      else if (alias.includes(needle)) score = Math.max(score, tier.includes);
    }
  }
  return score;
}

// Order equal-score hits: broadest container first (city → area → locality).
function kindRank(hit: MapSearchHit): number {
  if (hit.kind === "city") return 0;
  return hit.id.startsWith("area:") ? 1 : 2;
}

export function searchMapIndex(query: string, limit = 8): MapSearchHit[] {
  const needles = Array.from(new Set([normalize(query), compact(query)].filter(Boolean)));
  if (needles.length === 0) return [];

  return indexed
    .map(({ hit, nameAliases, contextAliases }) => {
      let score = Math.max(
        tierScore(nameAliases, needles, NAME_TIER),
        tierScore(contextAliases, needles, CONTEXT_TIER)
      );
      // Tie-break only: on an equal *name* score, prefer the more specific locality.
      if (hit.kind === "city") score -= 4;
      return { hit, score };
    })
    .filter((entry) => entry.score > 0)
    .sort(
      (a, b) =>
        b.score - a.score ||
        kindRank(a.hit) - kindRank(b.hit) ||
        a.hit.label.localeCompare(b.hit.label)
    )
    .slice(0, limit)
    .map((entry) => entry.hit);
}
