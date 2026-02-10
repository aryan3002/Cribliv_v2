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

@Injectable()
export class OwnerService {
  constructor(
    @Inject(AppStateService) private readonly appState: AppStateService,
    @Inject(DatabaseService) private readonly database: DatabaseService
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
          l.created_at::text
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
        items: result.rows.map((row) => ({
          id: row.id,
          ownerUserId,
          listingType: row.listing_type,
          title: row.title,
          city: row.city,
          locality: row.locality ?? undefined,
          monthlyRent: Number(row.monthly_rent),
          verificationStatus: row.verification_status,
          status: row.status,
          createdAt: new Date(row.created_at).getTime()
        })),
        total: result.rowCount ?? 0
      };
    }

    const items = [...this.appState.listings.values()].filter(
      (l) => l.ownerUserId === ownerUserId && (!status || l.status === status)
    );

    return {
      items: items.map((item) => ({ ...item })) as Array<Record<string, unknown>>,
      total: items.length
    };
  }

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
            whatsapp_available
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
            $13
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
            ownerContact.rows[0]?.whatsapp_opt_in ?? false
          ]
        );

        const listingId = listingResult.rows[0].id;
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
          VALUES ($1::uuid, $2, $3, $4, $5, $6, $7, $8, $9)
          `,
          [
            listingId,
            cityResult.rows[0].id,
            localityId,
            body.location.address_line1 ?? `${city} property`,
            body.location.landmark ?? null,
            body.location.pincode ?? null,
            body.location.lat ?? null,
            body.location.lng ?? null,
            body.location.masked_address ?? `${body.location.locality ?? city}`
          ]
        );

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
      meta: body
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
            body.property_fields?.preferred_tenant ?? null
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
              body.location.lat ?? null,
              body.location.lng ?? null,
              body.location.masked_address ?? null
            ]
          );
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

  async presignPhotos(
    ownerUserId: string,
    listingId: string,
    idempotencyKey: string,
    files: Array<{ client_upload_id: string }>
  ) {
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

      const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();
      const response = {
        uploads: files.map((file) => ({
          client_upload_id: file.client_upload_id,
          upload_url: `https://blob.example/upload/${listingId}/${file.client_upload_id}`,
          blob_path: `${listingId}/${file.client_upload_id}`,
          expires_at: expiresAt
        }))
      };

      await this.storeIdempotentResponse(ownerUserId, route, idempotencyKey, response);
      return response;
    }

    const listing = this.appState.listings.get(listingId);
    if (!listing || listing.ownerUserId !== ownerUserId) {
      throw new ForbiddenException({ code: "forbidden", message: "Forbidden" });
    }

    return {
      uploads: files.map((file) => ({
        client_upload_id: file.client_upload_id,
        upload_url: `https://blob.example/upload/${listingId}/${file.client_upload_id}`,
        blob_path: `${listingId}/${file.client_upload_id}`,
        expires_at: new Date(Date.now() + 15 * 60 * 1000).toISOString()
      }))
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
    if (this.database.isEnabled()) {
      const route = `owner:${listingId}:photos/complete`;
      const cached = await this.getIdempotentResponse(ownerUserId, route, idempotencyKey);
      if (cached) {
        return cached as { photo_ids: string[]; accepted_count: number };
      }

      const client = await this.database.getClient();
      try {
        await client.query("BEGIN");
        await this.assertListingOwner(ownerUserId, listingId, client);

        const photoIds: string[] = [];
        for (const file of files) {
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
              file.sort_order ?? 0,
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
