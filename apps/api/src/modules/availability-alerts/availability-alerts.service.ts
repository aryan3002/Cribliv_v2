import { BadRequestException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { AppStateService } from "../../common/app-state.service";
import { DatabaseService } from "../../common/database.service";
import { readFeatureFlags } from "../../config/feature-flags";
import type {
  AvailabilityAlertResult,
  AvailabilityAlertStatus,
  WaitlistLead
} from "@cribliv/shared-types";

export interface UserAvailabilityAlertSummary {
  listing_id: string;
  status: AvailabilityAlertStatus;
}

/**
 * Notify-when-available waitlist: seekers (including guests, via OTP) register
 * interest in a listing that is currently marked unavailable, and get pulled off
 * the list once the owner flips it back.
 *
 * Dual-mode per DatabaseService.isEnabled(): Postgres `listing_availability_alerts`
 * (migration 0067) when a DB is configured, else the AppStateService in-memory
 * store (`addAvailabilityAlert` / `listAvailabilityAlerts`, added for the same
 * dual-mode parity as every other module in this codebase).
 */
@Injectable()
export class AvailabilityAlertsService {
  constructor(
    @Inject(AppStateService) private readonly appState: AppStateService,
    @Inject(DatabaseService) private readonly database: DatabaseService
  ) {}

  /**
   * Resolves the authenticated caller's phone number by user id.
   *
   * `AuthGuard` only ever populates `request.user` with `{ id, role }` (see
   * common/auth.guard.ts + common/types.ts UserContext) — there is no `phone` on
   * the auth payload, so it can never be trusted from the request. The waitlist
   * phone always comes from the users table (DB) / users map (in-memory), the same
   * way ContactsService and NotificationService resolve a user's phone by id.
   */
  private async resolvePhone(userId: string): Promise<string | null> {
    if (this.database.isEnabled()) {
      const result = await this.database.query<{ phone_e164: string }>(
        `SELECT phone_e164 FROM users WHERE id = $1::uuid LIMIT 1`,
        [userId]
      );
      return result.rows[0]?.phone_e164 ?? null;
    }

    return this.appState.users.get(userId)?.phone ?? null;
  }

  async join(
    userId: string,
    listingId: string,
    locale: string | null
  ): Promise<AvailabilityAlertResult> {
    if (!readFeatureFlags().ff_unavailable_listings) {
      throw new NotFoundException({
        code: "feature_disabled",
        message: "Notify-when-available is not enabled"
      });
    }

    const phone = await this.resolvePhone(userId);
    if (!phone) {
      throw new BadRequestException({
        code: "phone_not_found",
        message: "Could not resolve a phone number for this account"
      });
    }

    if (this.database.isEnabled()) {
      const inserted = await this.database.query<{
        id: string;
        status: AvailabilityAlertStatus;
      }>(
        `INSERT INTO listing_availability_alerts (listing_id, user_id, phone, locale)
         VALUES ($1::uuid, $2::uuid, $3, $4)
         ON CONFLICT (listing_id, phone) DO NOTHING
         RETURNING id, status`,
        [listingId, userId, phone, locale]
      );

      if (inserted.rowCount) {
        return { status: inserted.rows[0].status, already_on_list: false };
      }

      const existing = await this.database.query<{ status: AvailabilityAlertStatus }>(
        `SELECT status FROM listing_availability_alerts
          WHERE listing_id = $1::uuid AND phone = $2
          LIMIT 1`,
        [listingId, phone]
      );
      return { status: existing.rows[0]?.status ?? "waiting", already_on_list: true };
    }

    const { alert, already_on_list } = this.appState.addAvailabilityAlert({
      listing_id: listingId,
      phone,
      user_id: userId,
      locale
    });
    return { status: alert.status, already_on_list };
  }

  async leave(userId: string, listingId: string): Promise<{ ok: true }> {
    const phone = await this.resolvePhone(userId);
    if (!phone) return { ok: true };

    if (this.database.isEnabled()) {
      await this.database.query(
        `DELETE FROM listing_availability_alerts WHERE listing_id = $1::uuid AND phone = $2`,
        [listingId, phone]
      );
      return { ok: true };
    }

    this.appState.availabilityAlerts = this.appState.availabilityAlerts.filter(
      (a) => !(a.listing_id === listingId && a.phone === phone)
    );
    return { ok: true };
  }

  async listForUser(userId: string): Promise<UserAvailabilityAlertSummary[]> {
    const phone = await this.resolvePhone(userId);
    if (!phone) return [];

    if (this.database.isEnabled()) {
      const result = await this.database.query<{
        listing_id: string;
        status: AvailabilityAlertStatus;
      }>(
        `SELECT listing_id::text, status
           FROM listing_availability_alerts
          WHERE phone = $1
          ORDER BY created_at DESC`,
        [phone]
      );
      return result.rows.map((r) => ({ listing_id: r.listing_id, status: r.status }));
    }

    return this.appState.availabilityAlerts
      .filter((a) => a.phone === phone)
      .sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
      .map((a) => ({ listing_id: a.listing_id, status: a.status }));
  }

  /** Used by the admin lead-center waitlist view (Task 14). */
  async listForListing(listingId: string): Promise<WaitlistLead[]> {
    if (this.database.isEnabled()) {
      const result = await this.database.query<WaitlistLead>(
        `SELECT id::text, phone, user_id::text AS user_id, status, created_at::text
           FROM listing_availability_alerts
          WHERE listing_id = $1::uuid
          ORDER BY created_at DESC`,
        [listingId]
      );
      return result.rows;
    }

    return this.appState
      .listAvailabilityAlerts(listingId)
      .slice()
      .sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
      .map((a) => ({
        id: a.id,
        phone: a.phone,
        user_id: a.user_id,
        status: a.status,
        created_at: a.created_at
      }));
  }
}
