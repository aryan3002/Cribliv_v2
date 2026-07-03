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
  /** Slug of the parent locality this micro-locality belongs to. Required by
   * the AI-draft pipeline (parseDraftResponse/buildCityFiles) so orphaned
   * micro-localities can be validated and dropped; optional here so Task 3's
   * existing direct-construction call sites remain valid. */
  parent_slug?: string;
  seo_aliases?: string[];
}

export interface LandmarkCandidate {
  slug: string;
  name_en: string;
  name_hi: string;
  /** Raw landmark type string from the AI draft, resolved via
   * mapLandmarkType() during buildCityFiles(). Optional so Task 3's existing
   * direct-construction call sites (which pass type separately to
   * toLandmarkOut) remain valid. */
  type?: string;
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
  /** Present when the candidate carried a parent_slug (AI-draft pipeline).
   * Omitted for Task 3's original direct-construction call sites so the
   * existing toEqual() test (no parent_slug field) is unaffected. */
  parent_slug?: string;
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
  const result: MicroLocalityOut = {
    slug: cand.slug,
    name_en: cand.name_en,
    name_hi: cand.name_hi,
    lat: v.lat,
    lng: v.lng,
    seo_aliases: cand.seo_aliases ?? [],
  };

  if (cand.parent_slug) {
    result.parent_slug = cand.parent_slug;
  }

  return result;
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

// ─── AI DRAFT (Azure OpenAI) ────────────────────────────────────────────

export interface DraftResult {
  localities: LocalityCandidate[];
  micro_localities: MicroLocalityCandidate[];
  landmarks: LandmarkCandidate[];
}

export interface AiConfig {
  endpoint: string;
  apiKey: string;
  deployment: string;
  timeoutMs: number;
}

/** Same env convention as seo-copy.service.ts's readAiConfig(). */
export function readAiConfig(): AiConfig {
  return {
    endpoint: (process.env.AZURE_OPENAI_ENDPOINT?.trim() ?? "").replace(/\/+$/, ""),
    apiKey: process.env.AZURE_OPENAI_API_KEY?.trim() ?? "",
    deployment:
      process.env.AZURE_OPENAI_CHAT_DEPLOYMENT?.trim() ||
      process.env.AZURE_OPENAI_EXTRACT_DEPLOYMENT?.trim() ||
      "",
    timeoutMs: Math.max(Number(process.env.SEO_GENERATE_TIMEOUT_MS) || 30000, 10000),
  };
}

/**
 * Builds the Azure OpenAI prompt requesting three candidate arrays for a
 * city: localities, micro_localities, landmarks. Every entry is later
 * verified against Google Geocoding, so the prompt explicitly tells the
 * model that hallucinated entries will be discarded (encourages recall over
 * over-caution without risking bad data reaching the site).
 */
export function buildDraftPrompt(cityName: string, stateName: string): string {
  const typesList = LANDMARK_TYPES.join(", ");
  return `You are helping seed a rental real-estate platform's local-search data for an Indian city.

City: ${cityName}
State: ${stateName}, India

Generate JSON with exactly this shape:
{
  "localities": [
    { "name_en": "string", "name_hi": "string (Devanagari script)", "pincode": "string, optional 6-digit PIN" }
  ],
  "micro_localities": [
    {
      "name_en": "string",
      "name_hi": "string (Devanagari script)",
      "parent_slug": "string, the slug (lowercase-hyphenated) of the parent locality from the localities array above",
      "seo_aliases": ["string, ...common alternative spellings/abbreviations locals search for, e.g. 'sec18' for 'Sector 18'"]
    }
  ],
  "landmarks": [
    {
      "name_en": "string",
      "name_hi": "string (Devanagari script)",
      "type": "one of: ${typesList}",
      "primary_locality_slug": "string, optional slug of the nearest locality",
      "aka": ["string, ...common alternative spellings/abbreviations locals search for, e.g. 'LU' for 'University of Lucknow'"]
    }
  ]
}

Rules:
- List well-known localities (neighborhoods/sectors/colonies), smaller micro-localities within them, and notable landmarks (colleges, hospitals, malls, markets, stations, airports, IT parks, offices, religious sites, parks, stadiums, monuments).
- "name_hi" MUST be written in Devanagari script (नागरी लिपि), not transliterated Latin.
- Every entry you return will be independently verified against Google Maps/Geocoding before being published — entries that cannot be verified are silently discarded. This means you should be generous and list everything you know is real, because hallucinated or made-up entries are automatically filtered out and cost nothing; the risk is only in omitting real places.
- "aka"/"seo_aliases" should capture common alternative spellings, abbreviations, or informal names that locals actually search for (e.g. metro-station short names, common misspellings, English/Hindi transliteration variants).
- Reply with valid JSON only — no markdown, no surrounding prose.`;
}

export type DraftFetch = typeof fetch;

interface RawLocalityCandidate {
  name_en?: unknown;
  name_hi?: unknown;
  pincode?: unknown;
}

interface RawMicroLocalityCandidate {
  name_en?: unknown;
  name_hi?: unknown;
  parent_slug?: unknown;
  seo_aliases?: unknown;
}

interface RawLandmarkCandidate {
  name_en?: unknown;
  name_hi?: unknown;
  type?: unknown;
  primary_locality_slug?: unknown;
  aka?: unknown;
}

interface RawDraftBody {
  localities?: unknown;
  micro_localities?: unknown;
  landmarks?: unknown;
}

function asStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const strs = value.filter((v): v is string => typeof v === "string");
  return strs.length > 0 ? strs : undefined;
}

