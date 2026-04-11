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

@Controller()
export class ListingsController {
  constructor(
    @Inject(AppStateService) private readonly appState: AppStateService,
    @Inject(DatabaseService) private readonly database: DatabaseService
  ) {}

  @Get("listings/:listing_id")
  async detail(@Param("listing_id") listingId: string) {
    if (this.database.isEnabled() && /^[0-9a-f-]{36}$/i.test(listingId)) {
      const result = await this.database.query<{
        id: string;
        title: string;
        description: string | null;
        listing_type: "flat_house" | "pg";
        monthly_rent: number;
        verification_status: "unverified" | "pending" | "verified" | "failed";
        city: string;
        locality: string | null;
        owner_phone: string | null;
        photos: string[];
      }>(
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
          u.phone_e164 AS owner_phone,
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
            photos: photoUrls
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
        locality: listing.locality ?? null
      },
      owner_trust: {
        verification_status: listing.verificationStatus,
        no_response_refund: true
      },
      contact_locked: true
    });
  }
}
