import {
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  NotFoundException
} from "@nestjs/common";
import { randomUUID } from "crypto";
import { AppStateService } from "../../common/app-state.service";
import { DatabaseService } from "../../common/database.service";
import { logTelemetry } from "../../common/telemetry";
import { NotificationService } from "../notifications/notification.service";
import { LeadsService } from "../leads/leads.service";
import { readFeatureFlags } from "../../config/feature-flags";
import { debitWalletCredits, WalletBalanceError } from "../wallet/wallet-balance";

const DISPUTE_WINDOW_MS = 72 * 60 * 60 * 1000;

@Injectable()
export class ContactsService {
  constructor(
    @Inject(AppStateService) private readonly appState: AppStateService,
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(NotificationService) private readonly notifications: NotificationService,
    @Inject(LeadsService) private readonly leadsService: LeadsService
  ) {}

  // Flag ON: the credit buys a guaranteed callback — the owner phone is never
  // returned to the tenant. Flag OFF: legacy reveal behavior, unchanged.
  private buildUnlockResponse(input: {
    unlockId: string;
    ownerPhone: string | null;
    whatsappAvailable: boolean;
    creditsRemaining: number;
    responseDeadlineAt: string;
  }) {
    if (readFeatureFlags().ff_callback_leads) {
      return {
        unlock_id: input.unlockId,
        callback: {
          status: "awaiting_call" as const,
          call_deadline_at: input.responseDeadlineAt
        },
        credits_remaining: input.creditsRemaining,
        response_deadline_at: input.responseDeadlineAt
      };
    }
    return {
      unlock_id: input.unlockId,
      owner_contact: {
        phone_e164: input.ownerPhone ?? "+919888888888",
        whatsapp_available: input.whatsappAvailable
      },
      credits_remaining: input.creditsRemaining,
      response_deadline_at: input.responseDeadlineAt
    };
  }

  async unlockContact(
    userId: string,
    listingId: string,
    idempotencyKey: string,
    source: string | null = null
  ) {
    let result: Awaited<ReturnType<typeof this.unlockContactDb>>;
    if (this.database.isEnabled()) {
      result = await this.unlockContactDb(userId, listingId, idempotencyKey, source);
    } else {
      result = this.unlockContactInMemory(userId, listingId, idempotencyKey);
    }

    // Fire-and-forget: notify owner that a tenant unlocked their contact
    this.notifyOwnerContactUnlocked(listingId, userId).catch((err) => {
      logTelemetry("notification.error", {
        type: "owner.contact_unlocked",
        listing_id: listingId,
        error: err instanceof Error ? err.message : String(err)
      });
    });

    // Fire-and-forget: create lead for owner's inbox
    this.createLeadFromUnlock(
      listingId,
      userId,
      result.unlock_id,
      (result as { response_deadline_at?: string }).response_deadline_at ?? null
    ).catch((err) => {
      logTelemetry("lead.creation_error", {
        listing_id: listingId,
        tenant_user_id: userId,
        error: err instanceof Error ? err.message : String(err)
      });
    });

    return result;
  }

  // Cached presence of the migration-0050 `contact_unlocks.source` column. Only
  // caches `true`; while false it re-checks each unlock so it self-heals the
  // moment the migration is applied (no restart needed).
  private contactUnlockSourcePresent = false;
  private async hasContactUnlockSource(): Promise<boolean> {
    if (this.contactUnlockSourcePresent) return true;
    try {
      const { rows } = await this.database.query(
        `SELECT 1 FROM information_schema.columns
         WHERE table_name = 'contact_unlocks' AND column_name = 'source' LIMIT 1`
      );
      this.contactUnlockSourcePresent = rows.length > 0;
    } catch {
      this.contactUnlockSourcePresent = false;
    }
    return this.contactUnlockSourcePresent;
  }

