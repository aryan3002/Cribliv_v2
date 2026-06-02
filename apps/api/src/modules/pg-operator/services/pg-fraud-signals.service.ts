import { Injectable, Logger } from "@nestjs/common";
import { DatabaseService } from "../../../common/database.service";
import { readFeatureFlags } from "../../../config/feature-flags";

export interface FraudSignalResult {
  flagged: boolean;
  severity: "low" | "medium" | "high";
  details: Record<string, unknown>;
}

// Heuristic scam markers — keyword-based, no LLM cost.
const SCAM_MARKERS = [
  "pay now",
  "advance required",
  "no visit",
  "no viewing",
  "100% guaranteed",
  "urgent deal",
  "limited time",
  "free gift",
  "pay via upi",
  "send money"
];

@Injectable()
export class PgFraudSignalsService {
  private readonly logger = new Logger(PgFraudSignalsService.name);

  constructor(private readonly db: DatabaseService) {}

  private async insertFlag(
    listingId: string,
    flagType: string,
    severity: "low" | "medium" | "high",
    details: Record<string, unknown>
  ): Promise<void> {
    await this.db.query(
      `INSERT INTO fraud_flags (listing_id, flag_type, severity, details)
       VALUES ($1::uuid, $2, $3, $4::jsonb)
       ON CONFLICT DO NOTHING`,
      [listingId, flagType, severity, JSON.stringify(details)]
    );
  }

  async priceAnomaly(
    listingId: string,
    sharing: string,
    monthlyRentPaise: number,
    citySlug: string
  ): Promise<FraudSignalResult> {
    if (!this.db.isEnabled()) return { flagged: false, severity: "low", details: {} };

    try {
      const result = await this.db.query<{ avg: number | string; stddev: number | string }>(
        `SELECT avg(rt.monthly_rent_paise)::float AS avg,
                stddev_pop(rt.monthly_rent_paise)::float AS stddev
         FROM pg_room_types rt
         JOIN listings l ON l.id = rt.listing_id
         JOIN listing_locations ll ON ll.listing_id = l.id
         JOIN cities c ON c.id = ll.city_id
         WHERE l.status = 'active' AND c.slug = $1 AND rt.sharing = $2`,
        [citySlug, sharing]
      );

      const row = result.rows[0];
      if (!row || !row.avg || !row.stddev || Number(row.stddev) === 0) {
        return { flagged: false, severity: "low", details: { reason: "insufficient_data" } };
      }

      const avg = Number(row.avg);
      const stddev = Number(row.stddev);
      const z = Math.abs((monthlyRentPaise - avg) / stddev);

      if (z <= 3 || !readFeatureFlags().ff_pg_fraud_ai) {
        return { flagged: false, severity: "low", details: { z_score: z } };
      }

      const details = { z_score: z, avg_paise: avg, rent_paise: monthlyRentPaise, sharing };
      await this.insertFlag(listingId, "price_anomaly", z > 5 ? "high" : "medium", details);
      return { flagged: true, severity: z > 5 ? "high" : "medium", details };
    } catch (e) {
      this.logger.warn(`priceAnomaly failed ${listingId}: ${String(e)}`);
      return { flagged: false, severity: "low", details: {} };
    }
  }

  async contactReuse(listingId: string, operatorUserId: string): Promise<FraudSignalResult> {
    if (!this.db.isEnabled()) return { flagged: false, severity: "low", details: {} };

    try {
      const result = await this.db.query<{ count: number }>(
        `SELECT count(*)::int AS count
         FROM listings l
         WHERE l.owner_user_id = $1::uuid AND l.status = 'active' AND l.listing_type = 'pg'`,
        [operatorUserId]
      );

      const count = result.rows[0]?.count ?? 0;
      if (count < 3 || !readFeatureFlags().ff_pg_fraud_ai) {
        return { flagged: false, severity: "low", details: { listing_count: count } };
      }

      const details = { listing_count: count, operator_user_id: operatorUserId };
      await this.insertFlag(listingId, "contact_reuse", "medium", details);
      return { flagged: true, severity: "medium", details };
    } catch (e) {
      this.logger.warn(`contactReuse failed ${listingId}: ${String(e)}`);
      return { flagged: false, severity: "low", details: {} };
    }
  }

  async duplicatePhoto(listingId: string, photoHashes: string[]): Promise<FraudSignalResult> {
    if (!this.db.isEnabled() || !photoHashes.length) {
      return { flagged: false, severity: "low", details: {} };
    }

    try {
      const result = await this.db.query<{ listing_id: string }>(
        `SELECT DISTINCT lp.listing_id::text
         FROM listing_photos lp
         WHERE lp.blob_path = ANY($1::text[]) AND lp.listing_id != $2::uuid`,
        [photoHashes, listingId]
      );

      if (!result.rows.length || !readFeatureFlags().ff_pg_fraud_ai) {
        return { flagged: false, severity: "low", details: {} };
      }

      const details = { duplicate_in: result.rows.map((r) => r.listing_id) };
      await this.insertFlag(listingId, "duplicate_photo", "high", details);
      return { flagged: true, severity: "high", details };
    } catch (e) {
      this.logger.warn(`duplicatePhoto failed ${listingId}: ${String(e)}`);
      return { flagged: false, severity: "low", details: {} };
    }
  }

  async scamText(listingId: string, description: string): Promise<FraudSignalResult> {
    const text = description.toLowerCase();
    const hits = SCAM_MARKERS.filter((m) => text.includes(m));
    // Score: proportion of markers triggered, threshold 0.25 (≥3 of 10 markers)
    const score = hits.length / SCAM_MARKERS.length;

    if (score < 0.25 || !readFeatureFlags().ff_pg_fraud_ai) {
      return { flagged: false, severity: "low", details: { score, hits } };
    }

    const details = { score, hits, description_length: description.length };
    if (this.db.isEnabled()) {
      await this.insertFlag(
        listingId,
        "suspicious_text",
        score > 0.5 ? "high" : "medium",
        details
      ).catch(() => {});
    }
    return { flagged: true, severity: score > 0.5 ? "high" : "medium", details };
  }
}
