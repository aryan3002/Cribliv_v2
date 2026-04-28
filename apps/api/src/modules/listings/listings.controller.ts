import { Controller, Get, Inject, NotFoundException, Param } from "@nestjs/common";
import { ok } from "../../common/response";
import { AppStateService } from "../../common/app-state.service";
import { DatabaseService } from "../../common/database.service";
import { readFeatureFlags } from "../../config/feature-flags";

function buildPhotoPublicBaseUrl() {
  const explicit = process.env.PHOTO_PUBLIC_BASE_URL?.trim();
  if (explicit) return explicit.replace(/\/+$/, "");
  const accountName = process.env.AZURE_STORAGE_ACCOUNT_NAME?.trim();
  const container = process.env.AZURE_STORAGE_CONTAINER_LISTING_PHOTOS?.trim() || "listing-photos";
  if (!accountName) return "";
  return `https://${accountName}.blob.core.windows.net/${container}`;
}

function toBlobUrl(blobPath: string | null): string | null {
  if (!blobPath) return null;
  if (/^https?:\/\//i.test(blobPath)) return blobPath;
  const base = buildPhotoPublicBaseUrl();
  if (!base) return blobPath;
  return `${base}/${blobPath.replace(/^\/+/, "")}`;
}

function firstName(fullName: string | null): string | null {
  if (!fullName) return null;
  const trimmed = fullName.trim();
  if (!trimmed) return null;
  const parts = trimmed.split(/\s+/);
  return parts[0] ?? null;
}

interface ListingDetailRow {
  id: string;
  title: string;
  description: string | null;
  listing_type: "flat_house" | "pg";
  monthly_rent: number;
  verification_status: "unverified" | "pending" | "verified" | "failed";
  city: string;
  locality: string | null;
  bhk: number | null;
  bathrooms: number | null;
  area_sqft: number | null;
  furnishing: "unfurnished" | "semi_furnished" | "fully_furnished" | null;
  preferred_tenant: string | null;
  security_deposit: number | null;
  available_from: string | null;
  whatsapp_available: boolean | null;
  amenities: unknown;
  rules: unknown;
  owner_phone: string | null;
  owner_full_name: string | null;
  owner_created_at: string | null;
  owner_preferred_language: string | null;
  pg_total_beds: number | null;
  pg_occupancy_type: string | null;
  pg_room_sharing_options: unknown;
  pg_food_included: boolean | null;
  pg_curfew_time: string | null;
  pg_attached_bathroom: boolean | null;
  photos: string[];
}

@Controller()
export class ListingsController {
  constructor(
    @Inject(AppStateService) private readonly appState: AppStateService,
    @Inject(DatabaseService) private readonly database: DatabaseService
  ) {}

  @Get("listings/:listing_id")
  async detail(@Param("listing_id") listingId: string) {
    if (this.database.isEnabled() && /^[0-9a-f-]{36}$/i.test(listingId)) {
      const result = await this.database.query<ListingDetailRow>(
        `
        SELECT
          l.id::text,
          COALESCE(NULLIF(l.title_en, ''), NULLIF(l.title_hi, ''), 'Listing') AS title,
          COALESCE(NULLIF(l.description_en, ''), NULLIF(l.description_hi, ''), NULL) AS description,
          l.listing_type::text,
          l.monthly_rent,
          l.verification_status::text,
          c.slug AS city,
          loc.slug AS locality,
          l.bhk,
          l.bathrooms,
          l.area_sqft,
          l.furnishing::text,
          l.preferred_tenant::text,
          l.security_deposit,
          l.available_from::text,
          l.whatsapp_available,
          l.amenities,
          l.rules,
          u.phone_e164 AS owner_phone,
          u.full_name AS owner_full_name,
          u.created_at::text AS owner_created_at,
          u.preferred_language::text AS owner_preferred_language,
          pg.total_beds AS pg_total_beds,
          pg.occupancy_type::text AS pg_occupancy_type,
          pg.room_sharing_options AS pg_room_sharing_options,
          pg.food_included AS pg_food_included,
          pg.curfew_time::text AS pg_curfew_time,
          pg.attached_bathroom AS pg_attached_bathroom,
          COALESCE(
            (SELECT json_agg(lp.blob_path ORDER BY lp.is_cover DESC, lp.sort_order ASC, lp.created_at ASC)
             FROM listing_photos lp
             WHERE lp.listing_id = l.id
               AND lp.moderation_status != 'rejected'),
            '[]'
          ) AS photos
        FROM listings l
        JOIN listing_locations ll ON ll.listing_id = l.id
        JOIN cities c ON c.id = ll.city_id
        LEFT JOIN localities loc ON loc.id = ll.locality_id
        LEFT JOIN users u ON u.id = l.owner_user_id
        LEFT JOIN pg_details pg ON pg.listing_id = l.id
        WHERE l.id = $1::uuid
          AND l.status = 'active'
        LIMIT 1
        `,
        [listingId]
      );

      if (result.rowCount && result.rows[0]) {
        const listing = result.rows[0];
        const flags = readFeatureFlags();

        // Partial phone reveal: mask all but last 4 digits
        let ownerPhoneMasked: string | null = null;
        if (flags.ff_partial_phone_reveal_enabled && listing.owner_phone) {
          const phone = listing.owner_phone;
          ownerPhoneMasked = phone.slice(0, -4).replace(/\d/g, "X") + phone.slice(-4);
        }

        const rawPhotos: unknown[] = Array.isArray(listing.photos) ? listing.photos : [];
        const photoUrls = rawPhotos
          .filter((p): p is string => typeof p === "string" && p.length > 0)
          .map((p) => toBlobUrl(p))
          .filter((p): p is string => p !== null);

        const amenities: string[] = Array.isArray(listing.amenities)
          ? (listing.amenities as unknown[]).filter(
              (a): a is string => typeof a === "string" && a.length > 0
            )
          : [];

        const rules: Record<string, unknown> | null =
          listing.rules && typeof listing.rules === "object" && !Array.isArray(listing.rules)
            ? (listing.rules as Record<string, unknown>)
            : null;

        const isPg = listing.listing_type === "pg";
        const pgRoomSharing: string[] = Array.isArray(listing.pg_room_sharing_options)
          ? (listing.pg_room_sharing_options as unknown[]).filter(
              (s): s is string => typeof s === "string"
            )
          : [];

        return ok({
          listing_detail: {
            id: listing.id,
            title: listing.title,
            description: listing.description,
            listing_type: listing.listing_type,
            monthly_rent: listing.monthly_rent,
            verification_status: listing.verification_status,
            city: listing.city,
            locality: listing.locality,
            bhk: listing.bhk,
            bathrooms: listing.bathrooms,
            area_sqft: listing.area_sqft,
            furnishing: listing.furnishing,
            preferred_tenant: listing.preferred_tenant,
            security_deposit: listing.security_deposit,
            available_from: listing.available_from,
            whatsapp_available: listing.whatsapp_available ?? false,
            amenities,
            rules,
            photos: photoUrls,
            pg_details: isPg
              ? {
                  total_beds: listing.pg_total_beds,
                  occupancy_type: listing.pg_occupancy_type,
                  room_sharing_options: pgRoomSharing,
                  food_included: listing.pg_food_included ?? false,
                  curfew_time: listing.pg_curfew_time,
                  attached_bathroom: listing.pg_attached_bathroom ?? false
                }
              : null
          },
          owner: {
            first_name: firstName(listing.owner_full_name),
            member_since: listing.owner_created_at,
            preferred_language: listing.owner_preferred_language,
            whatsapp_available: listing.whatsapp_available ?? false
          },
          owner_trust: {
            verification_status: listing.verification_status,
            no_response_refund: true
          },
          owner_phone_masked: ownerPhoneMasked,
          contact_locked: true
        });
      }
    }

    const listing = this.appState.listings.get(listingId);

    if (!listing || listing.status !== "active") {
      throw new NotFoundException({ code: "listing_not_found", message: "Listing not found" });
    }

    return ok({
      listing_detail: {
        id: listing.id,
        title: listing.title,
        description: null,
        listing_type: listing.listingType,
        monthly_rent: listing.monthlyRent,
        verification_status: listing.verificationStatus,
        city: listing.city,
        locality: listing.locality ?? null,
        bhk: null,
        bathrooms: null,
        area_sqft: null,
        furnishing: listing.furnishing ?? null,
        preferred_tenant: null,
        security_deposit: null,
        available_from: null,
        whatsapp_available: false,
        amenities: [],
        rules: null,
        photos: [],
        pg_details: null
      },
      owner: {
        first_name: null,
        member_since: null,
        preferred_language: null,
        whatsapp_available: false
      },
      owner_trust: {
        verification_status: listing.verificationStatus,
        no_response_refund: true
      },
      contact_locked: true
    });
  }
}
