import { BadRequestException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { DatabaseService } from "../../common/database.service";
import { normalizeIndianPhone } from "./phone.util";

export interface PgTransferResult {
  listing_id: string;
  operator_user_id: string;
  operator_phone: string;
  leads_moved: number;
  already_owned: boolean;
}

export interface PgTransferInput {
  listingId: string;
  phoneE164: string;
  fullName?: string;
  adminUserId: string;
}

/**
 * The single place a PG ever changes hands.
 *
 * A flat/house listing binds to a person through ONE column; a PG binds through
 * three, and each gates something different:
 *   - `pg_listings.operator_user_id` — the PG aggregate head: listing edit,
 *     publish, status (pg-listing.service.ts:536, :589, :640).
 *   - `pg_properties.operator_id` — the property container: maintenance
 *     (pg-maintenance.service.ts:564), occupancy (pg-occupancy.service.ts:131),
 *     bed assignment, layout, AND the live tenant -> operator phone lookup
 *     (pg-residence.service.ts:146).
 *   - the `listings` projection (same id, 1:1) — `owner_user_id`,
 *     `contact_phone_encrypted` (the number a tenant receives on unlock,
 *     contacts.service.ts:305) and `whatsapp_available`.
 * Move one without the others and the PG is half-transferred: the new operator
 * sees a listing they cannot edit, or the dashboard shows them while paid
 * unlocks still hand out the previous operator's number.
 *
 * Three further tables carry a DENORMALIZED operator stamp that would otherwise
 * go stale — leads, listing-scoped pg_analytics_overrides, and
 * pg_manage_requests. They move too; see the inline notes at each write.
 *
 * Audited to `admin_actions` (action='transfer_owner', enum value added by
 * migration 0069 — this service needs no migration of its own).
 *
 * DB-only by design: AppStateService has no pg_listings model (only a loose
 * pgProperties map at app-state.service.ts:903), and the sibling admin PG
 * service already throws db_disabled without a database
 * (pg-admin-properties.service.ts:247). A deliberate, documented departure from
 * the CLAUDE.md dual-mode rule, consistent with every other PG admin service.
 */
@Injectable()
export class AdminPgTransferService {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

  async transferOperator(input: PgTransferInput): Promise<PgTransferResult> {
    const phone = normalizeIndianPhone(input.phoneE164);
    if (!phone) {
      throw new BadRequestException({
        code: "invalid_phone",
        message: "Enter a valid Indian mobile number"
      });
    }

    const fullName = input.fullName?.trim() || null;

    if (!this.database.isEnabled()) {
      throw new NotFoundException({
        code: "db_disabled",
        message: "PG transfer requires a database"
      });
    }

    const client = await this.database.getClient();
    try {
      await client.query("BEGIN");

      // FOR UPDATE so two admins transferring the same PG serialise rather than
      // racing to a lost update. Lock order is always head-then-property.
      const head = await client.query<{
        id: string;
        operator_user_id: string;
        pg_property_id: string | null;
        status: string;
      }>(
        `SELECT id::text, operator_user_id::text, pg_property_id::text, status::text
           FROM pg_listings
          WHERE id = $1::uuid
          FOR UPDATE`,
        [input.listingId]
      );

      if (!head.rowCount || !head.rows[0]) {
        throw new NotFoundException({
          code: "listing_not_found",
          message: "PG listing not found"
        });
      }

      const current = head.rows[0];

      // Migration 0033:20 relaxed pg_property_id to nullable for legacy orphans.
      // Those listings still transfer — there is simply no container to move.
      if (current.pg_property_id) {
        await client.query(`SELECT id FROM pg_properties WHERE id = $1::uuid FOR UPDATE`, [
          current.pg_property_id
        ]);
      }

      // Upsert the operator by phone. Promote tenant -> pg_operator; never
      // downgrade an existing owner/pg_operator/admin (those survive unchanged
      // and are rejected below); never overwrite a name the user set themselves.
      const operator = await client.query<{
        id: string;
        phone_e164: string;
        role: string;
        is_blocked: boolean;
      }>(
        `INSERT INTO users (phone_e164, role, preferred_language, full_name)
         VALUES ($1, 'pg_operator', 'en', $2)
         ON CONFLICT (phone_e164) DO UPDATE
           SET role = CASE WHEN users.role = 'tenant' THEN 'pg_operator'::user_role ELSE users.role END,
               full_name = COALESCE(NULLIF(users.full_name, ''), EXCLUDED.full_name),
               updated_at = now()
         RETURNING id::text, phone_e164, role::text, is_blocked`,
        [phone, fullName]
      );

      const target = operator.rows[0];

      // An admin is blocked from /pg-operator/* by middleware.ts:29, so it could
      // never manage the PG it was handed.
      if (target.role === "admin") {
        throw new BadRequestException({
          code: "cannot_transfer_to_admin",
          message: "That number belongs to an admin account"
        });
      }
      // Roles are mutually exclusive on the web: middleware.ts:27-34 admits only
      // `owner` to /owner/* and only `pg_operator` to /pg-operator/*. Promoting
      // an owner would silently lock them out of their own flat dashboard, so
      // this is a refusal, not a promotion — matching auth.service.ts:782's
      // "contact admin to change" stance on self-service role switches.
      if (target.role === "owner") {
        throw new BadRequestException({
          code: "target_is_owner",
          message:
            "That number belongs to a flat/house owner account. Change their role first, or use a different number."
        });
      }
      if (target.is_blocked) {
        throw new BadRequestException({
          code: "target_blocked",
          message: "That account is blocked"
        });
      }

      if (target.id === current.operator_user_id) {
        await client.query("COMMIT");
        return {
          listing_id: current.id,
          operator_user_id: target.id,
          operator_phone: target.phone_e164,
          leads_moved: 0,
          already_owned: true
        };
      }

      // 1/6 — the PG aggregate head.
      await client.query(
        `UPDATE pg_listings
            SET operator_user_id = $2::uuid,
                updated_at = now()
          WHERE id = $1::uuid`,
        [current.id, target.id]
      );

      // 2/6 — the property container. 1 listing : 1 property since migration
      // 0041, so this never steals a property from another live listing.
      if (current.pg_property_id) {
        await client.query(
          `UPDATE pg_properties
              SET operator_id = $2::uuid,
                  updated_at = now()
            WHERE id = $1::uuid`,
          [current.pg_property_id, target.id]
        );
      }

      // 3/6 — the public read projection. whatsapp_available is sourced from the
      // TARGET's own opt-in, never carried over: it drives the WhatsApp CTA a
      // tenant sees after paying, so inheriting the previous operator's value
      // would promise WhatsApp for someone who never opted in. Mirrors
      // admin-listing-transfer.service.ts:158 and pg-listing.service.ts:349.
      await client.query(
        `UPDATE listings
            SET owner_user_id = $2::uuid,
                contact_phone_encrypted = $3,
                whatsapp_available = (SELECT whatsapp_opt_in FROM users WHERE id = $2::uuid),
                updated_at = now()
          WHERE id = $1::uuid`,
        [current.id, target.id, target.phone_e164]
      );

      // 4/6 — leads carry a denormalised owner_user_id stamped at creation, so
      // they do not follow the listing on their own. transferred_at marks them
      // inherited so they do not consume the new operator's free-lead allowance
      // (leads.service.ts:115).
      const leads = await client.query(
        `UPDATE leads
            SET owner_user_id = $2::uuid,
                transferred_at = now(),
                updated_at = now()
          WHERE listing_id = $1::uuid
            AND owner_user_id <> $2::uuid`,
        [current.id, target.id]
      );

      // 5/6 — listing-scoped analytics cuts follow the listing they were aimed
      // at; operator-GLOBAL rows (listing_id IS NULL) deliberately stay with the
      // previous operator, being a judgement about the person.
      //
      // DELETE first: uq_pg_override_listing is UNIQUE(operator_id, listing_id)
      // (migration 0038:22), so a blind UPDATE raises 23505 when the target
      // already holds a row for this listing — reachable by transferring a PG
      // away and later back.
      await client.query(
        `DELETE FROM pg_analytics_overrides
           WHERE listing_id = $1::uuid AND operator_id = $2::uuid`,
        [current.id, target.id]
      );
      await client.query(
        `UPDATE pg_analytics_overrides
            SET operator_id = $2::uuid,
                updated_at = now()
          WHERE listing_id = $1::uuid`,
        [current.id, target.id]
      );

      // 6/6 — the operator's own managed-ops view already resolves live through
      // pg_listings (pg-manage-request.service.ts:144); this is so the admin
      // queue's JOIN on r.operator_user_id (:173) stops naming the previous
      // operator. Its unique indexes key on listing_id alone (0060:29, :31), so
      // this cannot collide.
      await client.query(
        `UPDATE pg_manage_requests
            SET operator_user_id = $2::uuid,
                updated_at = now()
          WHERE listing_id = $1::uuid`,
        [current.id, target.id]
      );

      await client.query(
        `INSERT INTO admin_actions(admin_user_id, target_type, target_id, action, before_state, after_state)
         VALUES ($1::uuid, 'listing', $2::uuid, 'transfer_owner', $3::jsonb, $4::jsonb)`,
        [
          input.adminUserId,
          current.id,
          JSON.stringify({
            from_user_id: current.operator_user_id,
            status: current.status,
            pg_property_id: current.pg_property_id
          }),
          JSON.stringify({
            to_user_id: target.id,
            to_phone: target.phone_e164,
            leads_moved: leads.rowCount ?? 0,
            listing_type: "pg"
          })
        ]
      );

      await client.query("COMMIT");

      return {
        listing_id: current.id,
        operator_user_id: target.id,
        operator_phone: target.phone_e164,
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
}
