import { Inject, Injectable, Logger, BadRequestException } from "@nestjs/common";
import { DatabaseService } from "../../common/database.service";
import { readFeatureFlags } from "../../config/feature-flags";

const REPORT_THRESHOLD = 5;
const STALE_DAYS = 30;
const INACTIVITY_DAYS = 60;

@Injectable()
export class FraudService {
  private readonly logger = new Logger(FraudService.name);

  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

  /**
   * Report a listing (tenant-initiated). Auto-pauses at 5+ reports.
   */
  async reportListing(
    listingId: string,
    reporterUserId: string,
    reason: string
  ): Promise<{ flagged: boolean; auto_paused: boolean }> {
    const flags = readFeatureFlags();
    if (!flags.ff_fraud_detection_enabled || !this.database.isEnabled()) {
      return { flagged: false, auto_paused: false };
    }

    // Check duplicate report
    const existing = await this.database.query<{ id: string }>(
      `SELECT id::text FROM fraud_flags
       WHERE listing_id = $1::uuid AND reporter_user_id = $2::uuid AND flag_type = 'tenant_report'
       LIMIT 1`,
      [listingId, reporterUserId]
    );
    if (existing.rows.length > 0) {
      throw new BadRequestException({
        code: "already_reported",
        message: "You have already reported this listing"
      });
    }

    await this.database.query(
      `INSERT INTO fraud_flags (listing_id, flag_type, severity, reporter_user_id, details)
       VALUES ($1::uuid, 'tenant_report', 'medium', $2::uuid, $3::jsonb)`,
      [listingId, reporterUserId, JSON.stringify({ reason })]
    );

    const updated = await this.database.query<{ report_count: number }>(
      `UPDATE listings SET report_count = report_count + 1, updated_at = now()
       WHERE id = $1::uuid
       RETURNING report_count`,
      [listingId]
    );

    const reportCount = updated.rows[0]?.report_count ?? 0;
    let autoPaused = false;

    if (reportCount >= REPORT_THRESHOLD) {
      await this.database.query(
        `UPDATE listings SET status = 'paused', updated_at = now() WHERE id = $1::uuid AND status = 'active'`,
        [listingId]
      );
      autoPaused = true;
      this.logger.warn(`Listing ${listingId} auto-paused: ${reportCount} reports`);
    }

    return { flagged: true, auto_paused: autoPaused };
  }

  /**
   * Worker: detect and auto-pause stale listings (active > STALE_DAYS with no owner activity).
   */
  async sweepStaleListings(): Promise<number> {
    if (!this.database.isEnabled()) return 0;

    const result = await this.database.query<{ id: string }>(
      `UPDATE listings
       SET status = 'paused', updated_at = now()
       WHERE status = 'active'
         AND last_owner_activity_at < now() - make_interval(days => $1)
       RETURNING id::text`,
      [STALE_DAYS]
    );

    const count = result.rowCount ?? 0;
    if (count > 0) {
      // Create fraud flags for each paused listing
      for (const row of result.rows) {
        await this.database
          .query(
            `INSERT INTO fraud_flags (listing_id, flag_type, severity, details)
           VALUES ($1::uuid, 'stale', 'low', '{"reason": "no_activity_30d"}'::jsonb)
           ON CONFLICT DO NOTHING`,
            [row.id]
          )
          .catch(() => {});
      }
      this.logger.log(`Stale sweep: paused ${count} listings`);
    }

    return count;
  }

