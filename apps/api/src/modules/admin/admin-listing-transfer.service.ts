import { BadRequestException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { randomUUID } from "crypto";
import { AppStateService } from "../../common/app-state.service";
import { DatabaseService } from "../../common/database.service";
import { normalizeIndianPhone } from "./phone.util";

export interface TransferResult {
  listing_id: string;
  owner_user_id: string;
  owner_phone: string;
  leads_moved: number;
  already_owned: boolean;
}

export interface TransferInput {
  listingId: string;
  phoneE164: string;
  fullName?: string;
  adminUserId: string;
  /** Also flip status to 'pending_review' in the same transaction (publish-on-behalf). */
  alsoSubmit?: boolean;
}

/**
 * The single place a flat/house listing ever changes hands.
 *
 * Three columns bind a listing to a person and they must always move
 * together: `owner_user_id` (dashboard, edit rights, new-lead routing, public
 * "Listed by"), `contact_phone_encrypted` (the number a tenant receives after
 * spending a credit — see contacts.service.ts:305), and `whatsapp_available`
 * (whether that same paid-unlock response advertises a WhatsApp CTA — see
 * contacts.service.ts:305 and owner.service.ts:428 for where it's first
 * written, from the creating user's own opt-in). Moving only `owner_user_id`
 * produces a listing whose masked preview shows the new owner while paid
 * unlocks still hand out the old one, so a tenant pays and calls the wrong
 * person; leaving `whatsapp_available` behind similarly tells a tenant
 * WhatsApp works for an owner who never opted in.
 *
 * Every change is audited to `admin_actions` (action='transfer_owner'), which
 * the admin home workspace's Activity tab reads back.
 */
@Injectable()
export class AdminListingTransferService {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(AppStateService) private readonly appState: AppStateService
  ) {}

  async transferOwner(input: TransferInput): Promise<TransferResult> {
    const phone = normalizeIndianPhone(input.phoneE164);
    if (!phone) {
      throw new BadRequestException({
        code: "invalid_phone",
        message: "Enter a valid Indian mobile number"
      });
    }

    const fullName = input.fullName?.trim() || null;

    if (!this.database.isEnabled()) {
      return this.transferInMemory(input, phone, fullName);
    }

    const client = await this.database.getClient();
    try {
      await client.query("BEGIN");

      // FOR UPDATE so two admins transferring the same listing serialise rather
      // than racing to a lost update.
      const listing = await client.query<{
        id: string;
        owner_user_id: string;
        listing_type: string;
        status: string;
      }>(
        `SELECT id::text, owner_user_id::text, listing_type::text, status::text
           FROM listings
          WHERE id = $1::uuid
          FOR UPDATE`,
        [input.listingId]
      );

      if (!listing.rowCount || !listing.rows[0]) {
        throw new NotFoundException({
          code: "listing_not_found",
          message: "Listing not found"
        });
      }

      const current = listing.rows[0];
      if (current.listing_type !== "flat_house") {
        throw new BadRequestException({
          code: "pg_not_supported",
          message: "PG listings cannot be transferred yet"
        });
      }

      // Upsert the owner by phone. Promote tenant -> owner; never downgrade an
      // existing owner/pg_operator; never overwrite a name the owner set.
      const owner = await client.query<{
        id: string;
        phone_e164: string;
        role: string;
        is_blocked: boolean;
      }>(
        `INSERT INTO users (phone_e164, role, preferred_language, full_name)
         VALUES ($1, 'owner', 'en', $2)
         ON CONFLICT (phone_e164) DO UPDATE
           SET role = CASE WHEN users.role = 'tenant' THEN 'owner'::user_role ELSE users.role END,
               full_name = COALESCE(NULLIF(users.full_name, ''), EXCLUDED.full_name),
               updated_at = now()
         RETURNING id::text, phone_e164, role::text, is_blocked`,
        [phone, fullName]
      );

      const target = owner.rows[0];

      // An admin account is blocked from /owner/* by middleware, so it would
      // never be able to see or manage the listing it was handed.
      if (target.role === "admin") {
        throw new BadRequestException({
          code: "cannot_transfer_to_admin",
          message: "That number belongs to an admin account"
        });
      }
      if (target.is_blocked) {
        throw new BadRequestException({
          code: "target_blocked",
          message: "That account is blocked"
        });
      }

      if (target.id === current.owner_user_id && !input.alsoSubmit) {
        await client.query("COMMIT");
        return {
          listing_id: current.id,
          owner_user_id: target.id,
          owner_phone: target.phone_e164,
          leads_moved: 0,
          already_owned: true
        };
      }

      // whatsapp_available moves too, sourced from the TARGET user (not
      // carried over from the old owner): it is written at creation from the
      // creating user's own whatsapp_opt_in (owner.service.ts:428), read back
      // on the paid-unlock response (contacts.service.ts:305) and drives the
      // WhatsApp CTA on the public listing page (listing-host-card.tsx:74).
      // Leaving it untouched here would let a worker with whatsapp_opt_in=true
      // publish on behalf of an owner who doesn't use WhatsApp, so a tenant
      // spends a credit, is told WhatsApp works, and gets silence. The
      // subquery re-reads the just-upserted row rather than threading a new
      // bound param through — target.id is already $2.
      await client.query(
        `UPDATE listings
            SET owner_user_id = $2::uuid,
                contact_phone_encrypted = $3,
                whatsapp_available = (SELECT whatsapp_opt_in FROM users WHERE id = $2::uuid),
                ${input.alsoSubmit ? "status = 'pending_review'," : ""}
                updated_at = now()
          WHERE id = $1::uuid`,
        [current.id, target.id, target.phone_e164]
      );

      // Leads carry a denormalised owner_user_id stamped at creation, so they do
      // not follow the listing on their own. transferred_at marks them inherited
      // so they do not consume the new owner's free-lead allowance.
      const leads = await client.query(
        `UPDATE leads
            SET owner_user_id = $2::uuid,
                transferred_at = now(),
                updated_at = now()
          WHERE listing_id = $1::uuid
            AND owner_user_id <> $2::uuid`,
        [current.id, target.id]
      );

      await client.query(
        `INSERT INTO admin_actions(admin_user_id, target_type, target_id, action, before_state, after_state)
         VALUES ($1::uuid, 'listing', $2::uuid, 'transfer_owner', $3::jsonb, $4::jsonb)`,
        [
          input.adminUserId,
          current.id,
          JSON.stringify({ from_user_id: current.owner_user_id, status: current.status }),
          JSON.stringify({
            to_user_id: target.id,
            to_phone: target.phone_e164,
            leads_moved: leads.rowCount ?? 0,
            submitted: Boolean(input.alsoSubmit)
          })
        ]
      );

      await client.query("COMMIT");

      return {
        listing_id: current.id,
        owner_user_id: target.id,
        owner_phone: target.phone_e164,
        leads_moved: leads.rowCount ?? 0,
        already_owned: false
      };
    } catch (err) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * In-memory fallback for DB-less local boot (CLAUDE.md dual-mode rule). The
   * in-memory ListingRecord has no contact-phone field, so only the owner
   * binding moves here.
   */
  private transferInMemory(
    input: TransferInput,
    phone: string,
    fullName: string | null
  ): TransferResult {
    const listing = this.appState.listings.get(input.listingId);
    if (!listing) {
      throw new NotFoundException({ code: "listing_not_found", message: "Listing not found" });
    }
    if (listing.listingType !== "flat_house") {
      throw new BadRequestException({
        code: "pg_not_supported",
        message: "PG listings cannot be transferred yet"
      });
    }

    // Scan by value rather than `usersByPhone` because that lookup map is only
    // ever kept in sync by the code paths that create users (auth OTP verify,
    // POST /admin/users) — it is not a foreign key, just a cache. Scanning
    // `users` directly is correct regardless of how a given user entered state.
    let target = [...this.appState.users.values()].find((u) => u.phone === phone);
    if (!target) {
      target = {
        id: randomUUID(),
        phone,
        role: "owner",
        preferred_language: "en",
        ...(fullName ? { full_name: fullName } : {})
      };
      this.appState.users.set(target.id, target);
    } else {
      if (target.role === "admin") {
        throw new BadRequestException({
          code: "cannot_transfer_to_admin",
          message: "That number belongs to an admin account"
        });
      }
      if (target.role === "tenant") target.role = "owner";
      if (!target.full_name && fullName) target.full_name = fullName;
    }
    // Keep the phone->user cache consistent so a subsequent OTP login for this
    // (possibly brand-new) owner resolves to the same user id this transfer
    // just wrote onto the listing, instead of auth minting a second account.
    this.appState.usersByPhone.set(target.phone, target);

    if (listing.ownerUserId === target.id && !input.alsoSubmit) {
      return {
        listing_id: listing.id,
        owner_user_id: target.id,
        owner_phone: phone,
        leads_moved: 0,
        already_owned: true
      };
    }

    const previousOwner = listing.ownerUserId;
    listing.ownerUserId = target.id;
    if (input.alsoSubmit) listing.status = "pending_review";

    let leadsMoved = 0;
    for (const lead of this.appState.leads.values()) {
      if (lead.listingId === listing.id && lead.ownerUserId === previousOwner) {
        lead.ownerUserId = target.id;
        lead.transferredAt = Date.now();
        leadsMoved += 1;
      }
    }

    return {
      listing_id: listing.id,
      owner_user_id: target.id,
      owner_phone: phone,
      leads_moved: leadsMoved,
      already_owned: false
    };
  }
}
