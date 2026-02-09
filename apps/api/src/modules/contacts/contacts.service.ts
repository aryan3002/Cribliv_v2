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

@Injectable()
export class ContactsService {
  constructor(
    @Inject(AppStateService) private readonly appState: AppStateService,
    @Inject(DatabaseService) private readonly database: DatabaseService
  ) {}

  async unlockContact(userId: string, listingId: string, idempotencyKey: string) {
    if (this.database.isEnabled()) {
      return this.unlockContactDb(userId, listingId, idempotencyKey);
    }

    return this.unlockContactInMemory(userId, listingId, idempotencyKey);
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

  private async unlockContactDb(userId: string, listingId: string, idempotencyKey: string) {
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
        return {
          unlock_id: row.id,
          owner_contact: {
            phone_e164: row.owner_phone ?? "+919888888888",
            whatsapp_available: row.whatsapp_available
          },
          credits_remaining: Number(row.balance_credits),
          response_deadline_at: row.response_deadline_at
        };
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

      const walletResult = await client.query<{ balance_credits: number }>(
        `
        SELECT balance_credits
        FROM wallets
        WHERE user_id = $1::uuid
        FOR UPDATE
        `,
        [userId]
      );

      const balance = Number(walletResult.rows[0]?.balance_credits ?? 0);
      if (balance < 1) {
        throw new HttpException(
          { code: "insufficient_credits", message: "Insufficient credits" },
          HttpStatus.PAYMENT_REQUIRED
        );
      }

      const debitTxnResult = await client.query<{ id: string }>(
        `
        INSERT INTO wallet_transactions(
          wallet_user_id,
          txn_type,
          credits_delta,
          reference_type,
          reference_id,
          idempotency_key,
          metadata
        )
        VALUES ($1::uuid, 'debit_contact_unlock', -1, 'listing', $2::uuid, $3, '{}'::jsonb)
        ON CONFLICT (wallet_user_id, idempotency_key) DO NOTHING
        RETURNING id::text
        `,
        [userId, listingId, idempotencyKey]
      );

      let walletTxnId = debitTxnResult.rows[0]?.id;
      const debitTxnInserted = Boolean(walletTxnId);
      if (!walletTxnId) {
        const existingTxn = await client.query<{ id: string }>(
          `
          SELECT id::text
          FROM wallet_transactions
          WHERE wallet_user_id = $1::uuid
            AND idempotency_key = $2
          LIMIT 1
          `,
          [userId, idempotencyKey]
        );
        walletTxnId = existingTxn.rows[0]?.id;
      }

      if (!walletTxnId) {
        throw new ConflictException({
          code: "duplicate_unlock",
          message: "Duplicate unlock request"
        });
      }

      if (debitTxnInserted) {
        await client.query(
          `
          UPDATE wallets
          SET balance_credits = balance_credits - 1, updated_at = now()
          WHERE user_id = $1::uuid
            AND balance_credits >= 1
          `,
          [userId]
        );
      }

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
          response_deadline_at
        )
        VALUES ($1::uuid, $2::uuid, $3::uuid, $4, now() + interval '12 hours')
        ON CONFLICT (tenant_user_id, listing_id, idempotency_key) DO NOTHING
        RETURNING id::text, response_deadline_at::text
        `,
        [userId, listingId, walletTxnId, idempotencyKey]
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

      const balanceAfterResult = await client.query<{ balance_credits: number }>(
        `
        SELECT balance_credits
        FROM wallets
        WHERE user_id = $1::uuid
        LIMIT 1
        `,
        [userId]
      );

      await client.query("COMMIT");

      const listing = listingResult.rows[0];
      return {
        unlock_id: unlockId,
        owner_contact: {
          phone_e164: listing.owner_phone ?? "+919888888888",
          whatsapp_available: listing.whatsapp_available
        },
        credits_remaining: Number(balanceAfterResult.rows[0]?.balance_credits ?? 0),
        response_deadline_at: responseDeadlineAt
      };
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
      return {
        unlock_id: existing.id,
        owner_contact: {
          phone_e164: "+919888888888",
          whatsapp_available: true
        },
        credits_remaining: this.appState.getWalletBalance(userId),
        response_deadline_at: new Date(existing.responseDeadlineAt).toISOString()
      };
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
      responseDeadlineAt: Date.now() + 12 * 60 * 60 * 1000
    };

    this.appState.unlocks.set(unlock.id, unlock);
    this.appState.unlockByIdempotency.set(cacheKey, unlock);

    return {
      unlock_id: unlock.id,
      owner_contact: {
        phone_e164: "+919888888888",
        whatsapp_available: true
      },
      credits_remaining: this.appState.getWalletBalance(userId),
      response_deadline_at: new Date(unlock.responseDeadlineAt).toISOString()
    };
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

      await client.query("COMMIT");
      const updated = updateResult.rows[0];
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

    return {
      unlock_id: unlock.id,
      owner_response_status: unlock.ownerResponseStatus,
      owner_responded_at: new Date(unlock.ownerRespondedAt).toISOString(),
      channel
    };
  }
}
