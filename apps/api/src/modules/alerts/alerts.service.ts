import { Inject, Injectable, BadRequestException, NotFoundException } from "@nestjs/common";
import { DatabaseService } from "../../common/database.service";
import { readFeatureFlags } from "../../config/feature-flags";

@Injectable()
export class AlertsService {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

  async saveSavedSearch(params: {
    userId: string;
    citySlug: string;
    localityId?: number;
    bhk?: number;
    maxRent?: number;
    listingType?: string;
  }): Promise<{ id: string; created: boolean }> {
    const flags = readFeatureFlags();
    if (!flags.ff_saved_search_alerts_enabled) {
      throw new BadRequestException({
        code: "feature_disabled",
        message: "Saved search alerts not enabled"
      });
    }
    if (!this.database.isEnabled()) {
      throw new BadRequestException({ code: "db_unavailable", message: "Database unavailable" });
    }

    const result = await this.database.query<{ id: string }>(
      `INSERT INTO saved_searches
         (user_id, city_slug, locality_id, bhk, max_rent, listing_type)
       VALUES ($1::uuid, $2, $3, $4, $5, $6::listing_type)
       ON CONFLICT (user_id, city_slug, locality_id, bhk, max_rent, listing_type)
         DO UPDATE SET is_active = true, updated_at = now()
       RETURNING id::text`,
      [
        params.userId,
        params.citySlug,
        params.localityId ?? null,
        params.bhk ?? null,
        params.maxRent ?? null,
        params.listingType ?? null
      ]
    );

    return { id: result.rows[0].id, created: true };
  }

  async getSavedSearches(userId: string): Promise<
    {
      id: string;
      city_slug: string;
      locality_name: string | null;
      bhk: number | null;
      max_rent: number | null;
      listing_type: string | null;
      last_alerted_at: string | null;
    }[]
  > {
    if (!this.database.isEnabled()) return [];

    const result = await this.database.query<{
      id: string;
      city_slug: string;
      locality_name: string | null;
      bhk: number | null;
      max_rent: number | null;
      listing_type: string | null;
      last_alerted_at: string | null;
    }>(
      `SELECT
         ss.id::text,
         ss.city_slug,
         lo.name_en AS locality_name,
         ss.bhk,
         ss.max_rent,
         ss.listing_type::text,
         ss.last_alerted_at::text
       FROM saved_searches ss
       LEFT JOIN localities lo ON lo.id = ss.locality_id
       WHERE ss.user_id = $1::uuid
         AND ss.is_active = true
       ORDER BY ss.created_at DESC`,
      [userId]
    );

    return result.rows;
  }

  async deleteSavedSearch(userId: string, searchId: string): Promise<void> {
    if (!this.database.isEnabled()) return;

    const result = await this.database.query(
      `UPDATE saved_searches
       SET is_active = false, updated_at = now()
       WHERE id = $1::uuid AND user_id = $2::uuid`,
      [searchId, userId]
    );

    if (!result.rowCount) {
      throw new NotFoundException({ code: "not_found", message: "Saved search not found" });
    }
  }
}
