import { Controller, Get, Headers, Inject, NotFoundException, Param, Query } from "@nestjs/common";
import { ok } from "../../common/response";
import { AppStateService } from "../../common/app-state.service";
import { DatabaseService } from "../../common/database.service";
import { AnalyticsService } from "../analytics/analytics.service";
import { readFeatureFlags } from "../../config/feature-flags";
import { toBlobUrl } from "../../common/photo-url";

/**
 * Optional auth header parser. The listing-detail endpoint is public, but we
 * still want the owning operator/owner to be able to preview their listing
 * BEFORE it transitions to `status='active'`. Returns the user id if the
 * Authorization header matches a live session; otherwise null. Never throws.
 */
async function optionalAuthUserId(
  database: DatabaseService,
  appState: AppStateService,
  authHeader: string | undefined
): Promise<string | null> {
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : undefined;
  if (!token?.startsWith("acc_")) return null;
  const sessionId = token.slice(4);
  if (!/^[0-9a-f-]{36}$/i.test(sessionId)) return null;

  if (database.isEnabled()) {
    try {
      const r = await database.query<{ user_id: string }>(
        `SELECT s.user_id::text
           FROM sessions s
          WHERE s.id = $1::uuid
            AND s.revoked_at IS NULL
            AND s.expires_at > now()
          LIMIT 1`,
        [sessionId]
      );
      if (r.rowCount && r.rows[0]) return r.rows[0].user_id;
    } catch {
      // fallthrough to in-memory check
    }
  }
  // No in-memory session fallback in this controller (AppStateService doesn't
  // expose one publicly); the DB lookup above is the only auth path. Returns
  // null when DB is disabled (test env) — listings.detail then enforces the
  // public 'active' filter, which is the safe default.
  return null;
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
  owner_user_id: string;
  title: string;
  description: string | null;
  listing_type: "flat_house" | "pg";
  monthly_rent: number;
  verification_status: "unverified" | "pending" | "verified" | "failed";
  is_available: boolean;
  waitlist_count: number;
  city: string;
  locality: string | null;
  lat: number | null;
  lng: number | null;
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
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(AnalyticsService) private readonly analytics: AnalyticsService
  ) {}

  @Get("listings/:listing_id")
  async detail(
    @Param("listing_id") listingId: string,
    @Headers("authorization") authHeader: string | undefined,
    @Query("ref") ref?: string
  ) {
    // Traffic-source tag (e.g. a blog post drove this view). Only accept a
    // bounded blog- ref so it's safe to store as event metadata.
    const sourceRef =
      typeof ref === "string" && /^blog-[a-z0-9:_-]{1,110}$/i.test(ref) ? ref : null;
    if (this.database.isEnabled() && /^[0-9a-f-]{36}$/i.test(listingId)) {
      // If the request is from the listing's owner (operator preview), allow
      // viewing in any status. Otherwise enforce status='active' for public.
      const viewerId = await optionalAuthUserId(this.database, this.appState, authHeader);

      const result = await this.database.query<ListingDetailRow>(
        `
        SELECT
          l.id::text,
          l.owner_user_id::text AS owner_user_id,
          COALESCE(NULLIF(l.title_en, ''), NULLIF(l.title_hi, ''), 'Listing') AS title,
          COALESCE(NULLIF(l.description_en, ''), NULLIF(l.description_hi, ''), NULL) AS description,
          l.listing_type::text,
          l.monthly_rent,
          l.verification_status::text,
          l.is_available,
          (SELECT count(*) FROM listing_availability_alerts a
             WHERE a.listing_id = l.id AND a.status IN ('waiting','ready'))::int AS waitlist_count,
          c.slug AS city,
          loc.slug AS locality,
          ll.lat::float8 AS lat,
          ll.lng::float8 AS lng,
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
          AND (l.status = 'active' OR ($2::uuid IS NOT NULL AND l.owner_user_id = $2::uuid))
        LIMIT 1
        `,
        [listingId, viewerId]
      );

      if (result.rowCount && result.rows[0]) {
        const listing = result.rows[0];

        // Record a "view" for non-owner viewers. This is the ONLY place a
        // listing view is persisted (listing_events('view')) — it powers the
        // operator/owner dashboard "views" metric, uniformly for PG + flat/house.
        // Owner self-previews don't count. Internally gated by
        // ff_listing_analytics_enabled. Fire-and-forget; never blocks the response.
        if (viewerId !== listing.owner_user_id) {
          void this.analytics.trackEvent({
            listing_id: listing.id,
            user_id: viewerId ?? undefined,
            event_type: "view",
            metadata: sourceRef ? { source: sourceRef } : undefined
          });
        }

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
            is_available: Boolean(listing.is_available),
            waitlist_count: Number(listing.waitlist_count),
            city: listing.city,
            locality: listing.locality,
            lat: listing.lat != null ? Number(listing.lat) : null,
            lng: listing.lng != null ? Number(listing.lng) : null,
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
        is_available: listing.is_available ?? true,
        waitlist_count: this.appState
          .listAvailabilityAlerts(listing.id)
          .filter((a) => a.status === "waiting" || a.status === "ready").length,
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
        amenities: listing.amenities || [],
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
