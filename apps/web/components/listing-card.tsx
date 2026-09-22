"use client";

import Link from "next/link";
import type { Route } from "next";
import type { ReactNode } from "react";
import {
  ShieldCheck,
  Building,
  MapPin,
  BedDouble,
  Maximize2,
  Sofa,
  UtensilsCrossed,
  Clock
} from "lucide-react";
import { Badge } from "@cribliv/ui";
import styles from "./listing-card.module.css";
import { ListingCardHeart } from "./listing-card-heart";
import { NotifyAvailabilityButton } from "./listing/notify-availability-button";
import { useFlag } from "../lib/feature-flags";
import { t, type Locale } from "../lib/i18n";
import { motion, useReducedMotion } from "framer-motion";
import { RentReveal, SafetyRow } from "./motion/TrustMotion";

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
  /** Independent of `verification_status` — mirrors the `listings.is_available`
   *  DB column (migration 0067). Only rendered when `ff_unavailable_listings`
   *  is on; ignored entirely (no dimming/badge/notify) when the flag is off. */
  is_available?: boolean;
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
  /** Force the TrustMotion treatment on/off. Omit to gate via ff_trust_motion. */
  trustMotion?: boolean;
}

export function ListingCardItem({
  listing,
  locale,
  heartSlot,
  compact = false,
  trustMotion
}: ListingCardItemProps) {
  const cityDisplay = listing.city_name ?? toDisplayCity(listing.city);
  const isPg = listing.listing_type === "pg";
  const typeLabel = isPg ? "PG" : "Flat / House";
  // PG listings use the split route /[locale]/pg/[city]/[id]; flats keep /[locale]/listing/[id].
  const href = (
    isPg && listing.city
      ? `/${locale}/pg/${listing.city}/${listing.id}`
      : `/${locale}/listing/${listing.id}`
  ) as Route;
  const rentDisplay = formatRent(listing.monthly_rent);
  const hasRent = !!listing.monthly_rent && listing.monthly_rent > 0;
  const isVerified = listing.verification_status === "verified";
  const fLabel = furnishLabel(listing.furnishing);
  // Gated at the card level (not just via a child's self-hiding check) so no
  // unavailable-listing UI leaks when the flag is off — see Task 8's lesson.
  const ffUnavailableListings = useFlag("ff_unavailable_listings");
  const isUnavailable = ffUnavailableListings && listing.is_available === false;
  const loc = locale as Locale;
  // TrustMotion: verified pill pops in, rent counts up + underline, safety strip.
  // The prop overrides the flag (used by the preview); suppressed on unavailable.
  const ffTrustMotion = useFlag("ff_trust_motion");
  const reducedMotion = !!useReducedMotion();
  const showTrust = (trustMotion ?? ffTrustMotion) && !isUnavailable;
  const verifiedBadge = (
    <Badge
      tone="verified"
      style={{
        background: "rgba(255,255,255,0.94)",
        boxShadow: "var(--shadow-sm)",
        backdropFilter: "blur(6px)"
      }}
    >
      <ShieldCheck size={12} aria-hidden="true" /> Verified
    </Badge>
  );

  const chips: { icon: ReactNode; label: string }[] = [];
  if (listing.bhk) chips.push({ icon: <BedDouble size={12} />, label: `${listing.bhk} BHK` });
  if (listing.area_sqft)
    chips.push({ icon: <Maximize2 size={12} />, label: `${listing.area_sqft} sqft` });
  if (fLabel) chips.push({ icon: <Sofa size={12} />, label: fLabel });
  if (isPg) chips.push({ icon: <UtensilsCrossed size={12} />, label: "Shared living" });

  return (
    <article className={`${styles.card}${compact ? ` ${styles.compact}` : ""}`}>
      <Link href={href} className={styles.media} aria-label={listing.title}>
        {listing.cover_photo ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={listing.cover_photo}
            alt={listing.title}
            loading="lazy"
            className={`${styles.img}${isUnavailable ? ` ${styles.imgDimmed}` : ""}`}
          />
        ) : (
          <div
            className={`${styles.placeholder}${isUnavailable ? ` ${styles.imgDimmed}` : ""}`}
            aria-hidden="true"
          >
            <Building size={34} strokeWidth={1.5} />
          </div>
        )}
        <span className={styles.scrim} aria-hidden="true" />

        <div className={styles.badgeRow}>
          {isVerified ? (
            showTrust ? (
              <span style={{ position: "relative", display: "inline-flex" }}>
                {!reducedMotion && (
                  <motion.span
                    aria-hidden
                    initial={{ opacity: 0.5, scale: 1 }}
                    animate={{ opacity: 0, scale: 1.9 }}
                    transition={{ duration: 0.7, ease: "easeOut", delay: 0.3 }}
                    style={{
                      position: "absolute",
                      inset: -2,
                      borderRadius: 9999,
                      border: "2px solid #0d9f4f"
                    }}
                  />
                )}
                <motion.span
                  initial={reducedMotion ? false : { scale: 0, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  transition={{
                    type: "spring",
                    stiffness: 420,
                    damping: 24,
                    mass: 0.7,
                    delay: 0.12
                  }}
                >
                  {verifiedBadge}
                </motion.span>
              </span>
            ) : (
              verifiedBadge
            )
          ) : (
            <span />
          )}
          {heartSlot ?? <ListingCardHeart listingId={listing.id} />}
        </div>

        <span className={`${styles.typePill}${isPg ? ` ${styles.typePillPg}` : ""}`}>
          {typeLabel}
        </span>

        {isUnavailable && (
          <div className={styles.unavailBanner}>
            <Clock size={15} strokeWidth={2.25} aria-hidden="true" />
            {t(loc, "availUnavailableChip")}
          </div>
        )}
      </Link>

      <Link href={href} className={styles.body}>
        <h3 className={styles.title}>{listing.title}</h3>

        <div className={styles.loc}>
          <MapPin size={13} aria-hidden="true" />
          <span className={styles.locText}>
            {[listing.locality, cityDisplay].filter(Boolean).join(", ") || "Location"}
          </span>
        </div>

        {chips.length > 0 && (
          <div className={styles.metaRow}>
            {chips.map((c) => (
              <span key={c.label} className={styles.metaChip}>
                {c.icon}
                {c.label}
              </span>
            ))}
          </div>
        )}

        <div className={styles.priceRow}>
          {showTrust && hasRent ? (
            <RentReveal
              rent={listing.monthly_rent ?? 0}
              per={isPg ? "/mo onwards" : "/month"}
              style={{ fontSize: 18 }}
            />
          ) : (
            <span className={styles.priceWrap}>
              <span className={styles.price}>{rentDisplay}</span>
              {hasRent && <span className={styles.period}>{isPg ? "/mo onwards" : "/month"}</span>}
            </span>
          )}
          {!isUnavailable && (
            <Badge tone="neutral" style={{ fontSize: 11, padding: "4px 8px" }}>
              <ShieldCheck size={12} aria-hidden="true" /> Live details
            </Badge>
          )}
        </div>

        {isUnavailable && (
          <NotifyAvailabilityButton listingId={listing.id} locale={locale} variant="inline" />
        )}
      </Link>
      {showTrust && !compact && (
        <div style={{ padding: "0 14px 14px" }}>
          <SafetyRow
            items={["Verified owner", "Real photos", "No brokerage"]}
            style={{ gap: 12 }}
          />
        </div>
      )}
    </article>
  );
}
