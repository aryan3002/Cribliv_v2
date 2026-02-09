import { Inject, Injectable } from "@nestjs/common";
import { AppStateService } from "../../common/app-state.service";
import { DatabaseService } from "../../common/database.service";

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
    @Inject(DatabaseService) private readonly database: DatabaseService
  ) {}

  routeQuery(query: string, locale: "en" | "hi", cityHint?: string) {
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

    const missingCity = !filters.city;
    const missingType = !filters.listing_type;

    if (missingCity || missingType) {
      return {
        intent: "search_listing",
        route: "/search",
        filters,
        clarifying_question: {
          id: missingCity ? "missing_city" : "missing_type",
          text: missingCity
            ? locale === "hi"
              ? "कौन सा शहर चाहिए?"
              : "Which city should we search in?"
            : locale === "hi"
              ? "फ्लैट/हाउस चाहिए या PG?"
              : "Do you want Flat/House or PG?",
          options: missingCity ? CITY_ORDER.slice(0, 4) : ["flat_house", "pg"]
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
    if (this.database.isEnabled()) {
      const clauses: string[] = ["l.status = 'active'"];
      const params: unknown[] = [];

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

      if (query.verified_only === "true") {
        clauses.push(`l.verification_status = 'verified'`);
      }

      const page = Math.max(1, Number(query.page ?? "1"));
      const pageSize = 20;
      const offset = (page - 1) * pageSize;

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
        listing_type: "flat_house" | "pg";
        monthly_rent: number;
        verification_status: "unverified" | "pending" | "verified" | "failed";
        created_at: string;
        photo_count: number;
      }>(
        `
        SELECT
          l.id::text,
          COALESCE(NULLIF(l.title_en, ''), NULLIF(l.title_hi, ''), 'Listing') AS title,
          c.slug AS city,
          l.listing_type::text,
          l.monthly_rent,
          l.verification_status::text,
          l.created_at::text,
          (
            SELECT count(*)::int
            FROM listing_photos lp
            WHERE lp.listing_id = l.id
          ) AS photo_count
        FROM listings l
        JOIN listing_locations ll ON ll.listing_id = l.id
        JOIN cities c ON c.id = ll.city_id
        LEFT JOIN localities loc ON loc.id = ll.locality_id
        WHERE ${where}
        ORDER BY l.created_at DESC
        LIMIT $${resultParams.length - 1}
        OFFSET $${resultParams.length}
        `,
        resultParams
      );

      const now = Date.now();
      const items = rows.rows.map((row) => {
        const createdAt = new Date(row.created_at).getTime();
        const freshness = Math.max(0, 1 - (now - createdAt) / (1000 * 60 * 60 * 24 * 30));
        const verification =
          row.verification_status === "verified"
            ? 1
            : row.verification_status === "pending"
              ? 0.5
              : 0;
        const photoQuality = Math.min((row.photo_count ?? 0) / 6, 1);
        const ownerResponseRate = 0.7;
        const completeness = 0.8;
        const engagement = 0.5;
        const score =
          0.3 * verification +
          0.2 * freshness +
          0.2 * photoQuality +
          0.15 * ownerResponseRate +
          0.1 * completeness +
          0.05 * engagement;

        return {
          id: row.id,
          title: row.title,
          city: row.city,
          listing_type: row.listing_type,
          monthly_rent: row.monthly_rent,
          verification_status: row.verification_status,
          score: Number(score.toFixed(4))
        };
      });

      if (query.sort === "price_asc") {
        items.sort((a, b) => a.monthly_rent - b.monthly_rent);
      } else if (query.sort === "price_desc") {
        items.sort((a, b) => b.monthly_rent - a.monthly_rent);
      } else if (query.sort === "newest") {
        items.sort((a, b) => b.score - a.score);
      } else {
        items.sort((a, b) => b.score - a.score);
      }

      return {
        items,
        total: Number(countResult.rows[0]?.total ?? 0),
        page,
        page_size: pageSize
      };
    }

    const now = Date.now();
    const items = [...this.appState.listings.values()]
      .filter((l) => l.status === "active")
      .filter((l) => (!query.city ? true : l.city === query.city))
      .filter((l) => (!query.locality ? true : l.locality === query.locality))
      .filter((l) => (!query.listing_type ? true : l.listingType === query.listing_type))
      .filter((l) => {
        if (!query.min_rent) {
          return true;
        }
        return l.monthlyRent >= Number(query.min_rent);
      })
      .filter((l) => {
        if (!query.max_rent) {
          return true;
        }

        return l.monthlyRent <= Number(query.max_rent);
      })
      .map((l) => {
        const freshness = Math.max(0, 1 - (now - l.createdAt) / (1000 * 60 * 60 * 24 * 30));
        const verification =
          l.verificationStatus === "verified" ? 1 : l.verificationStatus === "pending" ? 0.5 : 0;
        const score =
          0.3 * verification + 0.2 * freshness + 0.2 * 0.8 + 0.15 * 0.7 + 0.1 * 0.8 + 0.05 * 0.5;

        return {
          id: l.id,
          title: l.title,
          city: l.city,
          listing_type: l.listingType,
          monthly_rent: l.monthlyRent,
          verification_status: l.verificationStatus,
          score: Number(score.toFixed(4))
        };
      });

    if (query.sort === "price_asc") {
      items.sort((a, b) => a.monthly_rent - b.monthly_rent);
    } else if (query.sort === "price_desc") {
      items.sort((a, b) => b.monthly_rent - a.monthly_rent);
    } else {
      items.sort((a, b) => b.score - a.score);
    }

    return {
      items,
      total: items.length,
      page: Number(query.page ?? "1"),
      page_size: items.length || 10
    };
  }
}
