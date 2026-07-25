import { RENT_CITY_CONTENT } from "../rent-city-content";
import microLocalitiesData from "../../../../data/seeds/lucknow/micro-localities.json";

/**
 * Locality links for the nav's Rent panel.
 *
 * RENT_CITY_CONTENT.popularLocalities holds DISPLAY NAMES ("Gomti Nagar"), not
 * slugs — so it cannot build /city/{city}/{locality} URLs, and that route calls
 * notFound() on an unknown locality. A guessed slug would be a 404 inside the
 * navigation itself.
 *
 * Lucknow is the exception: data/seeds/lucknow/micro-localities.json carries
 * real parent_slug values that populate the DB, so those links resolve. Every
 * other city uses the /search?city=&q= shape that rent-in/[city] already ships.
 */
export interface NavLink {
  label: string;
  href: string;
}

interface MicroLocality {
  slug: string;
  name_en: string;
  name_hi: string;
  parent_slug: string;
}

const MICRO_LOCALITIES = microLocalitiesData as MicroLocality[];

/** Distinct parent localities, first-seen order — these are real /city/lucknow/{slug} pages. */
const LUCKNOW_LOCALITIES: ReadonlyArray<{ slug: string; label: string }> = (() => {
  const seen = new Set<string>();
  const out: Array<{ slug: string; label: string }> = [];
  for (const micro of MICRO_LOCALITIES) {
    if (seen.has(micro.parent_slug)) continue;
    seen.add(micro.parent_slug);
    out.push({ slug: micro.parent_slug, label: titleCaseSlug(micro.parent_slug) });
  }
  return out;
})();

function titleCaseSlug(slug: string): string {
  return slug
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

const DEFAULT_LIMIT = 8;

export function localityLinks(
  locale: "en" | "hi",
  citySlug: string,
  limit: number = DEFAULT_LIMIT
): NavLink[] {
  if (citySlug === "lucknow") {
    return LUCKNOW_LOCALITIES.slice(0, limit).map((loc) => ({
      label: loc.label,
      href: `/${locale}/city/lucknow/${loc.slug}`
    }));
  }

  const city = RENT_CITY_CONTENT[citySlug];
  if (!city) return [];

  return city.popularLocalities.slice(0, limit).map((name) => ({
    label: name,
    href: `/${locale}/search?city=${citySlug}&q=${encodeURIComponent(name)}`
  }));
}