/**
 * Parses (and validates) the raw AI JSON response into a DraftResult.
 * Slugifies every candidate, drops entries that are malformed/unmappable/
 * empty-slug, and dedupes by slug within each array. Never throws — bad or
 * non-JSON content simply yields empty arrays.
 */
export function parseDraftResponse(content: string): DraftResult {
  let body: RawDraftBody;
  try {
    body = JSON.parse(content) as RawDraftBody;
  } catch {
    return { localities: [], micro_localities: [], landmarks: [] };
  }
  if (!body || typeof body !== "object") {
    return { localities: [], micro_localities: [], landmarks: [] };
  }

  const rawLocalities = Array.isArray(body.localities) ? (body.localities as RawLocalityCandidate[]) : [];
  const localities: LocalityCandidate[] = [];
  for (const c of rawLocalities) {
    if (typeof c?.name_en !== "string" || typeof c?.name_hi !== "string") continue;
    const slug = slugify(c.name_en);
    if (!slug) continue;
    const cand: LocalityCandidate = { slug, name_en: c.name_en, name_hi: c.name_hi };
    if (typeof c.pincode === "string" && c.pincode) cand.pincode = c.pincode;
    localities.push(cand);
  }

  const rawMicros = Array.isArray(body.micro_localities)
    ? (body.micro_localities as RawMicroLocalityCandidate[])
    : [];
  const micro_localities: MicroLocalityCandidate[] = [];
  for (const c of rawMicros) {
    if (typeof c?.name_en !== "string" || typeof c?.name_hi !== "string") continue;
    if (typeof c.parent_slug !== "string" || !c.parent_slug) continue;
    const slug = slugify(c.name_en);
    if (!slug) continue;
    const cand: MicroLocalityCandidate = {
      slug,
      name_en: c.name_en,
      name_hi: c.name_hi,
      parent_slug: c.parent_slug,
    };
    const aliases = asStringArray(c.seo_aliases);
    if (aliases) cand.seo_aliases = aliases;
    micro_localities.push(cand);
  }

  const rawLandmarks = Array.isArray(body.landmarks) ? (body.landmarks as RawLandmarkCandidate[]) : [];
  const landmarks: LandmarkCandidate[] = [];
  for (const c of rawLandmarks) {
    if (typeof c?.name_en !== "string" || typeof c?.name_hi !== "string") continue;
    const mappedType = typeof c.type === "string" ? mapLandmarkType(c.type) : null;
    if (!mappedType) continue;
    const slug = slugify(c.name_en);
    if (!slug) continue;
    const cand: LandmarkCandidate = { slug, name_en: c.name_en, name_hi: c.name_hi, type: mappedType };
    if (typeof c.primary_locality_slug === "string" && c.primary_locality_slug) {
      cand.primary_locality_slug = c.primary_locality_slug;
    }
    const aka = asStringArray(c.aka);
    if (aka) cand.aka = aka;
    landmarks.push(cand);
  }

  return {
    localities: dedupeBySlug(localities),
    micro_localities: dedupeBySlug(micro_localities),
    landmarks: dedupeBySlug(landmarks),
  };
}

