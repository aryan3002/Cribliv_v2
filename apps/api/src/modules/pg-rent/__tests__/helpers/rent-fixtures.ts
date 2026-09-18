import { randomUUID } from "node:crypto";

import type { DatabaseService } from "../../../../common/database.service";
import type { Role } from "../../../../common/types";

export class RentFixtures {
  cityId = 0;
  readonly userIds: string[] = [];
  readonly propertyIds: string[] = [];
  private phoneSeq = 0;

  constructor(
    private readonly db: DatabaseService,
    private readonly runId: string
  ) {}

  async setup(): Promise<void> {
    const city = await this.db.query<{ id: number }>(
      `INSERT INTO cities (slug, name_en, name_hi, state_en, state_hi)
       VALUES ($1, 'Rent test city', 'Rent test city', 'Test State', 'Test State') RETURNING id`,
      [`rent-${this.runId}`]
    );
    this.cityId = city.rows[0].id;
  }

  async teardown(): Promise<void> {
    if (this.propertyIds.length) {
      // pg_rent_payment_allocations.invoice_id is ON DELETE RESTRICT and the table has no
      // property column, so the property cascade would be blocked at pg_rent_invoices.
      await this.db.query(
        `DELETE FROM pg_rent_payment_allocations
          WHERE invoice_id IN (SELECT id FROM pg_rent_invoices WHERE pg_property_id = ANY($1::uuid[]))
             OR payment_id IN (SELECT id FROM pg_rent_payments WHERE pg_property_id = ANY($1::uuid[]))`,
        [this.propertyIds]
      );
      await this.db.query(`DELETE FROM pg_properties WHERE id = ANY($1::uuid[])`, [
        this.propertyIds
      ]);
    }
    if (this.userIds.length) {
      await this.db.query(`DELETE FROM idempotency_keys WHERE actor_user_id = ANY($1::uuid[])`, [
        this.userIds
      ]);
      await this.db.query(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [this.userIds]);
    }
    if (this.cityId) await this.db.query(`DELETE FROM cities WHERE id = $1`, [this.cityId]);
  }

  nextPhone(): string {
    this.phoneSeq += 1;
    return `+9177${this.runId.slice(0, 6)}${String(this.phoneSeq).padStart(3, "0")}`;
  }

  async createUser(role: Role, phone = this.nextPhone()): Promise<string> {
    const result = await this.db.query<{ id: string }>(
      `INSERT INTO users (phone_e164, role, preferred_language) VALUES ($1, $2::user_role, 'en') RETURNING id::text`,
      [phone, role]
    );
    this.userIds.push(result.rows[0].id);
    return result.rows[0].id;
  }

  async createProperty(
    operatorId: string,
    opts: { internalCode?: string | null; displayName?: string } = {}
  ): Promise<string> {
    const result = await this.db.query<{ id: string }>(
      `INSERT INTO pg_properties
         (operator_id, display_name, internal_code, city_id, is_primary, manage_enabled, layout_status, total_floors)
       VALUES ($1::uuid, $2, $3, $4, false, true, 'ready', 1) RETURNING id::text`,
      [
        operatorId,
        opts.displayName ?? `Rent property ${randomUUID().slice(0, 8)}`,
        opts.internalCode ?? null,
        this.cityId
      ]
    );
    this.propertyIds.push(result.rows[0].id);
    return result.rows[0].id;
  }

