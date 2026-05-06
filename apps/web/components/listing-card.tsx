"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { ShieldCheck, Heart, Building, MapPin } from "lucide-react";

export interface ListingCardData {
  id: string;
  title: string;
  city?: string | null;
  city_name?: string | null;
  locality?: string | null;
  listing_type?: "flat_house" | "pg" | string | null;
  monthly_rent?: number | null;
  bhk?: number | null;
  furnishing?: string | null;
  area_sqft?: number | null;
  verification_status?: "unverified" | "pending" | "verified" | "failed" | null;
  cover_photo?: string | null;
}

function furnishLabel(f?: string | null): string | null {
  if (!f) return null;
  if (f === "fully_furnished") return "Fully Furnished";
  if (f === "semi_furnished") return "Semi-Furnished";
  if (f === "unfurnished") return "Unfurnished";
  return f;
}

function toDisplayCity(slug?: string | null): string | null {
  if (!slug) return null;
  return slug.charAt(0).toUpperCase() + slug.slice(1).toLowerCase();
}

function formatRent(rent?: number | null): string {
  if (!rent || rent <= 0) return "Price on request";
  return `₹${rent.toLocaleString("en-IN")}`;
}

interface ListingCardItemProps {
  listing: ListingCardData;
  locale: string;
  /** Optional slot at top-right of image (e.g. interactive heart button). Defaults to a static heart. */
  heartSlot?: ReactNode;
  /** Render compact (carousel) instead of grid card. Compact uses min-width for horizontal scroll snap. */
  compact?: boolean;
}

export function ListingCardItem({
  listing,
  locale,
  heartSlot,
  compact = false
}: ListingCardItemProps) {
  const cityDisplay = listing.city_name ?? toDisplayCity(listing.city);
  const typeLabel = listing.listing_type === "pg" ? "PG" : "Flat / House";
  const rentDisplay = formatRent(listing.monthly_rent);
  const isVerified = listing.verification_status === "verified";

  const metaParts: string[] = [];
  if (listing.bhk) metaParts.push(`${listing.bhk} BHK`);
  if (listing.area_sqft) metaParts.push(`${listing.area_sqft} sqft`);
  const fLabel = furnishLabel(listing.furnishing);
  if (fLabel) metaParts.push(fLabel);
  if (listing.listing_type === "pg") metaParts.push("PG");

  return (
    <article className={`listing-card${compact ? " listing-card--compact" : ""}`}>
      <Link
        href={`/${locale}/listing/${listing.id}`}
        className="listing-card__media"
        aria-label={listing.title}
      >
        {listing.cover_photo ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={listing.cover_photo}
            alt={listing.title}
            loading="lazy"
            className="listing-card__img"
          />
        ) : (
          <div className="listing-card__placeholder" aria-hidden="true">
            <Building size={32} />
          </div>
        )}

        {isVerified && (
          <span className="listing-card__verified" aria-label="Verified owner">
            <ShieldCheck size={12} aria-hidden="true" />
            Verified
          </span>
        )}
      </Link>

      <div className="listing-card__heart-slot">
        {heartSlot ?? (
          <button
            type="button"
            className="listing-card__heart"
            aria-label="Save"
            onClick={(e) => {
              // Static fallback — the search-results page wires up real shortlist action via heartSlot.
              e.preventDefault();
            }}
          >
            <Heart size={16} aria-hidden="true" />
          </button>
        )}
      </div>

      <Link href={`/${locale}/listing/${listing.id}`} className="listing-card__body">
        <div className="listing-card__row1">
          <h3 className="listing-card__title">{listing.title}</h3>
          {isVerified && (
            <span className="listing-card__rating" aria-hidden="true">
              <ShieldCheck size={12} />
              <span>Verified</span>
            </span>
          )}
        </div>

        <div className="listing-card__loc">
          <MapPin size={12} aria-hidden="true" />
          <span>
            {[listing.locality, cityDisplay].filter(Boolean).join(", ") || "Location"}
            {" · "}
            {typeLabel}
          </span>
        </div>

        {metaParts.length > 0 && <div className="listing-card__meta">{metaParts.join(" · ")}</div>}

        <div className="listing-card__price-row">
          <span className="listing-card__price">{rentDisplay}</span>
          {listing.monthly_rent && listing.monthly_rent > 0 && (
            <span className="listing-card__period">/month</span>
          )}
        </div>
      </Link>
    </article>
  );
}
