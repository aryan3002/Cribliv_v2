import { Injectable, Logger } from "@nestjs/common";
import { DatabaseService } from "../../../common/database.service";
import { ListingContentGeneratorService } from "../../owner/listing-content-generator.service";
import type { PgListingPayload, PgSharingKind } from "@cribliv/shared-types";

export interface PricingSuggestionsInput {
  city_slug: string;
  locality_slug?: string | null;
  sharings: PgSharingKind[];
}

export interface PricingSuggestion {
  sharing: PgSharingKind;
  p25_paise: number;
  p50_paise: number;
  p75_paise: number;
  sample: number;
}

export interface PricingSuggestionsResult {
  suggestions: PricingSuggestion[];
}

export interface AmenitySuggestionsResult {
  amenities: string[];
  house_rules: string[];
}

export interface GenerateContentResult {
  title: string;
  description: string;
}

// Deterministic suggestions based on payload gaps — cheap, no LLM tokens.
const COMMON_AMENITIES = [
  "wifi",
  "hot_water",
  "power_backup",
  "cctv",
  "security_guard",
  "laundry",
  "housekeeping"
];
const COMMON_RULES = [
  "no_smoking",
  "no_alcohol",
  "no_non_veg",
  "no_pets",
  "curfew_10pm",
  "no_cooking_in_room"
];

@Injectable()
export class PgAiAssistService {
  private readonly logger = new Logger(PgAiAssistService.name);

  constructor(
    private readonly contentGenerator: ListingContentGeneratorService,
    private readonly db: DatabaseService
  ) {}

  async generateContent(payload: PgListingPayload): Promise<GenerateContentResult> {
    const d = payload.pg_details;
    const rooms = payload.room_types ?? [];
    const cheapestRent = rooms.length
      ? Math.min(...rooms.map((r) => r.monthly_rent_paise))
      : undefined;
    const sharingTypes = [...new Set(rooms.map((r) => r.sharing))].join(", ");
    const allAmenities = [
      ...(d.amenities?.core ?? []),
      ...(d.amenities?.room ?? []),
      ...(d.amenities?.services ?? []),
      ...(d.amenities?.extras ?? [])
    ];

    return this.contentGenerator.generate({
      listing_type: "pg",
      city: payload.property.city_slug,
      locality: payload.property.locality_slug ?? undefined,
      monthly_rent: cheapestRent != null ? Math.round(cheapestRent / 100) : undefined,
      preferred_tenant: d.gender_policy ?? undefined,
      beds: d.total_beds,
      sharing_type: sharingTypes || undefined,
      meals_included: d.meals?.provided ?? false,
      amenities: allAmenities.length ? allAmenities : undefined
    });
  }

  async pricingSuggestions(input: PricingSuggestionsInput): Promise<PricingSuggestionsResult> {
    if (!this.db.isEnabled() || !input.sharings.length) {
      return { suggestions: [] };
    }

    try {
      const rows = await this.db.query<{
        sharing: string;
        p25: number | string;
        p50: number | string;
        p75: number | string;
        sample: number;
      }>(
        `SELECT rt.sharing,
                percentile_cont(0.25) WITHIN GROUP (ORDER BY rt.monthly_rent_paise) AS p25,
                percentile_cont(0.5)  WITHIN GROUP (ORDER BY rt.monthly_rent_paise) AS p50,
                percentile_cont(0.75) WITHIN GROUP (ORDER BY rt.monthly_rent_paise) AS p75,
                count(*)::int AS sample
         FROM pg_room_types rt
         JOIN listings l    ON l.id = rt.listing_id
         JOIN listing_locations ll ON ll.listing_id = l.id
         JOIN cities c ON c.id = ll.city_id
         WHERE l.status = 'active'
           AND c.slug = $1
           AND rt.sharing = ANY($2::text[])
         GROUP BY rt.sharing`,
        [input.city_slug, input.sharings]
      );

      const suggestions: PricingSuggestion[] = rows.rows
        .filter((r) => r.sample >= 3)
        .map((r) => ({
          sharing: r.sharing as PgSharingKind,
          p25_paise: Math.round(Number(r.p25)),
          p50_paise: Math.round(Number(r.p50)),
          p75_paise: Math.round(Number(r.p75)),
          sample: r.sample
        }));

      return { suggestions };
    } catch (e) {
      this.logger.warn(`pricingSuggestions failed: ${String(e)}`);
      return { suggestions: [] };
    }
  }

  async amenitySuggestions(payload: PgListingPayload): Promise<AmenitySuggestionsResult> {
    const d = payload.pg_details;
    const existingAmenities = new Set([
      ...(d.amenities?.core ?? []),
      ...(d.amenities?.room ?? []),
      ...(d.amenities?.services ?? []),
      ...(d.amenities?.extras ?? [])
    ]);
    const amenities = COMMON_AMENITIES.filter((a) => !existingAmenities.has(a));

    const existingRules = d.house_rules ? Object.keys(d.house_rules) : [];
    const house_rules = COMMON_RULES.filter((r) => !existingRules.includes(r));

    return { amenities, house_rules };
  }
}
