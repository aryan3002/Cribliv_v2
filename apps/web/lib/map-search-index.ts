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

const localityHits: MapSearchHit[] = [
  ...(localities as LocalitySeed[]),
  ...(lucknowMicroLocalities as LocalitySeed[]).map((locality) => ({
    ...locality,
    city_slug: "lucknow"
  }))
]
  .map((locality): MapSearchHit | null => {
    const citySlug = locality.city_slug;
    if (!citySlug || locality.lat == null || locality.lng == null) return null;
    const city = cityBySlug.get(citySlug);
    return {
      id: `locality:${citySlug}:${locality.slug}`,
      label: locality.name_en,
      detail: city ? `${city.name_en}${locality.parent_slug ? ` · ${slugLabel(locality.parent_slug)}` : ""}` : citySlug,
      lat: locality.lat,
      lng: locality.lng,
      city: citySlug,
      kind: "locality" as const
    };
  })
  .filter((hit): hit is MapSearchHit => hit !== null);

const allHits = [...cityHits, ...localityHits].map((hit) => {
  const aliases = [
    hit.label,
    hit.detail,
    hit.city,
    hit.id.split(":").at(-1) ?? "",
    compact(hit.label)
  ];
  return {
    hit,
    aliases: Array.from(new Set(aliases.filter(Boolean).flatMap((alias) => [normalize(alias), compact(alias)])))
  };
});

export function searchMapIndex(query: string, limit = 6): MapSearchHit[] {
  const normalized = normalize(query);
  const compacted = compact(query);
  if (!normalized && !compacted) return [];

  return allHits
    .map(({ hit, aliases }) => {
      let score = 0;
      for (const alias of aliases) {
        if (!alias) continue;
        if (alias === normalized || alias === compacted) score = Math.max(score, 100);
        else if (alias.startsWith(normalized) || alias.startsWith(compacted)) score = Math.max(score, 80);
        else if (alias.includes(normalized) || alias.includes(compacted)) score = Math.max(score, 55);
      }
      if (hit.kind === "city") score -= 4;
      return { hit, score };
    })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.hit.label.localeCompare(b.hit.label))
    .slice(0, limit)
    .map((entry) => entry.hit);
}
