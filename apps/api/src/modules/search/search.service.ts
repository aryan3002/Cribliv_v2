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

@Injectable()
export class SearchService {
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
        clauses.push(
          `(
            to_tsvector('english', COALESCE(l.title_en,'') || ' ' || COALESCE(l.description_en,''))
            @@ websearch_to_tsquery('english', $${params.length})
            OR similarity(l.title_en, $${params.length}) > 0.15
          )`
        );
      }

      if (query.city) {
        params.push(query.city.toLowerCase());
        clauses.push(`c.slug = $${params.length}`);
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
          params.push(lng, lat, radiusM);
          clauses.push(
            `ll.geo_point IS NOT NULL AND ST_DWithin(ll.geo_point, ST_SetSRID(ST_MakePoint($${params.length - 2}, $${params.length - 1}), 4326)::geography, $${params.length})`
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

      const page = parsePage(query.page);
      const pageSize = 20;
      const offset = (page - 1) * pageSize;

      // ── Sort: use listing_scores for relevance to fix pagination bug ──
      const ftsRankExpr = hasFts
        ? `ts_rank(to_tsvector('english', COALESCE(l.title_en,'') || ' ' || COALESCE(l.description_en,'')), websearch_to_tsquery('english', $${ftsParamIdx}))`
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

      const countResult = await this.database.query<{ total: number }>(
        `
        SELECT count(*)::int AS total
        FROM listings l
        JOIN listing_locations ll ON ll.listing_id = l.id
        JOIN cities c ON c.id = ll.city_id
        LEFT JOIN localities loc ON loc.id = ll.locality_id
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
          listing_type: row.listing_type,
          monthly_rent: row.monthly_rent,
          bhk: row.bhk,
          furnishing: row.furnishing,
          area_sqft: row.area_sqft,
          verification_status: row.verification_status,
          cover_photo: row.cover_photo,
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

    // In-memory fallback when DB is not available
    return { items: [], total: 0, page: 1, page_size: 20 };
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
    limit = 200
  ): Promise<
    Array<{
      id: string;
      lat: number;
      lng: number;
      title: string;
      monthly_rent: number;
      listing_type: string;
    }>
  > {
    if (!this.database.isEnabled()) return [];

    const result = await this.database.query<{
      id: string;
      lat: number;
      lng: number;
      title: string;
      monthly_rent: number;
      listing_type: string;
    }>(
      `SELECT
         l.id::text,
         ST_Y(ll.geo_point::geometry) AS lat,
         ST_X(ll.geo_point::geometry) AS lng,
         COALESCE(NULLIF(l.title_en, ''), 'Listing') AS title,
         l.monthly_rent,
         l.listing_type::text
       FROM listings l
       JOIN listing_locations ll ON ll.listing_id = l.id
       WHERE l.status = 'active'
         AND ll.geo_point IS NOT NULL
         AND ST_Intersects(
           ll.geo_point,
           ST_MakeEnvelope($1, $2, $3, $4, 4326)::geography
         )
       ORDER BY l.created_at DESC
       LIMIT $5`,
      [bounds.sw_lng, bounds.sw_lat, bounds.ne_lng, bounds.ne_lat, limit]
    );

    return result.rows;
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

    return result.rows;
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
   * Typeahead / autocomplete suggestions.
   * Returns matching cities, localities, and listing titles using pg_trgm similarity.
   */
  async suggest(
    q: string,
    limit = 8
  ): Promise<Array<{ type: string; label: string; value: string }>> {
    const term = (q ?? "").trim();
    if (term.length < 2) return [];

    if (!this.database.isEnabled()) {
      // In-memory fallback: match against city names
      const cities = CITY_ORDER.filter((c) => c.includes(term.toLowerCase())).map((c) => ({
        type: "city" as const,
        label: c.charAt(0).toUpperCase() + c.slice(1),
        value: c
      }));
      return cities.slice(0, limit);
    }

    const results: Array<{ type: string; label: string; value: string }> = [];

    // Cities
    const cityRows = await this.database.query<{ slug: string; name_en: string; sim: number }>(
      `SELECT slug, name_en, similarity(name_en, $1) AS sim
       FROM cities
       WHERE is_active = true AND (similarity(name_en, $1) > 0.15 OR name_en ILIKE '%' || $1 || '%')
       ORDER BY sim DESC
       LIMIT 3`,
      [term]
    );
    for (const row of cityRows.rows) {
      results.push({ type: "city", label: row.name_en, value: row.slug });
    }

    // Localities
    const locRows = await this.database.query<{
      slug: string;
      name_en: string;
      city_slug: string;
      sim: number;
    }>(
      `SELECT loc.slug, loc.name_en, c.slug AS city_slug, similarity(loc.name_en, $1) AS sim
       FROM localities loc
       JOIN cities c ON c.id = loc.city_id
       WHERE c.is_active = true AND (similarity(loc.name_en, $1) > 0.15 OR loc.name_en ILIKE '%' || $1 || '%')
       ORDER BY sim DESC
       LIMIT 3`,
      [term]
    );
    for (const row of locRows.rows) {
      results.push({
        type: "locality",
        label: `${row.name_en}, ${row.city_slug}`,
        value: row.slug
      });
    }

    // Listing titles
    const titleRows = await this.database.query<{
      id: string;
      title: string;
      city: string;
      sim: number;
    }>(
      `SELECT l.id::text, COALESCE(NULLIF(l.title_en,''), 'Listing') AS title, c.slug AS city,
              similarity(l.title_en, $1) AS sim
       FROM listings l
       JOIN listing_locations ll ON ll.listing_id = l.id
       JOIN cities c ON c.id = ll.city_id
       WHERE l.status = 'active' AND (similarity(l.title_en, $1) > 0.15 OR l.title_en ILIKE '%' || $1 || '%')
       ORDER BY sim DESC
       LIMIT 4`,
      [term]
    );
    for (const row of titleRows.rows) {
      results.push({ type: "listing", label: `${row.title} (${row.city})`, value: row.id });
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
}
