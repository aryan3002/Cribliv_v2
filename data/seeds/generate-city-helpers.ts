/**
 * Pure generator helpers for city/locality/landmark seeding.
 * Zero dependencies, fully testable.
 */

// ─── LANDMARK TYPES ────────────────────────────────────────────────────

export const LANDMARK_TYPES = [
  "college",
  "hospital",
  "mall",
  "market",
  "station",
  "airport",
  "it_park",
  "office",
  "religious",
  "park",
  "stadium",
  "monument",
] as const;

export type LandmarkType = (typeof LANDMARK_TYPES)[number];

// ─── SLUGIFY ────────────────────────────────────────────────────────────

/**
 * URL-safe slug. Removes apostrophes FIRST ("George's" -> "georges"), strips
 * non-ASCII (Devanagari/accents), lowercases, collapses non-alphanumeric runs to
 * a single hyphen, trims leading/trailing hyphens.
 */
export function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/['’]/g, "") // straight + curly apostrophes
    .normalize("NFKD")
    .replace(/[^\u0000-\u007f]/g, "") // drop non-ASCII
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// ─── LANDMARK TYPE MAPPING ──────────────────────────────────────────────

const LANDMARK_TYPES_SET = new Set<string>(LANDMARK_TYPES);

const LANDMARK_SYNONYMS: Record<string, LandmarkType> = {
  // College synonyms
  university: "college",
  institute: "college",
  school: "college",
  academy: "college",

  // Hospital synonyms
  clinic: "hospital",
  "medical center": "hospital",
  "medical centre": "hospital",

  // Mall synonyms
  "shopping mall": "mall",
  "shopping centre": "mall",
  "shopping center": "mall",

  // Station synonyms
  metro: "station",
  "railway station": "station",
  "train station": "station",
  "bus stand": "station",
  "bus station": "station",

  // IT Park synonyms
  it: "it_park",
  tech: "it_park",
  "tech park": "it_park",
  "software park": "it_park",

  // Office synonyms
  "business park": "office",
  "corporate office": "office",

  // Religious synonyms
  temple: "religious",
  mosque: "religious",
  church: "religious",
  gurudwara: "religious",
  mandir: "religious",
  masjid: "religious",

  // Park synonyms
  garden: "park",

  // Stadium synonyms
  sports: "stadium",
  "cricket stadium": "stadium",

  // Monument synonyms
  memorial: "monument",
};

export function mapLandmarkType(raw: string): LandmarkType | null {
  if (!raw || raw.trim() === "") {
    return null;
  }

  const trimmed = raw.trim();

  // Fast path: exact match in LANDMARK_TYPES
  if (LANDMARK_TYPES_SET.has(trimmed)) {
    return trimmed as LandmarkType;
  }

  // Synonym map (case-insensitive, lowercased)
  const lower = trimmed.toLowerCase();
  if (lower in LANDMARK_SYNONYMS) {
    return LANDMARK_SYNONYMS[lower];
  }

  return null;
}

// ─── DEDUPLICATION ─────────────────────────────────────────────────────

export function dedupeBySlug<T extends { slug: string }>(items: T[]): T[] {
  const seen = new Set<string>();
  const result: T[] = [];

  for (const item of items) {
    if (!seen.has(item.slug)) {
      seen.add(item.slug);
      result.push(item);
    }
  }

  return result;
}

// ─── CANDIDATE INTERFACES ──────────────────────────────────────────────

export interface LocalityCandidate {
  slug: string;
  name_en: string;
  name_hi: string;
  pincode?: string;
}

export interface MicroLocalityCandidate {
  slug: string;
  name_en: string;
  name_hi: string;
  seo_aliases?: string[];
}

export interface LandmarkCandidate {
  slug: string;
  name_en: string;
  name_hi: string;
  primary_locality_slug?: string;
  aka?: string[];
}

export interface VerifiedPlace {
  canonical_name: string;
  lat: number;
  lng: number;
}

// ─── OUTPUT INTERFACES ──────────────────────────────────────────────────

export interface LocalityOut {
  city_slug: string;
  slug: string;
  name_en: string;
  name_hi: string;
  pincode?: string;
  lat: number;
  lng: number;
}

export interface MicroLocalityOut {
  slug: string;
  name_en: string;
  name_hi: string;
  lat: number;
  lng: number;
  seo_aliases: string[];
}

export interface LandmarkOut {
  slug: string;
  name_en: string;
  name_hi: string;
  type: LandmarkType;
  lat: number;
  lng: number;
  primary_locality_slug?: string;
  aka: string[];
}

// ─── TRANSFORMS ────────────────────────────────────────────────────────

export function toLocalityOut(
  city_slug: string,
  cand: LocalityCandidate,
  v: VerifiedPlace
): LocalityOut {
  const result: LocalityOut = {
    city_slug,
    slug: cand.slug,
    name_en: cand.name_en,
    name_hi: cand.name_hi,
    lat: v.lat,
    lng: v.lng,
  };

  if (cand.pincode) {
    result.pincode = cand.pincode;
  }

  return result;
}

export function toMicroLocalityOut(
  cand: MicroLocalityCandidate,
  v: VerifiedPlace
): MicroLocalityOut {
  return {
    slug: cand.slug,
    name_en: cand.name_en,
    name_hi: cand.name_hi,
    lat: v.lat,
    lng: v.lng,
    seo_aliases: cand.seo_aliases ?? [],
  };
}

export function toLandmarkOut(
  cand: LandmarkCandidate,
  v: VerifiedPlace,
  type: LandmarkType
): LandmarkOut {
  const result: LandmarkOut = {
    slug: cand.slug,
    name_en: cand.name_en,
    name_hi: cand.name_hi,
    type,
    lat: v.lat,
    lng: v.lng,
    aka: cand.aka ?? [],
  };

  if (cand.primary_locality_slug) {
    result.primary_locality_slug = cand.primary_locality_slug;
  }

  return result;
}

// ─── GOOGLE GEOCODE VERIFY ─────────────────────────────────────────────

export type GeocodeFetch = typeof fetch;

/** Thrown on REQUEST_DENIED / OVER_QUERY_LIMIT so the whole run aborts instead
 * of silently emitting empty files (a denied key must NOT look like "no place"). */
export class GeocodeAbortError extends Error {
  constructor(public readonly status: string) {
    super(`Google Geocoding aborted: ${status}`);
    this.name = "GeocodeAbortError";
  }
}

interface GeocodeResult { formatted_address?: string; geometry?: { location?: { lat?: number; lng?: number } }; }
interface GeocodeBody { status?: string; results?: GeocodeResult[]; error_message?: string; }

export function buildGeocodeUrl(query: string, apiKey: string): string {
  const url = new URL("https://maps.googleapis.com/maps/api/geocode/json");
  url.searchParams.set("address", query);
  url.searchParams.set("key", apiKey);
  return url.toString();
}

/** OK -> VerifiedPlace; ZERO_RESULTS/malformed -> null; denied/throttled -> "abort". */
export function parseGeocodeResponse(body: unknown): VerifiedPlace | "abort" | null {
  if (!body || typeof body !== "object") return null;
  const b = body as GeocodeBody;
  if (b.status === "REQUEST_DENIED" || b.status === "OVER_QUERY_LIMIT") return "abort";
  if (b.status !== "OK") return null;
  const top = b.results?.[0];
  const loc = top?.geometry?.location;
  if (!top || typeof top.formatted_address !== "string" || !loc ||
      typeof loc.lat !== "number" || typeof loc.lng !== "number") return null;
  return { canonical_name: top.formatted_address, lat: loc.lat, lng: loc.lng };
}

export async function verifyPlace(
  query: string, apiKey: string, fetchImpl: GeocodeFetch = fetch
): Promise<VerifiedPlace | null> {
  let res: Response;
  try {
    res = await fetchImpl(buildGeocodeUrl(query, apiKey));
  } catch { return null; }
  if (!res.ok) return null;
  const body = (await res.json().catch(() => null)) as unknown;
  const parsed = parseGeocodeResponse(body);
  if (parsed === "abort") {
    const status = (body as GeocodeBody)?.status ?? "unknown";
    // mirrors metro-walk.service.ts logging of status + error_message
    console.error(`Geocode ${status} for "${query}": ${(body as GeocodeBody)?.error_message ?? ""}`);
    throw new GeocodeAbortError(status);
  }
  return parsed;
}