/**
 * Calls Azure OpenAI chat completions to draft candidate localities/
 * micro-localities/landmarks for a city. Never throws — any HTTP failure,
 * network error, timeout, or malformed response yields empty arrays so the
 * CLI can decide how to handle a failed draft (it will see 0 candidates and
 * the drop-ratio guard / empty output makes that obvious).
 */
export async function draftCity(
  cityName: string,
  stateName: string,
  config: AiConfig,
  fetchImpl: DraftFetch = fetch
): Promise<DraftResult> {
  const empty: DraftResult = { localities: [], micro_localities: [], landmarks: [] };
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs);
  try {
    const url = `${config.endpoint}/openai/deployments/${encodeURIComponent(config.deployment)}/chat/completions?api-version=2024-10-21`;
    const response = await fetchImpl(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "api-key": config.apiKey },
      body: JSON.stringify({
        messages: [
          {
            role: "system",
            content:
              "You produce structured local-search seed data for an Indian rental platform. Reply with valid JSON only.",
          },
          { role: "user", content: buildDraftPrompt(cityName, stateName) },
        ],
        temperature: 0.4,
        max_tokens: 4000,
        response_format: { type: "json_object" },
      }),
      signal: controller.signal,
    });
    if (!response.ok) return empty;
    const payload = (await response.json().catch(() => ({}))) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = payload.choices?.[0]?.message?.content;
    if (!content) return empty;
    return parseDraftResponse(content);
  } catch {
    return empty;
  } finally {
    clearTimeout(timeout);
  }
}

// ─── ORCHESTRATOR ────────────────────────────────────────────────────────

export interface CityFiles {
  localities: LocalityOut[];
  micro_localities: MicroLocalityOut[];
  landmarks: LandmarkOut[];
  dropped: string[];
}

export async function buildCityFiles(
  cityName: string,
  stateName: string,
  citySlug: string,
  draft: DraftResult,
  verify: (query: string) => Promise<VerifiedPlace | null>
): Promise<CityFiles> {
  const q = (name: string) => `${name}, ${stateName}, India`; // strong disambiguation (Review 4 MAJOR 3)
  const dropped: string[] = [];
  const localities: LocalityOut[] = [];
  const micro_localities: MicroLocalityOut[] = [];
  const landmarks: LandmarkOut[] = [];

  for (const cand of dedupeBySlug(draft.localities)) {
    const v = await verify(q(cand.name_en));
    if (!v) { dropped.push(`locality:${cand.slug}`); continue; }
    localities.push(toLocalityOut(citySlug, cand, v));
  }
  const keptLocalitySlugs = new Set(localities.map((l) => l.slug));

  for (const cand of dedupeBySlug(draft.micro_localities)) {
    if (!cand.parent_slug || !keptLocalitySlugs.has(cand.parent_slug)) { dropped.push(`micro:${cand.slug}`); continue; } // Review 4 MAJOR 5
    const v = await verify(q(cand.name_en));
    if (!v) { dropped.push(`micro:${cand.slug}`); continue; }
    micro_localities.push(toMicroLocalityOut(cand, v));
  }

  for (const cand of dedupeBySlug(draft.landmarks)) {
    const v = await verify(q(cand.name_en));
    if (!v) { dropped.push(`landmark:${cand.slug}`); continue; }
    landmarks.push(toLandmarkOut(cand, v, mapLandmarkType(cand.type ?? "") ?? "monument"));
  }

  return {
    localities: dedupeBySlug(localities),
    micro_localities: dedupeBySlug(micro_localities),
    landmarks: dedupeBySlug(landmarks),
    dropped,
  };
}
