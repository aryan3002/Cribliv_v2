"use client";

import { useEffect, useRef, useState } from "react";
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
  Home as HomeIcon,
  MoreHorizontal,
  Users
} from "lucide-react";
import type { OwnerListingVm, ListingStatus } from "../../lib/owner-api";
import { t, type Locale } from "../../lib/i18n";
import { toTitleCase, VERIFICATION_LABELS } from "../../lib/utils";
import { useFlag } from "../../lib/feature-flags";
import { AvailabilityToggle } from "./availability-toggle";
import { ListingAvailabilityToggle } from "./listing-availability-toggle";
import { SeekerNearWidget } from "./seeker-near-widget";

interface Props {
  listing: OwnerListingVm;
  locale: string;
  accessToken: string | null;
  onStatusChange: (id: string, newStatus: "active" | "paused") => void;
  onAvailabilityChange?: (id: string, newAvailable: boolean) => void;
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

export function ListingCardLuxe({
  listing,
  locale,
  accessToken,
  onStatusChange,
  onAvailabilityChange,
  onBoost
}: Props) {
  const [actionsOpen, setActionsOpen] = useState(false);
  const actionsDialogRef = useRef<HTMLDivElement>(null);
  const actionsTriggerRef = useRef<HTMLButtonElement>(null);
  const actionsCloseRef = useRef<HTMLButtonElement>(null);
  const ffUnavailableListings = useFlag("ff_unavailable_listings");
  const loc = locale as Locale;
  const status = STATUS_META[listing.status] ?? STATUS_META.draft;
  const isVerified = listing.verificationStatus === "verified";
  const isPendingVerif = listing.verificationStatus === "pending";
  const isFailedVerif = listing.verificationStatus === "failed";
  const cover = listing.coverImage || listing.photos?.[0];
  const localityInitial = (listing.locality || listing.city || "C").trim().charAt(0).toUpperCase();
  const editHref = `/${locale}/owner/listings/new?edit=${listing.id}`;
  const verificationHref = `/${locale}/owner/verification?listing=${listing.id}`;
  const canToggleAvailability =
    (listing.status === "active" || listing.status === "paused") && Boolean(accessToken);
  // Stricter than the Visibility gate above: "not available" only makes sense
  // for a listing that's actually live and searchable (flats/houses only —
  // see the design spec's monetization/waitlist scope).
  const isEligibleForAvailabilityToggle =
    listing.listingType === "flat_house" && listing.status === "active";
  // Gated by ff_unavailable_listings at the card level so the wrapper divs
  // (which carry visible box styling in the actions sheet) don't render an
  // empty shell when the flag is off — the child's own `if (!flagOn) return
  // null` is defense-in-depth, not the only gate.
  const canToggleListingAvailability =
    ffUnavailableListings && isEligibleForAvailabilityToggle && Boolean(accessToken);
  const showWaitlistNudge =
    ffUnavailableListings &&
    isEligibleForAvailabilityToggle &&
    Boolean(listing.waitlist_count) &&
    listing.is_available === false;
  const canEdit =
    listing.status === "draft" ||
    listing.status === "rejected" ||
    listing.status === "pending_review" ||
    listing.status === "active" ||
    listing.status === "paused";
  const canBoost = listing.status === "active";
  const editLabel = listing.status === "rejected" ? "Fix and resubmit" : "Edit";

  const verifLabel =
    VERIFICATION_LABELS[listing.verificationStatus as keyof typeof VERIFICATION_LABELS];

  function handleBoost() {
    setActionsOpen(false);
    onBoost(listing);
  }

  useEffect(() => {
    if (!actionsOpen) return;
    const previousOverflow = document.body.style.overflow;
    const trigger = actionsTriggerRef.current;
    document.body.style.overflow = "hidden";
    const focusTimer = window.setTimeout(() => actionsCloseRef.current?.focus(), 0);

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setActionsOpen(false);
        return;
      }
      if (event.key !== "Tab") return;

      const focusable = Array.from(
        actionsDialogRef.current?.querySelectorAll<HTMLElement>(
          'button:not([disabled]), a[href], input:not([disabled]), [tabindex]:not([tabindex="-1"])'
        ) ?? []
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown);
    return () => {
      window.clearTimeout(focusTimer);
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
      trigger?.focus();
    };
  }, [actionsOpen]);

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

        {listing.status === "active" && (
          <SeekerNearWidget listingId={listing.id} accessToken={accessToken} />
        )}

