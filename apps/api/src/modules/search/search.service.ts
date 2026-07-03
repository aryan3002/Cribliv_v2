import { Inject, Injectable } from "@nestjs/common";
import { AppStateService } from "../../common/app-state.service";
import { DatabaseService } from "../../common/database.service";
import { IntentClassifierService } from "../ai/intent-classifier.service";
import { RankingService } from "../ai/ranking.service";
import { EmbeddingService } from "../ai/embedding.service";
import { QueryParserService } from "../ai/query-parser.service";
import type { ParsedFilters, SearchIntent } from "../ai/ai.types";

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

const CITY_ORDER = [
  "delhi",
  "gurugram",
  "noida",
  "ghaziabad",
  "faridabad",
  "chandigarh",
  "jaipur",
  "lucknow"
];

const TYPE_KEYWORDS = {
  pg: ["pg", "पीजी", "hostel", "हॉस्टल"],
  flatHouse: ["flat", "house", "घर", "apartment", "home", "1bhk", "2bhk", "3bhk", "4bhk"]
};

const SORT_OPTIONS = [
  { key: "relevance", label: "Relevance" },
  { key: "newest", label: "Newest" },
  { key: "verified", label: "Verified first" },
  { key: "rent_asc", label: "Rent: Low to High" },
  { key: "rent_desc", label: "Rent: High to Low" }
] as const;

function normalizeSort(sort?: string) {
  if (!sort) {
    return "relevance";
  }

  const normalized = sort.toLowerCase();
  if (normalized === "price_asc") {
    return "rent_asc";
  }
  if (normalized === "price_desc") {
    return "rent_desc";
  }
  if (normalized === "newest" || normalized === "verified") {
    return normalized;
  }
  if (normalized === "rent_asc" || normalized === "rent_desc") {
    return normalized;
  }

  return "relevance";
}

function parsePage(rawPage?: string) {
  const parsed = Number(rawPage ?? "1");
  if (!Number.isFinite(parsed) || parsed < 1) {
    return 1;
  }
  return Math.floor(parsed);
}

function normalizeDigits(input: string) {
  const devanagari = "०१२३४५६७८९";
  return input.replace(/[०-९]/g, (char) => String(devanagari.indexOf(char)));
}

function parseRentValue(rawNumber: string, unitHint?: string) {
  const value = Number(rawNumber);
  if (!Number.isFinite(value)) {
    return undefined;
  }

  const unit = (unitHint ?? "").toLowerCase();
  if (unit.includes("k") || unit.includes("हजार") || unit.includes("thousand")) {
    return value * 1000;
  }

  if (value >= 1000) {
    return value;
  }

  if (value >= 10 && value <= 300) {
    return value * 1000;
  }

  return value;
}

function parseRentFilters(text: string) {
  const filters: { min_rent?: number; max_rent?: number } = {};
  const normalized = normalizeDigits(text.toLowerCase());

  const rangeMatch =
    normalized.match(
      /(\d{2,6})\s*(k|हजार|thousand)?\s*(?:-|to|and|से)\s*(\d{2,6})\s*(k|हजार|thousand)?/
    ) ??
    normalized.match(
      /between\s+(\d{2,6})\s*(k|हजार|thousand)?\s+and\s+(\d{2,6})\s*(k|हजार|thousand)?/
    );
  if (rangeMatch) {
    const low = parseRentValue(rangeMatch[1], rangeMatch[2]);
    const high = parseRentValue(rangeMatch[3], rangeMatch[4]);
    if (low && high) {
      filters.min_rent = Math.min(low, high);
      filters.max_rent = Math.max(low, high);
      return filters;
    }
  }

  const maxMatch =
    normalized.match(
      /(?:under|below|max|upto|up to|less than|तक|के अंदर|से कम)\s*(\d{2,6})\s*(k|हजार|thousand)?/
    ) ?? normalized.match(/(\d{2,6})\s*(k|हजार|thousand)?\s*(?:under|below|max|upto|तक)/);
  if (maxMatch) {
    const parsed = parseRentValue(maxMatch[1], maxMatch[2]);
    if (parsed) {
      filters.max_rent = parsed;
    }
  }

  const minMatch =
    normalized.match(
      /(?:above|min|starting|atleast|at least|से ज्यादा|से ऊपर)\s*(\d{2,6})\s*(k|हजार|thousand)?/
    ) ?? normalized.match(/(\d{2,6})\s*(k|हजार|thousand)?\s*(?:above|min)/);
  if (minMatch) {
    const parsed = parseRentValue(minMatch[1], minMatch[2]);
    if (parsed) {
      filters.min_rent = parsed;
    }
  }

  if (!filters.max_rent && !filters.min_rent) {
    const fallback = normalized.match(/(\d{2,6})\s*(k|हजार|thousand)/);
    if (fallback) {
      const parsed = parseRentValue(fallback[1], fallback[2]);
      if (parsed) {
        filters.max_rent = parsed;
      }
    }
  }

  return filters;
}

type SuggestRow = {
  type: "city" | "locality" | "listing";
  label: string;
  value: string;
  // City / locality enrichments
  listing_count?: number;
  rent_band?: { min: number; max: number };
  // Listing enrichments
  cover_url?: string | null;
  rent?: number;
  verified?: boolean;
  locality_label?: string;
  posted_at?: string;
  // Locality only
  city_slug?: string;
};

const SUGGEST_CACHE_TTL_MS = 60_000;
const SUGGEST_CACHE_MAX_ENTRIES = 256;
const DICTIONARY_TTL_MS = 10 * 60_000;
const PREVIEW_CACHE_TTL_MS = 60 * 60_000;
const PREVIEW_CACHE_MAX_ENTRIES = 512;

type SearchPreview = {
  type: "city" | "locality";
  slug: string;
  name: string;
  city_slug?: string;
  listing_count: number;
  rent_band: { min: number; max: number } | null;
  verified_pct: number | null;
  avg_bhk: number | null;
  sample_photos: string[];
};

@Injectable()
export class SearchService {
  private readonly photoPublicBaseUrl = this.resolvePhotoPublicBaseUrl();

  // Tiny LRU-ish cache for typeahead. Hot prefixes ("delhi", "lucknow",
  // "gurg") hit memory in <1ms instead of round-tripping to Postgres.
  private readonly suggestCache = new Map<string, { rows: SuggestRow[]; expiresAt: number }>();
  private readonly previewCache = new Map<
    string,
    { value: SearchPreview | null; expiresAt: number }
  >();
  private dictionaryCache: {
    value: { cities: string[]; localities: string[] };
    expiresAt: number;
  } | null = null;

  constructor(
    @Inject(AppStateService) private readonly appState: AppStateService,
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(IntentClassifierService) private readonly intentClassifier: IntentClassifierService,
    @Inject(RankingService) private readonly rankingService: RankingService,
    @Inject(EmbeddingService) private readonly embeddingService: EmbeddingService,
    @Inject(QueryParserService) private readonly queryParser: QueryParserService
  ) {}