  /**
   * Notify the listing owner that a tenant unlocked their contact info.
   */
  private async createLeadFromUnlock(
    listingId: string,
    tenantUserId: string,
    unlockId: string,
    callDeadlineAt: string | null
  ) {
    if (!this.database.isEnabled()) return;

    // Get owner_user_id and tenant phone for the lead
    const listingInfo = await this.database.query<{ owner_user_id: string }>(
      `SELECT owner_user_id::text FROM listings WHERE id = $1::uuid LIMIT 1`,
      [listingId]
    );
    const ownerUserId = listingInfo.rows[0]?.owner_user_id;
    if (!ownerUserId) return;

    const tenantInfo = await this.database.query<{ phone_e164: string }>(
      `SELECT phone_e164 FROM users WHERE id = $1::uuid LIMIT 1`,
      [tenantUserId]
    );
    const phone = tenantInfo.rows[0]?.phone_e164 ?? "";
    const masked =
      phone.length >= 4 ? phone.slice(0, -4).replace(/./g, "X") + phone.slice(-4) : null;

    await this.leadsService.createLead({
      listing_id: listingId,
      owner_user_id: ownerUserId,
      tenant_user_id: tenantUserId,
      contact_unlock_id: unlockId,
      tenant_phone_masked: masked ?? undefined,
      call_deadline_at: callDeadlineAt ?? undefined
    });
  }

  private async notifyOwnerContactUnlocked(listingId: string, tenantUserId: string) {
    if (this.database.isEnabled()) {
      const ownerInfo = await this.database.query<{
        owner_user_id: string;
        title: string;
      }>(
        `
        SELECT
          l.owner_user_id::text,
          COALESCE(NULLIF(l.title_en, ''), NULLIF(l.title_hi, ''), 'आपकी प्रॉपर्टी') AS title
        FROM listings l
        WHERE l.id = $1::uuid
        LIMIT 1
        `,
        [listingId]
      );

      const owner = ownerInfo.rows[0];
      if (!owner) return;

      // Also get tenant name for a richer message
      const tenantInfo = await this.database.query<{ name: string }>(
        `
        SELECT COALESCE(NULLIF(full_name, ''), 'एक किरायेदार') AS name
        FROM users
        WHERE id = $1::uuid
        LIMIT 1
        `,
        [tenantUserId]
      );

      await this.notifications.send({
        type: "owner.contact_unlocked",
        recipientUserId: owner.owner_user_id,
        payload: {
          listing_title: owner.title,
          listing_id: listingId,
          tenant_name: tenantInfo.rows[0]?.name ?? "एक किरायेदार",
          response_deadline: readFeatureFlags().ff_callback_leads ? "24 घंटे" : "12 घंटे"
        },
        mode: "immediate"
      });
    }
  }

  async markOwnerResponded(
    ownerUserId: string,
    unlockId: string,
    channel: "call" | "whatsapp" | "sms"
  ) {
    if (this.database.isEnabled()) {
      return this.markOwnerRespondedDb(ownerUserId, unlockId, channel);
    }

    return this.markOwnerRespondedInMemory(ownerUserId, unlockId, channel);
  }

