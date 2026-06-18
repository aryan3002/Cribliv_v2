import { BadRequestException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { DatabaseService } from "../../common/database.service";
import { AzureBlobPhotoStorageService } from "../owner/azure-blob-photo-storage.service";
import type { PgAdminListingFull } from "@cribliv/shared-types";
import type { PgAdminDetailsPatchDto, PgAdminRoomsPutDto } from "./dto/pg-admin-edit.dto";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Admin-facing PG listing review & edit. Depends ONLY on DatabaseService — a
 * local provider that avoids importing the whole PgOperatorModule into
 * AdminModule (same rationale as PgScoreService / PgAdminPropertiesService).
 *
 * INVARIANT: every mutation runs in ONE transaction touching the PG source
 * tables AND the public projection (listings / listing_locations), plus one
 * admin_actions audit row. Mirrors PgListingService's write primitives and
 * PgAdminPropertiesService.updateProperty's audit style.
 */
@Injectable()
export class PgAdminListingEditService {
  // Same public blob base the operator/public detail uses, so admin <img> tags
  // load directly.
  private readonly photoBase = (process.env.PHOTO_PUBLIC_BASE_URL ?? "").trim().replace(/\/+$/, "");

  constructor(
    @Inject(DatabaseService) private readonly db: DatabaseService,
    @Inject(AzureBlobPhotoStorageService)
    private readonly photoStorage: AzureBlobPhotoStorageService
  ) {}

  private toPhotoUrl(blobPath: string): string {
    if (/^https?:\/\//i.test(blobPath)) return blobPath;
    if (!this.photoBase) return blobPath;
    return `${this.photoBase}/${blobPath.replace(/^\/+/, "")}`;
  }

  /**
   * Full content read model for the Details/Rooms/Photos/Location tabs.
   * Admin scope: no status / operator filter (unlike the operator/public loaders).
   */
  async getFullListing(listingId: string): Promise<PgAdminListingFull> {
    if (!UUID_RE.test(listingId) || !this.db.isEnabled()) {
      throw new NotFoundException({ code: "listing_not_found" });
    }

    const head = await this.db.query<Record<string, unknown>>(
      `
      SELECT
        pl.id::text                AS id,
        pl.status::text            AS status,
        pl.title                   AS title,
        pl.created_at::text        AS created_at,
        pp.id::text                AS property_id,
        pp.display_name            AS property_display_name,
        pp.status::text            AS property_status,
        pp.lat                     AS property_lat,
        pp.lng                     AS property_lng,
        pp.total_floors            AS property_total_floors,
        pp.internal_code           AS property_internal_code,
        c.slug                     AS city_slug,
        loc.slug                   AS locality_slug,
        d.total_beds               AS total_beds,
        d.gender_policy::text      AS gender_policy,
        d.tenant_type::text        AS tenant_type,
        d.security_deposit_paise   AS security_deposit_paise,
        d.deposit_refundable_pct   AS deposit_refundable_pct,
        d.notice_period_days       AS notice_period_days,
        d.lock_in_months           AS lock_in_months,
        d.electricity_mode::text   AS electricity_mode,
        d.maintenance_paise        AS maintenance_paise,
        d.rent_due_day             AS rent_due_day,
        d.price_negotiable         AS price_negotiable,
        d.payment_modes            AS payment_modes,
        d.meals                    AS meals,
        d.meal_charges_paise       AS meal_charges_paise,
        d.amenities                AS amenities,
        d.house_rules              AS house_rules,
        d.nearby                   AS nearby
      FROM pg_listings pl
      LEFT JOIN pg_properties pp ON pp.id = pl.pg_property_id
      LEFT JOIN cities c ON c.id = pp.city_id
      LEFT JOIN localities loc ON loc.id = pp.locality_id
      LEFT JOIN pg_details d ON d.listing_id = pl.id
      WHERE pl.id = $1::uuid
      LIMIT 1
      `,
      [listingId]
    );
    if (!head.rowCount || !head.rows[0]) {
      throw new NotFoundException({ code: "listing_not_found" });
    }
    const h = head.rows[0];

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
      moderation_status: string;
    }>(
      `
      SELECT id::text AS id, blob_path, is_cover, sort_order, moderation_status::text AS moderation_status
      FROM listing_photos
      WHERE listing_id = $1::uuid
        AND moderation_status != 'rejected'
      ORDER BY is_cover DESC, sort_order ASC, created_at ASC
      `,
      [listingId]
    );

    return {
      listing: {
        id: String(h.id),
        title: (h.title as string) ?? null,
        status: String(h.status),
        created_at: (h.created_at as string) ?? null
      },
      property: h.property_id
        ? {
            id: String(h.property_id),
            display_name: (h.property_display_name as string) ?? null,
            status: String(h.property_status),
            city_slug: (h.city_slug as string) ?? null,
            locality_slug: (h.locality_slug as string) ?? null,
            lat: h.property_lat == null ? null : Number(h.property_lat),
            lng: h.property_lng == null ? null : Number(h.property_lng),
            total_floors: h.property_total_floors == null ? null : Number(h.property_total_floors),
            internal_code: (h.property_internal_code as string) ?? null
          }
        : null,
      pg_details: {
        total_beds: h.total_beds == null ? null : Number(h.total_beds),
        gender_policy:
          (h.gender_policy as PgAdminListingFull["pg_details"]["gender_policy"]) ?? null,
        tenant_type: (h.tenant_type as PgAdminListingFull["pg_details"]["tenant_type"]) ?? null,
        security_deposit_paise:
          h.security_deposit_paise == null ? null : Number(h.security_deposit_paise),
        deposit_refundable_pct:
          h.deposit_refundable_pct == null ? null : Number(h.deposit_refundable_pct),
        notice_period_days: h.notice_period_days == null ? null : Number(h.notice_period_days),
        lock_in_months: h.lock_in_months == null ? null : Number(h.lock_in_months),
        electricity_mode:
          (h.electricity_mode as PgAdminListingFull["pg_details"]["electricity_mode"]) ?? null,
        maintenance_paise: h.maintenance_paise == null ? null : Number(h.maintenance_paise),
        rent_due_day: h.rent_due_day == null ? null : Number(h.rent_due_day),
        price_negotiable: Boolean(h.price_negotiable),
        payment_modes: (h.payment_modes as PgAdminListingFull["pg_details"]["payment_modes"]) ?? [],
        meals: (h.meals as Record<string, unknown>) ?? null,
        meal_charges_paise: h.meal_charges_paise == null ? null : Number(h.meal_charges_paise),
        amenities: (h.amenities as Record<string, unknown>) ?? {},
        house_rules: (h.house_rules as Record<string, unknown>) ?? {},
        nearby: (h.nearby as Record<string, unknown>) ?? null
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
      photos: photos.rows.map((p) => ({
        id: p.id,
        blob_path: this.toPhotoUrl(p.blob_path),
        is_cover: Boolean(p.is_cover),
        sort_order: Number(p.sort_order),
        moderation_status: p.moderation_status
      }))
    };
  }

  // ── Mutations ──────────────────────────────────────────────────────────────
  // Each runs in ONE transaction touching the PG source table(s) + (where the
  // projection depends on it) the public listings row, plus one admin_actions
  // audit row. Mirrors PgAdminPropertiesService.updateProperty.

  /**
   * Update the listing's pg_details (Details tab). The projection does NOT read
   * pg_details, so no listings/listing_locations write here. Merges the patch
   * onto the existing row (only provided keys change) and UPSERTs the full
   * column set (jsonb columns need ::jsonb casts).
   */
  async updateDetails(
    adminId: string,
    listingId: string,
    patch: PgAdminDetailsPatchDto
  ): Promise<void> {
    if (!UUID_RE.test(listingId)) throw new NotFoundException({ code: "listing_not_found" });
    if (!this.db.isEnabled()) return;

    const client = await this.db.getClient();
    try {
      await client.query("BEGIN");
      const headExists = await client.query(
        `SELECT 1 FROM pg_listings WHERE id = $1::uuid FOR UPDATE`,
        [listingId]
      );
      if (!headExists.rowCount) {
        await client.query("ROLLBACK");
        throw new NotFoundException({ code: "listing_not_found" });
      }
      const cur = await client.query<Record<string, unknown>>(
        `SELECT * FROM pg_details WHERE listing_id = $1::uuid`,
        [listingId]
      );
      const before = cur.rows[0] ?? null;
      const pick = <T>(key: string, fallback: T): T =>
        Object.prototype.hasOwnProperty.call(patch, key)
          ? ((patch as Record<string, unknown>)[key] as T)
          : ((before?.[key] as T) ?? fallback);

      const totalBeds = pick<number | null>("total_beds", null);
      if (totalBeds == null) {
        // pg_details.total_beds is NOT NULL — a patch can't clear it and there
        // must be an existing value if the row exists.
        await client.query("ROLLBACK");
        throw new BadRequestException({ code: "invalid_payload", message: "total_beds required" });
      }

      await client.query(
        `INSERT INTO pg_details
           (listing_id, total_beds, gender_policy, tenant_type, notice_period_days, lock_in_months,
            security_deposit_paise, deposit_refundable_pct, electricity_mode, maintenance_paise,
            rent_due_day, payment_modes, late_fee_policy, price_negotiable, meals, meal_charges_paise,
            amenities, house_rules, nearby, onboarding_path)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13::jsonb,$14,$15::jsonb,$16,$17::jsonb,$18::jsonb,$19::jsonb,$20)
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
          totalBeds,
          pick<string | null>("gender_policy", null),
          pick<string | null>("tenant_type", null),
          pick<number | null>("notice_period_days", null),
          pick<number | null>("lock_in_months", null),
          pick<number | null>("security_deposit_paise", null),
          pick<number | null>("deposit_refundable_pct", null),
          pick<string | null>("electricity_mode", null),
          pick<number | null>("maintenance_paise", null),
          pick<number | null>("rent_due_day", null),
          JSON.stringify(pick<string[]>("payment_modes", [])),
          before?.late_fee_policy ? JSON.stringify(before.late_fee_policy) : null,
          pick<boolean>("price_negotiable", false),
          (() => {
            const m = pick<Record<string, unknown> | null>("meals", null);
            return m ? JSON.stringify(m) : null;
          })(),
          pick<number | null>("meal_charges_paise", null),
          JSON.stringify(pick<Record<string, unknown>>("amenities", {})),
          JSON.stringify(pick<Record<string, unknown>>("house_rules", {})),
          (() => {
            const n = pick<Record<string, unknown> | null>("nearby", null);
            return n ? JSON.stringify(n) : null;
          })(),
          (before?.onboarding_path as string) ?? "self_serve"
        ]
      );

      // Per-listing title lives on the head, not pg_details — update it AND the
      // public projection (listings.title_en) in the same transaction so cards /
      // search / detail stay consistent.
      if (typeof patch.title === "string" && patch.title.trim().length >= 2) {
        const t = patch.title.trim();
        await client.query(`UPDATE pg_listings SET title = $2 WHERE id = $1::uuid`, [listingId, t]);
        await client.query(
          `UPDATE listings SET title_en = $2, updated_at = now()
            WHERE id = $1::uuid AND listing_type = 'pg'`,
          [listingId, t]
        );
      }

      await this.audit(client, adminId, "listing", listingId, "edit_pg_property", before, patch);
      await client.query("COMMIT");
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
  }

  /**
   * Replace the full room-type set (Rooms tab). Recomputes starting rent and
   * projects it to the public listings row so cards/search show the new price.
   * Delete-all-then-insert inside the txn (UNIQUE key prevents dupes).
   */
  async updateRooms(
    adminId: string,
    listingId: string,
    rooms: PgAdminRoomsPutDto["rooms"]
  ): Promise<{ id: string; starting_rent_paise: number }> {
    if (!UUID_RE.test(listingId)) throw new NotFoundException({ code: "listing_not_found" });
    if (!rooms.length) throw new BadRequestException({ code: "no_room_types" });
    if (!this.db.isEnabled()) return { id: listingId, starting_rent_paise: 0 };

    const startingPaise = Math.min(...rooms.map((r) => r.monthly_rent_paise));

    const client = await this.db.getClient();
    try {
      await client.query("BEGIN");
      const head = await client.query(`SELECT 1 FROM pg_listings WHERE id = $1::uuid FOR UPDATE`, [
        listingId
      ]);
      if (!head.rowCount) {
        await client.query("ROLLBACK");
        throw new NotFoundException({ code: "listing_not_found" });
      }
      const before = await client.query(
        `SELECT sharing::text, ac, bathroom_kind::text, furnishing::text,
                monthly_rent_paise, vacancy_count, available_from::text
         FROM pg_room_types WHERE listing_id = $1::uuid`,
        [listingId]
      );

      await client.query(`DELETE FROM pg_room_types WHERE listing_id = $1::uuid`, [listingId]);
      for (const rt of rooms) {
        await client.query(
          `INSERT INTO pg_room_types
             (listing_id, sharing, ac, bathroom_kind, furnishing, room_size_sqft,
              monthly_rent_paise, vacancy_count, available_from)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
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

      // Source head (paise) + public projection (rupees) must agree.
      await client.query(`UPDATE pg_listings SET starting_rent_paise = $2 WHERE id = $1::uuid`, [
        listingId,
        startingPaise
      ]);
      await client.query(
        `UPDATE listings SET monthly_rent = $2, updated_at = now()
          WHERE id = $1::uuid AND listing_type = 'pg'`,
        [listingId, Math.round(startingPaise / 100)]
      );

      await this.audit(
        client,
        adminId,
        "listing",
        listingId,
        "edit_pg_property",
        { rooms: before.rows },
        { rooms, starting_rent_paise: startingPaise }
      );
      await client.query("COMMIT");
      return { id: listingId, starting_rent_paise: startingPaise };
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
  }

  // ── Photos ─────────────────────────────────────────────────────────────────
  // Operate on the shared listing_photos table. Reuses the same Azure SAS
  // provider the operator flow uses. Admin uploads are trusted → committed as
  // 'approved' so they surface immediately.

  private async assertListingExists(listingId: string): Promise<void> {
    if (!UUID_RE.test(listingId)) throw new NotFoundException({ code: "listing_not_found" });
    const r = await this.db.query(`SELECT 1 FROM pg_listings WHERE id = $1::uuid`, [listingId]);
    if (!r.rowCount) throw new NotFoundException({ code: "listing_not_found" });
  }

  async presignPhotos(
    listingId: string,
    files: Array<{ clientUploadId: string; contentType: string; sizeBytes: number }>
  ): Promise<{ uploads: Array<{ clientUploadId: string; uploadUrl: string; blobPath: string }> }> {
    if (!this.db.isEnabled()) return { uploads: [] };
    await this.assertListingExists(listingId);
    if (!files.length)
      throw new BadRequestException({
        code: "validation_error",
        message: "At least one file is required"
      });
    if (files.length > 30)
      throw new BadRequestException({
        code: "validation_error",
        message: "Maximum 30 files per request"
      });

    const seen = new Set<string>();
    const uploads = files.map((f) => {
      const id = String(f.clientUploadId ?? "").trim();
      if (!id)
        throw new BadRequestException({
          code: "validation_error",
          message: "clientUploadId is required"
        });
      if (seen.has(id))
        throw new BadRequestException({
          code: "duplicate_client_upload_id",
          message: `Duplicate clientUploadId: ${id}`
        });
      seen.add(id);
      this.photoStorage.validatePresignRequest(f.contentType, Number(f.sizeBytes));
      const target = this.photoStorage.createUploadTarget({
        listingId,
        clientUploadId: f.clientUploadId,
        contentType: f.contentType
      });
      return {
        clientUploadId: f.clientUploadId,
        uploadUrl: target.uploadUrl,
        blobPath: target.blobPath
      };
    });
    return { uploads };
  }

  async commitPhotos(
    adminId: string,
    listingId: string,
    photos: Array<{ clientUploadId: string; blobPath: string; isCover: boolean; sortOrder: number }>
  ): Promise<{ committed: number }> {
    if (!this.db.isEnabled()) return { committed: 0 };
    await this.assertListingExists(listingId);
    if (!photos.length)
      throw new BadRequestException({
        code: "validation_error",
        message: "At least one photo is required"
      });

    await Promise.all(
      photos.map((p) => this.photoStorage.validateUploadedBlob(listingId, p.blobPath))
    );

    const client = await this.db.getClient();
    try {
      await client.query("BEGIN");
      for (const p of photos) {
        await client.query(
          `INSERT INTO listing_photos (listing_id, blob_path, sort_order, is_cover, moderation_status, client_upload_id)
           VALUES ($1::uuid, $2, $3, $4, 'approved', $5)
           ON CONFLICT (listing_id, client_upload_id) DO UPDATE SET
             blob_path = EXCLUDED.blob_path, sort_order = EXCLUDED.sort_order,
             is_cover = EXCLUDED.is_cover, updated_at = now()`,
          [listingId, p.blobPath, p.sortOrder, p.isCover, p.clientUploadId]
        );
      }
      await this.normalizeCover(client, listingId);
      await this.audit(
        client,
        adminId,
        "listing",
        listingId,
        "edit_pg_property",
        { op: "commit" },
        { count: photos.length }
      );
      await client.query("COMMIT");
      return { committed: photos.length };
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
  }

  async reorderPhotos(
    adminId: string,
    listingId: string,
    items: Array<{ id: string; sort_order: number; is_cover: boolean }>
  ): Promise<{ items: Array<{ id: string; sort_order: number; is_cover: boolean }> }> {
    if (!this.db.isEnabled()) return { items: [] };
    await this.assertListingExists(listingId);
    const client = await this.db.getClient();
    try {
      await client.query("BEGIN");
      for (const it of items) {
        await client.query(
          `UPDATE listing_photos SET sort_order = $3, is_cover = $4, updated_at = now()
            WHERE id = $1::uuid AND listing_id = $2::uuid`,
          [it.id, listingId, it.sort_order, it.is_cover]
        );
      }
      await this.normalizeCover(client, listingId);
      await this.audit(
        client,
        adminId,
        "listing",
        listingId,
        "edit_pg_property",
        { op: "reorder" },
        { items }
      );
      await client.query("COMMIT");
      return { items };
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
  }

  async deletePhoto(
    adminId: string,
    listingId: string,
    photoId: string
  ): Promise<{ deleted: boolean }> {
    if (!this.db.isEnabled()) return { deleted: false };
    if (!UUID_RE.test(listingId) || !UUID_RE.test(photoId)) {
      throw new NotFoundException({ code: "photo_not_found" });
    }
    const client = await this.db.getClient();
    try {
      await client.query("BEGIN");
      const del = (await client.query(
        `DELETE FROM listing_photos WHERE id = $1::uuid AND listing_id = $2::uuid
         RETURNING is_cover`,
        [photoId, listingId]
      )) as { rowCount: number; rows: Array<{ is_cover: boolean }> };
      if (!del.rowCount) {
        await client.query("ROLLBACK");
        throw new NotFoundException({ code: "photo_not_found" });
      }
      // If the cover was removed, promote the lowest-sort remaining photo.
      await this.normalizeCover(client, listingId);
      await this.audit(
        client,
        adminId,
        "listing",
        listingId,
        "edit_pg_property",
        { op: "delete", photoId },
        null
      );
      await client.query("COMMIT");
      // Note: the Azure blob is intentionally left (no delete API on the storage
      // provider); the photo is gone from every read surface (listing_photos).
      return { deleted: true };
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
  }

  /** Guarantee exactly one cover when photos exist (lowest sort_order wins). */
  private async normalizeCover(
    client: { query: (text: string, params?: unknown[]) => Promise<unknown> },
    listingId: string
  ): Promise<void> {
    const r = (await client.query(
      `SELECT id::text AS id, is_cover FROM listing_photos
        WHERE listing_id = $1::uuid AND moderation_status <> 'rejected'
        ORDER BY is_cover DESC, sort_order ASC, created_at ASC`,
      [listingId]
    )) as { rows: Array<{ id: string; is_cover: boolean }> };
    if (r.rows.length === 0) return;
    const coverId = r.rows[0].id;
    await client.query(
      `UPDATE listing_photos
          SET is_cover = (id = $2::uuid), updated_at = now()
        WHERE listing_id = $1::uuid`,
      [listingId, coverId]
    );
  }

  /** One audit row per mutation, matching PgAdminPropertiesService.updateProperty. */
  private async audit(
    client: { query: (text: string, params?: unknown[]) => Promise<unknown> },
    adminId: string,
    targetType: string,
    targetId: string,
    action: string,
    before: unknown,
    after: unknown
  ): Promise<void> {
    await client.query(
      `INSERT INTO admin_actions (admin_user_id, target_type, target_id, action, reason, before_state, after_state)
       VALUES ($1::uuid, $2, $3::uuid, $4, NULL, $5::jsonb, $6::jsonb)`,
      [
        adminId,
        targetType,
        targetId,
        action,
        JSON.stringify(before ?? null),
        JSON.stringify(after ?? null)
      ]
    );
  }
}
