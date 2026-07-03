"use client";

import Link from "next/link";
import type { Route } from "next";
import { ShieldCheck, MapPin, Building, UtensilsCrossed } from "lucide-react";
import { Badge } from "@cribliv/ui";
import type { PgCard } from "../../lib/pg-public-api";
import { trackPgCardClick } from "../../lib/pg-track";

const SHARING_LABEL: Record<string, string> = {
  single: "Single",
  double: "Double",
  triple: "Triple",
  quad: "Quad",
  dorm: "Dorm"
};

const GENDER_LABEL: Record<string, string> = {
  boys: "Boys",
  girls: "Girls",
  coed: "Co-ed"
};

function toCityDisplay(slug?: string | null): string | null {
  if (!slug) return null;
  return slug.charAt(0).toUpperCase() + slug.slice(1).toLowerCase();
}

export function PgListingCard({
  listing,
  locale,
  position = 0,
  surface = "pg_search",
  filters = {}
}: {
  listing: PgCard;
  locale: string;
  position?: number;
  surface?: "pg_search" | "pg_city" | "pg_detail_similar";
  filters?: Record<string, string>;
}) {
  const href = `/${locale}/pg/${listing.city}/${listing.id}` as Route;
  const cityDisplay = listing.city_name ?? toCityDisplay(listing.city);
  const rentFrom =
    listing.starting_rent && listing.starting_rent > 0
      ? `from ₹${listing.starting_rent.toLocaleString("en-IN")}`
      : "Price on request";
  const genderLabel = listing.gender_policy ? GENDER_LABEL[listing.gender_policy] : null;
  const onCardClick = () =>
    trackPgCardClick({ listing_id: listing.id, position, surface, city: listing.city, filters });

  return (
    <article className="listing-card">
      <Link
        href={href}
        className="listing-card__media"
        aria-label={listing.title}
        onClick={onCardClick}
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
        {listing.verified && (
          <Badge
            tone="verified"
            style={{
              position: "absolute",
              left: 10,
              top: 10,
              zIndex: 2,
              background: "rgba(255,255,255,0.94)",
              boxShadow: "var(--shadow-sm)",
              backdropFilter: "blur(6px)"
            }}
          >
            <ShieldCheck size={12} aria-hidden="true" /> Verified
          </Badge>
        )}
        <span className="listing-card__type-pill">PG / Hostel</span>
      </Link>

      <Link href={href} className="listing-card__body" onClick={onCardClick}>
        <div className="listing-card__row1">
          <h3 className="listing-card__title">{listing.title}</h3>
        </div>

        <div className="listing-card__loc">
          <MapPin size={12} aria-hidden="true" />
          <span>{[listing.locality, cityDisplay].filter(Boolean).join(", ") || "Location"}</span>
        </div>

        <div className="pg-card__badges">
          {genderLabel && <span className="pg-badge pg-badge--gender">{genderLabel}</span>}
          {listing.food_included && (
            <span className="pg-badge pg-badge--food">
              <UtensilsCrossed size={11} aria-hidden="true" /> Food
            </span>
          )}
          {listing.sharing_options.map((s) => (
            <span key={s} className="pg-badge pg-badge--sharing">
              {SHARING_LABEL[s] ?? s}
            </span>
          ))}
        </div>

        <div className="listing-card__price-row">
          <span>
            <span className="listing-card__price">{rentFrom}</span>
            {listing.starting_rent && listing.starting_rent > 0 && (
              <span className="listing-card__period">/month</span>
            )}
          </span>
          <Badge tone="neutral" style={{ fontSize: 11, padding: "4px 8px" }}>
            <ShieldCheck size={12} aria-hidden="true" /> Live details
          </Badge>
        </div>
      </Link>
    </article>
  );
}
