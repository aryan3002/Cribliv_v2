import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException
} from "@nestjs/common";
import { randomUUID } from "crypto";
import { AppStateService } from "../../common/app-state.service";
import { DatabaseService } from "../../common/database.service";
import { NotificationService } from "../notifications/notification.service";
import { logTelemetry } from "../../common/telemetry";
import { toBlobUrl } from "../../common/photo-url";
import { readFeatureFlags } from "../../config/feature-flags";
import { AzureBlobPhotoStorageService } from "./azure-blob-photo-storage.service";

@Injectable()
export class OwnerService {
  constructor(
    @Inject(AppStateService) private readonly appState: AppStateService,
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(NotificationService) private readonly notifications: NotificationService,
    @Inject(AzureBlobPhotoStorageService)
    private readonly photoStorage: AzureBlobPhotoStorageService
  ) {}

  async listOwnerListings(
    ownerUserId: string,
    status?: string
  ): Promise<{ items: Array<Record<string, unknown>>; total: number }> {
    if (this.database.isEnabled()) {
      const params: unknown[] = [ownerUserId];
      const statusClause = status ? "AND l.status = $2::listing_status" : "";
      if (status) {
        params.push(status);
      }

      const result = await this.database.query<{
        id: string;
        listing_type: "flat_house" | "pg";
        title: string;
        city: string;
        locality: string | null;
        monthly_rent: number;
        verification_status: "unverified" | "pending" | "verified" | "failed";
        status: "draft" | "pending_review" | "active" | "rejected" | "paused" | "archived";
        created_at: string;
        photos: string[] | null;
        is_available: boolean;
        waitlist_count: number;
      }>(
        `
        SELECT
          l.id::text,
          l.listing_type::text,
          COALESCE(NULLIF(l.title_en, ''), NULLIF(l.title_hi, ''), 'Listing') AS title,
          c.slug AS city,
          loc.slug AS locality,
          l.monthly_rent,
          l.verification_status::text,
          l.status::text,
          l.created_at::text,
          l.is_available,
          (SELECT count(*) FROM listing_availability_alerts a
             WHERE a.listing_id = l.id AND a.status IN ('waiting','ready'))::int AS waitlist_count,
          COALESCE(
            (
              SELECT json_agg(lp.blob_path ORDER BY lp.is_cover DESC, lp.sort_order ASC, lp.created_at ASC)
              FROM listing_photos lp
              WHERE lp.listing_id = l.id
                AND lp.moderation_status <> 'rejected'
            ),
            '[]'::json
          ) AS photos
        FROM listings l
        JOIN listing_locations ll ON ll.listing_id = l.id
        JOIN cities c ON c.id = ll.city_id
        LEFT JOIN localities loc ON loc.id = ll.locality_id
        WHERE l.owner_user_id = $1::uuid
        ${statusClause}
        ORDER BY l.created_at DESC
        `,
        params
      );

      return {
        items: result.rows.map((row) => {
          const photoUrls = (row.photos ?? [])
            .map((path) => toBlobUrl(path))
            .filter((url): url is string => Boolean(url));
          return {
            id: row.id,
            ownerUserId,
            listingType: row.listing_type,
            title: row.title,
            city: row.city,
            locality: row.locality ?? undefined,
            monthlyRent: Number(row.monthly_rent),
            verificationStatus: row.verification_status,
            status: row.status,
            createdAt: new Date(row.created_at).getTime(),
            photos: photoUrls,
            coverImage: photoUrls[0] ?? null,
            is_available: row.is_available,
            waitlist_count: Number(row.waitlist_count)
          };
        }),
        total: result.rowCount ?? 0
      };
    }

    const items = [...this.appState.listings.values()].filter(
      (l) => l.ownerUserId === ownerUserId && (!status || l.status === status)
    );

    return {
      items: items.map((item) => ({
        ...item,
        is_available: item.is_available ?? true,
        waitlist_count: this.appState
          .listAvailabilityAlerts(item.id)
          .filter((a) => a.status === "waiting" || a.status === "ready").length
      })) as Array<Record<string, unknown>>,
      total: items.length
    };
  }

