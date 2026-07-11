import { buildSearchQuery } from "./api";
import { hrefForSegment, type SearchSegment } from "./search-segment";
import { chipsToFilters, parseQuery, type ParsedChip } from "./smart-parser";

export interface SearchDictionary {
  cities: string[];
  localities: string[];
}

export interface ParsedIntentSearch {
  chips: ParsedChip[];
  filters: Record<string, string | number | boolean>;
  residual: string;
  targetSegment: SearchSegment;
}

const REPLACED_SEARCH_KEYS = new Set([
  "q",
  "city",
  "locality",
  "bhk",
  "min_rent",
  "max_rent",
  "furnishing",
  "listing_type",
  "page"
]);

const QUERY_CONNECTORS = new Set(["in", "at", "for"]);

export function parseIntentSearch(
  text: string,
  dictionary: SearchDictionary,
  currentSegment: SearchSegment = "homes"
): ParsedIntentSearch {
  const parsed = parseQuery(text, dictionary.cities, dictionary.localities);
  const filters = chipsToFilters(parsed.chips);
  const propertyType = filters.listing_type;
  const targetSegment: SearchSegment =
    propertyType === "pg" ? "pg" : propertyType === "flat_house" ? "homes" : currentSegment;

  const residual = parsed.residual
    .split(/\s+/)
    .filter((word) => !QUERY_CONNECTORS.has(word.toLowerCase()))
    .join(" ");

  if (residual) {
    filters.q = [filters.q, residual].filter(Boolean).join(" ");
  }

  return {
    chips: parsed.chips,
    filters,
    residual,
    targetSegment
  };
}

export function buildIntentSearchHref(
  locale: string,
  currentSegment: SearchSegment,
  currentFilters: Record<string, string>,
  text: string,
  dictionary: SearchDictionary
): string {
  const parsed = parseIntentSearch(text, dictionary, currentSegment);
  const preserved = Object.fromEntries(
    Object.entries(currentFilters).filter(([key]) => !REPLACED_SEARCH_KEYS.has(key))
  );
  const { listing_type: _listingType, ...parsedFilters } = parsed.filters;
  const params = Object.fromEntries(
    Object.entries({ ...preserved, ...parsedFilters }).map(([key, value]) => [key, String(value)])
  );

  return hrefForSegment(locale, parsed.targetSegment, params);
}

export function buildIntentCountPath(parsed: ParsedIntentSearch): string {
  const { listing_type: _listingType, ...filters } = parsed.filters;
  const listingType = parsed.targetSegment === "pg" ? "pg" : "flat_house";

  return `/listings/search?${buildSearchQuery({
    ...filters,
    listing_type: listingType,
    page: 1,
    page_size: 1
  })}`;
}
