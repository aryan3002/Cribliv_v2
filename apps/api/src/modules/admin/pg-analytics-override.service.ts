import { Inject, Injectable } from "@nestjs/common";
import { DatabaseService } from "../../common/database.service";
import type { PgActiveOverrides, PgOverrideScope } from "@cribliv/shared-types";

type Target = { listingId: string | null };

/**
 * Admin-owned. Records non-destructive "cut" flags that hide a PG operator's
 * analytics on their own dashboard. Granularity is per-LISTING (listing_id) or
 * operator-GLOBAL (listing_id IS NULL). Reads stay cheap (single indexed query);
 * every mutation writes an admin_actions audit row. See spec §3.1.
 */
@Injectable()
export class PgAnalyticsOverrideService {
  constructor(@Inject(DatabaseService) private readonly db: DatabaseService) {}

  /** Read-path used by the operator dashboard. One indexed query. */
  async getActiveForOperator(operatorId: string): Promise<PgActiveOverrides> {
    if (!this.db.isEnabled()) return { global: false, listing_ids: [] };
    const r = await this.db.query<{ listing_id: string | null }>(
      `SELECT listing_id::text AS listing_id
         FROM pg_analytics_overrides
        WHERE operator_id = $1::uuid AND active = true`,
      [operatorId]
    );
    const global = r.rows.some((x) => x.listing_id === null);
    const listing_ids = r.rows
      .filter((x) => x.listing_id !== null)
      .map((x) => x.listing_id as string);
    return { global, listing_ids };
  }

  /** Admin read for the detail-page toggles. */
  async getStateForOperator(
    operatorId: string,
    listingId: string
  ): Promise<{ global: boolean; listing: boolean }> {
    const a = await this.getActiveForOperator(operatorId);
    return { global: a.global, listing: a.listing_ids.includes(listingId) };
  }

  async set(
    adminId: string,
    operatorId: string,
    target: Target,
    reason: string | null
  ): Promise<void> {
    if (!this.db.isEnabled()) return;
    await this.upsert(operatorId, target, true, adminId, reason);
    await this.audit(adminId, operatorId, target, "set_analytics_override", reason, {
      active: true
    });
  }

  async clear(
    adminId: string,
    operatorId: string,
    target: Target,
    reason: string | null
  ): Promise<void> {
    if (!this.db.isEnabled()) return;
    await this.upsert(operatorId, target, false, adminId, reason);
    await this.audit(adminId, operatorId, target, "clear_analytics_override", reason, {
      active: false
    });
  }

  private async upsert(
    operatorId: string,
    target: Target,
    active: boolean,
    adminId: string,
    reason: string | null
  ) {
    // Partial unique indexes (global vs listing) require matching conflict
    // targets; emulate upsert with update-then-insert to stay index-agnostic.
    const updated = await this.db.query(
      `UPDATE pg_analytics_overrides
          SET active = $3, reason = $4, updated_by = $5::uuid, updated_at = now()
        WHERE operator_id = $1::uuid
          AND listing_id IS NOT DISTINCT FROM $2::uuid`,
      [operatorId, target.listingId, active, reason, adminId]
    );
    if (!updated.rowCount) {
      await this.db.query(
        `INSERT INTO pg_analytics_overrides (operator_id, listing_id, active, reason, created_by, updated_by)
         VALUES ($1::uuid, $2::uuid, $3, $4, $5::uuid, $5::uuid)`,
        [operatorId, target.listingId, active, reason, adminId]
      );
    }
  }

  private scope(target: Target): PgOverrideScope {
    return target.listingId === null ? "global" : "listing";
  }

  private async audit(
    adminId: string,
    operatorId: string,
    target: Target,
    action: "set_analytics_override" | "clear_analytics_override",
    reason: string | null,
    after: Record<string, unknown>
  ) {
    // Reuse existing admin_target_type enum values (no new migration):
    // 'listing' for a per-listing cut, 'user' for an operator-global cut.
    const isGlobal = target.listingId === null;
    const targetType = isGlobal ? "user" : "listing";
    const targetId = target.listingId ?? operatorId;
    await this.db.query(
      `INSERT INTO admin_actions (admin_user_id, target_type, target_id, action, reason, before_state, after_state)
       VALUES ($1::uuid, $2::admin_target_type, $3::uuid, $4, $5, $6::jsonb, $7::jsonb)`,
      [
        adminId,
        targetType,
        targetId,
        action,
        reason,
        JSON.stringify({ scope: this.scope(target), operator_id: operatorId }),
        JSON.stringify(after)
      ]
    );
  }
}