  async getOwnerListing(ownerUserId: string, listingId: string): Promise<Record<string, unknown>> {
    if (this.database.isEnabled()) {
      const result = await this.database.query(
        `
        SELECT
          l.id::text,
          l.listing_type::text,
          COALESCE(NULLIF(l.title_en, ''), NULLIF(l.title_hi, ''), 'Listing') AS title,
          l.description_en AS description,
          c.slug AS city,
          loc.slug AS locality,
          l.monthly_rent,
          l.security_deposit,
          l.bhk,
          l.bathrooms,
          l.area_sqft,
          l.furnishing::text,
          l.preferred_tenant::text,
          l.amenities,
          l.verification_status::text,
          l.status::text,
          l.created_at::text,
          l.is_available,
          (SELECT count(*) FROM listing_availability_alerts a
             WHERE a.listing_id = l.id AND a.status IN ('waiting','ready'))::int AS waitlist_count,
          ll.address_line1,
          ll.landmark,
          ll.pincode,
          ll.masked_address,
          ll.lat::float8 AS lat,
          ll.lng::float8 AS lng,
          pg.total_beds,
          pg.occupancy_type::text AS occupancy_type,
          pg.room_sharing_options,
          pg.food_included,
          pg.curfew_time::text AS curfew_time,
          pg.attached_bathroom,
          COALESCE(
            (
              SELECT json_agg(
                json_build_object(
                  'id', lp.id::text,
                  'blob_path', lp.blob_path,
                  'sort_order', lp.sort_order,
                  'is_cover', lp.is_cover
                )
                ORDER BY lp.is_cover DESC, lp.sort_order ASC, lp.created_at ASC
              )
              FROM listing_photos lp
              WHERE lp.listing_id = l.id
                AND lp.moderation_status <> 'rejected'
            ),
            '[]'::json
          ) AS photo_items
        FROM listings l
        JOIN listing_locations ll ON ll.listing_id = l.id
        JOIN cities c ON c.id = ll.city_id
        LEFT JOIN localities loc ON loc.id = ll.locality_id
        LEFT JOIN pg_details pg ON pg.listing_id = l.id
        WHERE l.owner_user_id = $1::uuid
          AND l.id = $2::uuid
        LIMIT 1
        `,
        [ownerUserId, listingId]
      );

      if (!result.rowCount || !result.rows[0]) {
        throw new NotFoundException({ code: "not_found", message: "Listing not found" });
      }

      const row = result.rows[0];
      const rawPhotoItems: Array<{
        id: string;
        blob_path: string;
        sort_order: number;
        is_cover: boolean;
      }> = Array.isArray(row.photo_items) ? row.photo_items : [];
      const photoItems = rawPhotoItems
        .map((item) => {
          const url = toBlobUrl(item.blob_path);
          if (!url) return null;
          return {
            id: item.id,
            url,
            blob_path: item.blob_path,
            sort_order: Number(item.sort_order ?? 0),
            is_cover: Boolean(item.is_cover)
          };
        })
        .filter(
          (
            value
          ): value is {
            id: string;
            url: string;
            blob_path: string;
            sort_order: number;
            is_cover: boolean;
          } => value !== null
        );
      const photoUrls = photoItems.map((item) => item.url);

      return {
        id: row.id,
        ownerUserId,
        listingType: row.listing_type,
        title: row.title,
        description: row.description,
        city: row.city,
        locality: row.locality ?? undefined,
        monthlyRent: row.monthly_rent ? Number(row.monthly_rent) : undefined,
        securityDeposit: row.security_deposit ? Number(row.security_deposit) : undefined,
        bhk: row.bhk ? Number(row.bhk) : undefined,
        bathrooms: row.bathrooms ? Number(row.bathrooms) : undefined,
        areaSqft: row.area_sqft ? Number(row.area_sqft) : undefined,
        furnishing: row.furnishing ?? undefined,
        preferredTenant: row.preferred_tenant ?? undefined,
        amenities: row.amenities ?? [],
        verificationStatus: row.verification_status,
        status: row.status,
        createdAt: new Date(row.created_at as string).getTime(),
        is_available: Boolean(row.is_available),
        waitlist_count: Number(row.waitlist_count),
        addressLine1: row.address_line1 ?? undefined,
        landmark: row.landmark ?? undefined,
        pincode: row.pincode ?? undefined,
        maskedAddress: row.masked_address ?? undefined,
        lat: row.lat != null ? Number(row.lat) : undefined,
        lng: row.lng != null ? Number(row.lng) : undefined,
        totalBeds: row.total_beds ? Number(row.total_beds) : undefined,
        occupancyType: row.occupancy_type ?? undefined,
        roomSharingOptions: row.room_sharing_options ?? [],
        foodIncluded: row.food_included ?? undefined,
        curfewTime: row.curfew_time ?? undefined,
        attachedBathroom: row.attached_bathroom ?? undefined,
        photos: photoUrls,
        photoItems,
        coverImage: photoUrls[0] ?? null
      };
    }

    const listing = this.appState.listings.get(listingId);
    if (!listing || listing.ownerUserId !== ownerUserId) {
      throw new NotFoundException({ code: "not_found", message: "Listing not found" });
    }

    const meta = (listing as any).meta ?? {};
    return {
      id: listing.id,
      ownerUserId,
      listingType: listing.listingType,
      title: listing.title,
      description: meta.description,
      city: listing.city,
      locality: listing.locality,
      monthlyRent: listing.monthlyRent,
      securityDeposit: meta.deposit ? Number(meta.deposit) : undefined,
      bhk: meta.property_fields?.bhk ? Number(meta.property_fields.bhk) : undefined,
      bathrooms: meta.property_fields?.bathrooms
        ? Number(meta.property_fields.bathrooms)
        : undefined,
      areaSqft: meta.property_fields?.area_sqft
        ? Number(meta.property_fields.area_sqft)
        : undefined,
      furnishing: listing.furnishing,
      preferredTenant: meta.property_fields?.preferred_tenant,
      amenities: listing.amenities ?? [],
      verificationStatus: listing.verificationStatus,
      status: listing.status,
      createdAt: listing.createdAt,
      is_available: listing.is_available ?? true,
      waitlist_count: this.appState
        .listAvailabilityAlerts(listing.id)
        .filter((a) => a.status === "waiting" || a.status === "ready").length,
      addressLine1: meta.location?.address_line1,
      landmark: meta.location?.landmark,
      pincode: meta.location?.pincode,
      maskedAddress: meta.location?.masked_address,
      totalBeds: meta.pg_fields?.total_beds ? Number(meta.pg_fields.total_beds) : undefined,
      occupancyType: meta.pg_fields?.occupancy_type,
      roomSharingOptions: meta.pg_fields?.room_sharing_options ?? [],
      foodIncluded: meta.pg_fields?.food_included,
      curfewTime: meta.pg_fields?.curfew_time,
      attachedBathroom: meta.pg_fields?.attached_bathroom,
      photos: [],
      photoItems: [],
      coverImage: null
    };
  }