  /**
   * Route a natural-language query to intent + filters.
   * Pipeline: AI intent classifier (when enabled) → regex fallback.
   */
  async routeQuery(
    query: string,
    locale: "en" | "hi",
    cityHint?: string,
    sessionToken?: string,
    userId?: string
  ) {
    // 1. Try AI intent classifier first
    const aiResult = await this.intentClassifier.classify(query, locale, cityHint);

    if (aiResult && aiResult.confidence >= 0.5) {
      // Conversation context: merge with accumulated filters if available
      let mergedFilters = aiResult.filters as Record<string, unknown>;

      if (sessionToken) {
        const session = await this.queryParser.getOrCreateSession(sessionToken, userId);
        if (session) {
          mergedFilters = this.queryParser.mergeFilters(
            session.accumulated_filters,
            aiResult.filters
          ) as Record<string, unknown>;

          await this.queryParser.appendTurn(
            session.session_id,
            { role: "user", content: query, filters: aiResult.filters, timestamp: Date.now() },
            mergedFilters as ParsedFilters,
            aiResult.intent
          );
        }
      }

      const route = this.intentToRoute(aiResult.intent, mergedFilters);
      return {
        intent: aiResult.intent,
        route,
        filters: mergedFilters,
        clarifying_question: aiResult.clarifying_question,
        source: "ai" as const
      };
    }

    // 2. Regex fallback (existing logic)
    return { ...this.routeQueryRegex(query, locale, cityHint), source: "regex" as const };
  }

  /** Map intent to a route path */
  private intentToRoute(intent: SearchIntent, filters: Record<string, unknown>): string {
    switch (intent) {
      case "open_listing":
        return filters.listing_id ? `/listing/${filters.listing_id}` : "/search";
      case "post_listing":
        return "/owner/dashboard";
      case "city_browse":
        return filters.city ? `/city/${filters.city}` : "/search";
      default:
        return "/search";
    }
  }

