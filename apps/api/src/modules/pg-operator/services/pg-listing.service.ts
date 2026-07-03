import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  Optional
} from "@nestjs/common";
import { DatabaseService } from "../../../common/database.service";
import { AppStateService } from "../../../common/app-state.service";
import { randomUUID } from "node:crypto";
import { PgPropertiesService } from "./pg-properties.service";
import { PgScoreService } from "./pg-score.service";
import { isMaterialChange } from "./pg-listing-material";
import type {
  PgAmenities,
  PgElectricityMode,
  PgFurnishing,
  PgGenderPolicy,
  PgHouseRules,
  PgListingPayload,
  PgMeals,
  PgNearby,
  PgProperty,
  PgSharingKind,
  PgBathroomKind,
  PgTenantType
} from "@cribliv/shared-types";

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
  /** Committed admin-verification state — for the edit-wizard score meter. */
  verification_status: string | null;
  /** True when the listing has a real pin in listing_locations (score signal). */
  has_exact_geo: boolean;
  /** Persisted composite quality score 0-100 (matches dashboard). 0 for listings not yet scored. */
  composite_score: number;
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
  // Owner-style edit hydration: structured photos with id + order so the wizard
  // can re-render existing photos and call the reorder endpoint. Mirrors the
  // owner getOwnerListing `photoItems` shape.
  photoItems: Array<{
    id: string;
    url: string;
    blob_path: string;
    sort_order: number;
    is_cover: boolean;
  }>;
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
    @Inject(PgPropertiesService) private readonly properties: PgPropertiesService,
    @Optional() private readonly scoreService?: PgScoreService
  ) {}

  async createDraft(
    operatorId: string,
    pgPropertyId: string,
    payload: PgListingPayload,
    initialStatus: "draft" | "pending_review" = "draft"
  ): Promise<ListingResult> {
    // 1 listing : 1 property — accept any property the operator owns (the fresh
    // one the controller just minted), not only the single "active" one. Still
    // ownership-scoped, so a foreign/unknown property id is rejected (IDOR).
    let prop = await this.properties.getOwnedProperty(operatorId, pgPropertyId);
    if (!prop) {
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
        // Propagate geocoords from the payload to pg_properties so projectGeo
        // uses the precise pin set in the location step (property was created
        // before geocoding in the wizard flow).
        if (payload.property.lat != null && payload.property.lng != null) {
          await client.query(`UPDATE pg_properties SET lat = $2, lng = $3 WHERE id = $1::uuid`, [
            prop.id,
            payload.property.lat,
            payload.property.lng
          ]);
          prop = { ...prop, lat: payload.property.lat, lng: payload.property.lng };
        }
        // Sync the canonical locality from the payload. The public projection
        // reads prop.locality_id, so refresh it here too — otherwise a property
        // created before the locality step keeps NULL locality and the listing
        // can't be found by locality / SEO / CriblMaps. Slug is resolved against
        // the SAME canonical `localities` set used by search + SEO.
        if (payload.property.locality_slug) {
          const locRes = (await client.query(
            `SELECT id FROM localities WHERE city_id = $1 AND slug = $2 LIMIT 1`,
            [prop.city_id, String(payload.property.locality_slug).toLowerCase()]
          )) as { rows: Array<{ id: number }> };
          const localityId = locRes.rows[0]?.id ?? null;
          if (localityId != null) {
            await client.query(`UPDATE pg_properties SET locality_id = $2 WHERE id = $1::uuid`, [
              prop.id,
              localityId
            ]);
            prop = { ...prop, locality_id: localityId };
          }
        }
        await this.writePgListingHead(client, id, operatorId, pgPropertyId, payload, initialStatus);
        await this.writePgDetails(client, id, payload);
        await this.writeRoomTypes(client, id, payload);
        await this.projectToListings(client, id, operatorId, prop, payload, initialStatus);
        await client.query("COMMIT");
        void this.recordScoreAsync(id);
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
    void this.recordScoreAsync(id);
    return { id, status: initialStatus };
  }

  // Re-score from DB truth (real photo count, verification, geo) — never from a
  // create-time snapshot. Idempotent + best-effort; failures must not break the
  // write path. Called after create, submit, and go-live.
  private async recordScoreAsync(listingId: string): Promise<void> {
    if (!this.scoreService) return;
    // BUG-M6: fire-and-forget, but a failure must surface (log) rather than vanish
    // — and this guard guarantees the `void` callsites never become an unhandled
    // rejection even if rescoreListing throws before its own internal catch.
    try {
      await this.scoreService.rescoreListing(listingId);
    } catch (e) {
      this.log.warn(
        `[pg-listings] recordScoreAsync failed listingId=${listingId}: ${(e as Error).message}`
      );
    }
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
        this.listingTitle(payload),
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
    // create passes draft/pending_review; updateListing may PRESERVE active/paused
    // on a non-material edit (cast ::listing_status in SQL accepts any enum value).
    status: string
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
       -- NOTE: verification_status is set on INSERT ('unverified') but deliberately
       -- NOT in the conflict clause. Verification is owned solely by the admin flow;
       -- an operator edit (the only path that hits this conflict) must never re-stamp
       -- it — a non-material edit on a verified+active listing has to stay verified.
       ON CONFLICT (id) DO UPDATE SET
         title_en = EXCLUDED.title_en,
         monthly_rent = EXCLUDED.monthly_rent,
         status = EXCLUDED.status,
         updated_at = now()`,
      [
        id,
        operatorId,
        this.listingTitle(payload),
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
        // BUG-M2: the public projection must NOT carry the precise building name.
        // Keep address_line1 coarse (locality/city); the real display_name lives
        // privately in pg_properties and is only revealed after a lead unlock.
        payload.property.locality_slug ?? payload.property.city_slug,
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
    // Resolve the effective coordinate: the operator's pin if set, else the locality
    // centroid. Write it to BOTH the projection (listing_locations — read by the map +
    // server score) AND the head (pg_properties), so the two never diverge. Previously
    // the centroid fallback updated only listing_locations, leaving pg_properties.lat
    // NULL → the edit wizard (which reads the head) saw "no geo" and a re-save could
    // clobber the projection's pin back to a stale value.
    let lat: number | null = prop.lat ?? null;
    let lng: number | null = prop.lng ?? null;
    if ((lat == null || lng == null) && prop.locality_id != null) {
      const c = (await exec.query(
        `SELECT lat, lng FROM localities WHERE id = $1 AND lat IS NOT NULL LIMIT 1`,
        [prop.locality_id]
      )) as { rows: Array<{ lat: number | null; lng: number | null }> };
      if (c.rows[0]?.lat != null && c.rows[0]?.lng != null) {
        lat = Number(c.rows[0].lat);
        lng = Number(c.rows[0].lng);
      }
    }
    if (lat != null && lng != null) {
      await exec.query(
        `UPDATE listing_locations SET lat = $2, lng = $3 WHERE listing_id = $1::uuid`,
        [id, lat, lng]
      );
      await exec.query(
        `UPDATE pg_properties SET lat = $2, lng = $3, updated_at = now() WHERE id = $1::uuid`,
        [prop.id, lat, lng]
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
  async listOperatorListings(operatorId: string): Promise<
    Array<{
      id: string;
      pg_property_id?: string | null;
      status: string;
      updated_at: string;
      composite_score?: number;
      title?: string | null;
      cover_photo?: string | null;
      city_slug?: string | null;
      locality_slug?: string | null;
      gender_policy?: string | null;
      total_beds?: number | null;
      starting_rent_paise?: number | null;
      total_vacancy?: number;
    }>
  > {
    if (this.db.isEnabled()) {
      const r = await this.db.query<{
        id: string;
        pg_property_id: string | null;
        status: string;
        updated_at: string;
        composite_score: number | null;
        title: string | null;
        cover_blob: string | null;
        city_slug: string | null;
        locality_slug: string | null;
        gender_policy: string | null;
        total_beds: number | null;
        starting_rent_paise: number | null;
        total_vacancy: number | null;
      }>(
        `SELECT pl.id::text, pl.pg_property_id::text AS pg_property_id,
                pl.status::text, pl.updated_at::text,
                COALESCE(ls.composite_score, 0)::float AS composite_score,
                pl.title, pl.starting_rent_paise,
                c.slug AS city_slug, loc.slug AS locality_slug,
                d.gender_policy::text AS gender_policy, d.total_beds,
                cover.blob_path AS cover_blob,
                COALESCE(vac.total_vacancy, 0)::int AS total_vacancy
         FROM pg_listings pl
         LEFT JOIN listing_scores ls ON ls.listing_id = pl.id
         LEFT JOIN pg_properties pp ON pp.id = pl.pg_property_id
         LEFT JOIN cities c ON c.id = pp.city_id
         LEFT JOIN localities loc ON loc.id = pp.locality_id
         LEFT JOIN pg_details d ON d.listing_id = pl.id
         LEFT JOIN LATERAL (
           SELECT blob_path FROM listing_photos
           WHERE listing_id = pl.id AND moderation_status != 'rejected'
           ORDER BY is_cover DESC, sort_order ASC, created_at ASC
           LIMIT 1
         ) cover ON true
         LEFT JOIN LATERAL (
           SELECT SUM(vacancy_count)::int AS total_vacancy
           FROM pg_room_types WHERE listing_id = pl.id
         ) vac ON true
         WHERE pl.operator_user_id = $1::uuid
         ORDER BY pl.created_at DESC`,
        [operatorId]
      );
      return r.rows.map((row) => ({
        id: row.id,
        pg_property_id: row.pg_property_id,
        status: row.status,
        updated_at: row.updated_at,
        composite_score:
          row.composite_score != null ? Math.round(row.composite_score * 100) : undefined,
        title: row.title,
        cover_photo: row.cover_blob ? this.toPhotoUrl(row.cover_blob) : null,
        city_slug: row.city_slug,
        locality_slug: row.locality_slug,
        gender_policy: row.gender_policy,
        total_beds: row.total_beds,
        starting_rent_paise: row.starting_rent_paise,
        total_vacancy: row.total_vacancy ?? 0
      }));
    }
    return [...this.state.listings.values()]
      .filter((l) => l.ownerUserId === operatorId && l.listingType === "pg")
      .map((l) => ({
        id: l.id,
        pg_property_id: null,
        status: l.status,
        updated_at: new Date(l.createdAt).toISOString()
      }));
  }

  /**
   * Operator-controlled listing visibility. Toggles a live listing between
   * `active` (shown on homepage/search) and `paused` (hidden), or `archived`
   * (permanently removed from public surfaces). Updates BOTH the pg_listings row
   * and the projected public `listings` row (same id) in one transaction, scoped
   * to the operator. Draft / pending_review listings can't be toggled here —
   * they go live through the submit → admin-approval path.
   */
  async setListingStatus(
    listingId: string,
    operatorId: string,
    status: "active" | "paused" | "archived"
  ): Promise<{ id: string; status: string }> {
    if (!this.db.isEnabled()) {
      throw new BadRequestException({ code: "db_unavailable", message: "Database unavailable" });
    }
    const existing = await this.db.query<{ status: string }>(
      `SELECT status::text FROM pg_listings WHERE id = $1::uuid AND operator_user_id = $2::uuid LIMIT 1`,
      [listingId, operatorId]
    );
    if (!existing.rows.length) {
      throw new NotFoundException({ code: "not_found", message: "Listing not found" });
    }
    const current = existing.rows[0].status;
    if (current === "draft" || current === "pending_review") {
      throw new BadRequestException({
        code: "not_approved",
        message: "Submit the listing for review before changing its visibility."
      });
    }

    const client = await this.db.getClient();
    try {
      await client.query("BEGIN");
      await client.query(
        `UPDATE pg_listings SET status = $2::listing_status, updated_at = now()
         WHERE id = $1::uuid AND operator_user_id = $3::uuid`,
        [listingId, status, operatorId]
      );
      await client.query(
        `UPDATE listings SET status = $2::listing_status, updated_at = now()
         WHERE id = $1::uuid AND owner_user_id = $3::uuid`,
        [listingId, status, operatorId]
      );
      await client.query("COMMIT");
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
    return { id: listingId, status };
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

    const detail = await this.loadListingDetail(
      listingId,
      `pl.id = $1::uuid AND pl.operator_user_id = $2::uuid`,
      [listingId, operatorId]
    );
    if (!detail) return null;
    // Operator manage page renders <img> directly — hand it absolute URLs too.
    return {
      ...detail,
      photos: detail.photos.map((p) => ({ ...p, blob_path: this.toPhotoUrl(p.blob_path) }))
    };
  }

  /**
   * Reconstruct the EXACT wizard payload (PgListingPayload) for a committed
   * listing so "Edit listing" can rehydrate the wizard. This is the inverse of
   * the write path (writePgDetails / writeRoomTypes / writePgListingHead +
   * property creation): every column maps back 1:1, city_id/locality_id are
   * resolved to slugs, and *_paise bigints are cast string→number (money rule).
   *
   * NOT getOperatorListingDetail — that's a lossy display DTO (drops payment
   * terms, meal_charges, maintenance, late_fee_policy, nearby, deposit pct).
   * Ownership-scoped (operator_user_id) → returns null for a non-owner / bad id.
   */
  async getEditPayload(operatorId: string, listingId: string): Promise<PgListingPayload | null> {
    if (!isUuid(listingId) || !this.db.isEnabled()) return null;

    // Head + own property, slugs resolved, ownership-scoped.
    const head = await this.db.query<{
      title: string | null;
      display_name: string;
      internal_code: string | null;
      city_slug: string;
      locality_slug: string | null;
      total_floors: number | null;
      lat: number | null;
      lng: number | null;
    }>(
      // Geo comes from the PROJECTION (listing_locations) — that's the pin the map
      // + server score read and the operator actually dropped; pg_properties.lat can
      // lag it. Reading the projection makes the wizard show the real pin and stops a
      // re-save from clobbering it back to a stale/centroid value (pin data-loss).
      `SELECT pl.title,
              p.display_name, p.internal_code,
              c.slug AS city_slug, loc.slug AS locality_slug,
              p.total_floors,
              COALESCE(ll.lat, p.lat) AS lat,
              COALESCE(ll.lng, p.lng) AS lng
         FROM pg_listings pl
         JOIN pg_properties p ON p.id = pl.pg_property_id
         JOIN cities c        ON c.id = p.city_id
         LEFT JOIN localities loc ON loc.id = p.locality_id
         LEFT JOIN listing_locations ll ON ll.listing_id = pl.id
        WHERE pl.id = $1::uuid AND pl.operator_user_id = $2::uuid
        LIMIT 1`,
      [listingId, operatorId]
    );
    const h = head.rows[0];
    if (!h) return null;

    const details = await this.db.query<Record<string, unknown>>(
      `SELECT total_beds, gender_policy::text AS gender_policy, tenant_type::text AS tenant_type,
              notice_period_days, lock_in_months, security_deposit_paise, deposit_refundable_pct,
              electricity_mode::text AS electricity_mode, maintenance_paise, rent_due_day,
              payment_modes, late_fee_policy, price_negotiable, meals, meal_charges_paise,
              amenities, house_rules, nearby
         FROM pg_details WHERE listing_id = $1::uuid LIMIT 1`,
      [listingId]
    );
    const rooms = await this.db.query<Record<string, unknown>>(
      `SELECT sharing::text AS sharing, ac, bathroom_kind::text AS bathroom_kind,
              furnishing::text AS furnishing, monthly_rent_paise, vacancy_count,
              available_from::text AS available_from
         FROM pg_room_types WHERE listing_id = $1::uuid
        ORDER BY monthly_rent_paise ASC`,
      [listingId]
    );

    return {
      title: h.title ?? null,
      property: {
        display_name: h.display_name,
        internal_code: h.internal_code ?? null,
        city_slug: h.city_slug,
        locality_slug: h.locality_slug ?? null,
        total_floors: h.total_floors == null ? null : Number(h.total_floors),
        lat: h.lat == null ? null : Number(h.lat),
        lng: h.lng == null ? null : Number(h.lng)
      },
      pg_details: this.detailsRowToPayload(details.rows[0] ?? {}),
      room_types: rooms.rows.map((r) => this.roomRowToPayload(r))
    };
  }

  /** Inverse of writePgDetails — maps a pg_details row back to the payload. */
  private detailsRowToPayload(d: Record<string, unknown>): PgListingPayload["pg_details"] {
    const num = (v: unknown): number | null => (v == null ? null : Number(v));
    return {
      total_beds: d.total_beds == null ? 0 : Number(d.total_beds),
      gender_policy: (d.gender_policy as PgGenderPolicy) ?? null,
      tenant_type: (d.tenant_type as PgTenantType) ?? null,
      security_deposit_paise: num(d.security_deposit_paise),
      deposit_refundable_pct: num(d.deposit_refundable_pct),
      price_negotiable: Boolean(d.price_negotiable),
      meals: (d.meals as PgMeals | null) ?? undefined,
      meal_charges_paise: num(d.meal_charges_paise),
      amenities: (d.amenities as PgAmenities | null) ?? undefined,
      house_rules: (d.house_rules as PgHouseRules | null) ?? undefined,
      nearby: (d.nearby as PgNearby | null) ?? undefined,
      late_fee_policy: (d.late_fee_policy as Record<string, unknown> | null) ?? null,
      // PgPaymentTerms (mixed into pg_details)
      notice_period_days: num(d.notice_period_days),
      lock_in_months: num(d.lock_in_months),
      electricity_mode: (d.electricity_mode as PgElectricityMode) ?? null,
      maintenance_paise: num(d.maintenance_paise),
      rent_due_day: num(d.rent_due_day),
      payment_modes: (d.payment_modes as Array<"upi" | "bank_transfer" | "cash">) ?? []
    };
  }

  /** Inverse of writeRoomTypes — maps a pg_room_types row back to the payload. */
  private roomRowToPayload(r: Record<string, unknown>): PgListingPayload["room_types"][number] {
    return {
      sharing: r.sharing as PgSharingKind,
      ac: Boolean(r.ac),
      bathroom_kind: (r.bathroom_kind as PgBathroomKind) ?? undefined,
      furnishing: (r.furnishing as PgFurnishing) ?? undefined,
      monthly_rent_paise: Number(r.monthly_rent_paise),
      vacancy_count: Number(r.vacancy_count),
      available_from: (r.available_from as string) ?? null
    };
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
        d.house_rules             AS house_rules,
        -- Committed signals the edit-wizard score meter needs (else it fabricates
        -- "unverified" + no-geo and shows a score that mismatches the dashboard).
        -- verification lives on the public projection (what the server score reads);
        -- has_exact_geo from listing_locations (the authoritative pin).
        lst.verification_status::text AS verification_status,
        (ll.lat IS NOT NULL)          AS has_exact_geo,
        -- Persisted quality score — same column the dashboard reads (listing_scores)
        -- so detail page and dashboard always show the identical number.
        COALESCE(ls.composite_score, 0)::float AS composite_score
      FROM pg_listings pl
      LEFT JOIN pg_properties pp ON pp.id = pl.pg_property_id
      LEFT JOIN cities c ON c.id = pp.city_id
      LEFT JOIN localities loc ON loc.id = pp.locality_id
      LEFT JOIN pg_details d ON d.listing_id = pl.id
      LEFT JOIN listings lst ON lst.id = pl.id
      LEFT JOIN listing_locations ll ON ll.listing_id = pl.id
      LEFT JOIN listing_scores ls ON ls.listing_id = pl.id
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

    const photos = await this.db.query<{
      id: string;
      blob_path: string;
      is_cover: boolean;
      sort_order: number;
    }>(
      `
      SELECT id::text AS id, blob_path, is_cover, sort_order
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
      verification_status: (h.verification_status as string) ?? null,
      has_exact_geo: Boolean(h.has_exact_geo),
      composite_score: Math.round(Number(h.composite_score ?? 0) * 100),
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
      photos: photos.rows.map((p) => ({ blob_path: p.blob_path, is_cover: Boolean(p.is_cover) })),
      photoItems: photos.rows.map((p) => ({
        id: String(p.id),
        url: this.toPhotoUrl(p.blob_path),
        blob_path: p.blob_path,
        sort_order: Number(p.sort_order),
        is_cover: Boolean(p.is_cover)
      }))
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
        // Re-score now that photos are attached (uploaded after create, before
        // submit) — the create-time score had photo_count = 0.
        void this.recordScoreAsync(listingId);
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

  /**
   * BUG-M1 — edit a COMMITTED listing in place. Re-runs the write tx against the
   * SAME listing id and its OWN property (no new listing, no new property, no
   * draft). Status follows the MATERIAL-EDIT rule (spec §2): material change →
   * pending_review; a non-material edit on a live (active/paused) listing stays
   * live; rejected/archived/pending_review always re-review. Ownership-scoped
   * (operator_user_id) → no self-go-live, no IDOR. Idempotency is the caller's.
   */
  async updateListing(
    operatorId: string,
    listingId: string,
    payload: PgListingPayload
  ): Promise<ListingResult> {
    if (!isUuid(listingId) || !this.db.isEnabled()) {
      throw new NotFoundException({
        code: "listing_not_found",
        message: "listing_not_found: no PG listing with that id for this operator"
      });
    }
    if (!payload.room_types?.length) {
      throw new BadRequestException({
        code: "no_room_types",
        message: "no_room_types: at least one room type is required"
      });
    }

    // Resolve the listing's OWN property + current status, ownership-scoped.
    const own = await this.db.query<{ pg_property_id: string; status: string }>(
      `SELECT pg_property_id::text AS pg_property_id, status::text AS status
         FROM pg_listings WHERE id = $1::uuid AND operator_user_id = $2::uuid LIMIT 1`,
      [listingId, operatorId]
    );
    const propertyId = own.rows[0]?.pg_property_id;
    const curStatus = own.rows[0]?.status;
    if (!propertyId || !curStatus) {
      throw new NotFoundException({
        code: "listing_not_found",
        message: "listing_not_found: no PG listing with that id for this operator"
      });
    }

    // MATERIAL-EDIT rule: diff incoming vs the committed "before". 'active' is
    // only ever PRESERVED on a non-material edit — never newly granted here.
    const before = await this.getEditPayload(operatorId, listingId);
    const material = !before || isMaterialChange(before, payload);
    const nextStatus =
      curStatus === "active" || curStatus === "paused"
        ? material
          ? "pending_review"
          : curStatus
        : "pending_review";

    // Resolve slugs → ids for the property update (reuse the canonical resolver;
    // throws unknown_city on a bad slug, same as create).
    const { cityId, localityId } = await this.properties.resolveLocation(
      payload.property.city_slug,
      payload.property.locality_slug ?? undefined
    );
    // The refreshed property the projection/geo step must use — built in-memory
    // (a pool re-read wouldn't see the uncommitted UPDATE inside this tx).
    const updatedProp = {
      id: propertyId,
      city_id: cityId,
      locality_id: localityId,
      lat: payload.property.lat ?? null,
      lng: payload.property.lng ?? null
    } as PgProperty;

    const client = await this.db.getClient();
    try {
      await client.query("BEGIN");

      await client.query(
        `UPDATE pg_properties
            SET display_name = $2, internal_code = $3, city_id = $4, locality_id = $5,
                total_floors = $6, lat = $7, lng = $8, updated_at = now()
          WHERE id = $1::uuid AND operator_id = $9::uuid`,
        [
          propertyId,
          payload.property.display_name,
          payload.property.internal_code ?? null,
          cityId,
          localityId,
          payload.property.total_floors ?? null,
          payload.property.lat ?? null,
          payload.property.lng ?? null,
          operatorId
        ]
      );

      // The head writer is INSERT-only, so update the head columns directly
      // (title/rent/status). verification_status is left untouched here.
      await client.query(
        `UPDATE pg_listings
            SET title = $3, starting_rent_paise = $4, status = $5::listing_status, updated_at = now()
          WHERE id = $1::uuid AND operator_user_id = $2::uuid`,
        [
          listingId,
          operatorId,
          this.listingTitle(payload),
          this.cheapestRentPaise(payload),
          nextStatus
        ]
      );

      await this.writePgDetails(client, listingId, payload);
      await this.writeRoomTypes(client, listingId, payload);
      // REPLACE semantics: writeRoomTypes upserts but never deletes — drop the
      // room types the operator removed so they don't linger.
      await this.deleteOrphanRoomTypes(client, listingId, payload);
      await this.projectToListings(client, listingId, operatorId, updatedProp, payload, nextStatus);

      await client.query("COMMIT");
    } catch (e) {
      await client.query("ROLLBACK");
      this.log.error(
        `[pg-listings] updateListing tx FAILED operatorId=${operatorId} listingId=${listingId}: ${
          (e as Error).message
        }`
      );
      throw e;
    } finally {
      client.release();
    }
    void this.recordScoreAsync(listingId);
    return { id: listingId, status: nextStatus };
  }

  /**
   * Delete room types the operator removed in this edit (writeRoomTypes upserts
   * but never deletes). Identity = the upsert conflict key
   * (sharing, ac, bathroom_kind, furnishing) using the same write-side defaults.
   */
  private async deleteOrphanRoomTypes(
    client: SqlExec,
    listingId: string,
    payload: PgListingPayload
  ): Promise<void> {
    const key = (sharing: unknown, ac: unknown, bathroom: unknown, furnishing: unknown): string =>
      `${String(sharing)}|${String(ac)}|${bathroom ?? "attached_western"}|${furnishing ?? "semi_furnished"}`;
    const keep = new Set(
      payload.room_types.map((r) => key(r.sharing, r.ac, r.bathroom_kind, r.furnishing))
    );
    const existing = (await client.query(
      `SELECT id::text AS id, sharing::text AS sharing, ac,
              bathroom_kind::text AS bathroom_kind, furnishing::text AS furnishing
         FROM pg_room_types WHERE listing_id = $1::uuid`,
      [listingId]
    )) as {
      rows: Array<{
        id: string;
        sharing: string;
        ac: boolean;
        bathroom_kind: string | null;
        furnishing: string | null;
      }>;
    };
    const orphanIds = existing.rows
      .filter((r) => !keep.has(key(r.sharing, r.ac, r.bathroom_kind, r.furnishing)))
      .map((r) => r.id);
    if (orphanIds.length) {
      await client.query(`DELETE FROM pg_room_types WHERE id = ANY($1::uuid[])`, [orphanIds]);
    }
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

  /**
   * The listing's public title. Distinct from the shared building/property name:
   * each listing carries its own title, falling back to the building name only
   * when the payload omits one (voice drafts / older clients).
   */
  private listingTitle(p: PgListingPayload): string {
    const t = typeof p.title === "string" ? p.title.trim() : "";
    return t.length > 0 ? t : p.property.display_name;
  }

  /** Cheapest room-type rent, in paise (pg_listings.starting_rent_paise — money rule). */
  private cheapestRentPaise(p: PgListingPayload): number {
    const rents = p.room_types.map((rt) => rt.monthly_rent_paise);
    return rents.length ? Math.min(...rents) : 0;
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