  /**
   * Create a (flat/house) listing. Opens and manages its own transaction.
   * PG-unaware: PG owns its own write path (PgListingService) since the split.
   */
  async createListing(ownerUserId: string, body: any) {
    if (!body.listing_type || !body.title || !body.rent || !body.location?.city) {
      throw new BadRequestException({
        code: "validation_error",
        message: "listing_type, title, rent, and location.city are required"
      });
    }

    if (this.database.isEnabled()) {
      const client = await this.database.getClient();
      try {
        await client.query("BEGIN");

        const city = String(body.location.city).toLowerCase();
        const cityResult = await client.query<{ id: number }>(
          `
          SELECT id
          FROM cities
          WHERE slug = $1
          LIMIT 1
          `,
          [city]
        );
        if (!cityResult.rowCount) {
          throw new BadRequestException({ code: "validation_error", message: "Unknown city" });
        }

        let localityId: number | null = null;
        if (body.location.locality) {
          const locality = await client.query<{ id: number }>(
            `
            SELECT id
            FROM localities
            WHERE city_id = $1
              AND slug = $2
            LIMIT 1
            `,
            [cityResult.rows[0].id, String(body.location.locality).toLowerCase()]
          );
          localityId = locality.rows[0]?.id ?? null;
        }

        const ownerContact = await client.query<{ phone_e164: string; whatsapp_opt_in: boolean }>(
          `
          SELECT phone_e164, whatsapp_opt_in
          FROM users
          WHERE id = $1::uuid
          LIMIT 1
          `,
          [ownerUserId]
        );

        const listingResult = await client.query<{ id: string; status: string }>(
          `
          INSERT INTO listings(
            owner_user_id,
            listing_type,
            title_en,
            description_en,
            status,
            verification_status,
            monthly_rent,
            security_deposit,
            bhk,
            bathrooms,
            area_sqft,
            furnishing,
            preferred_tenant,
            contact_phone_encrypted,
            whatsapp_available,
            amenities
          )
          VALUES (
            $1::uuid,
            $2::listing_type,
            $3,
            $4,
            'draft',
            'unverified',
            $5,
            $6,
            $7,
            $8,
            $9,
            $10::furnishing_type,
            $11::tenant_pref,
            $12,
            $13,
            $14::jsonb
          )
          RETURNING id::text, status::text
          `,
          [
            ownerUserId,
            body.listing_type,
            String(body.title),
            body.description ? String(body.description) : null,
            Number(body.rent),
            body.deposit ? Number(body.deposit) : null,
            body.property_fields?.bhk ? Number(body.property_fields.bhk) : null,
            body.property_fields?.bathrooms ? Number(body.property_fields.bathrooms) : null,
            body.property_fields?.area_sqft ? Number(body.property_fields.area_sqft) : null,
            body.property_fields?.furnishing ?? null,
            body.property_fields?.preferred_tenant ?? null,
            ownerContact.rows[0]?.phone_e164 ?? null,
            ownerContact.rows[0]?.whatsapp_opt_in ?? false,
            // listings.amenities is `jsonb NOT NULL DEFAULT '[]'::jsonb`. Passing
            // explicit `null` overrode the default and crashed with a NOT NULL
            // violation whenever the caller omitted amenities. Default to '[]'
            // so the column always gets a valid jsonb.
            JSON.stringify(body.amenities ?? [])
          ]
        );

        const listingId = listingResult.rows[0].id;
        const locLat = body.location.lat ?? null;
        const locLng = body.location.lng ?? null;
        const hasGeo = locLat != null && locLng != null;

        await client.query(
          `
          INSERT INTO listing_locations(
            listing_id,
            city_id,
            locality_id,
            address_line1,
            landmark,
            pincode,
            lat,
            lng,
            masked_address
          )
          VALUES (
            $1::uuid, $2, $3, $4, $5, $6, $7, $8, $9
          )
          `,
          [
            listingId,
            cityResult.rows[0].id,
            localityId,
            body.location.address_line1 ?? `${city} property`,
            body.location.landmark ?? null,
            body.location.pincode ?? null,
            locLat,
            locLng,
            body.location.masked_address ?? `${body.location.locality ?? city}`
          ]
        );

        if (hasGeo) {
          await client.query("SAVEPOINT before_geo_point");
          try {
            await client.query(
              `UPDATE listing_locations SET geo_point = ST_SetSRID(ST_MakePoint($1::float8, $2::float8), 4326)::geography WHERE listing_id = $3::uuid`,
              [locLng, locLat, listingId]
            );
            await client.query("RELEASE SAVEPOINT before_geo_point");
          } catch {
            await client.query("ROLLBACK TO SAVEPOINT before_geo_point");
          }
        } else if (localityId) {
          // Fallback: approximate from locality centroid so listing appears on map
          await client.query("SAVEPOINT before_centroid");
          try {
            await client.query(
              `UPDATE listing_locations ll
               SET lat = loc.lat, lng = loc.lng
               FROM localities loc
               WHERE ll.listing_id = $1::uuid
                 AND loc.id = $2
                 AND loc.lat IS NOT NULL`,
              [listingId, localityId]
            );
            // Also set geo_point if PostGIS is available
            await client.query(
              `UPDATE listing_locations
               SET geo_point = ST_SetSRID(ST_MakePoint(lng::float8, lat::float8), 4326)::geography
               WHERE listing_id = $1::uuid
                 AND lat IS NOT NULL AND lng IS NOT NULL
                 AND geo_point IS NULL`,
              [listingId]
            );
            await client.query("RELEASE SAVEPOINT before_centroid");
          } catch {
            await client.query("ROLLBACK TO SAVEPOINT before_centroid");
          }
        }

        if (body.listing_type === "pg" && body.pg_fields?.total_beds) {
          const totalBeds = Number(body.pg_fields.total_beds);
          await client.query(
            `
            INSERT INTO pg_details(
              listing_id,
              total_beds,
              occupancy_type,
              room_sharing_options,
              food_included,
              curfew_time,
              attached_bathroom,
              onboarding_path
            )
            VALUES (
              $1::uuid,
              $2,
              $3::occupancy_type,
              $4::jsonb,
              $5,
              $6,
              $7,
              $8::pg_onboarding_path
            )
            `,
            [
              listingId,
              totalBeds,
              body.pg_fields.occupancy_type ?? null,
              JSON.stringify(body.pg_fields.room_sharing_options ?? []),
              Boolean(body.pg_fields.food_included ?? false),
              body.pg_fields.curfew_time ?? null,
              Boolean(body.pg_fields.attached_bathroom ?? false),
              totalBeds <= 29 ? "self_serve" : "sales_assist"
            ]
          );
        }

        await client.query("COMMIT");
        return { listing_id: listingResult.rows[0].id, status: listingResult.rows[0].status };
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    }

    const listing = {
      id: randomUUID(),
      ownerUserId,
      listingType: body.listing_type,
      title: body.title,
      city: String(body.location.city).toLowerCase(),
      locality: body.location.locality ?? undefined,
      monthlyRent: Number(body.rent),
      furnishing: body.property_fields?.furnishing ?? undefined,
      verificationStatus: "unverified" as const,
      status: "draft" as const,
      createdAt: Date.now(),
      meta: body,
      amenities: body.amenities ?? []
    };

    this.appState.listings.set(listing.id, listing);
    return { listing_id: listing.id, status: listing.status };
  }

  async updateListing(ownerUserId: string, listingId: string, body: any) {
    if (this.database.isEnabled()) {
      const client = await this.database.getClient();
      try {
        await client.query("BEGIN");
        const existing = await client.query<{ id: string }>(
          `
          SELECT id::text
          FROM listings
          WHERE id = $1::uuid
            AND owner_user_id = $2::uuid
          LIMIT 1
          FOR UPDATE
          `,
          [listingId, ownerUserId]
        );

        if (!existing.rowCount) {
          throw new NotFoundException({ code: "not_found", message: "Listing not found" });
        }

        const listingUpdate = await client.query<{ status: string }>(
          `
          UPDATE listings
          SET
            title_en = COALESCE($3, title_en),
            description_en = COALESCE($4, description_en),
            monthly_rent = COALESCE($5, monthly_rent),
            security_deposit = COALESCE($6, security_deposit),
            bhk = COALESCE($7, bhk),
            bathrooms = COALESCE($8, bathrooms),
            area_sqft = COALESCE($9, area_sqft),
            furnishing = COALESCE($10::furnishing_type, furnishing),
            preferred_tenant = COALESCE($11::tenant_pref, preferred_tenant),
            amenities = COALESCE($12::jsonb, amenities),
            updated_at = now()
          WHERE id = $1::uuid
            AND owner_user_id = $2::uuid
          RETURNING status::text
          `,
          [
            listingId,
            ownerUserId,
            body.title ? String(body.title) : null,
            body.description ? String(body.description) : null,
            body.rent ? Number(body.rent) : null,
            body.deposit ? Number(body.deposit) : null,
            body.property_fields?.bhk ? Number(body.property_fields.bhk) : null,
            body.property_fields?.bathrooms ? Number(body.property_fields.bathrooms) : null,
            body.property_fields?.area_sqft ? Number(body.property_fields.area_sqft) : null,
            body.property_fields?.furnishing ?? null,
            body.property_fields?.preferred_tenant ?? null,
            // listings.amenities is `jsonb NOT NULL DEFAULT '[]'::jsonb`. Passing
            // explicit `null` overrode the default and crashed with a NOT NULL
            // violation whenever the caller omitted amenities — the standard PG
            // operator wizard case, since PG amenities live on pg_details, not
            // listings. Default to '[]' so the column gets a valid jsonb.
            JSON.stringify(body.amenities ?? [])
          ]
        );

        if (body.location?.city || body.location?.locality || body.location?.address_line1) {
          let cityId: number | null = null;
          if (body.location?.city) {
            const cityResult = await client.query<{ id: number }>(
              `SELECT id FROM cities WHERE slug = $1 LIMIT 1`,
              [String(body.location.city).toLowerCase()]
            );
            cityId = cityResult.rows[0]?.id ?? null;
          }

          let localityId: number | null = null;
          if (cityId && body.location?.locality) {
            const locality = await client.query<{ id: number }>(
              `
              SELECT id
              FROM localities
              WHERE city_id = $1
                AND slug = $2
              LIMIT 1
              `,
              [cityId, String(body.location.locality).toLowerCase()]
            );
            localityId = locality.rows[0]?.id ?? null;
          }

          const updateLat = body.location.lat ?? null;
          const updateLng = body.location.lng ?? null;
          const hasUpdateGeo = updateLat != null && updateLng != null;

          await client.query(
            `
            UPDATE listing_locations
            SET
              city_id = COALESCE($2, city_id),
              locality_id = COALESCE($3, locality_id),
              address_line1 = COALESCE($4, address_line1),
              landmark = COALESCE($5, landmark),
              pincode = COALESCE($6, pincode),
              lat = COALESCE($7, lat),
              lng = COALESCE($8, lng),
              masked_address = COALESCE($9, masked_address),
              updated_at = now()
            WHERE listing_id = $1::uuid
            `,
            [
              listingId,
              cityId,
              localityId,
              body.location.address_line1 ?? null,
              body.location.landmark ?? null,
              body.location.pincode ?? null,
              updateLat,
              updateLng,
              body.location.masked_address ?? null
            ]
          );

          if (hasUpdateGeo) {
            await client.query("SAVEPOINT before_geo_point");
            try {
              await client.query(
                `UPDATE listing_locations SET geo_point = ST_SetSRID(ST_MakePoint($1::float8, $2::float8), 4326)::geography WHERE listing_id = $3::uuid`,
                [updateLng, updateLat, listingId]
              );
              await client.query("RELEASE SAVEPOINT before_geo_point");
            } catch {
              await client.query("ROLLBACK TO SAVEPOINT before_geo_point");
            }
          } else if (localityId) {
            // Fallback: approximate from locality centroid on update
            await client.query("SAVEPOINT before_centroid");
            try {
              await client.query(
                `UPDATE listing_locations ll
                 SET lat = COALESCE(ll.lat, loc.lat),
                     lng = COALESCE(ll.lng, loc.lng)
                 FROM localities loc
                 WHERE ll.listing_id = $1::uuid
                   AND loc.id = $2
                   AND loc.lat IS NOT NULL
                   AND ll.lat IS NULL`,
                [listingId, localityId]
              );
              await client.query(
                `UPDATE listing_locations
                 SET geo_point = ST_SetSRID(ST_MakePoint(lng::float8, lat::float8), 4326)::geography
                 WHERE listing_id = $1::uuid
                   AND lat IS NOT NULL AND lng IS NOT NULL
                   AND geo_point IS NULL`,
                [listingId]
              );
              await client.query("RELEASE SAVEPOINT before_centroid");
            } catch {
              await client.query("ROLLBACK TO SAVEPOINT before_centroid");
            }
          }
        }

        await client.query("COMMIT");
        return {
          listing_id: listingId,
          status: listingUpdate.rows[0]?.status ?? "draft",
          updated_at: new Date().toISOString()
        };
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    }

    const listing = this.appState.listings.get(listingId);
    if (!listing) {
      throw new NotFoundException({ code: "not_found", message: "Listing not found" });
    }

    if (listing.ownerUserId !== ownerUserId) {
      throw new ForbiddenException({ code: "forbidden", message: "Forbidden" });
    }

    if (body.title) {
      listing.title = body.title;
    }

    if (body.rent) {
      listing.monthlyRent = Number(body.rent);
    }

    if (body.location?.city) {
      listing.city = String(body.location.city).toLowerCase();
    }

    if (body.location?.locality) {
      listing.locality = body.location.locality;
    }

    if (body.property_fields?.furnishing) {
      listing.furnishing = body.property_fields.furnishing;
    }

    if (body.amenities) {
      listing.amenities = body.amenities;
    }

    return {
      listing_id: listing.id,
      status: listing.status,
      updated_at: new Date().toISOString()
    };
  }

  async submitListing(ownerUserId: string, listingId: string, agreeTerms: boolean) {
    if (this.database.isEnabled()) {
      if (!agreeTerms) {
        throw new BadRequestException({
          code: "missing_required_fields",
          message: "agree_terms required"
        });
      }

      const updated = await this.database.query<{ id: string; status: string }>(
        `
        UPDATE listings
        SET status = 'pending_review', updated_at = now()
        WHERE id = $1::uuid
          AND owner_user_id = $2::uuid
        RETURNING id::text, status::text
        `,
        [listingId, ownerUserId]
      );

      if (!updated.rowCount || !updated.rows[0]) {
        throw new NotFoundException({ code: "not_found", message: "Listing not found" });
      }

      // Fire-and-forget: confirm listing submission to owner via WhatsApp
      this.notifyListingSubmitted(ownerUserId, listingId).catch((err) => {
        logTelemetry("notification.error", {
          type: "owner.listing_submitted",
          listing_id: listingId,
          error: err instanceof Error ? err.message : String(err)
        });
      });

      return { listing_id: updated.rows[0].id, status: updated.rows[0].status };
    }

    const listing = this.appState.listings.get(listingId);
    if (!listing) {
      throw new NotFoundException({ code: "not_found", message: "Listing not found" });
    }

    if (listing.ownerUserId !== ownerUserId) {
      throw new ForbiddenException({ code: "forbidden", message: "Forbidden" });
    }

    if (!agreeTerms) {
      throw new BadRequestException({
        code: "missing_required_fields",
        message: "agree_terms required"
      });
    }

    listing.status = "pending_review";
    return { listing_id: listing.id, status: listing.status };
  }

  private async notifyListingSubmitted(ownerUserId: string, listingId: string) {
    if (!this.database.isEnabled()) return;

    const listingInfo = await this.database.query<{ title: string }>(
      `
      SELECT COALESCE(NULLIF(title_en, ''), NULLIF(title_hi, ''), 'आपकी प्रॉपर्टी') AS title
      FROM listings
      WHERE id = $1::uuid
      LIMIT 1
      `,
      [listingId]
    );

    await this.notifications.send({
      type: "owner.listing_submitted",
      recipientUserId: ownerUserId,
      payload: {
        listing_title: listingInfo.rows[0]?.title ?? "आपकी प्रॉपर्टी",
        listing_id: listingId
      },
      mode: "immediate"
    });
  }

  async toggleAvailability(
    ownerUserId: string,
    listingId: string,
    available: boolean
  ): Promise<{ listing_id: string; status: string }> {
    if (this.database.isEnabled()) {
      const newStatus = available ? "active" : "paused";
      const result = await this.database.query<{ id: string; status: string }>(
        `UPDATE listings
         SET status = $3::listing_status,
             last_owner_activity_at = now(),
             updated_at = now()
         WHERE id = $1::uuid
           AND owner_user_id = $2::uuid
           AND status IN ('active', 'paused')
         RETURNING id::text, status::text`,
        [listingId, ownerUserId, newStatus]
      );

      if (!result.rowCount) {
        throw new NotFoundException({
          code: "not_found",
          message: "Listing not found or not eligible"
        });
      }

      return { listing_id: result.rows[0].id, status: result.rows[0].status };
    }

    const listing = this.appState.listings.get(listingId);
    if (!listing || listing.ownerUserId !== ownerUserId) {
      throw new NotFoundException({ code: "not_found", message: "Listing not found" });
    }
    listing.status = available ? "active" : "paused";
    return { listing_id: listing.id, status: listing.status };
  }

  /**
   * Flips the `is_available` flag (independent of `status`/visibility). Flats/houses
   * only, ownership-scoped, and only while the listing is `active`.
   */
  async setAvailability(
    ownerUserId: string,
    listingId: string,
    available: boolean
  ): Promise<{ listing_id: string; is_available: boolean }> {
    if (!readFeatureFlags().ff_unavailable_listings) {
      throw new NotFoundException({
        code: "feature_disabled",
        message: "Notify-when-available is not enabled"
      });
    }

    if (this.database.isEnabled()) {
      const result = await this.database.query<{ id: string; is_available: boolean }>(
        `UPDATE listings
            SET is_available = $3,
                became_unavailable_at = CASE WHEN $3 THEN NULL ELSE now() END,
                availability_source = 'owner',
                last_owner_activity_at = now(),
                updated_at = now()
          WHERE id = $1::uuid
            AND owner_user_id = $2::uuid
            AND status = 'active'
            AND listing_type = 'flat_house'
          RETURNING id::text, is_available`,
        [listingId, ownerUserId, available]
      );

      if (!result.rowCount) {
        throw new NotFoundException({
          code: "not_found",
          message: "Listing not found or not eligible"
        });
      }

      if (available) {
        await this.database.query(
          `UPDATE listing_availability_alerts
              SET status = 'ready', ready_at = now()
            WHERE listing_id = $1::uuid AND status = 'waiting'`,
          [listingId]
        );
      }

      return { listing_id: result.rows[0].id, is_available: result.rows[0].is_available };
    }

    const listing = this.appState.listings.get(listingId);
    if (!listing || listing.ownerUserId !== ownerUserId) {
      throw new NotFoundException({ code: "not_found", message: "Listing not found" });
    }
    if (listing.listingType !== "flat_house") {
      throw new BadRequestException({
        code: "availability_flat_house_only",
        message: "Availability can only be set for flat/house listings"
      });
    }
    if (listing.status !== "active") {
      throw new BadRequestException({
        code: "availability_requires_active",
        message: "Listing must be active to change availability"
      });
    }

    this.appState.setListingAvailability(listingId, available);
    return { listing_id: listingId, is_available: available };
  }

  async presignPhotos(
    ownerUserId: string,
    listingId: string,
    idempotencyKey: string,
    files: Array<{ client_upload_id: string; content_type: string; size_bytes: number }>
  ) {
    if (!Array.isArray(files) || files.length === 0) {
      throw new BadRequestException({
        code: "validation_error",
        message: "At least one file is required"
      });
    }

    if (files.length > 30) {
      throw new BadRequestException({
        code: "validation_error",
        message: "Maximum 30 files can be presigned per request"
      });
    }

    const seenUploadIds = new Set<string>();
    for (const file of files) {
      const uploadId = String(file.client_upload_id ?? "").trim();
      if (!uploadId) {
        throw new BadRequestException({
          code: "validation_error",
          message: "client_upload_id is required"
        });
      }
      if (seenUploadIds.has(uploadId)) {
        throw new BadRequestException({
          code: "duplicate_client_upload_id",
          message: `Duplicate client_upload_id in request: ${uploadId}`
        });
      }
      seenUploadIds.add(uploadId);
      this.photoStorage.validatePresignRequest(file.content_type, Number(file.size_bytes));
    }

    if (this.database.isEnabled()) {
      const route = `owner:${listingId}:photos/presign`;
      const cached = await this.getIdempotentResponse(ownerUserId, route, idempotencyKey);
      if (cached) {
        return cached as {
          uploads: Array<{
            client_upload_id: string;
            upload_url: string;
            blob_path: string;
            expires_at: string;
          }>;
        };
      }

      await this.assertListingOwner(ownerUserId, listingId);
      const response = {
        uploads: files.map((file) => {
          const uploadTarget = this.photoStorage.createUploadTarget({
            listingId,
            clientUploadId: file.client_upload_id,
            contentType: file.content_type
          });
          return {
            client_upload_id: file.client_upload_id,
            upload_url: uploadTarget.uploadUrl,
            blob_path: uploadTarget.blobPath,
            expires_at: uploadTarget.expiresAt
          };
        })
      };

      await this.storeIdempotentResponse(ownerUserId, route, idempotencyKey, response);
      return response;
    }

    const listing = this.appState.listings.get(listingId);
    if (!listing || listing.ownerUserId !== ownerUserId) {
      throw new ForbiddenException({ code: "forbidden", message: "Forbidden" });
    }

    return {
      uploads: files.map((file) => {
        const uploadTarget = this.photoStorage.createUploadTarget({
          listingId,
          clientUploadId: file.client_upload_id,
          contentType: file.content_type
        });

        return {
          client_upload_id: file.client_upload_id,
          upload_url: uploadTarget.uploadUrl,
          blob_path: uploadTarget.blobPath,
          expires_at: uploadTarget.expiresAt
        };
      })
    };
  }

  async completePhotos(
    ownerUserId: string,
    listingId: string,
    idempotencyKey: string,
    files: Array<{
      client_upload_id: string;
      blob_path: string;
      is_cover?: boolean;
      sort_order?: number;
    }>
  ) {
    if (!Array.isArray(files) || files.length === 0) {
      throw new BadRequestException({
        code: "validation_error",
        message: "At least one file is required"
      });
    }

    const seenUploadIds = new Set<string>();
    let coverCount = 0;
    for (const file of files) {
      const uploadId = String(file.client_upload_id ?? "").trim();
      const blobPath = String(file.blob_path ?? "").trim();
      if (!uploadId || !blobPath) {
        throw new BadRequestException({
          code: "validation_error",
          message: "client_upload_id and blob_path are required"
        });
      }
      if (seenUploadIds.has(uploadId)) {
        throw new BadRequestException({
          code: "duplicate_client_upload_id",
          message: `Duplicate client_upload_id in request: ${uploadId}`
        });
      }
      seenUploadIds.add(uploadId);

      if (Boolean(file.is_cover)) {
        coverCount += 1;
      }
    }

    if (coverCount > 1) {
      throw new BadRequestException({
        code: "validation_error",
        message: "Only one photo can be marked as cover"
      });
    }

    if (this.database.isEnabled()) {
      const route = `owner:${listingId}:photos/complete`;
      const cached = await this.getIdempotentResponse(ownerUserId, route, idempotencyKey);
      if (cached) {
        return cached as { photo_ids: string[]; accepted_count: number };
      }

      await this.assertListingOwner(ownerUserId, listingId);

      await Promise.all(
        files.map((file) => this.photoStorage.validateUploadedBlob(listingId, file.blob_path))
      );

      const client = await this.database.getClient();
      try {
        await client.query("BEGIN");

        if (coverCount === 1) {
          await client.query(
            `
            UPDATE listing_photos
            SET is_cover = false,
                updated_at = now()
            WHERE listing_id = $1::uuid
              AND is_cover = true
            `,
            [listingId]
          );
        }

        const photoIds: string[] = [];
        for (const file of files) {
          const rawSortOrder = Number(file.sort_order);
          const normalizedSortOrder = Number.isFinite(rawSortOrder)
            ? Math.max(Math.min(Math.trunc(rawSortOrder), 32767), 0)
            : 0;

          const inserted = await client.query<{ id: string }>(
            `
            INSERT INTO listing_photos(listing_id, blob_path, sort_order, is_cover, moderation_status, client_upload_id)
            VALUES ($1::uuid, $2, $3, $4, 'pending', $5)
            ON CONFLICT (listing_id, client_upload_id) DO NOTHING
            RETURNING id::text
            `,
            [
              listingId,
              file.blob_path,
              normalizedSortOrder,
              Boolean(file.is_cover ?? false),
              file.client_upload_id
            ]
          );

          const id = inserted.rows[0]?.id;
          if (!id) {
            throw new ConflictException({
              code: "duplicate_client_upload_id",
              message: `Duplicate client_upload_id: ${file.client_upload_id}`
            });
          }
          photoIds.push(id);
        }

        const response = {
          photo_ids: photoIds,
          accepted_count: photoIds.length
        };
        await client.query("COMMIT");
        await this.storeIdempotentResponse(ownerUserId, route, idempotencyKey, response);
        return response;
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    }

    const listing = this.appState.listings.get(listingId);
    if (!listing || listing.ownerUserId !== ownerUserId) {
      throw new ForbiddenException({ code: "forbidden", message: "Forbidden" });
    }

    return {
      photo_ids: files.map(() => randomUUID()),
      accepted_count: files.length
    };
  }

  async reorderPhotos(
    ownerUserId: string,
    listingId: string,
    idempotencyKey: string,
    items: Array<{ photo_id: string; sort_order: number; is_cover?: boolean }>
  ) {
    if (!Array.isArray(items) || items.length === 0) {
      throw new BadRequestException({
        code: "validation_error",
        message: "items is required"
      });
    }

    const normalized: Array<{ photoId: string; sortOrder: number; isCover: boolean }> = [];
    const seenIds = new Set<string>();
    const seenSortOrders = new Set<number>();
    let coverCount = 0;

    for (const item of items) {
      const photoId = String(item.photo_id ?? "").trim();
      if (!photoId) {
        throw new BadRequestException({
          code: "validation_error",
          message: "photo_id is required for every item"
        });
      }
      if (seenIds.has(photoId)) {
        throw new BadRequestException({
          code: "validation_error",
          message: `Duplicate photo_id: ${photoId}`
        });
      }
      seenIds.add(photoId);

      const rawSortOrder = Number(item.sort_order);
      if (!Number.isFinite(rawSortOrder)) {
        throw new BadRequestException({
          code: "validation_error",
          message: "sort_order must be a number"
        });
      }
      const sortOrder = Math.max(Math.min(Math.trunc(rawSortOrder), 32767), 0);
      if (seenSortOrders.has(sortOrder)) {
        throw new BadRequestException({
          code: "validation_error",
          message: `Duplicate sort_order: ${sortOrder}`
        });
      }
      seenSortOrders.add(sortOrder);

      const isCover = Boolean(item.is_cover);
      if (isCover) coverCount += 1;

      normalized.push({ photoId, sortOrder, isCover });
    }

    if (coverCount !== 1) {
      throw new BadRequestException({
        code: "validation_error",
        message: "Exactly one photo must be marked as cover"
      });
    }

    if (this.database.isEnabled()) {
      const route = `owner:${listingId}:photos/reorder`;
      const cached = await this.getIdempotentResponse(ownerUserId, route, idempotencyKey);
      if (cached) {
        return cached as {
          updated_count: number;
          items: Array<{ id: string; sort_order: number; is_cover: boolean }>;
        };
      }

      await this.assertListingOwner(ownerUserId, listingId);

      const client = await this.database.getClient();
      try {
        await client.query("BEGIN");

        // Lock the listing's photo rows up-front. SELECT ... FOR UPDATE both
        // serializes concurrent reorders for this listing and lets us assert
        // that every photo_id in the request actually belongs to this listing
        // (and isn't soft-rejected) before mutating anything.
        const existing = await client.query<{ id: string }>(
          `
          SELECT id::text
          FROM listing_photos
          WHERE listing_id = $1::uuid
            AND moderation_status <> 'rejected'
          FOR UPDATE
          `,
          [listingId]
        );

        const validIds = new Set(existing.rows.map((row) => row.id));
        for (const { photoId } of normalized) {
          if (!validIds.has(photoId)) {
            throw new BadRequestException({
              code: "invalid_photo_id",
              message: `Photo ${photoId} does not belong to this listing`
            });
          }
        }

        // Two-phase update: first clear is_cover on everything (avoids any
        // intermediate "two covers" state if we ever add a partial unique
        // index), then write the new sort_order / is_cover per row.
        await client.query(
          `
          UPDATE listing_photos
          SET is_cover = false,
              updated_at = now()
          WHERE listing_id = $1::uuid
            AND is_cover = true
          `,
          [listingId]
        );

        const updated: Array<{ id: string; sort_order: number; is_cover: boolean }> = [];
        for (const { photoId, sortOrder, isCover } of normalized) {
          const result = await client.query<{
            id: string;
            sort_order: number;
            is_cover: boolean;
          }>(
            `
            UPDATE listing_photos
            SET sort_order = $1,
                is_cover = $2,
                updated_at = now()
            WHERE id = $3::uuid
              AND listing_id = $4::uuid
            RETURNING id::text, sort_order, is_cover
            `,
            [sortOrder, isCover, photoId, listingId]
          );
          const row = result.rows[0];
          if (!row) {
            throw new BadRequestException({
              code: "invalid_photo_id",
              message: `Photo ${photoId} could not be updated`
            });
          }
          updated.push({
            id: row.id,
            sort_order: Number(row.sort_order),
            is_cover: Boolean(row.is_cover)
          });
        }

        const response = {
          updated_count: updated.length,
          items: updated
        };
        await client.query("COMMIT");
        await this.storeIdempotentResponse(ownerUserId, route, idempotencyKey, response);
        return response;
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    }

    // In-memory fallback: we don't persist photos in AppState, but we still
    // return a coherent response so the frontend optimistic update stands.
    const listing = this.appState.listings.get(listingId);
    if (!listing || listing.ownerUserId !== ownerUserId) {
      throw new ForbiddenException({ code: "forbidden", message: "Forbidden" });
    }
    return {
      updated_count: normalized.length,
      items: normalized.map((entry) => ({
        id: entry.photoId,
        sort_order: entry.sortOrder,
        is_cover: entry.isCover
      }))
    };
  }

  private async assertListingOwner(
    ownerUserId: string,
    listingId: string,
    client?: {
      query: (
        text: string,
        params?: unknown[]
      ) => Promise<{ rowCount: number | null; rows: unknown[] }>;
    }
  ) {
    const runQuery = (text: string, params?: unknown[]) =>
      client ? client.query(text, params) : this.database.query(text, params ?? []);
    const result = await runQuery(
      `
      SELECT id::text
      FROM listings
      WHERE id = $1::uuid
        AND owner_user_id = $2::uuid
      LIMIT 1
      `,
      [listingId, ownerUserId]
    );

    if (!result.rowCount) {
      throw new ForbiddenException({ code: "forbidden", message: "Forbidden" });
    }
  }

  private async getIdempotentResponse(ownerUserId: string, route: string, idemKey: string) {
    if (!this.database.isEnabled()) {
      return null;
    }

    const result = await this.database.query<{ response: unknown }>(
      `
      SELECT response
      FROM idempotency_keys
      WHERE actor_user_id = $1::uuid
        AND route = $2
        AND idem_key = $3
        AND expires_at > now()
      LIMIT 1
      `,
      [ownerUserId, route, idemKey]
    );
    return result.rows[0]?.response ?? null;
  }

  private async storeIdempotentResponse(
    ownerUserId: string,
    route: string,
    idemKey: string,
    response: unknown
  ) {
    if (!this.database.isEnabled()) {
      return;
    }

    await this.database.query(
      `
      INSERT INTO idempotency_keys(actor_user_id, route, idem_key, response, expires_at)
      VALUES ($1::uuid, $2, $3, $4::jsonb, now() + interval '24 hours')
      ON CONFLICT (actor_user_id, route, idem_key) DO NOTHING
      `,
      [ownerUserId, route, idemKey, JSON.stringify(response)]
    );
  }
}
