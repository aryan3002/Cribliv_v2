"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { signOut, useSession } from "next-auth/react";
import { Building2, Plus, RefreshCw, Sparkles } from "lucide-react";
import { listOwnerListings, type ListingStatus, type OwnerListingVm } from "../../lib/owner-api";
import { t, type Locale } from "../../lib/i18n";
import { BoostModal } from "./boost-modal";
import { ListingCardLuxe } from "./listing-card-luxe";

type LoadState =
  | { status: "loading"; items: OwnerListingVm[]; total: number }
  | { status: "ready"; items: OwnerListingVm[]; total: number }
  | { status: "error"; items: OwnerListingVm[]; total: number; message: string };

type FilterValue = ListingStatus | "all";
type I18nKey = string;

const EMPTY_LISTINGS = { items: [] as OwnerListingVm[], total: 0 };

const STATUS_FILTERS: Array<{ value: FilterValue; labelKey: I18nKey }> = [
  { value: "all", labelKey: "ownerFilterAll" },
  { value: "draft", labelKey: "ownerFilterDrafts" },
  { value: "pending_review", labelKey: "ownerFilterPending" },
  { value: "active", labelKey: "ownerFilterActive" },
  { value: "rejected", labelKey: "ownerFilterRejected" },
  { value: "paused", labelKey: "ownerFilterPaused" }
];

function rawErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : typeof err === "string" ? err : "";
}

function isUnauthorizedError(err: unknown): boolean {
  const message = rawErrorMessage(err).toLowerCase();
  return message.includes("unauthorized") || message.includes("status 401");
}

function isNetworkError(err: unknown): boolean {
  const message = rawErrorMessage(err).toLowerCase();
  return (
    message.includes("failed to fetch") ||
    message.includes("network") ||
    message.includes("offline") ||
    message.includes("load failed")
  );
}

function listingsErrorMessage(err: unknown, loc: Locale): string {
  if (isUnauthorizedError(err)) return t(loc, "ownerListingsErrorUnauthorized");
  if (isNetworkError(err)) return t(loc, "ownerListingsErrorNetwork");
  return t(loc, "ownerListingsErrorListings");
}

function filterMatches(listing: OwnerListingVm, filter: FilterValue): boolean {
  return filter === "all" || listing.status === filter;
}

