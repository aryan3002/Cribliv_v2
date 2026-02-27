import { Inject, Injectable, Logger } from "@nestjs/common";
import { DatabaseService } from "../../common/database.service";
import { readFeatureFlags } from "../../config/feature-flags";
import type { ScoredListing } from "./ai.types";

// ─── Ranking weight configuration ─────────────────────────────────────────────
// These weights match the existing hardcoded formula but are now configurable.

const DEFAULT_WEIGHTS = {
  verification: 0.3,
  freshness: 0.2,
  photo_quality: 0.2,
  response_rate: 0.15,
  completeness: 0.1,
  engagement: 0.05
} as const;

@Injectable()
export class RankingService {
  private readonly logger = new Logger(RankingService.name);

  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

  /**
   * Fetch precomputed scores for a batch of listing IDs.
   * Returns null when ff_ai_ranking is off or DB unavailable (caller uses hardcoded fallback).
   */
  async getScores(listingIds: string[]): Promise<Map<string, ScoredListing> | null> {
    const flags = readFeatureFlags();
    if (!flags.ff_ai_ranking) return null;
    if (!this.database.isEnabled()) return null;
    if (listingIds.length === 0) return new Map();

    try {
      const placeholders = listingIds.map((_, i) => `$${i + 1}`).join(",");
      const result = await this.database.query<{
        listing_id: string;
        composite_score: number;
        verification_score: number;
        freshness_score: number;
        photo_score: number;
        response_rate_score: number;
        completeness_score: number;
        engagement_score: number;
      }>(
        `SELECT
           listing_id::text,
           composite_score,
           verification_score,
           freshness_score,
           photo_score,
           response_rate_score,
           completeness_score,
           engagement_score
         FROM listing_scores
         WHERE listing_id IN (${placeholders})`,
        listingIds
      );

      const map = new Map<string, ScoredListing>();
      for (const row of result.rows) {
        map.set(row.listing_id, {
          listing_id: row.listing_id,
          composite_score: row.composite_score,
          verification_score: row.verification_score,
          freshness_score: row.freshness_score,
          photo_score: row.photo_score,
          response_rate_score: row.response_rate_score,
          completeness_score: row.completeness_score,
          engagement_score: row.engagement_score
        });
      }

      return map;
    } catch (error) {
      this.logger.error("Failed to fetch listing scores — falling back to hardcoded", error);
      return null;
    }
  }

  /**
   * Compute and upsert scores for a batch of active listings.
   * Intended for background cron / admin trigger.
   */
  async recomputeScores(batchSize = 200): Promise<number> {
    const flags = readFeatureFlags();
    if (!flags.ff_ai_ranking) return 0;
    if (!this.database.isEnabled()) return 0;

    try {
      const result = await this.database.query<{
        id: string;
        verification_status: string;
        created_at: string;
        photo_count: number;
        total_fields: number;
        filled_fields: number;
        unlock_count: number;
        response_count: number;
        save_count: number;
      }>(
        `SELECT
           l.id::text,
           l.verification_status::text,
           l.created_at::text,
           COALESCE((SELECT count(*)::int FROM listing_photos lp WHERE lp.listing_id = l.id), 0) AS photo_count,
           -- Completeness: count of relevant non-null fields
           (CASE WHEN l.title_en IS NOT NULL AND l.title_en != '' THEN 1 ELSE 0 END
            + CASE WHEN l.description_en IS NOT NULL AND l.description_en != '' THEN 1 ELSE 0 END
            + CASE WHEN l.monthly_rent IS NOT NULL THEN 1 ELSE 0 END
            + CASE WHEN l.deposit IS NOT NULL THEN 1 ELSE 0 END
            + CASE WHEN l.bhk IS NOT NULL THEN 1 ELSE 0 END
            + CASE WHEN l.furnishing IS NOT NULL THEN 1 ELSE 0 END
            + CASE WHEN l.area_sqft IS NOT NULL THEN 1 ELSE 0 END) AS filled_fields,
           7 AS total_fields,
           -- Engagement signals
           COALESCE((SELECT count(*)::int FROM contact_unlocks cu WHERE cu.listing_id = l.id), 0) AS unlock_count,
           COALESCE((SELECT count(*)::int FROM contact_unlocks cu WHERE cu.listing_id = l.id AND cu.owner_response_status = 'responded'), 0) AS response_count,
           COALESCE((SELECT count(*)::int FROM shortlist_items si WHERE si.listing_id = l.id), 0) AS save_count
         FROM listings l
         WHERE l.status = 'active'
         ORDER BY l.created_at DESC
         LIMIT $1`,
        [batchSize]
      );

      const now = Date.now();
      let count = 0;

      for (const row of result.rows) {
        const createdAt = new Date(row.created_at).getTime();
        const freshness = Math.max(0, 1 - (now - createdAt) / (1000 * 60 * 60 * 24 * 30));

        const verification =
          row.verification_status === "verified"
            ? 1
            : row.verification_status === "pending"
              ? 0.5
              : 0;

        const photoScore = Math.min((row.photo_count ?? 0) / 6, 1);

        const responseRate =
          row.unlock_count > 0 ? Math.min(row.response_count / row.unlock_count, 1) : 0.5; // Default when no unlocks yet

        const completeness = row.total_fields > 0 ? row.filled_fields / row.total_fields : 0.5;

        // Engagement: normalized combination of saves and unlocks
        const engagementRaw = Math.min((row.save_count + row.unlock_count) / 20, 1);
        const engagement = engagementRaw || 0.5; // Floor at 0.5 for new listings

        const composite =
          DEFAULT_WEIGHTS.verification * verification +
          DEFAULT_WEIGHTS.freshness * freshness +
          DEFAULT_WEIGHTS.photo_quality * photoScore +
          DEFAULT_WEIGHTS.response_rate * responseRate +
          DEFAULT_WEIGHTS.completeness * completeness +
          DEFAULT_WEIGHTS.engagement * engagement;

        await this.database.query(
          `INSERT INTO listing_scores
             (listing_id, verification_score, freshness_score, photo_score,
              response_rate_score, completeness_score, engagement_score, composite_score, computed_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now())
           ON CONFLICT (listing_id) DO UPDATE SET
             verification_score = EXCLUDED.verification_score,
             freshness_score = EXCLUDED.freshness_score,
             photo_score = EXCLUDED.photo_score,
             response_rate_score = EXCLUDED.response_rate_score,
             completeness_score = EXCLUDED.completeness_score,
             engagement_score = EXCLUDED.engagement_score,
             composite_score = EXCLUDED.composite_score,
             computed_at = now()`,
          [
            row.id,
            Number(verification.toFixed(4)),
            Number(freshness.toFixed(4)),
            Number(photoScore.toFixed(4)),
            Number(responseRate.toFixed(4)),
            Number(completeness.toFixed(4)),
            Number(engagement.toFixed(4)),
            Number(composite.toFixed(4))
          ]
        );

        count++;
      }

      this.logger.log(`Recomputed scores for ${count} listings`);
      return count;
    } catch (error) {
      this.logger.error("Failed to recompute listing scores", error);
      return 0;
    }
  }
}
