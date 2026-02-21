"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useSession, signOut } from "next-auth/react";
import {
  createSalesLead,
  type ListingStatus,
  makeIdempotencyKey,
  type OwnerListingVm,
  listOwnerListings
} from "../../../../lib/owner-api";
import { trackEvent } from "../../../../lib/analytics";
import { t, type Locale } from "../../../../lib/i18n";

const STATUS_FILTERS: Array<{ value: ListingStatus | "all"; label: string }> = [
  { value: "all", label: "All" },
  { value: "draft", label: "Drafts" },
  { value: "pending_review", label: "Pending" },
  { value: "active", label: "Active" },
  { value: "rejected", label: "Rejected" },
  { value: "paused", label: "Paused" }
];

const STATUS_LABEL: Record<ListingStatus, string> = {
  draft: "Draft",
  pending_review: "Pending Review",
  active: "Active",
  rejected: "Rejected",
  paused: "Paused",
  archived: "Archived"
};

const VERIFICATION_LABEL: Record<OwnerListingVm["verificationStatus"], string> = {
  unverified: "Unverified",
  pending: "Verification Pending",
  verified: "Verified",
  failed: "Verification Failed"
};

export default function OwnerDashboardPage({ params }: { params: { locale: string } }) {
  const locale = params.locale as Locale;
  const { data: nextAuthSession } = useSession();
  const accessToken = (nextAuthSession as { accessToken?: string } | null)?.accessToken ?? null;
  const userRole = (nextAuthSession?.user as { role?: string } | undefined)?.role as
    | "owner"
    | "pg_operator"
    | undefined;

  /** True when this user is specifically a PG operator */
  const isPgOperator = userRole === "pg_operator";
  const dashboardTitle = isPgOperator ? "Your PG Listings" : "Your Listings";
  const createListingLabel = isPgOperator ? "+ Add PG" : t(locale, "createListing");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const newListingHref = `/${locale}/owner/listings/new${isPgOperator ? "?type=pg" : ""}` as any;

  const [listings, setListings] = useState<OwnerListingVm[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<ListingStatus | "all">("all");
  const [pmRequesting, setPmRequesting] = useState(false);
  const [pmNotice, setPmNotice] = useState<string | null>(null);

  useEffect(() => {
    void loadListings();
  }, [statusFilter]);

  async function loadListings() {
    setLoading(true);
    setError(null);

    if (!accessToken) {
      setError(t(locale, "loginRequired"));
      setLoading(false);
      return;
    }

    try {
      const response = await listOwnerListings(
        accessToken,
        statusFilter === "all" ? undefined : statusFilter
      );
      setListings(response.items);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to load listings";
      if (message.toLowerCase().includes("unauthorized")) {
        void signOut({ redirect: false });
      }
      setError(message);
    } finally {
      setLoading(false);
    }
  }

  async function requestPropertyManagementAssist() {
    if (!accessToken) {
      setPmNotice(t(locale, "loginRequired"));
      return;
    }

    setPmRequesting(true);
    setPmNotice(null);
    try {
      await createSalesLead(accessToken, {
        source: "property_management",
        notes: "Property management consultation requested from owner dashboard",
        metadata: {
          locale,
          listing_count: listings.length
        },
        idempotencyKey: makeIdempotencyKey("pm-assist")
      });
      setPmNotice("Property management request submitted. Team will contact you.");
      trackEvent("property_management_requested", {
        listing_count: listings.length
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to request property management";
      if (message.toLowerCase().includes("unauthorized")) {
        void signOut({ redirect: false });
      }
      setPmNotice(message);
    } finally {
      setPmRequesting(false);
    }
  }

  return (
    <section className="hero">
      <div className="card-row" style={{ marginBottom: 16 }}>
        <div>
          <h1 style={{ margin: 0 }}>{dashboardTitle}</h1>
          {isPgOperator && (
            <p className="muted-text" style={{ margin: "4px 0 0" }}>
              PG Operator dashboard — manage your paying guest accommodations
            </p>
          )}
        </div>
        <Link className="primary" href={newListingHref}>
          {createListingLabel}
        </Link>
      </div>

      <div className="tab-row" role="tablist" aria-label="Filter by status">
        {STATUS_FILTERS.map((filter) => (
          <button
            key={filter.value}
            type="button"
            role="tab"
            aria-selected={statusFilter === filter.value}
            className={`tab-btn${statusFilter === filter.value ? " tab-btn--active" : ""}`}
            onClick={() => setStatusFilter(filter.value)}
          >
            {filter.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div aria-busy="true" aria-label="Loading listings">
          {[1, 2, 3].map((index) => (
            <div key={index} className="skeleton skeleton--card" />
          ))}
        </div>
      ) : error ? (
        <div className="panel warning-box" role="alert">
          {error}
        </div>
      ) : listings.length === 0 ? (
        <div className="empty-state">
          <h3>{t(locale, "noListings")}</h3>
          <p>
            {isPgOperator
              ? "No PG spaces listed yet. Add your first PG to start receiving tenant enquiries."
              : statusFilter === "all"
                ? t(locale, "noListingsDescription")
                : `No listings with status "${STATUS_LABEL[statusFilter as ListingStatus]}".`}
          </p>
          <Link className="primary" href={newListingHref}>
            {createListingLabel}
          </Link>
        </div>
      ) : (
        <div className="listing-grid">
          {listings.map((listing) => (
            <article key={listing.id} className="panel listing-card">
              <div className="card-row">
                <h3>{listing.title || "Untitled listing"}</h3>
                <span className={`status-pill status-pill--${listing.status}`}>
                  {STATUS_LABEL[listing.status]}
                </span>
              </div>

              <p className="muted-text">
                {listing.city || "City not set"} &middot;{" "}
                {listing.listingType === "pg" ? "PG" : "Flat/House"}
              </p>

              {typeof listing.monthlyRent === "number" ? (
                <p className="rent">₹{listing.monthlyRent.toLocaleString("en-IN")}/month</p>
              ) : (
                <p className="muted-text">Rent not set</p>
              )}

              <div className="card-row">
                <span className={`status-pill status-pill--${listing.verificationStatus}`}>
                  {VERIFICATION_LABEL[listing.verificationStatus]}
                </span>
                <div className="action-row">
                  {(listing.status === "draft" || listing.status === "rejected") && (
                    <Link
                      className="btn-sm btn-sm--primary"
                      href={`/${locale}/owner/listings/new?edit=${listing.id}`}
                    >
                      {listing.status === "rejected" ? "Edit & Resubmit" : "Edit & Submit"}
                    </Link>
                  )}
                  {listing.status === "active" && (
                    <Link
                      className="btn-sm"
                      href={`/${locale}/owner/listings/new?edit=${listing.id}`}
                    >
                      Edit
                    </Link>
                  )}
                </div>
              </div>
            </article>
          ))}
        </div>
      )}

      <div className="panel" style={{ marginTop: 24 }}>
        <div className="card-row">
          <div>
            <h3 style={{ margin: 0 }}>Verification status</h3>
            <p className="muted-text">Get verified to earn a Verified badge on your listings.</p>
          </div>
          <Link className="btn-sm btn-sm--primary" href={`/${locale}/owner/verification`}>
            {t(locale, "verification")}
          </Link>
        </div>
      </div>

      <div className="panel" style={{ marginTop: 16 }}>
        <div className="card-row">
          <div>
            <h3 style={{ margin: 0 }}>Need property management support?</h3>
            <p className="muted-text">
              Request a callback for managed onboarding, pricing guidance, and operations support.
            </p>
          </div>
          <button
            type="button"
            className="btn-sm btn-sm--primary"
            onClick={requestPropertyManagementAssist}
            disabled={pmRequesting}
          >
            {pmRequesting ? "Requesting..." : "Request Callback"}
          </button>
        </div>
        {pmNotice ? (
          <p className="muted-text" role="status" style={{ marginTop: 8 }}>
            {pmNotice}
          </p>
        ) : null}
      </div>
    </section>
  );
}
