import { BadRequestException, Inject, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { DatabaseService } from "../../../common/database.service";
import { AppStateService } from "../../../common/app-state.service";
import { randomUUID } from "node:crypto";
import { PgPropertiesService } from "./pg-properties.service";
import type { PgListingPayload, PgProperty } from "@cribliv/shared-types";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function isUuid(v: string): boolean {
  return typeof v === "string" && UUID_RE.test(v);
}

/**
 * Minimal query surface satisfied by both a pg `PoolClient` (transaction) and
 * the `DatabaseService` convenience wrapper. Lets the write helpers run inside
 * a caller-owned transaction.
 */
interface SqlExec {
  query: (text: string, params?: unknown[]) => Promise<unknown>;
}

export interface HydrateOptions {
  idempotencyKey: string;
}

export interface PgListingDetail {
  id: string;
  status: string;
  title: string | null;
  monthly_rent: number | null;
  created_at: string | null;
  city_slug: string | null;
  locality_slug: string | null;
  pg_details: {
    total_beds: number | null;
    gender_policy: string | null;
    tenant_type: string | null;
    security_deposit_paise: number | null;
    notice_period_days: number | null;
    lock_in_months: number | null;
    electricity_mode: string | null;
    rent_due_day: number | null;
    price_negotiable: boolean;
    payment_modes: string[];
    meals: Record<string, unknown> | null;
    amenities: Record<string, unknown>;
    house_rules: Record<string, unknown>;
  };
  room_types: Array<{
    sharing: string;
    ac: boolean;
    bathroom_kind: string | null;
    furnishing: string | null;
    monthly_rent_paise: number;
    vacancy_count: number;
    available_from: string | null;
  }>;
  photos: Array<{ blob_path: string; is_cover: boolean }>;
}

export interface ListingResult {
  id: string;
  status: string;
  [k: string]: unknown;
}

/**
 * PG-specialised listing service. PG owns its write end-to-end (no OwnerService):
 * it self-writes the base listings row + listing_locations and the PG detail
 * tables (pg_details + pg_room_types) in one transaction.
 *
 * Voice flow lands here via hydrateFromVoiceDraft(); replay-safe via
 * idempotency-key cache (state.pgVoiceIdempotency).
 */
@Injectable()
export class PgListingService {
  private readonly log = new Logger(PgListingService.name);
  // Same public blob base the card search uses, so public detail photos are
  // absolute URLs the browser can load directly (operator/wizard reads keep the
  // raw blob_path for re-order / delete).
  private readonly photoBase = (process.env.PHOTO_PUBLIC_BASE_URL ?? "").trim().replace(/\/+$/, "");

  private toPhotoUrl(blobPath: string): string {
    if (/^https?:\/\//i.test(blobPath)) return blobPath;
    if (!this.photoBase) return blobPath;
    return `${this.photoBase}/${blobPath.replace(/^\/+/, "")}`;
  }

  constructor(
    @Inject(DatabaseService) private readonly db: DatabaseService,
    @Inject(AppStateService) private readonly state: AppStateService,
    @Inject(PgPropertiesService) private readonly properties: PgPropertiesService
  ) {}

  async createDraft(
    operatorId: string,
    pgPropertyId: string,
    payload: PgListingPayload,
    initialStatus: "draft" | "pending_review" = "draft"
  ): Promise<ListingResult> {
    const prop = await this.properties.getActiveProperty(operatorId);
    if (!prop || prop.id !== pgPropertyId) {
      throw new NotFoundException({
        code: "property_not_found",
        message: "property_not_found: pg_property not found for operator"
      });
    }
    if (!payload.room_types?.length) {
      throw new BadRequestException({
        code: "no_room_types",
        message: "no_room_types: at least one room type is required"
      });
    }

    // PG owns its write end-to-end (split): no OwnerService. The PG head
    // (pg_listings — source of truth) + pg_details + pg_room_types + the public
    // READ PROJECTION (listings + listing_locations, SAME id) are written inside
    // ONE transaction, so a mid-write failure can't orphan any row. The id is
    // generated up front and shared 1:1 between head and projection.
    const id = randomUUID();
    if (this.db.isEnabled()) {
      const client = await this.db.getClient();
      try {
        await client.query("BEGIN");
        await this.writePgListingHead(client, id, operatorId, pgPropertyId, payload, initialStatus);
        await this.writePgDetails(client, id, payload);
        await this.writeRoomTypes(client, id, payload);
        await this.projectToListings(client, id, operatorId, prop, payload, initialStatus);
        await client.query("COMMIT");
        return { id, status: initialStatus };
      } catch (e) {
        await client.query("ROLLBACK");
        this.log.error(
          `[pg-listings] createDraft tx FAILED operatorId=${operatorId} city=${payload.property.city_slug}: ${
            (e as Error).message
          }`
        );
        throw e;
      } finally {
        client.release();
      }
    }

    // In-memory / unit-test fallback (no real DB): keep dev search + dashboard working.
    this.state.listings.set(id, {
      id,
      ownerUserId: operatorId,
      listingType: "pg",
      title: payload.property.display_name,
      city: payload.property.city_slug,
      locality: payload.property.locality_slug ?? undefined,
      monthlyRent: this.cheapestRentRupees(payload),
      verificationStatus: "unverified",
      status: initialStatus,
      createdAt: Date.now(),
      amenities: []
    });
    await this.writePgDetails(this.db, id, payload);
    await this.writeRoomTypes(this.db, id, payload);
    return { id, status: initialStatus };
  }

  /** PG-owned listing head — the source of truth (pg_listings). */
  private async writePgListingHead(
    exec: SqlExec,
    id: string,
    operatorId: string,
    pgPropertyId: string,
    payload: PgListingPayload,
    status: "draft" | "pending_review"
  ): Promise<void> {
    await exec.query(
      `INSERT INTO pg_listings(
         id, operator_user_id, pg_property_id, title, starting_rent_paise, status, verification_status
       )
       VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5, $6::listing_status, 'unverified')`,
      [
        id,
        operatorId,
        pgPropertyId,
        payload.property.display_name,
        this.cheapestRentPaise(payload),
        status
      ]
    );
  }

  /**
   * Write/refresh the public READ PROJECTION (shared listings + listing_locations)
   * from the PG aggregate, using the SAME id (1:1). Idempotent — re-running on
   * edit/approve UPSERTs. Maps / analytics / search read this projection
   * unchanged; they never need to know PG owns the source row.
   */
  private async projectToListings(
    exec: SqlExec,
    id: string,
    operatorId: string,
    prop: PgProperty,
    payload: PgListingPayload,
    status: "draft" | "pending_review"
  ): Promise<void> {
    const contact = (await this.db.query(
      `SELECT phone_e164, whatsapp_opt_in FROM users WHERE id = $1::uuid LIMIT 1`,
      [operatorId]
    )) as { rows: Array<{ phone_e164: string | null; whatsapp_opt_in: boolean | null }> };

    await exec.query(
      `INSERT INTO listings(
         id, owner_user_id, listing_type, title_en, status, verification_status,
         monthly_rent, amenities, pg_property_id, contact_phone_encrypted, whatsapp_available
       )
       VALUES ($1::uuid, $2::uuid, 'pg', $3, $8::listing_status, 'unverified', $4, '[]'::jsonb, $5::uuid, $6, $7)
       ON CONFLICT (id) DO UPDATE SET
         title_en = EXCLUDED.title_en,
         monthly_rent = EXCLUDED.monthly_rent,
         status = EXCLUDED.status,
         verification_status = EXCLUDED.verification_status,
         updated_at = now()`,
      [
        id,
        operatorId,
        payload.property.display_name,
        this.cheapestRentRupees(payload),
        prop.id,
        contact.rows[0]?.phone_e164 ?? null,
        contact.rows[0]?.whatsapp_opt_in ?? false,
        status
      ]
    );

    await exec.query(
      `INSERT INTO listing_locations(listing_id, city_id, locality_id, address_line1, masked_address)
       VALUES ($1::uuid, $2, $3, $4, $5)
       ON CONFLICT (listing_id) DO UPDATE SET
         city_id = EXCLUDED.city_id,
         locality_id = EXCLUDED.locality_id`,
      [
        id,
        prop.city_id,
        prop.locality_id,
        payload.property.display_name,
        payload.property.locality_slug ?? payload.property.city_slug
      ]
    );

    await this.projectGeo(exec, id, prop);
  }

  /**
   * Populate the projection's coordinates so the listing appears on CribLiv maps.
   * Precise property coords win; otherwise the locality centroid. geo_point
   * (PostGIS) is best-effort inside a savepoint so DBs without PostGIS degrade
   * gracefully (same pattern owner listings use).
   */
  private async projectGeo(exec: SqlExec, id: string, prop: PgProperty): Promise<void> {
    if (prop.lat != null && prop.lng != null) {
      await exec.query(
        `UPDATE listing_locations SET lat = $2, lng = $3 WHERE listing_id = $1::uuid`,
        [id, prop.lat, prop.lng]
      );
    } else if (prop.locality_id != null) {
      await exec.query(
        `UPDATE listing_locations ll
            SET lat = loc.lat, lng = loc.lng
            FROM localities loc
           WHERE ll.listing_id = $1::uuid AND loc.id = $2 AND loc.lat IS NOT NULL`,
        [id, prop.locality_id]
      );
    }

    await exec.query("SAVEPOINT pg_geo_point");
    try {
      await exec.query(
        `UPDATE listing_locations
            SET geo_point = ST_SetSRID(ST_MakePoint(lng::float8, lat::float8), 4326)::geography
          WHERE listing_id = $1::uuid AND lat IS NOT NULL AND lng IS NOT NULL`,
        [id]
      );
      await exec.query("RELEASE SAVEPOINT pg_geo_point");
    } catch {
      await exec.query("ROLLBACK TO SAVEPOINT pg_geo_point");
    }
  }

  /**
   * Operator's listing heads for the dashboard — read off pg_listings (the PG
   * source of truth; no OwnerService). In-memory mode reads the dev listings map.
   */
  async listOperatorListings(
    operatorId: string
  ): Promise<Array<{ id: string; status: string; updated_at: string }>> {
    if (this.db.isEnabled()) {
      const r = await this.db.query<{ id: string; status: string; updated_at: string }>(
        `SELECT id::text, status::text, updated_at::text
         FROM pg_listings
         WHERE operator_user_id = $1::uuid
         ORDER BY created_at DESC`,
        [operatorId]
      );
      return r.rows;
    }
    return [...this.state.listings.values()]
      .filter((l) => l.ownerUserId === operatorId && l.listingType === "pg")
      .map((l) => ({
        id: l.id,
        status: l.status,
        updated_at: new Date(l.createdAt).toISOString()
      }));
  }

  /**
   * Full operator-scoped detail for one PG listing: base row + pg_details
   * (new 0031 schema) + room types + photos. Owner-scoped — an operator can
   * only read their own listings (returns null otherwise → controller 404s).
   */
  async getOperatorListingDetail(
    operatorId: string,
    listingId: string
  ): Promise<PgListingDetail | null> {
    // A malformed id (e.g. "undefined" from a bad client redirect) must 404, not
    // 500 on `$1::uuid`. Treat anything that isn't a UUID as "not found".
    if (!isUuid(listingId)) return null;
    if (!this.db.isEnabled()) return null;

    return this.loadListingDetail(
      listingId,
      `pl.id = $1::uuid AND pl.operator_user_id = $2::uuid`,
      [listingId, operatorId]
    );
  }

  /**
   * Public detail — tenant-facing PG listing page. ACTIVE listings only
   * (draft / pending_review / paused never leak). No operator scope. Returns
   * null for a non-uuid id or a non-active listing (→ controller 404s).
   */
  async getPublicListingDetail(listingId: string): Promise<PgListingDetail | null> {
    if (!isUuid(listingId) || !this.db.isEnabled()) return null;
    const detail = await this.loadListingDetail(
      listingId,
      `pl.id = $1::uuid AND pl.status = 'active'`,
      [listingId]
    );
    if (!detail) return null;
    // Public consumers render <img> directly — hand them absolute URLs.
    return {
      ...detail,
      photos: detail.photos.map((p) => ({ ...p, blob_path: this.toPhotoUrl(p.blob_path) }))
    };
  }

  /**
   * Returns the operator_user_id for an ACTIVE PG listing, or null when the id
   * is malformed / not found / not active. Used by the free interest endpoint
   * to attribute the lead to the listing's operator.
   */
  async getActiveListingOperator(listingId: string): Promise<string | null> {
    if (!isUuid(listingId) || !this.db.isEnabled()) return null;
    const res = await this.db.query<{ operator_user_id: string }>(
      `SELECT operator_user_id::text AS operator_user_id
       FROM pg_listings WHERE id = $1::uuid AND status = 'active' LIMIT 1`,
      [listingId]
    );
    return res.rows[0]?.operator_user_id ?? null;
  }

  /**
   * Distinct city slugs the operator has PG listings in — used to scope search
   * demand insights to the operator's markets. DB off → [].
   */
  async listOperatorListingCities(operatorId: string): Promise<string[]> {
    if (!this.db.isEnabled()) return [];
    const r = await this.db.query<{ slug: string }>(
      `SELECT DISTINCT c.slug
         FROM pg_listings pl
         JOIN listing_locations ll ON ll.listing_id = pl.id
         JOIN cities c ON c.id = ll.city_id
        WHERE pl.operator_user_id = $1::uuid AND c.slug IS NOT NULL`,
      [operatorId]
    );
    return r.rows.map((x) => x.slug);
  }

  /** Shared loader: pg_listings head + pg_details + room types + photos → DTO. */
  private async loadListingDetail(
    listingId: string,
    headWhere: string,
    headParams: unknown[]
  ): Promise<PgListingDetail | null> {
    const head = await this.db.query<Record<string, unknown>>(
      `
      SELECT
        pl.id::text               AS id,
        pl.status::text           AS status,
        pl.title                  AS title,
        pl.starting_rent_paise    AS starting_rent_paise,
        pl.created_at::text       AS created_at,
        c.slug                    AS city_slug,
        loc.slug                  AS locality_slug,
        d.total_beds              AS total_beds,
        d.gender_policy::text     AS gender_policy,
        d.tenant_type::text       AS tenant_type,
        d.security_deposit_paise  AS security_deposit_paise,
        d.notice_period_days      AS notice_period_days,
        d.lock_in_months          AS lock_in_months,
        d.electricity_mode::text  AS electricity_mode,
        d.rent_due_day            AS rent_due_day,
        d.price_negotiable        AS price_negotiable,
        d.payment_modes           AS payment_modes,
        d.meals                   AS meals,
        d.amenities               AS amenities,
        d.house_rules             AS house_rules
      FROM pg_listings pl
      LEFT JOIN pg_properties pp ON pp.id = pl.pg_property_id
      LEFT JOIN cities c ON c.id = pp.city_id
      LEFT JOIN localities loc ON loc.id = pp.locality_id
      LEFT JOIN pg_details d ON d.listing_id = pl.id
      WHERE ${headWhere}
      LIMIT 1
      `,
      headParams
    );
    if (!head.rowCount || !head.rows[0]) return null;

    const rooms = await this.db.query<Record<string, unknown>>(
      `
      SELECT sharing::text AS sharing, ac, bathroom_kind::text AS bathroom_kind,
             furnishing::text AS furnishing, monthly_rent_paise, vacancy_count,
             available_from::text AS available_from
      FROM pg_room_types
      WHERE listing_id = $1::uuid
      ORDER BY monthly_rent_paise ASC
      `,
      [listingId]
    );

    const photos = await this.db.query<{ blob_path: string; is_cover: boolean }>(
      `
      SELECT blob_path, is_cover
      FROM listing_photos
      WHERE listing_id = $1::uuid
        AND moderation_status != 'rejected'
      ORDER BY is_cover DESC, sort_order ASC, created_at ASC
      `,
      [listingId]
    );

    const h = head.rows[0];
    return {
      id: String(h.id),
      status: String(h.status),
      title: (h.title as string) ?? null,
      monthly_rent:
        h.starting_rent_paise == null ? null : Math.round(Number(h.starting_rent_paise) / 100),
      created_at: (h.created_at as string) ?? null,
      city_slug: (h.city_slug as string) ?? null,
      locality_slug: (h.locality_slug as string) ?? null,
      pg_details: {
        total_beds: h.total_beds == null ? null : Number(h.total_beds),
        gender_policy: (h.gender_policy as string) ?? null,
        tenant_type: (h.tenant_type as string) ?? null,
        security_deposit_paise:
          h.security_deposit_paise == null ? null : Number(h.security_deposit_paise),
        notice_period_days: h.notice_period_days == null ? null : Number(h.notice_period_days),
        lock_in_months: h.lock_in_months == null ? null : Number(h.lock_in_months),
        electricity_mode: (h.electricity_mode as string) ?? null,
        rent_due_day: h.rent_due_day == null ? null : Number(h.rent_due_day),
        price_negotiable: Boolean(h.price_negotiable),
        payment_modes: (h.payment_modes as string[]) ?? [],
        meals: (h.meals as Record<string, unknown>) ?? null,
        amenities: (h.amenities as Record<string, unknown>) ?? {},
        house_rules: (h.house_rules as Record<string, unknown>) ?? {}
      },
      room_types: rooms.rows.map((r) => ({
        sharing: String(r.sharing),
        ac: Boolean(r.ac),
        bathroom_kind: (r.bathroom_kind as string) ?? null,
        furnishing: (r.furnishing as string) ?? null,
        monthly_rent_paise: Number(r.monthly_rent_paise),
        vacancy_count: Number(r.vacancy_count),
        available_from: (r.available_from as string) ?? null
      })),
      photos: photos.rows.map((p) => ({ blob_path: p.blob_path, is_cover: Boolean(p.is_cover) }))
    };
  }

  /**
   * Operator submits a draft for admin review (draft → pending_review). Flips the
   * PG-owned head AND the public projection in one transaction so the listing
   * appears in the existing admin review queue (which reads listings.status).
   * Owner-scoped + idempotent (re-submitting a pending listing is a no-op).
   */
  async submitForReview(
    operatorId: string,
    listingId: string
  ): Promise<{ id: string; status: string }> {
    if (!isUuid(listingId)) {
      throw new NotFoundException({
        code: "listing_not_found",
        message: "listing_not_found: no PG listing with that id for this operator"
      });
    }

    if (this.db.isEnabled()) {
      const client = await this.db.getClient();
      try {
        await client.query("BEGIN");
        const upd = (await client.query(
          `UPDATE pg_listings SET status = 'pending_review'
            WHERE id = $1::uuid AND operator_user_id = $2::uuid
              AND status IN ('draft', 'pending_review')
          RETURNING id::text, status::text`,
          [listingId, operatorId]
        )) as { rowCount: number };
        if (!upd.rowCount) {
          await client.query("ROLLBACK");
          throw new NotFoundException({
            code: "listing_not_found",
            message: "listing_not_found: not your listing, or not in a submittable state"
          });
        }
        // Reflect the transition onto the public read projection.
        await client.query(
          `UPDATE listings SET status = 'pending_review', updated_at = now()
            WHERE id = $1::uuid AND listing_type = 'pg'`,
          [listingId]
        );
        await client.query("COMMIT");
        return { id: listingId, status: "pending_review" };
      } catch (e) {
        await client.query("ROLLBACK");
        throw e;
      } finally {
        client.release();
      }
    }

    // In-memory / unit-test fallback.
    const l = this.state.listings.get(listingId);
    if (!l || l.ownerUserId !== operatorId || l.listingType !== "pg") {
      throw new NotFoundException({
        code: "listing_not_found",
        message: "listing_not_found: not your listing"
      });
    }
    l.status = "pending_review";
    return { id: listingId, status: "pending_review" };
  }

  async hydrateFromVoiceDraft(draftId: string, opts: HydrateOptions): Promise<ListingResult> {
    const cached = this.state.getPgVoiceIdempotent(opts.idempotencyKey);
    if (cached) {
      return { id: cached, status: "draft" };
    }
    const draft = this.state.getPgListingDraft(draftId);
    if (!draft) {
      throw new NotFoundException({
        code: "draft_not_found",
        message: "draft_not_found: pg_listing_draft missing"
      });
    }
    const listing = await this.createDraft(
      draft.operator_user_id as string,
      draft.pg_property_id as string,
      draft.payload as PgListingPayload
    );
    this.state.updatePgListingDraftCommitted(draftId, listing.id);
    this.state.setPgVoiceIdempotent(opts.idempotencyKey, listing.id);
    return listing;
  }

  /** Cheapest room-type rent, in paise (pg_listings.starting_rent_paise — money rule). */
  private cheapestRentPaise(p: PgListingPayload): number {
    return Math.min(...p.room_types.map((rt) => rt.monthly_rent_paise));
  }

  /** Cheapest room-type rent, in rupees (listings.monthly_rent projection is rupees). */
  private cheapestRentRupees(p: PgListingPayload): number {
    return Math.round(this.cheapestRentPaise(p) / 100);
  }

  private async writePgDetails(
    exec: SqlExec,
    listingId: string,
    p: PgListingPayload
  ): Promise<void> {
    const d = p.pg_details;
    // ---------------------------------------------------------------------
    // IMPORTANT (2026-05-30 fix): every jsonb column needs an explicit
    // `::jsonb` cast on its placeholder. node-postgres serialises object/array
    // bindings to JSON *text*, and PostgreSQL has no implicit text→jsonb cast.
    // Without casts the INSERT 500s with:
    //   "column \"payment_modes\" is of type jsonb but expression is of type text"
    // Enums on the other hand DO have implicit text→enum, so those stay bare.
    // ---------------------------------------------------------------------
    await exec.query(
      `INSERT INTO pg_details
         (listing_id, total_beds, gender_policy, tenant_type, notice_period_days, lock_in_months,
          security_deposit_paise, deposit_refundable_pct, electricity_mode, maintenance_paise,
          rent_due_day, payment_modes, late_fee_policy, price_negotiable, meals, meal_charges_paise,
          amenities, house_rules, nearby, onboarding_path)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13::jsonb,$14,$15::jsonb,$16,$17::jsonb,$18::jsonb,$19::jsonb,'self_serve')
       ON CONFLICT (listing_id) DO UPDATE SET
          total_beds = EXCLUDED.total_beds,
          gender_policy = EXCLUDED.gender_policy,
          tenant_type = EXCLUDED.tenant_type,
          notice_period_days = EXCLUDED.notice_period_days,
          lock_in_months = EXCLUDED.lock_in_months,
          security_deposit_paise = EXCLUDED.security_deposit_paise,
          deposit_refundable_pct = EXCLUDED.deposit_refundable_pct,
          electricity_mode = EXCLUDED.electricity_mode,
          maintenance_paise = EXCLUDED.maintenance_paise,
          rent_due_day = EXCLUDED.rent_due_day,
          payment_modes = EXCLUDED.payment_modes,
          late_fee_policy = EXCLUDED.late_fee_policy,
          price_negotiable = EXCLUDED.price_negotiable,
          meals = EXCLUDED.meals,
          meal_charges_paise = EXCLUDED.meal_charges_paise,
          amenities = EXCLUDED.amenities,
          house_rules = EXCLUDED.house_rules,
          nearby = EXCLUDED.nearby`,
      [
        listingId,
        d.total_beds,
        d.gender_policy ?? null,
        d.tenant_type ?? null,
        d.notice_period_days ?? null,
        d.lock_in_months ?? null,
        d.security_deposit_paise ?? null,
        d.deposit_refundable_pct ?? null,
        d.electricity_mode ?? null,
        d.maintenance_paise ?? null,
        d.rent_due_day ?? null,
        JSON.stringify(d.payment_modes ?? []),
        d.late_fee_policy ? JSON.stringify(d.late_fee_policy) : null,
        d.price_negotiable ?? false,
        d.meals ? JSON.stringify(d.meals) : null,
        d.meal_charges_paise ?? null,
        JSON.stringify(d.amenities ?? {}),
        JSON.stringify(d.house_rules ?? {}),
        d.nearby ? JSON.stringify(d.nearby) : null
      ]
    );
  }

  private async writeRoomTypes(
    exec: SqlExec,
    listingId: string,
    p: PgListingPayload
  ): Promise<void> {
    for (const rt of p.room_types) {
      // Enum columns (sharing/bathroom_kind/furnishing) have implicit text→enum
      // casts so no `::` markers needed. monthly_rent_paise is bigint — node-pg
      // sends it as a JS number which fits; vacancy_count is smallint, ditto.
      await exec.query(
        `INSERT INTO pg_room_types
           (listing_id, sharing, ac, bathroom_kind, furnishing, room_size_sqft,
            monthly_rent_paise, vacancy_count, available_from)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         ON CONFLICT (listing_id, sharing, ac, bathroom_kind, furnishing) DO UPDATE SET
            monthly_rent_paise = EXCLUDED.monthly_rent_paise,
            vacancy_count = EXCLUDED.vacancy_count,
            available_from = EXCLUDED.available_from`,
        [
          listingId,
          rt.sharing,
          rt.ac,
          rt.bathroom_kind ?? "attached_western",
          rt.furnishing ?? "semi_furnished",
          null,
          rt.monthly_rent_paise,
          rt.vacancy_count,
          rt.available_from ?? null
        ]
      );
    }
  }
}
