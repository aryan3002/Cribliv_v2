// Local NLP parser for the search bar. Pulls structured filter chips out
// of natural-language queries ("2bhk gomti nagar 18k") in <30ms with no
// network round-trip. Mirrors the server-side regex parser in
// apps/api/src/modules/search/search.service.ts so high-confidence queries
// produce identical filters as the LLM agentic-route would.

export type ChipKind =
  | "bhk"
  | "max_rent"
  | "min_rent"
  | "city"
  | "locality"
  | "listing_type"
  | "furnishing"
  | "amenity";

export interface ParsedChip {
  kind: ChipKind;
  value: string | number;
  label: string;
}

export interface ParseResult {
  chips: ParsedChip[];
  residual: string;
  confidence: number;
}

const CITY_ALIASES: Record<string, string> = {
  delhi: "delhi",
  "new delhi": "delhi",
  दिल्ली: "delhi",
  gurugram: "gurugram",
  gurgaon: "gurugram",
  गुड़गांव: "gurugram",
  गुरुग्राम: "gurugram",
  noida: "noida",
  नोएडा: "noida",
  ghaziabad: "ghaziabad",
  गाज़ियाबाद: "ghaziabad",
  faridabad: "faridabad",
  फरीदाबाद: "faridabad",
  chandigarh: "chandigarh",
  चंडीगढ़: "chandigarh",
  jaipur: "jaipur",
  जयपुर: "jaipur",
  lucknow: "lucknow",
  लखनऊ: "lucknow"
};

const PG_KEYWORDS = ["pg", "hostel", "पीजी", "हॉस्टल"];
const FLAT_KEYWORDS = ["flat", "house", "apartment", "home", "घर", "फ्लैट", "मकान"];
const FURNISHING_KEYWORDS: Record<string, "furnished" | "unfurnished" | "semi_furnished"> = {
  furnished: "furnished",
  unfurnished: "unfurnished",
  "semi furnished": "semi_furnished",
  "semi-furnished": "semi_furnished",
  semifurnished: "semi_furnished"
};
const AMENITY_KEYWORDS = ["parking", "balcony", "lift", "wifi", "ac", "geyser", "gym", "garden"];

const RENT_UNIT_K = /(k|thousand|हजार|hazar|hazaar|jar|yaar)/i;
const RENT_UNIT_LAKH = /(lakh|lac|l\b|लाख)/i;

function formatRent(rupees: number): string {
  if (rupees >= 100_000) {
    const v = rupees / 100_000;
    return `₹${v % 1 === 0 ? v : v.toFixed(1)}L`;
  }
  if (rupees >= 1000) {
    const v = rupees / 1000;
    return `₹${v % 1 === 0 ? v : v.toFixed(1)}k`;
  }
  return `₹${rupees}`;
}

const HINDI_NUMBERS: Record<string, number> = {
  ek: 1,
  do: 2,
  teen: 3,
  char: 4,
  paanch: 5,
  panch: 5,
  chhe: 6,
  che: 6,
  saat: 7,
  aath: 8,
  nau: 9,
  das: 10
};

function parseNumberValue(str: string): number | null {
  if (/^\d+$/.test(str)) return Number(str);
  const word = str.toLowerCase();
  if (HINDI_NUMBERS[word] !== undefined) return HINDI_NUMBERS[word];
  const devanagari = "०१२३४५६७८९";
  if (str.length > 0 && devanagari.includes(str[0])) {
    let n = "";
    for (const char of str) {
      const idx = devanagari.indexOf(char);
      if (idx !== -1) n += idx;
    }
    return Number(n);
  }
  return null;
}

function parseRentValue(numStr: string, unit: string | undefined): number | null {
  const value = parseNumberValue(numStr);
  if (value === null || !Number.isFinite(value)) return null;
  if (unit && RENT_UNIT_LAKH.test(unit)) return Math.round(value * 100_000);
  if (unit && RENT_UNIT_K.test(unit)) return Math.round(value * 1000);
  if (value >= 1000) return value;
  if (value >= 10 && value <= 300) return value * 1000;
  return value;
}