  /** Original regex-based route query (preserved as fallback) */
  routeQueryRegex(query: string, locale: "en" | "hi", cityHint?: string) {
    const rawText = query || "";
    const text = normalizeDigits(rawText).toLowerCase();
    const filters: Record<string, unknown> = {};
    let city = cityHint?.toLowerCase();

    const listingIdMatch = text.match(
      /[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i
    );
    if (listingIdMatch) {
      return {
        intent: "open_listing",
        route: `/listing/${listingIdMatch[0]}`,
        filters
      };
    }

    if (
      /\b(post|list|rent out|publish)\b/.test(text) ||
      /प्रॉपर्टी पोस्ट|listing डाल|घर डाल/.test(text)
    ) {
      return {
        intent: "post_listing",
        route: "/owner/dashboard",
        filters
      };
    }

    for (const [alias, canonical] of Object.entries(CITY_ALIASES)) {
      if (text.includes(alias.toLowerCase())) {
        city = canonical;
        break;
      }
    }

    if (city) {
      filters.city = city;
    }

    const hasPgKeyword = TYPE_KEYWORDS.pg.some((token) => text.includes(token.toLowerCase()));
    const hasFlatKeyword = TYPE_KEYWORDS.flatHouse.some((token) =>
      text.includes(token.toLowerCase())
    );

    if (hasPgKeyword && !hasFlatKeyword) {
      filters.listing_type = "pg";
    } else if (hasFlatKeyword) {
      filters.listing_type = "flat_house";
    }

    const rentFilters = parseRentFilters(text);
    if (rentFilters.max_rent) {
      filters.max_rent = rentFilters.max_rent;
    }
    if (rentFilters.min_rent) {
      filters.min_rent = rentFilters.min_rent;
    }

    const bhkMatch = text.match(/(\d)\s*bhk/);
    if (bhkMatch) {
      filters.bhk = Number(bhkMatch[1]);
    }

    const onlyCitySignal =
      Boolean(filters.city) &&
      !filters.listing_type &&
      !filters.min_rent &&
      !filters.max_rent &&
      !filters.bhk;
    if (onlyCitySignal) {
      return {
        intent: "city_browse",
        route: `/city/${filters.city as string}`,
        filters
      };
    }

    // Only ask clarifying questions when the query produced NO useful filters/signals at all.
    // If we have at least one actionable filter (type, rent, bhk, city) — proceed to search.
    const hasAnyFilter =
      Boolean(filters.city) ||
      Boolean(filters.listing_type) ||
      Boolean(filters.min_rent) ||
      Boolean(filters.max_rent) ||
      Boolean(filters.bhk);

    if (!hasAnyFilter && rawText.trim().length > 0) {
      // Completely unparseable query — ask what city
      return {
        intent: "search_listing",
        route: "/search",
        filters,
        clarifying_question: {
          id: "missing_city",
          text: locale === "hi" ? "कौन स௣ शहर चाहिए?" : "Which city should we search in?",
          options: CITY_ORDER.slice(0, 4)
        }
      };
    }

    return {
      intent: "search_listing",
      route: "/search",
      filters
    };
  }

  async searchListings(query: Record<string, string | undefined>) {
    const normalizedSort = normalizeSort(query.sort);

    if (this.database.isEnabled()) {
      const clauses: string[] = ["l.status = 'active'"];
      const params: unknown[] = [];
      let hasFts = false;
      let ftsParamIdx = 0;

      // ── Full-text search on q param ──
      if (query.q && query.q.trim().length > 0) {
        const q = query.q.trim();
        params.push(q);
        ftsParamIdx = params.length;
        hasFts = true;
        // Index-backed full-text search (migration 0042). The english/simple
        // tsvector predicates match idx_listings_fts_en / idx_listings_fts_hi, so
        // this is a fast GIN lookup instead of the previous per-row to_tsvector().
        //
        // The old `OR similarity(title, q) > 0.15` fuzzy branch was removed: its
        // GIN trigram index returns thousands of lossy candidates that must be
        // re-checked (a 277ms–2.3s cliff on no-match queries) and at 0.15 it was
        // low-precision (matched ~2.5k rows for a 3-word query). If typo-tolerance
        // is needed it should be a BOUNDED fallback that only runs when this FTS
        // returns too few rows — not an always-on predicate. See routeQuery/suggest.
        clauses.push(
          `(
            to_tsvector('english', COALESCE(l.title_en,'') || ' ' || COALESCE(l.description_en,''))
            @@ websearch_to_tsquery('english', $${params.length})
            OR to_tsvector('simple', COALESCE(l.title_hi,'') || ' ' || COALESCE(l.description_hi,''))
            @@ websearch_to_tsquery('simple', $${params.length})
          )`
        );
      }

      if (query.city) {
        // Filter on the denormalized listings.city_slug (migration 0042) instead
        // of cities.slug so the city predicate is pushed down onto listings and
        // can use idx_listings_active_cityslug_rent_created. The cities join below
        // is kept only for output columns (c.slug, c.name_en).
        params.push(query.city.toLowerCase());
        clauses.push(`l.city_slug = $${params.length}`);
      }

      if (query.listing_type) {
        params.push(query.listing_type);
        clauses.push(`l.listing_type = $${params.length}::listing_type`);
      }

      if (query.locality) {
        params.push(query.locality.toLowerCase());
        clauses.push(`loc.slug = $${params.length}`);
      }

      if (query.min_rent) {
        params.push(Number(query.min_rent));
        clauses.push(`l.monthly_rent >= $${params.length}`);
      }

      if (query.max_rent) {
        params.push(Number(query.max_rent));
        clauses.push(`l.monthly_rent <= $${params.length}`);
      }

      if (query.bhk) {
        params.push(Number(query.bhk));
        clauses.push(`l.bhk = $${params.length}`);
      }

      if (query.furnishing) {
        params.push(query.furnishing);
        clauses.push(`l.furnishing = $${params.length}::furnishing_type`);
      }

      if (query.verified_only === "true") {
        clauses.push(`l.verification_status = 'verified'`);
      }

      // ── Geo-search: radius filter (Phase 0A) ──
      if (query.lat && query.lng && query.radius_km) {
        const lat = Number(query.lat);
        const lng = Number(query.lng);
        const radiusM = Number(query.radius_km) * 1000;
        if (
          Number.isFinite(lat) &&
          Number.isFinite(lng) &&
          Number.isFinite(radiusM) &&
          radiusM > 0
        ) {
          // Bounding box approximation for radius (PostGIS not available):
          // 1m ≈ 1/111111° lat, 1/100000° lng at Delhi latitudes
          params.push(lat, lng, radiusM);
          const iLat = params.length - 2;
          const iLng = params.length - 1;
          const iR = params.length;
          clauses.push(
            `ll.lat IS NOT NULL AND ll.lat::float8 BETWEEN $${iLat}::float8 - $${iR}::float8/111111.0 AND $${iLat}::float8 + $${iR}::float8/111111.0 AND ll.lng::float8 BETWEEN $${iLng}::float8 - $${iR}::float8/100000.0 AND $${iLng}::float8 + $${iR}::float8/100000.0`
          );
        }
      }

      // ── Extended filters (Phase 3B) ──
      if (query.min_deposit) {
        params.push(Number(query.min_deposit));
        clauses.push(`l.security_deposit >= $${params.length}`);
      }

      if (query.max_deposit) {
        params.push(Number(query.max_deposit));
        clauses.push(`l.security_deposit <= $${params.length}`);
      }

      if (query.preferred_tenant) {
        params.push(query.preferred_tenant);
        clauses.push(`l.preferred_tenant = $${params.length}::tenant_pref`);
      }

      if (query.availability) {
        if (query.availability === "immediate") {
          clauses.push(`(l.available_from IS NULL OR l.available_from <= CURRENT_DATE)`);
        } else {
          params.push(query.availability);
          clauses.push(`l.available_from >= $${params.length}::date`);
        }
      }

      // ── SEO intent filters (PG-specific, joined via pg_details) ──
      let joinPgDetails = false;
      if (query.occupancy_type) {
        joinPgDetails = true;
        params.push(query.occupancy_type);
        clauses.push(`pgd.occupancy_type = $${params.length}::occupancy_type`);
      }
      if (query.food_included === "true") {
        joinPgDetails = true;
        clauses.push(`pgd.food_included = true`);
      }

      // ── PG segment filters (split: read the projection, filter the PG aggregate) ──
      // gender_policy / tenant_type live on pg_details (1:1). sharing / ac live on
      // pg_room_types (1:N) so they filter via EXISTS to avoid row multiplication.
      if (query.gender_policy) {
        joinPgDetails = true;
        params.push(query.gender_policy);
        clauses.push(`pgd.gender_policy = $${params.length}::pg_gender_policy`);
      }
      if (query.tenant_type) {
        joinPgDetails = true;
        params.push(query.tenant_type);
        clauses.push(`pgd.tenant_type = $${params.length}::pg_tenant_type`);
      }
      if (query.sharing) {
        params.push(query.sharing);
        clauses.push(
          `EXISTS (SELECT 1 FROM pg_room_types rt WHERE rt.listing_id = l.id AND rt.sharing = $${params.length}::pg_sharing_kind)`
        );
      }
      if (query.ac === "true") {
        clauses.push(
          `EXISTS (SELECT 1 FROM pg_room_types rt WHERE rt.listing_id = l.id AND rt.ac = true)`
        );
      }

      const page = parsePage(query.page);
      const pageSize = Math.min(Math.max(Number(query.page_size) || 20, 1), 60);
      const offset = (page - 1) * pageSize;

      // ── Sort: use listing_scores for relevance to fix pagination bug ──
      const ftsRankExpr = hasFts
        ? `GREATEST(ts_rank(to_tsvector('english', COALESCE(l.title_en,'') || ' ' || COALESCE(l.description_en,'')), websearch_to_tsquery('english', $${ftsParamIdx})), ts_rank(to_tsvector('simple', COALESCE(l.title_hi,'') || ' ' || COALESCE(l.description_hi,'')), websearch_to_tsquery('simple', $${ftsParamIdx})))`
        : "0";

      const orderBy =
        normalizedSort === "rent_asc"
          ? "l.monthly_rent ASC NULLS LAST, l.created_at DESC"
          : normalizedSort === "rent_desc"
            ? "l.monthly_rent DESC NULLS LAST, l.created_at DESC"
            : normalizedSort === "verified"
              ? `CASE WHEN l.verification_status = 'verified' THEN 0 WHEN l.verification_status = 'pending' THEN 1 ELSE 2 END ASC, l.created_at DESC`
              : normalizedSort === "newest"
                ? "l.created_at DESC"
                : // relevance: featured first, then materialized score + text rank
                  `COALESCE(ls.featured_score, 0) DESC, (COALESCE(ls.composite_score, 0.35) + ${hasFts ? ftsRankExpr : "0"}) DESC, l.created_at DESC`;

      const where = clauses.join(" AND ");

      const pgJoinSql = joinPgDetails ? "JOIN pg_details pgd ON pgd.listing_id = l.id" : "";

      // F8: trim the pagination count to the joins that actually affect the total.
      //  - listing_locations (INNER) is KEPT: it matches the result query's INNER
      //    join, so the total equals the number of returnable rows (a listing with
      //    no location is excluded from both). It also carries the geo predicate.
      //  - cities is DROPPED: INNER but ll.city_id is FK-guaranteed, so it never
      //    removed a row; count(*) selects no columns, so c.* is unused here.
      //  - localities is DROPPED unless a locality filter is active: it was a LEFT
      //    join, so it never changed the count; only needed for `loc.slug`.
      // Measured at 100k: city+rent 46ms->26ms, city+FTS 103ms->32ms, totals identical.
      const countFromSql = `FROM listings l
        JOIN listing_locations ll ON ll.listing_id = l.id
        ${query.locality ? "LEFT JOIN localities loc ON loc.id = ll.locality_id" : ""}
        ${pgJoinSql}`;

      const countResult = await this.database.query<{ total: number }>(
        `
        SELECT count(*)::int AS total
        ${countFromSql}
        WHERE ${where}
        `,
        params
      );

      const resultParams = [...params, pageSize, offset];
      const rows = await this.database.query<{
        id: string;
        title: string;
        city: string;
        city_name: string;
        locality: string | null;
        lat: number | null;
        lng: number | null;
        listing_type: "flat_house" | "pg";
        monthly_rent: number;
        bhk: number | null;
        furnishing: string | null;
        area_sqft: number | null;
        verification_status: "unverified" | "pending" | "verified" | "failed";
        created_at: string;
        photo_count: number;
        cover_photo: string | null;
        composite_score: number | null;
      }>(
        `
        SELECT
          l.id::text,
          COALESCE(NULLIF(l.title_en, ''), NULLIF(l.title_hi, ''), 'Listing') AS title,
          c.slug AS city,
          c.name_en AS city_name,
          loc.name_en AS locality,
          ll.lat::float8 AS lat,
          ll.lng::float8 AS lng,
          l.listing_type::text,
          l.monthly_rent,
          l.bhk,
          l.furnishing::text,
          l.area_sqft,
          l.verification_status::text,
          l.created_at::text,
          (SELECT count(*)::int FROM listing_photos lp WHERE lp.listing_id = l.id) AS photo_count,
          (SELECT lp2.blob_path FROM listing_photos lp2 WHERE lp2.listing_id = l.id AND lp2.is_cover = true LIMIT 1) AS cover_photo,
          ls.composite_score
        FROM listings l
        JOIN listing_locations ll ON ll.listing_id = l.id
        JOIN cities c ON c.id = ll.city_id
        LEFT JOIN localities loc ON loc.id = ll.locality_id
        LEFT JOIN listing_scores ls ON ls.listing_id = l.id
        ${pgJoinSql}
        WHERE ${where}
        ORDER BY ${orderBy}
        LIMIT $${resultParams.length - 1}
        OFFSET $${resultParams.length}
        `,
        resultParams
      );

      const now = Date.now();

      const items = rows.rows.map((row) => {
        let score: number;

        if (row.composite_score != null) {
          score = row.composite_score;
        } else {
          const createdAt = new Date(row.created_at).getTime();
          const freshness = Math.max(0, 1 - (now - createdAt) / (1000 * 60 * 60 * 24 * 30));
          const verification =
            row.verification_status === "verified"
              ? 1
              : row.verification_status === "pending"
                ? 0.5
                : 0;
          const photoQuality = Math.min((row.photo_count ?? 0) / 6, 1);
          score =
            0.3 * verification +
            0.2 * freshness +
            0.2 * photoQuality +
            0.15 * 0.7 +
            0.1 * 0.8 +
            0.05 * 0.5;
        }

        return {
          id: row.id,
          title: row.title,
          city: row.city,
          city_name: row.city_name,
          locality: row.locality,
          lat: row.lat,
          lng: row.lng,
          listing_type: row.listing_type,
          monthly_rent: row.monthly_rent,
          bhk: row.bhk,
          furnishing: row.furnishing,
          area_sqft: row.area_sqft,
          verification_status: row.verification_status,
          cover_photo: this.toPhotoUrl(row.cover_photo),
          score: Number(score.toFixed(4))
        };
      });

      return {
        items,
        total: Number(countResult.rows[0]?.total ?? 0),
        page,
        page_size: pageSize
      };
    }

    // In-memory fallback when DB is not available (used by integration tests/local fallback mode).
    const page = parsePage(query.page);
    const pageSize = 20;

    let rows = [...this.appState.listings.values()].filter(
      (listing) => listing.status === "active"
    );

    if (query.q?.trim()) {
      const q = query.q.trim().toLowerCase();
      rows = rows.filter((listing) => listing.title.toLowerCase().includes(q));
    }

    if (query.city) {
      const city = query.city.toLowerCase();
      rows = rows.filter((listing) => listing.city === city);
    }

    if (query.listing_type) {
      rows = rows.filter((listing) => listing.listingType === query.listing_type);
    }

    if (query.locality) {
      const locality = query.locality.toLowerCase();
      rows = rows.filter((listing) => (listing.locality ?? "").toLowerCase() === locality);
    }

    if (query.min_rent) {
      const minRent = Number(query.min_rent);
      if (Number.isFinite(minRent)) {
        rows = rows.filter((listing) => listing.monthlyRent >= minRent);
      }
    }

    if (query.max_rent) {
      const maxRent = Number(query.max_rent);
      if (Number.isFinite(maxRent)) {
        rows = rows.filter((listing) => listing.monthlyRent <= maxRent);
      }
    }

    if (query.bhk) {
      const bhk = Number(query.bhk);
      if (Number.isFinite(bhk)) {
        rows = rows.filter(
          (listing) =>
            listing.listingType === "flat_house" &&
            (listing.title.toLowerCase().includes(`${bhk}bhk`) ||
              listing.title.toLowerCase().includes(`${bhk} bhk`))
        );
      }
    }

    if (query.furnishing) {
      rows = rows.filter((listing) => listing.furnishing === query.furnishing);
    }

    if (query.verified_only === "true") {
      rows = rows.filter((listing) => listing.verificationStatus === "verified");
    }

    rows.sort((a, b) => {
      if (normalizedSort === "rent_asc") return a.monthlyRent - b.monthlyRent;
      if (normalizedSort === "rent_desc") return b.monthlyRent - a.monthlyRent;
      if (normalizedSort === "verified") {
        const rank = (status: string) => (status === "verified" ? 0 : status === "pending" ? 1 : 2);
        return rank(a.verificationStatus) - rank(b.verificationStatus);
      }

      // Default relevance/newest approximation for in-memory mode.
      return b.createdAt - a.createdAt;
    });

    const total = rows.length;
    const offset = (page - 1) * pageSize;
    const paged = rows.slice(offset, offset + pageSize);

    return {
      items: paged.map((row) => ({
        id: row.id,
        title: row.title,
        city: row.city,
        city_name: row.city,
        locality: row.locality ?? null,
        listing_type: row.listingType,
        monthly_rent: row.monthlyRent,
        bhk: null,
        furnishing: row.furnishing ?? null,
        area_sqft: null,
        verification_status: row.verificationStatus,
        cover_photo: null,
        score: 0.5
      })),
      total,
      page,
      page_size: pageSize
    };
  }

  /**
   * Map-based search: return listing pins within viewport bounds.
   */
  async searchListingsForMap(
    bounds: {
      sw_lat: number;
      sw_lng: number;
      ne_lat: number;
      ne_lng: number;
    },
    limit = 200,
    filters: {
      bhk?: number;
      max_rent?: number;
      listing_type?: "flat_house" | "pg";
      verified_only?: boolean;
      near_metro?: boolean;
    } = {}
  ): Promise<
    Array<{
      id: string;
      lat: number;
      lng: number;
      title: string;
      monthly_rent: number;
      listing_type: string;
      bhk: number | null;
      verification_status: string;
      furnishing: string | null;
      cover_photo: string | null;
      city: string;
      locality: string | null;
      locality_slug: string | null;
    }>
  > {
    if (!this.database.isEnabled()) return [];

    const params: (string | number | boolean | null)[] = [
      bounds.sw_lng,
      bounds.sw_lat,
      bounds.ne_lng,
      bounds.ne_lat,
      limit,
      filters.bhk ?? null,
      filters.max_rent ?? null,
      filters.listing_type ?? null,
      filters.verified_only ?? false,
      filters.near_metro ?? false
    ];

    const result = await this.database.query<{
      id: string;
      lat: number;
      lng: number;
      title: string;
      monthly_rent: number;
      listing_type: string;
      bhk: number | null;
      verification_status: string;
      furnishing: string | null;
      cover_photo: string | null;
      city: string;
      locality: string | null;
      locality_slug: string | null;
    }>(
      `SELECT
         l.id::text,
         ll.lat::float8 AS lat,
         ll.lng::float8 AS lng,
         COALESCE(NULLIF(l.title_en, ''), 'Listing') AS title,
         l.monthly_rent,
         l.listing_type::text,
         l.bhk,
         l.verification_status::text,
         l.furnishing::text,
         c.slug AS city,
         loc.name_en AS locality,
         loc.slug AS locality_slug,
         (
           SELECT lp.blob_path
           FROM listing_photos lp
           WHERE lp.listing_id = l.id
             AND lp.moderation_status <> 'rejected'
           ORDER BY lp.is_cover DESC, lp.sort_order ASC, lp.created_at ASC
           LIMIT 1
         ) AS cover_photo
       FROM listings l
       JOIN listing_locations ll ON ll.listing_id = l.id
       JOIN cities c ON c.id = ll.city_id
       LEFT JOIN localities loc ON loc.id = ll.locality_id
       WHERE l.status = 'active'
         AND ll.lat IS NOT NULL
         AND ll.lat::float8 BETWEEN $2 AND $4
         AND ll.lng::float8 BETWEEN $1 AND $3
         AND ($6::smallint IS NULL OR l.bhk = $6)
         AND ($7::int IS NULL OR l.monthly_rent <= $7)
         AND ($8::text IS NULL OR l.listing_type::text = $8)
         AND ($9::boolean IS NOT TRUE OR l.verification_status = 'verified')
         AND ($10::boolean IS NOT TRUE OR EXISTS (
           SELECT 1 FROM metro_stations ms
           WHERE ms.lat BETWEEN ll.lat::float8 - 0.009 AND ll.lat::float8 + 0.009
             AND ms.lng BETWEEN ll.lng::float8 - 0.009 AND ll.lng::float8 + 0.009
         ))
       ORDER BY l.created_at DESC
       LIMIT $5`,
      params
    );

    return result.rows.map((r) => ({
      ...r,
      cover_photo: this.toPhotoUrl(r.cover_photo)
    }));
  }

  /**
   * Similar listings: same locality/city + similar rent (0.7x-1.3x).
   */
  async getSimilarListings(
    listingId: string,
    limit = 6
  ): Promise<
    Array<{
      id: string;
      title: string;
      monthly_rent: number;
      listing_type: string;
      city: string;
      locality: string | null;
      cover_photo: string | null;
    }>
  > {
    if (!this.database.isEnabled()) return [];

    const result = await this.database.query<{
      id: string;
      title: string;
      monthly_rent: number;
      listing_type: string;
      city: string;
      locality: string | null;
      cover_photo: string | null;
    }>(
      `WITH ref AS (
         SELECT l.monthly_rent, ll.locality_id, ll.city_id, l.listing_type
         FROM listings l
         JOIN listing_locations ll ON ll.listing_id = l.id
         WHERE l.id = $1::uuid
         LIMIT 1
       )
       SELECT
         l.id::text,
         COALESCE(NULLIF(l.title_en, ''), 'Listing') AS title,
         l.monthly_rent,
         l.listing_type::text,
         c.slug AS city,
         loc.name_en AS locality,
         (SELECT lp.blob_path FROM listing_photos lp WHERE lp.listing_id = l.id AND lp.is_cover = true LIMIT 1) AS cover_photo
       FROM listings l
       JOIN listing_locations ll ON ll.listing_id = l.id
       JOIN cities c ON c.id = ll.city_id
       LEFT JOIN localities loc ON loc.id = ll.locality_id
       CROSS JOIN ref
       WHERE l.status = 'active'
         AND l.id != $1::uuid
         AND ll.city_id = ref.city_id
         AND l.monthly_rent BETWEEN ref.monthly_rent * 0.7 AND ref.monthly_rent * 1.3
       ORDER BY
         CASE WHEN ll.locality_id = ref.locality_id THEN 0 ELSE 1 END,
         ABS(l.monthly_rent - ref.monthly_rent) ASC
       LIMIT $2`,
      [listingId, limit]
    );

    return result.rows.map((row) => ({
      ...row,
      cover_photo: this.toPhotoUrl(row.cover_photo)
    }));
  }

  /**
   * Popular localities: localities with highest active listing count.
   */
  async getPopularLocalities(
    citySlug?: string,
    limit = 12
  ): Promise<
    Array<{
      slug: string;
      name: string;
      city: string;
      listing_count: number;
    }>
  > {
    if (!this.database.isEnabled()) return [];

    const params: unknown[] = [limit];
    let cityClause = "";
    if (citySlug) {
      params.push(citySlug);
      cityClause = `AND c.slug = $${params.length}`;
    }

    const result = await this.database.query<{
      slug: string;
      name: string;
      city: string;
      listing_count: number;
    }>(
      `SELECT
         loc.slug,
         loc.name_en AS name,
         c.slug AS city,
         count(*)::int AS listing_count
       FROM listings l
       JOIN listing_locations ll ON ll.listing_id = l.id
       JOIN cities c ON c.id = ll.city_id
       JOIN localities loc ON loc.id = ll.locality_id
       WHERE l.status = 'active' ${cityClause}
       GROUP BY loc.slug, loc.name_en, c.slug
       ORDER BY listing_count DESC
       LIMIT $1`,
      params
    );

    return result.rows;
  }

  async searchFiltersMetadata() {
    if (this.database.isEnabled()) {
      const cities = await this.database.query<{ slug: string }>(
        `
        SELECT slug
        FROM cities
        WHERE is_active = true
        ORDER BY slug ASC
        `
      );

      const localities = await this.database.query<{ slug: string }>(
        `
        SELECT DISTINCT loc.slug
        FROM localities loc
        JOIN listing_locations ll ON ll.locality_id = loc.id
        JOIN listings l ON l.id = ll.listing_id
        WHERE l.status = 'active'
        ORDER BY loc.slug ASC
        LIMIT 300
        `
      );

      const rentRange = await this.database.query<{
        min_rent: number | null;
        max_rent: number | null;
      }>(
        `
        SELECT min(monthly_rent)::int AS min_rent, max(monthly_rent)::int AS max_rent
        FROM listings
        WHERE status = 'active'
        `
      );

      return {
        cities: cities.rows.map((row) => row.slug),
        localities: localities.rows.map((row) => row.slug),
        listing_types: ["flat_house", "pg"],
        furnishing_options: ["unfurnished", "semi_furnished", "fully_furnished"],
        bhk_options: [1, 2, 3, 4, 5],
        sort_options: SORT_OPTIONS,
        ranges: {
          rent_min: Number(rentRange.rows[0]?.min_rent ?? 0),
          rent_max: Number(rentRange.rows[0]?.max_rent ?? 0)
        },
        defaults: {
          sort: "relevance",
          page_size: 20
        }
      };
    }

    const activeListings = [...this.appState.listings.values()].filter(
      (listing) => listing.status === "active"
    );
    const rents = activeListings.map((listing) => listing.monthlyRent);
    const localities = [
      ...new Set(activeListings.map((listing) => listing.locality).filter(Boolean))
    ].sort();

    return {
      cities: [...new Set(activeListings.map((listing) => listing.city))].sort(),
      localities,
      listing_types: ["flat_house", "pg"],
      furnishing_options: ["unfurnished", "semi_furnished", "fully_furnished"],
      bhk_options: [1, 2, 3, 4, 5],
      sort_options: SORT_OPTIONS,
      ranges: {
        rent_min: rents.length ? Math.min(...rents) : 0,
        rent_max: rents.length ? Math.max(...rents) : 0
      },
      defaults: {
        sort: "relevance",
        page_size: 20
      }
    };
  }

  /**
   * Lightweight place-name dictionary for the client-side smart parser.
   * Returns ALL cities + localities (not filtered by listing presence) so the
   * parser can recognize names like "Gomti Nagar" even before any listing is
   * tagged with that locality. Cached for 10 minutes.
   */
  async searchDictionary(): Promise<{ cities: string[]; localities: string[] }> {
    const cached = this.dictionaryCache;
    if (cached && cached.expiresAt > Date.now()) {
      return cached.value;
    }

    if (!this.database.isEnabled()) {
      const value = { cities: [...CITY_ORDER], localities: [] };
      this.dictionaryCache = { value, expiresAt: Date.now() + DICTIONARY_TTL_MS };
      return value;
    }

    const [cityRows, locRows] = await Promise.all([
      this.database.query<{ slug: string }>(
        `SELECT slug FROM cities WHERE is_active = true ORDER BY slug ASC`
      ),
      this.database.query<{ slug: string }>(
        `SELECT slug FROM localities ORDER BY slug ASC LIMIT 2000`
      )
    ]);

    const value = {
      cities: cityRows.rows.map((r) => r.slug),
      localities: locRows.rows.map((r) => r.slug)
    };
    this.dictionaryCache = { value, expiresAt: Date.now() + DICTIONARY_TTL_MS };
    return value;
  }

  /**
   * Locality / city preview for the dropdown's right-hand pane.
   * Returns aggregate stats + a small set of cover photos.
   */
  async getSearchPreview(
    type: "city" | "locality",
    slug: string
  ): Promise<{
    type: "city" | "locality";
    slug: string;
    name: string;
    city_slug?: string;
    listing_count: number;
    rent_band: { min: number; max: number } | null;
    verified_pct: number | null;
    avg_bhk: number | null;
    sample_photos: string[];
  } | null> {
    if (!this.database.isEnabled() || !slug) return null;

    const cacheKey = `${type}:${slug}`;
    const cached = this.previewCache.get(cacheKey);
    const now = Date.now();
    if (cached && cached.expiresAt > now) {
      return cached.value;
    }

    let value: Awaited<ReturnType<SearchService["getSearchPreview"]>> = null;

    if (type === "city") {
      const cityRows = await this.database.query<{
        slug: string;
        name_en: string;
      }>(`SELECT slug, name_en FROM cities WHERE slug = $1 AND is_active = true LIMIT 1`, [slug]);
      const city = cityRows.rows[0];
      if (!city) return null;

      const stats = await this.database.query<{
        listing_count: number;
        min_rent: number | null;
        max_rent: number | null;
        verified_count: number;
        avg_bhk: number | null;
      }>(
        `SELECT
           count(*)::int AS listing_count,
           min(l.monthly_rent)::int AS min_rent,
           max(l.monthly_rent)::int AS max_rent,
           sum(CASE WHEN l.verification_status = 'verified' THEN 1 ELSE 0 END)::int AS verified_count,
           avg(l.bhk)::float AS avg_bhk
         FROM listings l
         JOIN listing_locations ll ON ll.listing_id = l.id
         JOIN cities c ON c.id = ll.city_id
         WHERE c.slug = $1 AND l.status = 'active' AND l.listing_type = 'flat_house'`,
        [slug]
      );
      const row = stats.rows[0] ?? {
        listing_count: 0,
        min_rent: null,
        max_rent: null,
        verified_count: 0,
        avg_bhk: null
      };

      const photoRows = await this.database.query<{ blob_path: string }>(
        `SELECT lp.blob_path
         FROM listing_photos lp
         JOIN listings l ON l.id = lp.listing_id
         JOIN listing_locations ll ON ll.listing_id = l.id
         JOIN cities c ON c.id = ll.city_id
         WHERE c.slug = $1 AND l.status = 'active' AND l.listing_type = 'flat_house' AND lp.is_cover = true
         ORDER BY l.created_at DESC
         LIMIT 4`,
        [slug]
      );

      value = {
        type: "city",
        slug,
        name: city.name_en,
        listing_count: row.listing_count ?? 0,
        rent_band:
          row.min_rent != null && row.max_rent != null
            ? { min: row.min_rent, max: row.max_rent }
            : null,
        verified_pct:
          row.listing_count > 0 ? Math.round((row.verified_count / row.listing_count) * 100) : null,
        avg_bhk: row.avg_bhk != null ? Number(row.avg_bhk.toFixed(1)) : null,
        sample_photos: photoRows.rows
          .map((r) => this.toPhotoUrl(r.blob_path))
          .filter((u): u is string => Boolean(u))
      };
    } else {
      const locRows = await this.database.query<{
        slug: string;
        name_en: string;
        city_slug: string;
      }>(
        `SELECT loc.slug, loc.name_en, c.slug AS city_slug
         FROM localities loc
         JOIN cities c ON c.id = loc.city_id
         WHERE loc.slug = $1
         LIMIT 1`,
        [slug]
      );
      const loc = locRows.rows[0];
      if (!loc) return null;

      // Same fuzzy matching as the suggest endpoint: count listings whose
      // locality_id matches OR whose title/description mentions the locality
      // name. Catches the common case where listings weren't tagged at upload.
      const stats = await this.database.query<{
        listing_count: number;
        min_rent: number | null;
        max_rent: number | null;
        verified_count: number;
        avg_bhk: number | null;
      }>(
        `SELECT
           count(DISTINCT l.id)::int AS listing_count,
           min(l.monthly_rent)::int AS min_rent,
           max(l.monthly_rent)::int AS max_rent,
           sum(CASE WHEN l.verification_status = 'verified' THEN 1 ELSE 0 END)::int AS verified_count,
           avg(l.bhk)::float AS avg_bhk
         FROM listings l
         JOIN listing_locations ll ON ll.listing_id = l.id
         JOIN localities loc ON loc.city_id = ll.city_id
         WHERE loc.slug = $1
           AND l.status = 'active'
           AND l.listing_type = 'flat_house'
           AND (
             ll.locality_id = loc.id
             OR l.title_en ILIKE '%' || loc.name_en || '%'
             OR l.description_en ILIKE '%' || loc.name_en || '%'
           )`,
        [slug]
      );
      const row = stats.rows[0] ?? {
        listing_count: 0,
        min_rent: null,
        max_rent: null,
        verified_count: 0,
        avg_bhk: null
      };

      const photoRows = await this.database.query<{ blob_path: string }>(
        `SELECT DISTINCT lp.blob_path, l.created_at
         FROM listing_photos lp
         JOIN listings l ON l.id = lp.listing_id
         JOIN listing_locations ll ON ll.listing_id = l.id
         JOIN localities loc ON loc.city_id = ll.city_id
         WHERE loc.slug = $1
           AND l.status = 'active'
           AND l.listing_type = 'flat_house'
           AND lp.is_cover = true
           AND (
             ll.locality_id = loc.id
             OR l.title_en ILIKE '%' || loc.name_en || '%'
             OR l.description_en ILIKE '%' || loc.name_en || '%'
           )
         ORDER BY l.created_at DESC
         LIMIT 4`,
        [slug]
      );

      value = {
        type: "locality",
        slug,
        name: loc.name_en,
        city_slug: loc.city_slug,
        listing_count: row.listing_count ?? 0,
        rent_band:
          row.min_rent != null && row.max_rent != null
            ? { min: row.min_rent, max: row.max_rent }
            : null,
        verified_pct:
          row.listing_count > 0 ? Math.round((row.verified_count / row.listing_count) * 100) : null,
        avg_bhk: row.avg_bhk != null ? Number(row.avg_bhk.toFixed(1)) : null,
        sample_photos: photoRows.rows
          .map((r) => this.toPhotoUrl(r.blob_path))
          .filter((u): u is string => Boolean(u))
      };
    }

    this.previewCache.set(cacheKey, { value, expiresAt: now + PREVIEW_CACHE_TTL_MS });
    if (this.previewCache.size > PREVIEW_CACHE_MAX_ENTRIES) {
      const oldest = this.previewCache.keys().next().value;
      if (oldest !== undefined) this.previewCache.delete(oldest);
    }
    return value;
  }

  /**
   * Typeahead / autocomplete suggestions.
   * Returns matching cities, localities, and listing titles using pg_trgm similarity.
   * Cached for 60s — hot prefixes hit memory in <1ms.
   */
  async suggest(q: string, limit = 8): Promise<SuggestRow[]> {
    const term = (q ?? "").trim().toLowerCase();
    if (term.length < 2) return [];

    const cacheKey = `${term}|${limit}`;
    const now = Date.now();
    const cached = this.suggestCache.get(cacheKey);
    if (cached && cached.expiresAt > now) {
      // Touch to mark recently-used (Map preserves insertion order).
      this.suggestCache.delete(cacheKey);
      this.suggestCache.set(cacheKey, cached);
      return cached.rows;
    }

    const rows = await this.suggestUncached(term, limit);
    this.suggestCache.set(cacheKey, { rows, expiresAt: now + SUGGEST_CACHE_TTL_MS });

    if (this.suggestCache.size > SUGGEST_CACHE_MAX_ENTRIES) {
      const oldestKey = this.suggestCache.keys().next().value;
      if (oldestKey !== undefined) this.suggestCache.delete(oldestKey);
    }

    return rows;
  }

  private async suggestUncached(term: string, limit: number): Promise<SuggestRow[]> {
    if (!this.database.isEnabled()) {
      const cities = CITY_ORDER.filter((c) => c.includes(term)).map((c) => ({
        type: "city" as const,
        label: c.charAt(0).toUpperCase() + c.slice(1),
        value: c
      }));
      return cities.slice(0, limit);
    }

    const results: SuggestRow[] = [];

    // Cities — match name + listing aggregates from active listings.
    const cityRows = await this.database.query<{
      slug: string;
      name_en: string;
      listing_count: number;
      min_rent: number | null;
      max_rent: number | null;
      sim: number;
    }>(
      `SELECT
         c.slug,
         c.name_en,
         COALESCE(stats.listing_count, 0)::int AS listing_count,
         stats.min_rent::int AS min_rent,
         stats.max_rent::int AS max_rent,
         similarity(c.name_en, $1) AS sim
       FROM cities c
       LEFT JOIN LATERAL (
         SELECT count(*)::int AS listing_count,
                min(l.monthly_rent) AS min_rent,
                max(l.monthly_rent) AS max_rent
         FROM listings l
         JOIN listing_locations ll ON ll.listing_id = l.id
         WHERE ll.city_id = c.id AND l.status = 'active' AND l.listing_type = 'flat_house'
       ) stats ON true
       WHERE c.is_active = true
         AND (similarity(c.name_en, $1) > 0.15 OR c.name_en ILIKE '%' || $1 || '%' OR c.name_hi ILIKE '%' || $1 || '%')
       ORDER BY sim DESC
       LIMIT 3`,
      [term]
    );
    for (const row of cityRows.rows) {
      const out: SuggestRow = {
        type: "city",
        label: row.name_en,
        value: row.slug,
        listing_count: row.listing_count
      };
      if (row.min_rent != null && row.max_rent != null) {
        out.rent_band = { min: row.min_rent, max: row.max_rent };
      }
      results.push(out);
    }

    // Localities — match + same kind of aggregates. Counts listings linked
    // via locality_id OR whose title/description mentions the locality name
    // (catches data drift where ll.locality_id wasn't tagged at upload time).
    const locRows = await this.database.query<{
      slug: string;
      name_en: string;
      city_slug: string;
      listing_count: number;
      min_rent: number | null;
      max_rent: number | null;
      sim: number;
    }>(
      `SELECT
         loc.slug,
         loc.name_en,
         c.slug AS city_slug,
         COALESCE(stats.listing_count, 0)::int AS listing_count,
         stats.min_rent::int AS min_rent,
         stats.max_rent::int AS max_rent,
         similarity(loc.name_en, $1) AS sim
       FROM localities loc
       JOIN cities c ON c.id = loc.city_id
       LEFT JOIN LATERAL (
         SELECT count(DISTINCT l.id)::int AS listing_count,
                min(l.monthly_rent) AS min_rent,
                max(l.monthly_rent) AS max_rent
         FROM listings l
         JOIN listing_locations ll ON ll.listing_id = l.id
         WHERE l.status = 'active' AND l.listing_type = 'flat_house' AND ll.city_id = c.id
           AND (
             ll.locality_id = loc.id
             OR l.title_en ILIKE '%' || loc.name_en || '%'
             OR l.description_en ILIKE '%' || loc.name_en || '%'
           )
       ) stats ON true
       WHERE c.is_active = true
         AND (similarity(loc.name_en, $1) > 0.15 OR loc.name_en ILIKE '%' || $1 || '%' OR loc.name_hi ILIKE '%' || $1 || '%')
       ORDER BY sim DESC
       LIMIT 3`,
      [term]
    );
    for (const row of locRows.rows) {
      const out: SuggestRow = {
        type: "locality",
        label: `${row.name_en}, ${row.city_slug}`,
        value: row.slug,
        city_slug: row.city_slug,
        listing_count: row.listing_count
      };
      if (row.min_rent != null && row.max_rent != null) {
        out.rent_band = { min: row.min_rent, max: row.max_rent };
      }
      results.push(out);
    }

    // Listings — match by title + return rent / verified / cover / locality / posted_at.
    const titleRows = await this.database.query<{
      id: string;
      title: string;
      city: string;
      locality: string | null;
      monthly_rent: number;
      verification_status: string;
      cover_path: string | null;
      created_at: string;
      sim: number;
    }>(
      `SELECT
         l.id::text,
         COALESCE(NULLIF(l.title_en,''), 'Listing') AS title,
         c.slug AS city,
         loc.name_en AS locality,
         l.monthly_rent,
         l.verification_status::text,
         (SELECT lp.blob_path FROM listing_photos lp
            WHERE lp.listing_id = l.id AND lp.is_cover = true LIMIT 1) AS cover_path,
         l.created_at,
         similarity(l.title_en, $1) AS sim
       FROM listings l
       JOIN listing_locations ll ON ll.listing_id = l.id
       JOIN cities c ON c.id = ll.city_id
       LEFT JOIN localities loc ON loc.id = ll.locality_id
       WHERE l.status = 'active' AND l.listing_type = 'flat_house'
         AND (similarity(l.title_en, $1) > 0.15 OR l.title_en ILIKE '%' || $1 || '%' OR l.title_hi ILIKE '%' || $1 || '%')
       ORDER BY sim DESC
       LIMIT 4`,
      [term]
    );
    for (const row of titleRows.rows) {
      results.push({
        type: "listing",
        label: row.title,
        value: row.id,
        cover_url: this.toPhotoUrl(row.cover_path),
        rent: row.monthly_rent,
        verified: row.verification_status === "verified",
        locality_label: row.locality ?? row.city,
        posted_at: row.created_at,
        city_slug: row.city
      });
    }

    return results.slice(0, limit);
  }

  /**
   * Pricing intelligence: P25/P50/P75 rent for comparable active listings.
   * Gated by ff_pricing_intel_enabled.
   */
  async getPricingIntel(params: {
    city?: string;
    locality_id?: number;
    bhk?: number;
    listing_type?: "flat_house" | "pg";
  }): Promise<{
    p25: number | null;
    p50: number | null;
    p75: number | null;
    sample_size: number;
  }> {
    const { readFeatureFlags } = await import("../../config/feature-flags");
    const flags = readFeatureFlags();
    if (!flags.ff_pricing_intel_enabled || !this.database.isEnabled()) {
      return { p25: null, p50: null, p75: null, sample_size: 0 };
    }

    const citySlug = params.city ? this.normalizeCitySlug(params.city) : null;

    const result = await this.database.query<{
      p25: number | null;
      p50: number | null;
      p75: number | null;
      sample_size: number;
    }>(
      `SELECT
         percentile_cont(0.25) WITHIN GROUP (ORDER BY l.monthly_rent)::numeric(10,2) AS p25,
         percentile_cont(0.50) WITHIN GROUP (ORDER BY l.monthly_rent)::numeric(10,2) AS p50,
         percentile_cont(0.75) WITHIN GROUP (ORDER BY l.monthly_rent)::numeric(10,2) AS p75,
         count(*)::int AS sample_size
       FROM listings l
       JOIN listing_locations ll ON ll.listing_id = l.id
       LEFT JOIN cities c ON c.id = ll.city_id
       WHERE l.status = 'active'
         AND ($1::text  IS NULL OR c.slug         = $1)
         AND ($2::int   IS NULL OR ll.locality_id = $2)
         AND ($3::int   IS NULL OR l.bhk          = $3)
         AND ($4::text  IS NULL OR l.listing_type = $4::listing_type)`,
      [
        citySlug ?? null,
        params.locality_id ?? null,
        params.bhk ?? null,
        params.listing_type ?? null
      ]
    );

    const row = result.rows[0];
    return {
      p25: row?.p25 ? Number(row.p25) : null,
      p50: row?.p50 ? Number(row.p50) : null,
      p75: row?.p75 ? Number(row.p75) : null,
      sample_size: row?.sample_size ?? 0
    };
  }

  private normalizeCitySlug(city: string): string {
    const CITY_ALIASES_LOCAL: Record<string, string> = {
      lucknow: "lucknow",
      लखनऊ: "lucknow",
      delhi: "delhi",
      "new delhi": "delhi",
      दिल्ली: "delhi",
      gurugram: "gurugram",
      gurgaon: "gurugram",
      noida: "noida",
      jaipur: "jaipur"
    };
    return CITY_ALIASES_LOCAL[city.toLowerCase().trim()] ?? city.toLowerCase().trim();
  }

  private resolvePhotoPublicBaseUrl() {
    const explicit = process.env.PHOTO_PUBLIC_BASE_URL?.trim();
    if (explicit) {
      return explicit.replace(/\/+$/, "");
    }

    const accountName = process.env.AZURE_STORAGE_ACCOUNT_NAME?.trim();
    const container =
      process.env.AZURE_STORAGE_CONTAINER_LISTING_PHOTOS?.trim() || "listing-photos";

    if (!accountName) {
      return "";
    }

    return `https://${accountName}.blob.core.windows.net/${container}`;
  }

  private toPhotoUrl(blobPath: string | null) {
    if (!blobPath) return null;
    if (/^https?:\/\//i.test(blobPath)) return blobPath;
    if (!this.photoPublicBaseUrl) return blobPath;
    return `${this.photoPublicBaseUrl}/${blobPath.replace(/^\/+/, "")}`;
  }
}