  private async unlockContactDb(
    userId: string,
    listingId: string,
    idempotencyKey: string,
    source: string | null = null
  ) {
    const deadlineInterval = readFeatureFlags().ff_callback_leads ? "24 hours" : "12 hours";
    const client = await this.database.getClient();
    try {
      await client.query("BEGIN");

      const existingUnlock = await client.query<{
        id: string;
        listing_id: string;
        response_deadline_at: string;
        owner_phone: string | null;
        whatsapp_available: boolean;
        balance_credits: number;
      }>(
        `
        SELECT
          cu.id::text,
          cu.listing_id::text,
          cu.response_deadline_at::text,
          l.contact_phone_encrypted AS owner_phone,
          l.whatsapp_available,
          COALESCE(w.balance_credits, 0) AS balance_credits
        FROM contact_unlocks cu
        JOIN listings l ON l.id = cu.listing_id
        LEFT JOIN wallets w ON w.user_id = cu.tenant_user_id
        WHERE cu.tenant_user_id = $1::uuid
          AND cu.idempotency_key = $2
        LIMIT 1
        `,
        [userId, idempotencyKey]
      );

      if (existingUnlock.rowCount && existingUnlock.rows[0]) {
        if (existingUnlock.rows[0].listing_id !== listingId) {
          throw new ConflictException({
            code: "duplicate_unlock",
            message: "Idempotency-Key already used for another listing"
          });
        }
        await client.query("COMMIT");
        const row = existingUnlock.rows[0];
        logTelemetry("contact.unlock_idempotent_hit", {
          mode: "db",
          tenant_user_id: userId,
          unlock_id: row.id,
          listing_id: row.listing_id
        });
        return this.buildUnlockResponse({
          unlockId: row.id,
          ownerPhone: row.owner_phone,
          whatsappAvailable: row.whatsapp_available,
          creditsRemaining: Number(row.balance_credits),
          responseDeadlineAt: row.response_deadline_at
        });
      }

      const listingResult = await client.query<{
        id: string;
        owner_phone: string | null;
        whatsapp_available: boolean;
      }>(
        `
        SELECT id::text, contact_phone_encrypted AS owner_phone, whatsapp_available
        FROM listings
        WHERE id = $1::uuid
          AND status = 'active'
        LIMIT 1
        `,
        [listingId]
      );

      if (!listingResult.rowCount || !listingResult.rows[0]) {
        throw new HttpException(
          { code: "listing_inactive", message: "Listing inactive or missing" },
          HttpStatus.GONE
        );
      }

      await client.query(
        `
        INSERT INTO wallets(user_id, balance_credits, free_credits_granted)
        VALUES ($1::uuid, 0, 0)
        ON CONFLICT (user_id) DO NOTHING
        `,
        [userId]
      );

      let debit;
      try {
        debit = await debitWalletCredits(client, {
          userId,
          credits: 1,
          txnType: "debit_contact_unlock",
          referenceType: "listing",
          referenceId: listingId,
          idempotencyKey
        });
      } catch (error) {
        if (error instanceof WalletBalanceError) {
          if (error.code === "idempotency_conflict") {
            throw new ConflictException({
              code: "duplicate_unlock",
              message: "Idempotency-Key already used for another unlock"
            });
          }
          if (error.code === "insufficient_credits" || error.code === "wallet_not_found") {
            throw new HttpException(
              { code: "insufficient_credits", message: "Insufficient credits" },
              HttpStatus.PAYMENT_REQUIRED
            );
          }
        }
        throw error;
      }

      const walletTxnId = debit.transactionId;
      const debitTxnInserted = debit.inserted;

      // The `source` column ships in migration 0050. Until it's applied on a
      // given DB, omit it so this revenue-critical INSERT never fails on a
      // deploy-before-migrate ordering. Once present, it's cached as true.
      const hasSource = await this.hasContactUnlockSource();
      const sourceCol = hasSource ? ",\n          source" : "";
      const sourceVal = hasSource ? ", $5" : "";
      const unlockParams = hasSource
        ? [userId, listingId, walletTxnId, idempotencyKey, source]
        : [userId, listingId, walletTxnId, idempotencyKey];
      const unlockResult = await client.query<{
        id: string;
        response_deadline_at: string;
      }>(
        `
        INSERT INTO contact_unlocks(
          tenant_user_id,
          listing_id,
          wallet_txn_id,
          idempotency_key,
          response_deadline_at${sourceCol}
        )
        VALUES ($1::uuid, $2::uuid, $3::uuid, $4, now() + interval '${deadlineInterval}'${sourceVal})
        ON CONFLICT (tenant_user_id, listing_id, idempotency_key) DO NOTHING
        RETURNING id::text, response_deadline_at::text
        `,
        unlockParams
      );

      let unlockId = unlockResult.rows[0]?.id;
      let responseDeadlineAt = unlockResult.rows[0]?.response_deadline_at;
      const unlockInserted = Boolean(unlockId);

      if (!unlockId) {
        const existing = await client.query<{ id: string; response_deadline_at: string }>(
          `
          SELECT id::text, response_deadline_at::text
          FROM contact_unlocks
          WHERE tenant_user_id = $1::uuid
            AND listing_id = $2::uuid
            AND idempotency_key = $3
          LIMIT 1
          `,
          [userId, listingId, idempotencyKey]
        );
        unlockId = existing.rows[0]?.id;
        responseDeadlineAt = existing.rows[0]?.response_deadline_at;
      }

      if (!unlockId || !responseDeadlineAt) {
        throw new ConflictException({
          code: "duplicate_unlock",
          message: "Duplicate unlock request"
        });
      }

      if (unlockInserted) {
        await client.query(
          `
          INSERT INTO contact_events(contact_unlock_id, actor_role, event_type, metadata)
          VALUES ($1::uuid, 'tenant', 'unlock_created', '{}'::jsonb)
          `,
          [unlockId]
        );
      }

      await client.query("COMMIT");

      const listing = listingResult.rows[0];
      logTelemetry("contact.unlock_debited", {
        mode: "db",
        tenant_user_id: userId,
        unlock_id: unlockId,
        listing_id: listingId
      });
      return this.buildUnlockResponse({
        unlockId: unlockId,
        ownerPhone: listing.owner_phone,
        whatsappAvailable: listing.whatsapp_available,
        creditsRemaining: debit.balanceCredits,
        responseDeadlineAt: responseDeadlineAt
      });
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  private unlockContactInMemory(userId: string, listingId: string, idempotencyKey: string) {
    const cacheKey = `${userId}:unlock:${idempotencyKey}`;
    const existing = this.appState.unlockByIdempotency.get(cacheKey);
    if (existing) {
      logTelemetry("contact.unlock_idempotent_hit", {
        mode: "in_memory",
        tenant_user_id: userId,
        unlock_id: existing.id,
        listing_id: existing.listingId
      });
      return this.buildUnlockResponse({
        unlockId: existing.id,
        ownerPhone: "+919888888888",
        whatsappAvailable: true,
        creditsRemaining: this.appState.getWalletBalance(userId),
        responseDeadlineAt: new Date(existing.responseDeadlineAt).toISOString()
      });
    }

    const listing = this.appState.listings.get(listingId);
    if (!listing || listing.status !== "active") {
      throw new HttpException(
        { code: "listing_inactive", message: "Listing inactive or missing" },
        HttpStatus.GONE
      );
    }

    const balance = this.appState.getWalletBalance(userId);
    if (balance < 1) {
      throw new HttpException(
        { code: "insufficient_credits", message: "Insufficient credits" },
        HttpStatus.PAYMENT_REQUIRED
      );
    }

    const walletTxn = this.appState.addWalletTxn({
      userId,
      type: "debit_contact_unlock",
      creditsDelta: -1,
      referenceId: listingId,
      idempotencyKey
    });

    if (!walletTxn) {
      throw new ConflictException({
        code: "duplicate_unlock",
        message: "Duplicate unlock request"
      });
    }

    const unlock = {
      id: randomUUID(),
      tenantUserId: userId,
      listingId,
      idempotencyKey,
      ownerResponseStatus: "pending" as const,
      unlockStatus: "active" as const,
      responseDeadlineAt:
        Date.now() + (readFeatureFlags().ff_callback_leads ? 24 : 12) * 60 * 60 * 1000
    };

    this.appState.unlocks.set(unlock.id, unlock);
    this.appState.unlockByIdempotency.set(cacheKey, unlock);
    logTelemetry("contact.unlock_debited", {
      mode: "in_memory",
      tenant_user_id: userId,
      unlock_id: unlock.id,
      listing_id: listingId
    });

    return this.buildUnlockResponse({
      unlockId: unlock.id,
      ownerPhone: "+919888888888",
      whatsappAvailable: true,
      creditsRemaining: this.appState.getWalletBalance(userId),
      responseDeadlineAt: new Date(unlock.responseDeadlineAt).toISOString()
    });
  }

  private async markOwnerRespondedDb(
    ownerUserId: string,
    unlockId: string,
    channel: "call" | "whatsapp" | "sms"
  ) {
    const client = await this.database.getClient();
    try {
      await client.query("BEGIN");

      const unlockResult = await client.query<{
        id: string;
        listing_id: string;
        owner_response_status: "pending" | "responded" | "timeout_refunded";
      }>(
        `
        SELECT id::text, listing_id::text, owner_response_status::text
        FROM contact_unlocks
        WHERE id = $1::uuid
        FOR UPDATE
        `,
        [unlockId]
      );

      const unlock = unlockResult.rows[0];
      if (!unlock) {
        throw new NotFoundException({ code: "not_found", message: "Unlock not found" });
      }

      const ownerCheck = await client.query<{ owner_user_id: string }>(
        `
        SELECT owner_user_id::text
        FROM listings
        WHERE id = $1::uuid
        LIMIT 1
        `,
        [unlock.listing_id]
      );

      if (!ownerCheck.rowCount || ownerCheck.rows[0].owner_user_id !== ownerUserId) {
        throw new ForbiddenException({
          code: "forbidden",
          message: "Unlock not linked to this owner"
        });
      }

      if (unlock.owner_response_status !== "pending") {
        throw new ConflictException({
          code: "already_responded",
          message: "Owner response already recorded"
        });
      }

      const updateResult = await client.query<{
        id: string;
        owner_response_status: "pending" | "responded" | "timeout_refunded";
        owner_responded_at: string;
      }>(
        `
        UPDATE contact_unlocks
        SET owner_response_status = 'responded',
            owner_responded_at = now(),
            updated_at = now()
        WHERE id = $1::uuid
        RETURNING id::text, owner_response_status::text, owner_responded_at::text
        `,
        [unlockId]
      );

      await client.query(
        `
        INSERT INTO contact_events(contact_unlock_id, actor_role, event_type, metadata)
        VALUES ($1::uuid, 'owner', 'owner_responded', $2::jsonb)
        `,
        [unlockId, JSON.stringify({ channel })]
      );

      if (readFeatureFlags().ff_callback_leads) {
        // Callback model: a responded unlock IS a claimed call — stamp the
        // linked lead so dispute fraud-accounting and the owner card agree.
        await client.query(
          `UPDATE leads SET called_at = now(), called_by = 'owner', updated_at = now()
           WHERE contact_unlock_id = $1::uuid AND called_at IS NULL`,
          [unlockId]
        );
      }

      await client.query("COMMIT");
      const updated = updateResult.rows[0];
      logTelemetry("contact.owner_responded", {
        mode: "db",
        unlock_id: updated.id,
        owner_user_id: ownerUserId,
        channel
      });
      return {
        unlock_id: updated.id,
        owner_response_status: updated.owner_response_status,
        owner_responded_at: updated.owner_responded_at,
        channel
      };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  private markOwnerRespondedInMemory(
    ownerUserId: string,
    unlockId: string,
    channel: "call" | "whatsapp" | "sms"
  ) {
    const unlock = this.appState.unlocks.get(unlockId);
    if (!unlock) {
      throw new NotFoundException({ code: "not_found", message: "Unlock not found" });
    }

    const listing = this.appState.listings.get(unlock.listingId);
    if (!listing || listing.ownerUserId !== ownerUserId) {
      throw new ForbiddenException({
        code: "forbidden",
        message: "Unlock not linked to this owner"
      });
    }

    unlock.ownerResponseStatus = "responded";
    unlock.ownerRespondedAt = Date.now();
    logTelemetry("contact.owner_responded", {
      mode: "in_memory",
      unlock_id: unlock.id,
      owner_user_id: ownerUserId,
      channel
    });

    return {
      unlock_id: unlock.id,
      owner_response_status: unlock.ownerResponseStatus,
      owner_responded_at: new Date(unlock.ownerRespondedAt).toISOString(),
      channel
    };
  }

  private ensureCallbackMode() {
    if (!readFeatureFlags().ff_callback_leads) {
      throw new ForbiddenException({
        code: "feature_disabled",
        message: "Callbacks are not enabled"
      });
    }
  }

  private deriveCallbackStatus(input: {
    unlockStatus: string;
    ownerRespondedAt: string | number | null | undefined;
  }): "awaiting_call" | "call_claimed" | "refunded" {
    if (input.unlockStatus === "refunded") return "refunded";
    if (input.ownerRespondedAt) return "call_claimed";
    return "awaiting_call";
  }

  async listCallbacks(tenantUserId: string) {
    this.ensureCallbackMode();
    if (!this.database.isEnabled()) {
      const items = [...this.appState.unlocks.values()]
        .filter((u) => u.tenantUserId === tenantUserId)
        .sort((a, b) => b.responseDeadlineAt - a.responseDeadlineAt)
        .map((u) => ({
          callback_id: u.id,
          listing_id: u.listingId,
          listing_title: "Listing",
          status: this.deriveCallbackStatus({
            unlockStatus: u.unlockStatus,
            ownerRespondedAt: u.ownerRespondedAt
          }),
          requested_at: null,
          call_deadline_at: new Date(u.responseDeadlineAt).toISOString(),
          call_claimed_at: u.ownerRespondedAt ? new Date(u.ownerRespondedAt).toISOString() : null,
          tenant_confirmed_at: u.tenantConfirmedAt
            ? new Date(u.tenantConfirmedAt).toISOString()
            : null,
          disputed_at: u.disputedAt ? new Date(u.disputedAt).toISOString() : null
        }));
      return { items };
    }

    const result = await this.database.query<{
      callback_id: string;
      listing_id: string;
      listing_title: string;
      unlock_status: string;
      requested_at: string;
      call_deadline_at: string;
      call_claimed_at: string | null;
      tenant_confirmed_at: string | null;
      disputed_at: string | null;
    }>(
      `SELECT cu.id::text AS callback_id, cu.listing_id::text,
              COALESCE(NULLIF(l.title_en, ''), 'Listing') AS listing_title,
              cu.unlock_status::text AS unlock_status,
              cu.created_at::text AS requested_at,
              cu.response_deadline_at::text AS call_deadline_at,
              cu.owner_responded_at::text AS call_claimed_at,
              ld.tenant_confirmed_at::text, ld.disputed_at::text
       FROM contact_unlocks cu
       JOIN listings l ON l.id = cu.listing_id
       LEFT JOIN leads ld ON ld.contact_unlock_id = cu.id
       WHERE cu.tenant_user_id = $1::uuid
       ORDER BY cu.created_at DESC
       LIMIT 50`,
      [tenantUserId]
    );
    return {
      items: result.rows.map((r) => ({
        callback_id: r.callback_id,
        listing_id: r.listing_id,
        listing_title: r.listing_title,
        status: this.deriveCallbackStatus({
          unlockStatus: r.unlock_status,
          ownerRespondedAt: r.call_claimed_at
        }),
        requested_at: r.requested_at,
        call_deadline_at: r.call_deadline_at,
        call_claimed_at: r.call_claimed_at,
        tenant_confirmed_at: r.tenant_confirmed_at,
        disputed_at: r.disputed_at
      }))
    };
  }

  async confirmCallback(tenantUserId: string, callbackId: string) {
    this.ensureCallbackMode();
    if (!this.database.isEnabled()) {
      const unlock = this.appState.unlocks.get(callbackId);
      if (!unlock || unlock.tenantUserId !== tenantUserId) {
        throw new NotFoundException({ code: "not_found", message: "Callback not found" });
      }
      if (!unlock.ownerRespondedAt) {
        throw new ConflictException({
          code: "no_call_claimed",
          message: "No call has been claimed yet"
        });
      }
      unlock.tenantConfirmedAt = unlock.tenantConfirmedAt ?? Date.now();
      return {
        callback_id: callbackId,
        tenant_confirmed_at: new Date(unlock.tenantConfirmedAt).toISOString()
      };
    }

    const unlock = await this.database.query<{ id: string; owner_responded_at: string | null }>(
      `SELECT id::text, owner_responded_at::text FROM contact_unlocks
       WHERE id = $1::uuid AND tenant_user_id = $2::uuid LIMIT 1`,
      [callbackId, tenantUserId]
    );
    if (!unlock.rows.length) {
      throw new NotFoundException({ code: "not_found", message: "Callback not found" });
    }
    if (!unlock.rows[0].owner_responded_at) {
      throw new ConflictException({
        code: "no_call_claimed",
        message: "No call has been claimed yet"
      });
    }
    await this.database.query(
      `UPDATE leads SET tenant_confirmed_at = COALESCE(tenant_confirmed_at, now()), updated_at = now()
       WHERE contact_unlock_id = $1::uuid`,
      [callbackId]
    );
    await this.database.query(
      `INSERT INTO contact_events(contact_unlock_id, actor_role, event_type, metadata)
       VALUES ($1::uuid, 'tenant', 'tenant_confirmed', '{}'::jsonb)`,
      [callbackId]
    );
    const stamped = await this.database.query<{ tenant_confirmed_at: string }>(
      `SELECT tenant_confirmed_at::text FROM leads WHERE contact_unlock_id = $1::uuid LIMIT 1`,
      [callbackId]
    );
    return {
      callback_id: callbackId,
      tenant_confirmed_at: stamped.rows[0]?.tenant_confirmed_at ?? new Date().toISOString()
    };
  }

  async disputeCallback(tenantUserId: string, callbackId: string) {
    this.ensureCallbackMode();
    if (!this.database.isEnabled()) {
      return this.disputeCallbackInMemory(tenantUserId, callbackId);
    }
    return this.disputeCallbackDb(tenantUserId, callbackId);
  }

  private disputeCallbackInMemory(tenantUserId: string, callbackId: string) {
    const unlock = this.appState.unlocks.get(callbackId);
    if (!unlock || unlock.tenantUserId !== tenantUserId) {
      throw new NotFoundException({ code: "not_found", message: "Callback not found" });
    }
    if (!unlock.ownerRespondedAt) {
      throw new ConflictException({
        code: "no_call_claimed",
        message: "No call has been claimed yet"
      });
    }
    if (Date.now() - unlock.ownerRespondedAt > DISPUTE_WINDOW_MS) {
      throw new ConflictException({
        code: "dispute_window_closed",
        message: "Dispute window has closed"
      });
    }
    if (unlock.unlockStatus !== "active") {
      throw new ConflictException({
        code: "already_refunded",
        message: "Callback already refunded"
      });
    }
    this.appState.addWalletTxn({
      userId: tenantUserId,
      type: "refund_lead_dispute",
      creditsDelta: 1,
      referenceId: unlock.id
    });
    unlock.unlockStatus = "refunded";
    unlock.disputedAt = Date.now();
    logTelemetry("callback.disputed", { mode: "in_memory", unlock_id: unlock.id });
    return {
      callback_id: callbackId,
      refunded: true,
      credits_remaining: this.appState.getWalletBalance(tenantUserId)
    };
  }

  private async disputeCallbackDb(tenantUserId: string, callbackId: string) {
    const client = await this.database.getClient();
    try {
      await client.query("BEGIN");
      const unlockResult = await client.query<{
        id: string;
        listing_id: string;
        unlock_status: string;
        owner_responded_at: string | null;
        window_closed: boolean;
      }>(
        `SELECT id::text, listing_id::text, unlock_status::text, owner_responded_at::text,
                (owner_responded_at IS NOT NULL AND owner_responded_at < now() - interval '72 hours') AS window_closed
         FROM contact_unlocks
         WHERE id = $1::uuid AND tenant_user_id = $2::uuid
         FOR UPDATE`,
        [callbackId, tenantUserId]
      );
      const unlock = unlockResult.rows[0];
      if (!unlock) {
        throw new NotFoundException({ code: "not_found", message: "Callback not found" });
      }
      if (!unlock.owner_responded_at) {
        throw new ConflictException({
          code: "no_call_claimed",
          message: "No call has been claimed yet"
        });
      }
      if (unlock.window_closed) {
        throw new ConflictException({
          code: "dispute_window_closed",
          message: "Dispute window has closed"
        });
      }
      if (unlock.unlock_status !== "active") {
        throw new ConflictException({
          code: "already_refunded",
          message: "Callback already refunded"
        });
      }

      const refundTxn = await client.query<{ id: string }>(
        `INSERT INTO wallet_transactions(
           wallet_user_id, txn_type, credits_delta, reference_type, reference_id, metadata)
         VALUES ($1::uuid, 'refund_lead_dispute', 1, 'contact_unlock', $2::uuid, '{}'::jsonb)
         RETURNING id::text`,
        [tenantUserId, callbackId]
      );
      await client.query(
        `UPDATE wallets SET balance_credits = balance_credits + 1, updated_at = now()
         WHERE user_id = $1::uuid`,
        [tenantUserId]
      );
      await client.query(
        `UPDATE contact_unlocks
         SET unlock_status = 'refunded', refund_txn_id = $2::uuid, updated_at = now()
         WHERE id = $1::uuid`,
        [callbackId, refundTxn.rows[0].id]
      );
      const lead = await client.query<{ id: string; called_by: string | null }>(
        `UPDATE leads SET disputed_at = now(), updated_at = now()
         WHERE contact_unlock_id = $1::uuid
         RETURNING id::text, called_by`,
        [callbackId]
      );
      if (lead.rows[0]?.called_by === "owner") {
        // Serial disputers are handled manually via admin at current scale.
        await client.query(
          `INSERT INTO fraud_flags (listing_id, flag_type, severity, reporter_user_id, details)
           VALUES ($1::uuid, 'callback_dispute', 'medium', $2::uuid, $3::jsonb)`,
          [
            unlock.listing_id,
            tenantUserId,
            JSON.stringify({ lead_id: lead.rows[0].id, callback_id: callbackId })
          ]
        );
      }
      await client.query(
        `INSERT INTO contact_events(contact_unlock_id, actor_role, event_type, metadata)
         VALUES ($1::uuid, 'tenant', 'dispute_refund', '{}'::jsonb)`,
        [callbackId]
      );
      const balance = await client.query<{ balance_credits: number }>(
        `SELECT balance_credits FROM wallets WHERE user_id = $1::uuid LIMIT 1`,
        [tenantUserId]
      );
      await client.query("COMMIT");
      logTelemetry("callback.disputed", { mode: "db", unlock_id: callbackId });
      return {
        callback_id: callbackId,
        refunded: true,
        credits_remaining: Number(balance.rows[0]?.balance_credits ?? 0)
      };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}
