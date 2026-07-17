// Server-side fetchers that turn a listing/PG id into card-ready data for blog
// embeds. Both return null on any failure (deleted / unavailable / network) so
// a dead embed simply renders nothing instead of breaking the post.

import { fetchApi } from "./api";
import { getPgPublicListing } from "./pg-public-api";
import type { ListingCardData } from "../components/listing-card";
import type { PgCard } from "./pg-public-api";

const PHOTO_BASE = (process.env.NEXT_PUBLIC_PHOTO_BASE_URL || "").replace(/\/+$/, "");

/** Resolve a stored blob path to an absolute photo URL (mirrors PG detail page). */
function photoUrl(blobPath: string): string {
  if (/^https?:\/\//i.test(blobPath)) return blobPath;
  return PHOTO_BASE ? `${PHOTO_BASE}/${blobPath.replace(/^\/+/, "")}` : blobPath;
}

interface ListingDetailResponse {
  listing_detail: {
    id: string;
    title: string;
    listing_type: "flat_house" | "pg";
    monthly_rent: number;
    verification_status: "unverified" | "pending" | "verified" | "failed";
    city: string;
    locality?: string | null;
    bhk?: number | null;
    area_sqft?: number | null;
    furnishing?: string | null;
    photos?: string[];
  };
}

/** Fetch a flat/house listing by id and map it to a listing card. */
export async function fetchListingCard(id: string): Promise<ListingCardData | null> {
  try {
    const res = await fetchApi<ListingDetailResponse>(`/listings/${id}`, undefined, {
      server: true
    });
    const d = res?.listing_detail;
    if (!d?.id) return null;
    return {
      id: d.id,
      title: d.title,
      city: d.city,
      city_name: null,
      locality: d.locality ?? null,
      listing_type: d.listing_type,
      monthly_rent: d.monthly_rent,
      bhk: d.bhk ?? null,
      furnishing: d.furnishing ?? null,
      area_sqft: d.area_sqft ?? null,
      verification_status: d.verification_status,
      cover_photo: d.photos?.[0] ?? null
    };
  } catch {
    return null;
  }
}

/** Fetch a PG by id and map it to a PG card (rents are stored in paise). */
export async function fetchPgCard(city: string, id: string): Promise<PgCard | null> {
  try {
    const d = await getPgPublicListing(id, { server: true });
    if (!d?.id) return null;
    const roomRents = (d.room_types ?? [])
      .map((r) => r.monthly_rent_paise)
      .filter((n): n is number => typeof n === "number" && n > 0);
    const starting_rent = roomRents.length ? Math.round(Math.min(...roomRents) / 100) : null;
    const sharing_options = Array.from(
      new Set((d.room_types ?? []).map((r) => r.sharing).filter(Boolean))
    );
    const cover = (d.photos ?? []).find((p) => p.is_cover) ?? (d.photos ?? [])[0];
    return {
      id: d.id,
      title: d.title ?? "PG accommodation",
      city: d.city_slug ?? city,
      city_name: null,
      locality: d.locality_slug ?? null,
      listing_type: "pg",
      starting_rent,
      sharing_options,
      gender_policy: d.pg_details?.gender_policy ?? null,
      food_included: (d.pg_details?.meal_charges_paise ?? 0) > 0,
      verified: d.verification_status === "verified",
      cover_photo: cover ? photoUrl(cover.blob_path) : null,
      lat: d.location_point?.lat ?? null,
      lng: d.location_point?.lng ?? null
    };
  } catch {
    return null;
  }
}