  /**
   * Worker: detect potential brokers (same owner, multiple listings, same address proximity).
   */
  async sweepBrokerDetection(): Promise<number> {
    if (!this.database.isEnabled()) return 0;

    // Flag owners with 3+ listings that have similar addresses
    const result = await this.database.query<{
      owner_user_id: string;
      listing_count: number;
      listing_ids: string[];
    }>(
      `SELECT
         l.owner_user_id::text,
         count(*)::int AS listing_count,
         array_agg(l.id::text) AS listing_ids
       FROM listings l
       WHERE l.status IN ('active', 'pending_review')
       GROUP BY l.owner_user_id
       HAVING count(*) >= 3`
    );

    let flagged = 0;
    for (const row of result.rows) {
      const existingFlag = await this.database.query<{ id: string }>(
        `SELECT id::text FROM fraud_flags
         WHERE listing_id = ANY($1::uuid[]) AND flag_type = 'broker_detected' AND resolved_at IS NULL
         LIMIT 1`,
        [row.listing_ids]
      );

      if (existingFlag.rows.length === 0) {
        await this.database.query(
          `INSERT INTO fraud_flags (listing_id, flag_type, severity, details)
           VALUES ($1::uuid, 'broker_detected', 'high', $2::jsonb)`,
          [
            row.listing_ids[0],
            JSON.stringify({
              reason: "multiple_listings",
              owner_user_id: row.owner_user_id,
              listing_count: row.listing_count,
              listing_ids: row.listing_ids
            })
          ]
        );
        flagged++;
      }
    }

    if (flagged > 0) {
      this.logger.log(`Broker sweep: flagged ${flagged} potential brokers`);
    }
    return flagged;
  }

  /**
   * Worker: auto-pause listings with no owner activity for INACTIVITY_DAYS.
   */
  async sweepInactiveListings(): Promise<number> {
    if (!this.database.isEnabled()) return 0;

    const result = await this.database.query<{ id: string }>(
      `UPDATE listings
       SET status = 'paused', updated_at = now()
       WHERE status = 'active'
         AND last_owner_activity_at < now() - make_interval(days => $1)
       RETURNING id::text`,
      [INACTIVITY_DAYS]
    );

    return result.rowCount ?? 0;
  }

  /**
   * Admin: get unresolved fraud flags.
   */
  async getUnresolvedFlags(
    flagType?: string,
    page = 1,
    pageSize = 20
  ): Promise<{ items: any[]; total: number }> {
    if (!this.database.isEnabled()) return { items: [], total: 0 };

    const params: unknown[] = [];
    let typeClause = "";
    if (flagType) {
      params.push(flagType);
      typeClause = `AND ff.flag_type = $${params.length}`;
    }

    const countResult = await this.database.query<{ total: number }>(
      `SELECT count(*)::int AS total FROM fraud_flags ff WHERE ff.resolved_at IS NULL ${typeClause}`,
      params
    );

    const offset = (page - 1) * pageSize;
    const result = await this.database.query<{
      id: string;
      listing_id: string;
      listing_title: string;
      flag_type: string;
      severity: string;
      reporter_user_id: string | null;
      details: Record<string, unknown>;
      created_at: string;
    }>(
      `SELECT
         ff.id::text,
         ff.listing_id::text,
         COALESCE(NULLIF(l.title_en, ''), 'Listing') AS listing_title,
         ff.flag_type,
         ff.severity,
         ff.reporter_user_id::text,
         ff.details,
         ff.created_at::text
       FROM fraud_flags ff
       JOIN listings l ON l.id = ff.listing_id
       WHERE ff.resolved_at IS NULL ${typeClause}
       ORDER BY ff.created_at DESC
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, pageSize, offset]
    );

    return { items: result.rows, total: Number(countResult.rows[0]?.total ?? 0) };
  }

  /**
   * Admin: resolve a fraud flag.
   */
  async resolveFlag(flagId: string, adminUserId: string): Promise<{ resolved: boolean }> {
    if (!this.database.isEnabled()) return { resolved: false };

    const result = await this.database.query(
      `UPDATE fraud_flags SET resolved_at = now(), resolved_by = $2::uuid WHERE id = $1::uuid AND resolved_at IS NULL`,
      [flagId, adminUserId]
    );

    return { resolved: (result.rowCount ?? 0) > 0 };
  }
}