const numPattern = `(\\d+|ek|do|teen|char|paanch|panch|chhe|che|saat|aath|nau|das|[०-९]+)`;
const rentNumPattern = `(\\d{1,6}|ek|do|teen|char|paanch|panch|chhe|che|saat|aath|nau|das|[०-९]+)`;
const rentUnitPattern = `(k|lakh|lac|thousand|हजार|hazar|hazaar|jar|yaar|लाख)?`;

interface Match {
  chip: ParsedChip;
  start: number;
  end: number;
}

/**
 * Parse a free-form query into filter chips + residual text.
 *
 * @param text Raw user input.
 * @param cityList Slugs of known cities (longest-substring matched). Used for the
 *   common case where the query mentions a city we ship in.
 * @param localityList Slugs of known localities — same matching strategy.
 */
export function parseQuery(
  text: string,
  cityList: string[] = [],
  localityList: string[] = []
): ParseResult {
  const original = (text ?? "").trim();
  if (!original) return { chips: [], residual: "", confidence: 0 };

  const lower = original.toLowerCase();
  const matches: Match[] = [];

  // -- BHK --
  const bhkRegex = new RegExp(`${numPattern}\\s*bhk`, "ig");
  for (const m of lower.matchAll(bhkRegex)) {
    const n = parseNumberValue(m[1]);
    if (n !== null && Number.isFinite(n) && n > 0 && n <= 10) {
      matches.push({
        chip: { kind: "bhk", value: n, label: `${n} BHK` },
        start: m.index ?? 0,
        end: (m.index ?? 0) + m[0].length
      });
    }
  }

  // -- Rent: explicit range --
  const rangeRe = new RegExp(
    `${rentNumPattern}\\s*${rentUnitPattern}\\s*(?:-|to|and|–|से)\\s*${rentNumPattern}\\s*${rentUnitPattern}`,
    "i"
  );
  const rangeMatch = lower.match(rangeRe);
  if (rangeMatch && rangeMatch.index !== undefined) {
    const low = parseRentValue(rangeMatch[1], rangeMatch[2]);
    const high = parseRentValue(rangeMatch[3], rangeMatch[4]);
    if (low != null && high != null) {
      const min = Math.min(low, high);
      const max = Math.max(low, high);
      const start = rangeMatch.index;
      const end = start + rangeMatch[0].length;
      matches.push({
        chip: { kind: "min_rent", value: min, label: `≥ ${formatRent(min)}` },
        start,
        end
      });
      matches.push({
        chip: { kind: "max_rent", value: max, label: `≤ ${formatRent(max)}` },
        start,
        end
      });
    }
  }

  // -- Rent: max ("under 25k", "up to 30000", "max 18k") --
  const maxRe = new RegExp(
    `(?:under|below|max|upto|up to|less than|तक|के अंदर|से कम)\\s*${rentNumPattern}\\s*${rentUnitPattern}`,
    "i"
  );
  const maxMatch = lower.match(maxRe);
  if (maxMatch && maxMatch.index !== undefined) {
    const parsed = parseRentValue(maxMatch[1], maxMatch[2]);
    if (parsed != null) {
      matches.push({
        chip: { kind: "max_rent", value: parsed, label: `≤ ${formatRent(parsed)}` },
        start: maxMatch.index,
        end: maxMatch.index + maxMatch[0].length
      });
    }
  }

  // -- Rent: min ("above 10k", "starting 12k") --
  const minRe = new RegExp(
    `(?:above|min|starting|atleast|at least|से ज्यादा|से ऊपर)\\s*${rentNumPattern}\\s*${rentUnitPattern}`,
    "i"
  );
  const minMatch = lower.match(minRe);
  if (minMatch && minMatch.index !== undefined) {
    const parsed = parseRentValue(minMatch[1], minMatch[2]);
    if (parsed != null) {
      matches.push({
        chip: { kind: "min_rent", value: parsed, label: `≥ ${formatRent(parsed)}` },
        start: minMatch.index,
        end: minMatch.index + minMatch[0].length
      });
    }
  }

  // -- Rent: bare unit ("18k", "2 lakh") if no other rent chip parsed --
  const hasRentChip = matches.some((m) => m.chip.kind === "max_rent" || m.chip.kind === "min_rent");
  if (!hasRentChip) {
    const bareRe = new RegExp(
      `${rentNumPattern}\\s*(k|lakh|lac|thousand|हजार|hazar|hazaar|jar|yaar|लाख)`,
      "i"
    );
    const bare = lower.match(bareRe);
    if (bare && bare.index !== undefined) {
      const parsed = parseRentValue(bare[1], bare[2]);
      if (parsed != null) {
        matches.push({
          chip: { kind: "max_rent", value: parsed, label: `≤ ${formatRent(parsed)}` },
          start: bare.index,
          end: bare.index + bare[0].length
        });
      }
    }
  }

  // -- Listing type --
  const pgIdx = findKeyword(lower, PG_KEYWORDS);
  if (pgIdx) {
    matches.push({
      chip: { kind: "listing_type", value: "pg", label: "PG" },
      start: pgIdx.start,
      end: pgIdx.end
    });
  } else {
    const flatIdx = findKeyword(lower, FLAT_KEYWORDS);
    if (flatIdx) {
      matches.push({
        chip: { kind: "listing_type", value: "flat_house", label: "Flat" },
        start: flatIdx.start,
        end: flatIdx.end
      });
    }
  }

  // -- Furnishing --
  for (const [keyword, slug] of Object.entries(FURNISHING_KEYWORDS)) {
    const idx = lower.indexOf(keyword);
    if (idx >= 0) {
      const label =
        slug === "furnished"
          ? "Furnished"
          : slug === "semi_furnished"
            ? "Semi-furnished"
            : "Unfurnished";
      matches.push({
        chip: { kind: "furnishing", value: slug, label },
        start: idx,
        end: idx + keyword.length
      });
      break;
    }
  }

  // -- Amenities --
  for (const amenity of AMENITY_KEYWORDS) {
    const re = new RegExp(`\\b${amenity}\\b`, "i");
    const m = lower.match(re);
    if (m && m.index !== undefined) {
      matches.push({
        chip: {
          kind: "amenity",
          value: amenity,
          label: amenity[0].toUpperCase() + amenity.slice(1)
        },
        start: m.index,
        end: m.index + m[0].length
      });
    }
  }

  // -- City --
  const cityHit = findLongestSlugMatch(lower, [...Object.keys(CITY_ALIASES), ...cityList]);
  if (cityHit) {
    const canonical = CITY_ALIASES[cityHit.term] ?? cityHit.term;
    matches.push({
      chip: {
        kind: "city",
        value: canonical,
        label: canonical.charAt(0).toUpperCase() + canonical.slice(1)
      },
      start: cityHit.start,
      end: cityHit.end
    });
  }

  // -- Locality --
  const localityHit = findLongestSlugMatch(lower, localityList);
  if (localityHit) {
    matches.push({
      chip: {
        kind: "locality",
        value: localityHit.term,
        label: prettifySlug(localityHit.term)
      },
      start: localityHit.start,
      end: localityHit.end
    });
  }

  const dedupedMatches = dedupeChipsByKind(matches);
  const chips = dedupedMatches.map((m) => m.chip);

  // Build the residual string: original input minus all matched ranges.
  const residual = stripRanges(
    original,
    dedupedMatches.map((m) => [m.start, m.end])
  ).trim();

  // Confidence = fraction of input words that were captured.
  const totalWords = original.split(/\s+/).filter(Boolean).length || 1;
  const consumedChars = dedupedMatches.reduce((sum, m) => sum + (m.end - m.start), 0);
  const consumedWords = Math.max(
    chips.length,
    Math.round((consumedChars / Math.max(original.length, 1)) * totalWords)
  );
  const confidence = Math.min(1, consumedWords / totalWords);

  return { chips, residual, confidence };
}

