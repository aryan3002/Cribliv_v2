"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { clearAuthSession, readAuthSession } from "../../../../lib/client-auth";
import {
  type ListingStatus,
  type OwnerListingVm,
  listOwnerListings
} from "../../../../lib/owner-api";
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
  const [listings, setListings] = useState<OwnerListingVm[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<ListingStatus | "all">("all");

  useEffect(() => {
    void loadListings();
  }, [statusFilter]);

  async function loadListings() {
    setLoading(true);
    setError(null);

    const session = readAuthSession();
    if (!session?.access_token) {
      setError(t(locale, "loginRequired"));
      setLoading(false);
      return;
    }

    try {
      const response = await listOwnerListings(
        session.access_token,
        statusFilter === "all" ? undefined : statusFilter
      );
      setListings(response.items);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to load listings";
      if (message.toLowerCase().includes("unauthorized")) {
        clearAuthSession();
      }
      setError(message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="hero">
      <div className="card-row" style={{ marginBottom: 16 }}>
        <h1>{t(locale, "yourListings")}</h1>
        <Link className="primary" href={`/${locale}/owner/listings/new`}>
          {t(locale, "createListing")}
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
            {statusFilter === "all"
              ? t(locale, "noListingsDescription")
              : `No listings with status "${STATUS_LABEL[statusFilter]}".`}
          </p>
          <Link className="primary" href={`/${locale}/owner/listings/new`}>
            {t(locale, "createListing")}
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
    </section>
  );
}