        <div className="lcl__actions">
          {canEdit && (
            <Link
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              href={editHref as any}
              className="lcl__btn lcl__btn--primary"
            >
              <Pencil size={12} aria-hidden="true" />
              {editLabel}
            </Link>
          )}

          <button
            ref={actionsTriggerRef}
            type="button"
            className="lcl__btn lcl__btn--more"
            onClick={() => setActionsOpen(true)}
            aria-haspopup="dialog"
          >
            <MoreHorizontal size={15} aria-hidden="true" />
            More actions
          </button>

          {canToggleAvailability && accessToken && (
            <div className="lcl__desktop-action">
              <AvailabilityToggle
                listingId={listing.id}
                currentStatus={listing.status as "active" | "paused"}
                accessToken={accessToken}
                showLabel={false}
                errorMessage={t(loc, "ownerListingsErrorAvailability")}
                onStatusChange={(newStatus) => onStatusChange(listing.id, newStatus)}
              />
            </div>
          )}

          {canToggleListingAvailability && accessToken && (
            <div className="lcl__desktop-action">
              <ListingAvailabilityToggle
                listingId={listing.id}
                accessToken={accessToken}
                available={listing.is_available ?? true}
                showLabel={false}
                errorMessage={t(loc, "ownerListingsErrorListingAvailability")}
                onAvailabilityChange={(next) => onAvailabilityChange?.(listing.id, next)}
              />
            </div>
          )}

          {canBoost && (
            <button
              type="button"
              className="lcl__btn lcl__btn--boost lcl__desktop-action"
              onClick={handleBoost}
            >
              <Zap size={12} aria-hidden="true" />
              Boost
            </button>
          )}
        </div>

        {showWaitlistNudge && (
          <div className="lcl__waitlist-nudge">
            <Users size={14} aria-hidden="true" />
            <span>{listing.waitlist_count} people want to be notified when this is available</span>
          </div>
        )}
      </div>

      {actionsOpen && (
        <div
          className="lcl-sheet__overlay"
          role="presentation"
          onClick={(e) => {
            if (e.target === e.currentTarget) setActionsOpen(false);
          }}
        >
          <div
            ref={actionsDialogRef}
            className="lcl-sheet"
            role="dialog"
            aria-modal="true"
            aria-label="Listing actions"
          >
            <div className="lcl-sheet__header">
              <h4>{listing.title || "Listing actions"}</h4>
              <button
                ref={actionsCloseRef}
                type="button"
                className="lcl-sheet__close"
                aria-label="Close actions"
                onClick={() => setActionsOpen(false)}
              >
                <XCircle size={18} aria-hidden="true" />
              </button>
            </div>

            <div className="lcl-sheet__actions">
              {canEdit && (
                <Link
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  href={editHref as any}
                  className="lcl-sheet__action lcl-sheet__action--primary"
                  onClick={() => setActionsOpen(false)}
                >
                  <Pencil size={16} aria-hidden="true" />
                  {editLabel}
                </Link>
              )}

              {!isVerified && (
                <Link
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  href={verificationHref as any}
                  className="lcl-sheet__action"
                  onClick={() => setActionsOpen(false)}
                >
                  <ShieldCheck size={16} aria-hidden="true" />
                  Verify listing
                </Link>
              )}

              {canBoost && (
                <button type="button" className="lcl-sheet__action" onClick={handleBoost}>
                  <Zap size={16} aria-hidden="true" />
                  Boost
                </button>
              )}

              {canToggleAvailability && accessToken && (
                <div className="lcl-sheet__availability">
                  <AvailabilityToggle
                    listingId={listing.id}
                    currentStatus={listing.status as "active" | "paused"}
                    accessToken={accessToken}
                    errorMessage={t(loc, "ownerListingsErrorAvailability")}
                    onStatusChange={(newStatus) => onStatusChange(listing.id, newStatus)}
                  />
                </div>
              )}

              {canToggleListingAvailability && accessToken && (
                <div className="lcl-sheet__availability">
                  <ListingAvailabilityToggle
                    listingId={listing.id}
                    accessToken={accessToken}
                    available={listing.is_available ?? true}
                    errorMessage={t(loc, "ownerListingsErrorListingAvailability")}
                    onAvailabilityChange={(next) => onAvailabilityChange?.(listing.id, next)}
                  />
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </article>
  );
}