function findKeyword(text: string, keywords: string[]): { start: number; end: number } | null {
  for (const kw of keywords) {
    // \b word boundary only works for ASCII characters. For Devanagari
    // and other non-Latin scripts, fall back to simple indexOf matching.
    const isAscii = /^[a-z0-9_ -]+$/i.test(kw);
    if (isAscii) {
      const re = new RegExp(`\\b${kw}\\b`, "i");
      const m = text.match(re);
      if (m && m.index !== undefined) {
        return { start: m.index, end: m.index + m[0].length };
      }
    } else {
      const idx = text.indexOf(kw);
      if (idx >= 0) {
        return { start: idx, end: idx + kw.length };
      }
    }
  }
  return null;
}

function findLongestSlugMatch(
  text: string,
  slugs: string[]
): { term: string; start: number; end: number } | null {
  let best: { term: string; start: number; end: number } | null = null;
  for (const slug of slugs) {
    const term = slug.replace(/-/g, " ").toLowerCase();
    if (term.length < 3) continue;
    const idx = text.indexOf(term);
    if (idx >= 0) {
      if (!best || term.length > best.term.length) {
        best = { term, start: idx, end: idx + term.length };
      }
    }
  }
  return best ? { term: best.term.replace(/\s+/g, "-"), start: best.start, end: best.end } : null;
}

