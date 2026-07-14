"use client";

import { useRef } from "react";
import Link from "next/link";
import type { Route } from "next";
import {
  ShieldCheck,
  MapPin,
  Building,
  UtensilsCrossed,
  ChevronLeft,
  ChevronRight
} from "lucide-react";
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
  const stripRef = useRef<HTMLDivElement>(null);
  const features = [
    genderLabel && { id: "gender", label: genderLabel, className: "pg-badge--gender" },
    listing.food_included && { id: "food", label: "Food", className: "pg-badge--food" },
    ...listing.sharing_options.map((sharing) => ({
      id: `sharing-${sharing}`,
      label: SHARING_LABEL[sharing] ?? sharing,
      className: "pg-badge--sharing"
    })),
    listing.verified && { id: "verified", label: "Verified", className: "pg-badge--trust" }
  ].filter(Boolean) as Array<{ id: string; label: string; className: string }>;
  const onCardClick = () =>
    trackPgCardClick({ listing_id: listing.id, position, surface, city: listing.city, filters });
  const scrollStrip = (direction: "previous" | "next") =>
    stripRef.current?.scrollBy({
      left: direction === "next" ? 140 : -140,
      behavior: "smooth"
    });

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
        <span className="listing-card__type-pill">PG / Hostel</span>
      </Link>

      <div className="listing-card__body">
        <Link href={href} className="pg-card__body-link" onClick={onCardClick}>
          <div className="pg-card__body-top">
            <div>
              <h3 className="listing-card__title">{listing.title}</h3>
              <div className="listing-card__loc">
                <MapPin size={12} aria-hidden="true" />
                <span>
                  {[listing.locality, cityDisplay].filter(Boolean).join(", ") || "Location"}
                </span>
              </div>
            </div>
            <div className="pg-card__price-stack">
              <span className="listing-card__price">{rentFrom}</span>
              {listing.starting_rent && listing.starting_rent > 0 && (
                <span className="listing-card__period">/month</span>
              )}
            </div>
          </div>
          <span className="pg-card__trust-line">
            <ShieldCheck size={12} aria-hidden="true" /> Live details
          </span>
        </Link>

        {features.length > 0 && (
          <div className="pg-card-strip-shell">
            {features.length > 1 && (
              <button
                type="button"
                className="pg-card-strip-button"
                aria-label="Previous PG feature"
                onClick={() => scrollStrip("previous")}
              >
                <ChevronLeft size={16} aria-hidden="true" />
              </button>
            )}
            <div ref={stripRef} className="pg-card__strip" data-testid="pg-card-strip">
              {features.map((feature) => (
                <span key={feature.id} className={`pg-badge ${feature.className}`}>
                  {feature.id === "food" && <UtensilsCrossed size={11} aria-hidden="true" />}
                  {feature.id === "verified" && <ShieldCheck size={11} aria-hidden="true" />}
                  {feature.label}
                </span>
              ))}
            </div>
            {features.length > 1 && (
              <button
                type="button"
                className="pg-card-strip-button"
                aria-label="Next PG feature"
                onClick={() => scrollStrip("next")}
              >
                <ChevronRight size={16} aria-hidden="true" />
              </button>
            )}
          </div>
        )}
      </div>
    </article>
  );
}