export function OwnerListingsClient(props: { locale: string }): JSX.Element {
  const loc = props.locale as Locale;
  const { data: nextAuthSession } = useSession();
  const accessToken = nextAuthSession?.accessToken ?? null;
  const [filter, setFilter] = useState<FilterValue>("all");
  const [listingState, setListingState] = useState<LoadState>({
    status: "loading",
    ...EMPTY_LISTINGS
  });
  const [boostListing, setBoostListing] = useState<OwnerListingVm | null>(null);
  const [boostNotice, setBoostNotice] = useState<string | null>(null);

  const loadListings = useCallback(() => {
    if (!accessToken) {
      setListingState({
        status: "error",
        ...EMPTY_LISTINGS,
        message: t(loc, "loginRequired")
      });
      return;
    }

    setListingState((prev) => ({ status: "loading", items: prev.items, total: prev.total }));
    const statusQuery = filter === "all" ? undefined : filter;

    listOwnerListings(accessToken, statusQuery)
      .then((response) => {
        setListingState({
          status: "ready",
          items: response.items,
          total: response.total
        });
      })
      .catch((err) => {
        const message = listingsErrorMessage(err, loc);
        if (isUnauthorizedError(err)) void signOut({ redirect: false });
        setListingState((prev) => ({
          status: "error",
          items: prev.items,
          total: prev.total,
          message
        }));
      });
  }, [accessToken, filter, loc]);

  useEffect(() => {
    loadListings();
  }, [loadListings]);

  const visibleListings = useMemo(
    () => listingState.items.filter((listing) => filterMatches(listing, filter)),
    [filter, listingState.items]
  );

  function updateListingStatus(id: string, newStatus: "active" | "paused") {
    setListingState((prev) => ({
      ...prev,
      items: prev.items.map((listing) =>
        listing.id === id ? { ...listing, status: newStatus } : listing
      )
    }));
  }

  function handleBoostSuccess() {
    setBoostNotice(t(loc, "ownerListingsBoostSuccess"));
    setBoostListing(null);
  }

  const emptyTitle =
    filter === "all" ? t(loc, "ownerListingsEmptyTitle") : t(loc, "ownerListingsFilteredEmpty");
  const isInitialLoading = listingState.status === "loading" && listingState.items.length === 0;

  return (
    <div className="olc">
      <header className="olc-hero">
        <div className="olc-hero__copy">
          <p className="ovo-eyebrow">{t(loc, "ownerListingsEyebrow")}</p>
          <h1 className="olc-title">{t(loc, "ownerListingsTitle")}</h1>
          <p className="olc-subtitle">{t(loc, "ownerListingsSubtitle")}</p>
        </div>
        <Link href={`/${props.locale}/owner/listings/new`} className="ovo-add-listing">
          <Plus size={16} aria-hidden="true" />
          {t(loc, "createListing")}
        </Link>
      </header>

      {boostNotice && (
        <p className="olc-notice" role="status">
          <Sparkles size={15} aria-hidden="true" />
          {boostNotice}
        </p>
      )}

      <section className="olc-toolbar" aria-label={t(loc, "ownerListingsToolbar")}>
        <div className="olc-filter-row" role="group" aria-label={t(loc, "ownerFilterGroup")}>
          {STATUS_FILTERS.map((item) => {
            const active = item.value === filter;
            return (
              <button
                key={item.value}
                type="button"
                className={`olc-chip${active ? " olc-chip--active" : ""}`}
                aria-pressed={active}
                onClick={() => setFilter(item.value)}
              >
                {t(loc, item.labelKey)}
              </button>
            );
          })}
        </div>
      </section>

      {listingState.status === "error" ? (
        <div className="olc-error" role="alert">
          <p>{listingState.message}</p>
          <button type="button" onClick={loadListings}>
            <RefreshCw size={14} aria-hidden="true" />
            {t(loc, "ownerOverviewRetry")}
          </button>
        </div>
      ) : isInitialLoading ? (
        <div className="dlx-grid dlx-grid--listings" aria-label={t(loc, "ownerListingsLoading")}>
          {[1, 2, 3].map((item) => (
            <div key={item} className="lcl lcl--skeleton" />
          ))}
        </div>
      ) : visibleListings.length === 0 ? (
        <div className="olc-empty">
          <span className="olc-empty__icon" aria-hidden="true">
            <Building2 size={22} />
          </span>
          <h2>{emptyTitle}</h2>
          <p>
            {filter === "all"
              ? t(loc, "ownerListingsEmptyBody")
              : t(loc, "ownerListingsFilteredEmptyBody")}
          </p>
          {filter === "all" ? (
            <Link href={`/${props.locale}/owner/listings/new`} className="ovo-add-listing">
              <Plus size={16} aria-hidden="true" />
              {t(loc, "createListing")}
            </Link>
          ) : (
            <button type="button" className="olc-secondary-button" onClick={() => setFilter("all")}>
              {t(loc, "ownerListingsShowAll")}
            </button>
          )}
        </div>
      ) : (
        <div className="dlx-grid dlx-grid--listings">
          {visibleListings.map((listing) => (
            <ListingCardLuxe
              key={listing.id}
              listing={listing}
              locale={props.locale}
              accessToken={accessToken}
              onStatusChange={updateListingStatus}
              onBoost={(item) => setBoostListing(item)}
            />
          ))}
        </div>
      )}

      {accessToken && boostListing && (
        <BoostModal
          listingId={boostListing.id}
          listingTitle={boostListing.title}
          accessToken={accessToken}
          isOpen={Boolean(boostListing)}
          onClose={() => setBoostListing(null)}
          onSuccess={handleBoostSuccess}
        />
      )}
    </div>
  );
}