function dedupeChipsByKind(matches: Match[]): Match[] {
  const byKind = new Map<string, Match>();
  for (const m of matches) {
    // For min_rent + max_rent we keep both even with same kind (they coexist).
    const dedupKey =
      m.chip.kind === "amenity" ? `amenity:${m.chip.value}` : (m.chip.kind as string);
    const existing = byKind.get(dedupKey);
    if (!existing || m.end - m.start > existing.end - existing.start) {
      byKind.set(dedupKey, m);
    }
  }
  return Array.from(byKind.values()).sort((a, b) => a.start - b.start);
}

function stripRanges(input: string, ranges: Array<[number, number]>): string {
  if (ranges.length === 0) return input;
  // Merge overlapping ranges
  const sorted = [...ranges].sort((a, b) => a[0] - b[0]);
  const merged: Array<[number, number]> = [sorted[0]];
  for (let i = 1; i < sorted.length; i++) {
    const last = merged[merged.length - 1];
    const cur = sorted[i];
    if (cur[0] <= last[1]) {
      last[1] = Math.max(last[1], cur[1]);
    } else {
      merged.push(cur);
    }
  }
  const parts: string[] = [];
  let cursor = 0;
  for (const [start, end] of merged) {
    if (start > cursor) parts.push(input.slice(cursor, start));
    cursor = end;
  }
  if (cursor < input.length) parts.push(input.slice(cursor));
  return parts.join(" ").replace(/\s+/g, " ").trim();
}

function prettifySlug(slug: string): string {
  return slug
    .replace(/[-_]+/g, " ")
    .split(" ")
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

/**
 * Convert chips into the filter object shape the search results page expects.
 */
export function chipsToFilters(chips: ParsedChip[]): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  for (const chip of chips) {
    switch (chip.kind) {
      case "bhk":
      case "min_rent":
      case "max_rent":
        out[chip.kind] = chip.value as number;
        break;
      case "city":
        out.city = chip.value as string;
        break;
      case "locality":
        out.locality = chip.value as string;
        break;
      case "listing_type":
        out.listing_type = chip.value as string;
        break;
      case "furnishing":
        out.furnishing = chip.value as string;
        break;
      case "amenity":
        // Amenities aren't a single filter field; the search results page
        // doesn't have a canonical amenity filter today, so we surface the
        // amenity keyword in the free-text q so FTS can rank for it.
        out.q = (out.q ? `${out.q} ${chip.value}` : `${chip.value}`).toString();
        break;
    }
  }
  return out;
}
