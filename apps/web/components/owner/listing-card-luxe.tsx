"use client";

import Image from "next/image";
import Link from "next/link";
import {
  MapPin,
  Pencil,
  Zap,
  ShieldCheck,
  Clock,
  AlertCircle,
  XCircle,
  Building,
  Home as HomeIcon
} from "lucide-react";
import type { OwnerListingVm, ListingStatus } from "../../lib/owner-api";
import { toTitleCase, VERIFICATION_LABELS } from "../../lib/utils";
import { AvailabilityToggle } from "./availability-toggle";

interface Props {
  listing: OwnerListingVm;
  locale: string;
  accessToken: string | null;
  onStatusChange: (id: string, newStatus: "active" | "paused") => void;
  onBoost: (listing: OwnerListingVm) => void;
}

const STATUS_META: Record<
  ListingStatus,
  { label: string; bg: string; color: string; ring: string }
> = {
  active: {
    label: "Active",
    bg: "rgba(13, 159, 79, 0.12)",
    color: "#0A6F37",
    ring: "rgba(13, 159, 79, 0.32)"
  },
  pending_review: {
    label: "Pending",
    bg: "rgba(232, 140, 0, 0.12)",
    color: "#965500",
    ring: "rgba(232, 140, 0, 0.32)"
  },
  draft: {
    label: "Draft",
    bg: "rgba(100, 116, 139, 0.12)",
    color: "#475569",
    ring: "rgba(100, 116, 139, 0.32)"
  },
  rejected: {
    label: "Rejected",
    bg: "rgba(220, 38, 38, 0.12)",
    color: "#B91C1C",
    ring: "rgba(220, 38, 38, 0.32)"
  },
  paused: {
    label: "Paused",
    bg: "rgba(245, 158, 11, 0.12)",
    color: "#92400E",
    ring: "rgba(245, 158, 11, 0.32)"
  },
  archived: {
    label: "Archived",
    bg: "rgba(107, 114, 128, 0.12)",
    color: "#4B5563",
    ring: "rgba(107, 114, 128, 0.32)"
  }
};

export function ListingCardLuxe({ listing, locale, accessToken, onStatusChange, onBoost }: Props) {
  const status = STATUS_META[listing.status] ?? STATUS_META.draft;
  const isVerified = listing.verificationStatus === "verified";
  const isPendingVerif = listing.verificationStatus === "pending";
  const isFailedVerif = listing.verificationStatus === "failed";
  const cover = listing.coverImage || listing.photos?.[0];
  const localityInitial = (listing.locality || listing.city || "C").trim().charAt(0).toUpperCase();
  const editHref = `/${locale}/owner/listings/new?edit=${listing.id}`;

  const verifLabel =
    VERIFICATION_LABELS[listing.verificationStatus as keyof typeof VERIFICATION_LABELS];

  return (
    <article
      className={`lcl${listing.status === "paused" ? " lcl--paused" : ""}`}
      data-status={listing.status}
    >
      {/* media */}
      <Link
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        href={editHref as any}
        className="lcl__media"
        aria-label={`Open ${listing.title}`}
      >
        {cover ? (
          <Image
            src={cover}
            alt={listing.title}
            fill
            sizes="(min-width: 1280px) 380px, (min-width: 768px) 45vw, 92vw"
            className="lcl__img"
          />
        ) : (
          <div className="lcl__placeholder">
            <svg className="lcl__placeholder-grid" aria-hidden="true">
              <defs>
                <pattern
                  id={`g-${listing.id}`}
                  width="22"
                  height="22"
                  patternUnits="userSpaceOnUse"
                >
                  <circle cx="1" cy="1" r="1" fill="rgba(255,255,255,0.10)" />
                </pattern>
              </defs>
              <rect width="100%" height="100%" fill={`url(#g-${listing.id})`} />
            </svg>
            <span className="lcl__placeholder-monogram">{localityInitial}</span>
            <span className="lcl__placeholder-type">
              {listing.listingType === "pg" ? <Building size={14} /> : <HomeIcon size={14} />}
              {listing.listingType === "pg" ? "PG" : "Flat / House"}
            </span>
          </div>
        )}

        {/* gradient mask for legibility */}
        <span className="lcl__media-mask" aria-hidden="true" />

        {/* verification ribbon */}
        <span
          className={`lcl__ribbon${
            isVerified
              ? " lcl__ribbon--ok"
              : isFailedVerif
                ? " lcl__ribbon--fail"
                : isPendingVerif
                  ? " lcl__ribbon--pending"
                  : ""
          }`}
        >
          {isVerified ? (
            <ShieldCheck size={12} aria-hidden="true" />
          ) : isPendingVerif ? (
            <Clock size={12} aria-hidden="true" />
          ) : isFailedVerif ? (
            <XCircle size={12} aria-hidden="true" />
          ) : (
            <AlertCircle size={12} aria-hidden="true" />
          )}
          {verifLabel ?? "Unverified"}
        </span>

        {/* status chip */}
        <span
          className="lcl__status"
          style={{
            background: status.bg,
            color: status.color,
            boxShadow: `inset 0 0 0 1px ${status.ring}`
          }}
        >
          {status.label}
        </span>
      </Link>

      {/* body */}
      <div className="lcl__body">
        <h3 className="lcl__title" title={listing.title}>
          {listing.title || "Untitled listing"}
        </h3>

        <div className="lcl__meta">
          <span className="lcl__meta-item">
            <MapPin size={12} aria-hidden="true" />
            {listing.locality
              ? `${toTitleCase(listing.locality)}${listing.city ? `, ${toTitleCase(listing.city)}` : ""}`
              : listing.city
                ? toTitleCase(listing.city)
                : "Location not set"}
          </span>
          <span className="lcl__meta-dot" aria-hidden="true">
            ·
          </span>
          <span className="lcl__meta-item lcl__meta-item--muted">
            {listing.listingType === "pg" ? "PG" : "Flat / House"}
          </span>
        </div>

        <div className="lcl__price-row">
          {typeof listing.monthlyRent === "number" ? (
            <span className="lcl__price">
              <span className="lcl__price-currency">₹</span>
              {listing.monthlyRent.toLocaleString("en-IN")}
              <span className="lcl__price-per">/mo</span>
            </span>
          ) : (
            <span className="lcl__price lcl__price--empty">Rent not set</span>
          )}
        </div>

        <div className="lcl__actions">
          {(listing.status === "active" || listing.status === "paused") && accessToken && (
            <AvailabilityToggle
              listingId={listing.id}
              currentStatus={listing.status as "active" | "paused"}
              accessToken={accessToken}
              showLabel={false}
              onStatusChange={(newStatus) => onStatusChange(listing.id, newStatus)}
            />
          )}

          {(listing.status === "draft" ||
            listing.status === "rejected" ||
            listing.status === "pending_review" ||
            listing.status === "active" ||
            listing.status === "paused") && (
            <Link
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              href={editHref as any}
              className="lcl__btn lcl__btn--primary"
            >
              <Pencil size={12} aria-hidden="true" />
              {listing.status === "rejected" ? "Fix & Resubmit" : "Edit"}
            </Link>
          )}

          {listing.status === "active" && (
            <button
              type="button"
              className="lcl__btn lcl__btn--boost"
              onClick={() => onBoost(listing)}
            >
              <Zap size={12} aria-hidden="true" />
              Boost
            </button>
          )}
        </div>
      </div>
    </article>
  );
}