  /** pg_listings + pg_details for the property (rent_due_day seed, listing-level deposit, starting rent fallback). */
  async createListingWithDetails(
    propertyId: string,
    operatorId: string,
    opts: {
      rentDueDay?: number | null;
      depositPaise?: number | null;
      startingRentPaise?: number;
    } = {}
  ): Promise<string> {
    const listingId = randomUUID();
    await this.db.query(
      `INSERT INTO pg_listings (id, operator_user_id, pg_property_id, title, starting_rent_paise, status)
       VALUES ($1::uuid, $2::uuid, $3::uuid, 'Rent test listing', $4, 'active')`,
      [listingId, operatorId, propertyId, opts.startingRentPaise ?? 700000]
    );
    await this.db.query(
      `INSERT INTO pg_details (listing_id, total_beds, onboarding_path, rent_due_day, security_deposit_paise)
       VALUES ($1::uuid, 10, 'self_serve'::pg_onboarding_path, $2, $3)`,
      [listingId, opts.rentDueDay ?? null, opts.depositPaise ?? null]
    );
    return listingId;
  }

  async createRoomType(
    listingId: string,
    opts: { rentPaise?: number; depositPaise?: number | null; sharing?: string } = {}
  ): Promise<string> {
    const result = await this.db.query<{ id: string }>(
      `INSERT INTO pg_room_types
         (listing_id, sharing, ac, bathroom_kind, furnishing, monthly_rent_paise, security_deposit_paise, vacancy_count)
       VALUES ($1::uuid, $2::pg_sharing_kind, false, 'attached_western'::pg_bathroom_kind, 'semi_furnished'::furnishing_type, $3, $4, 0)
       RETURNING id::text`,
      [listingId, opts.sharing ?? "double", opts.rentPaise ?? 900000, opts.depositPaise ?? null]
    );
    return result.rows[0].id;
  }

  async createRoom(
    propertyId: string,
    opts: { roomTypeId?: string | null; roomNumber?: string } = {}
  ): Promise<string> {
    const result = await this.db.query<{ id: string }>(
      `INSERT INTO pg_rooms (pg_property_id, room_type_id, floor, room_number, display_label, bed_count, status)
       VALUES ($1::uuid, $2::uuid, 1, $3, 'Rent room', 2, 'active') RETURNING id::text`,
      [propertyId, opts.roomTypeId ?? null, opts.roomNumber ?? `R-${randomUUID().slice(0, 6)}`]
    );
    return result.rows[0].id;
  }

  async createBed(roomId: string, label: string, status = "occupied"): Promise<string> {
    const result = await this.db.query<{ id: string }>(
      `INSERT INTO pg_beds (room_id, bed_label, status, sort_order, metadata)
       VALUES ($1::uuid, $2, $3::pg_bed_status, 1, '{}'::jsonb) RETURNING id::text`,
      [roomId, label, status]
    );
    return result.rows[0].id;
  }

  async createAssignment(
    propertyId: string,
    bedId: string,
    opts: {
      createdBy: string;
      status?: string;
      occupantPhone?: string;
      occupantName?: string;
      tenantUserId?: string | null;
      moveIn?: string | null;
      noticeEnd?: string | null;
      moveOut?: string | null;
      rentPaise?: number | null;
      depositPaise?: number | null;
      rentDueDay?: number | null;
    }
  ): Promise<string> {
    const result = await this.db.query<{ id: string }>(
      `INSERT INTO pg_bed_assignments
         (pg_property_id, bed_id, tenant_user_id, occupant_name, occupant_phone_e164, status,
          move_in_date, notice_end_date, move_out_date, monthly_rent_paise, security_deposit_paise, rent_due_day, created_by)
       VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5, $6::pg_assignment_status,
               $7::date, $8::date, $9::date, $10, $11, $12, $13::uuid)
       RETURNING id::text`,
      [
        propertyId,
        bedId,
        opts.tenantUserId ?? null,
        opts.occupantName ?? "Rent Tenant",
        opts.occupantPhone ?? this.nextPhone(),
        opts.status ?? "active",
        opts.moveIn === undefined ? "2026-09-12" : opts.moveIn,
        opts.noticeEnd ?? null,
        opts.moveOut ?? null,
        opts.rentPaise ?? null,
        opts.depositPaise ?? null,
        opts.rentDueDay ?? null,
        opts.createdBy
      ]
    );
    return result.rows[0].id;
  }
}
