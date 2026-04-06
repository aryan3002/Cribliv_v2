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
import { LeadStatsWidget } from "../../../../components/owner/lead-stats-widget";
import { LeadsPipeline } from "../../../../components/owner/leads-pipeline";
import { BoostModal } from "../../../../components/owner/boost-modal";
import { AvailabilityToggle } from "../../../../components/owner/availability-toggle";

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
  const accessToken = nextAuthSession?.accessToken ?? null;
  const userRole = nextAuthSession?.user?.role as "owner" | "pg_operator" | undefined;

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

  // New state
  const [activeTab, setActiveTab] = useState<"listings" | "leads">("listings");
  const [boostTarget, setBoostTarget] = useState<OwnerListingVm | null>(null);
  const [boostNotice, setBoostNotice] = useState<string | null>(null);

  useEffect(() => {
    void loadListings();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter, accessToken]);

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
      if (message.toLowerCase().includes("unauthorized")) void signOut({ redirect: false });
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
        metadata: { locale, listing_count: listings.length },
        idempotencyKey: makeIdempotencyKey("pm-assist")
      });
      setPmNotice("Property management request submitted. Team will contact you.");
      trackEvent("property_management_requested", { listing_count: listings.length });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to request property management";
      if (message.toLowerCase().includes("unauthorized")) void signOut({ redirect: false });
      setPmNotice(message);
    } finally {
      setPmRequesting(false);
    }
  }

  return (
    <section className="container container--narrow" style={{ paddingBlock: "var(--space-6)" }}>
      {/* ── Header row ─────────────────────────────────────────────────── */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "var(--space-4)",
          flexWrap: "wrap",
          marginBottom: "var(--space-5)"
        }}
      >
        <div>
          <h1 className="h2" style={{ margin: 0 }}>
            {dashboardTitle}
          </h1>
          {isPgOperator && (
            <p
              className="caption"
              style={{ marginTop: "var(--space-1)", color: "var(--text-tertiary)" }}
            >
              PG Operator dashboard — manage your paying guest accommodations
            </p>
          )}
        </div>
        <div
          style={{ display: "flex", gap: "var(--space-2)", alignItems: "center", flexWrap: "wrap" }}
        >
          {accessToken && (
            <Link
              className="btn btn--secondary btn--sm"
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              href={`/${locale}/owner/leads` as any}
            >
              📊 All Leads
            </Link>
          )}
          <Link className="btn btn--primary" href={newListingHref}>
            {createListingLabel}
          </Link>
        </div>
      </div>

      {/* ── Lead Stats Widget ───────────────────────────────────────────── */}
      {accessToken && (
        <div style={{ marginBottom: "var(--space-5)" }}>
          <LeadStatsWidget accessToken={accessToken} />
        </div>
      )}

      {/* ── Top-level tabs: Listings | Leads ───────────────────────────── */}
      <div
        className="tab-row"
        role="tablist"
        aria-label="Dashboard view"
        style={{ marginBottom: "var(--space-1)" }}
      >
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === "listings"}
          className={`tab-btn${activeTab === "listings" ? " tab-btn--active" : ""}`}
          onClick={() => setActiveTab("listings")}
        >
          🏠 Listings
          {listings.length > 0 && (
            <span
              style={{
                marginLeft: 6,
                fontSize: 11,
                fontWeight: 700,
                padding: "1px 6px",
                borderRadius: "var(--radius-full)",
                background:
                  activeTab === "listings" ? "rgba(0,102,255,0.12)" : "var(--surface-sunken)",
                color: activeTab === "listings" ? "var(--brand)" : "var(--text-tertiary)"
              }}
            >
              {listings.length}
            </span>
          )}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === "leads"}
          className={`tab-btn${activeTab === "leads" ? " tab-btn--active" : ""}`}
          onClick={() => setActiveTab("leads")}
        >
          👥 Leads
        </button>
      </div>

      {/* ── Listings Tab ───────────────────────────────────────────────── */}
      {activeTab === "listings" && (
        <>
          {/* Status filter sub-tabs */}
          <div
            className="tab-row"
            role="tablist"
            aria-label="Filter by status"
            style={{ marginBottom: "var(--space-4)", borderBottom: "none", paddingBottom: 0 }}
          >
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

          {/* Boost success notice */}
          {boostNotice && (
            <div className="alert alert--success" style={{ marginBottom: "var(--space-4)" }}>
              {boostNotice}
            </div>
          )}

          {/* Listings grid */}
          {loading ? (
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))",
                gap: "var(--space-4)",
                marginTop: "var(--space-4)"
              }}
              aria-busy="true"
              aria-label="Loading listings"
            >
              {[1, 2, 3].map((i) => (
                <div
                  key={i}
                  className="skeleton-card"
                  style={{ height: 200, borderRadius: "var(--radius-lg)" }}
                />
              ))}
            </div>
          ) : error ? (
            <div
              className="alert alert--error"
              role="alert"
              style={{ marginTop: "var(--space-4)" }}
            >
              {error}
            </div>
          ) : listings.length === 0 ? (
            <div className="empty-state" style={{ marginTop: "var(--space-6)" }}>
              <span className="empty-state__icon">📋</span>
              <h3 style={{ fontFamily: "var(--font-heading)", fontSize: 20, fontWeight: 600 }}>
                {t(locale, "noListings")}
              </h3>
              <p style={{ color: "var(--text-secondary)", maxWidth: 360 }}>
                {isPgOperator
                  ? "No PG spaces listed yet. Add your first PG to start receiving tenant enquiries."
                  : statusFilter === "all"
                    ? t(locale, "noListingsDescription")
                    : `No listings with status "${STATUS_LABEL[statusFilter as ListingStatus]}".`}
              </p>
              <Link className="btn btn--primary" href={newListingHref}>
                {createListingLabel}
              </Link>
            </div>
          ) : (
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))",
                gap: "var(--space-4)",
                marginTop: "var(--space-4)"
              }}
            >
              {listings.map((listing) => (
                <article
                  key={listing.id}
                  className="card"
                  style={{ borderRadius: "var(--radius-lg)" }}
                >
                  {/* Status accent line */}
                  <div
                    style={{
                      height: 3,
                      background:
                        listing.status === "active"
                          ? "#22c55e"
                          : listing.status === "paused"
                            ? "#f59e0b"
                            : listing.status === "rejected"
                              ? "#dc2626"
                              : listing.status === "pending_review"
                                ? "#5046e5"
                                : "var(--border)"
                    }}
                  />

                  <div className="card__body">
                    {/* Title + status */}
                    <div
                      style={{
                        display: "flex",
                        alignItems: "flex-start",
                        justifyContent: "space-between",
                        gap: "var(--space-2)",
                        marginBottom: "var(--space-2)"
                      }}
                    >
                      <h3 className="card__title" style={{ WebkitLineClamp: 2 }}>
                        {listing.title || "Untitled listing"}
                      </h3>
                      <span className={`status-pill status-pill--${listing.status}`}>
                        {STATUS_LABEL[listing.status]}
                      </span>
                    </div>

                    <p className="card__location">
                      {listing.city || "City not set"} &middot;{" "}
                      {listing.listingType === "pg" ? "PG" : "Flat/House"}
                    </p>

                    {typeof listing.monthlyRent === "number" ? (
                      <p className="card__price">
                        ₹{listing.monthlyRent.toLocaleString("en-IN")}
                        <span className="card__price-period">/month</span>
                      </p>
                    ) : (
                      <p className="caption" style={{ color: "var(--text-tertiary)" }}>
                        Rent not set
                      </p>
                    )}

                    {/* Verification badge + availability toggle */}
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        gap: "var(--space-2)",
                        marginTop: "var(--space-3)",
                        paddingTop: "var(--space-3)",
                        borderTop: "1px solid var(--border)"
                      }}
                    >
                      <span
                        className={`badge badge--${
                          listing.verificationStatus === "verified"
                            ? "verified"
                            : listing.verificationStatus === "pending"
                              ? "pending"
                              : "default"
                        }`}
                      >
                        {VERIFICATION_LABEL[listing.verificationStatus]}
                      </span>

                      {(listing.status === "active" || listing.status === "paused") &&
                        accessToken && (
                          <AvailabilityToggle
                            listingId={listing.id}
                            currentStatus={listing.status as "active" | "paused"}
                            accessToken={accessToken}
                            onStatusChange={(newStatus) =>
                              setListings((prev) =>
                                prev.map((l) =>
                                  l.id === listing.id ? { ...l, status: newStatus } : l
                                )
                              )
                            }
                          />
                        )}
                    </div>

                    {/* Action buttons */}
                    <div
                      style={{
                        display: "flex",
                        gap: "var(--space-2)",
                        marginTop: "var(--space-3)",
                        flexWrap: "wrap"
                      }}
                    >
                      {(listing.status === "draft" || listing.status === "rejected") && (
                        <Link
                          className="btn btn--primary btn--sm"
                          href={`/${locale}/owner/listings/new?edit=${listing.id}`}
                          style={{ flex: 1, justifyContent: "center" }}
                        >
                          {listing.status === "rejected" ? "Edit & Resubmit" : "Edit & Submit"}
                        </Link>
                      )}
                      {listing.status === "active" && (
                        <>
                          <Link
                            className="btn btn--secondary btn--sm"
                            href={`/${locale}/owner/listings/new?edit=${listing.id}`}
                            style={{ flex: 1, justifyContent: "center" }}
                          >
                            Edit
                          </Link>
                          <button
                            type="button"
                            className="btn btn--sm"
                            onClick={() => setBoostTarget(listing)}
                            style={{
                              background: "linear-gradient(135deg, #f59e0b 0%, #d97706 100%)",
                              color: "white",
                              border: "none",
                              borderRadius: "var(--radius-sm)",
                              fontWeight: 700,
                              cursor: "pointer",
                              display: "flex",
                              alignItems: "center",
                              gap: 6
                            }}
                          >
                            ⚡ Boost
                          </button>
                        </>
                      )}
                      {listing.status === "paused" && (
                        <Link
                          className="btn btn--secondary btn--sm"
                          href={`/${locale}/owner/listings/new?edit=${listing.id}`}
                          style={{ flex: 1, justifyContent: "center" }}
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
        </>
      )}

      {/* ── Leads Tab ──────────────────────────────────────────────────── */}
      {activeTab === "leads" && accessToken && (
        <div style={{ marginTop: "var(--space-4)" }}>
          <LeadsPipeline accessToken={accessToken} />
        </div>
      )}
      {activeTab === "leads" && !accessToken && (
        <div className="alert alert--error" style={{ marginTop: "var(--space-4)" }}>
          Please log in to view leads.
        </div>
      )}

      {/* ── Verification CTA ───────────────────────────────────────────── */}
      <div className="card" style={{ marginTop: "var(--space-6)" }}>
        <div
          className="card__body"
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: "var(--space-4)",
            flexWrap: "wrap"
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "var(--space-3)" }}>
            <div
              style={{
                width: 40,
                height: 40,
                borderRadius: "var(--radius-md)",
                background: "var(--trust-light)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 20,
                flexShrink: 0
              }}
            >
              ✅
            </div>
            <div>
              <h3 className="card__title" style={{ margin: 0 }}>
                Verification status
              </h3>
              <p
                className="caption"
                style={{ color: "var(--text-tertiary)", marginTop: "var(--space-1)" }}
              >
                Get verified to earn a Verified badge on your listings.
              </p>
            </div>
          </div>
          <Link className="btn btn--primary btn--sm" href={`/${locale}/owner/verification`}>
            {t(locale, "verification")}
          </Link>
        </div>
      </div>

      {/* ── Property Management CTA ────────────────────────────────────── */}
      <div className="card" style={{ marginTop: "var(--space-4)" }}>
        <div
          className="card__body"
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: "var(--space-4)",
            flexWrap: "wrap"
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "var(--space-3)" }}>
            <div
              style={{
                width: 40,
                height: 40,
                borderRadius: "var(--radius-md)",
                background: "var(--brand-light)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 20,
                flexShrink: 0
              }}
            >
              🏢
            </div>
            <div>
              <h3 className="card__title" style={{ margin: 0 }}>
                Need property management support?
              </h3>
              <p
                className="caption"
                style={{ color: "var(--text-tertiary)", marginTop: "var(--space-1)" }}
              >
                Request a callback for managed onboarding, pricing guidance, and operations support.
              </p>
            </div>
          </div>
          <button
            type="button"
            className="btn btn--primary btn--sm"
            onClick={() => void requestPropertyManagementAssist()}
            disabled={pmRequesting}
          >
            {pmRequesting ? "Requesting…" : "Request Callback"}
          </button>
        </div>
        {pmNotice && (
          <p
            className="caption"
            role="status"
            style={{ padding: "0 var(--space-4) var(--space-4)", color: "var(--text-tertiary)" }}
          >
            {pmNotice}
          </p>
        )}
      </div>

      {/* ── Boost Modal ────────────────────────────────────────────────── */}
      {boostTarget && accessToken && (
        <BoostModal
          listingId={boostTarget.id}
          listingTitle={boostTarget.title}
          accessToken={accessToken}
          isOpen={true}
          onClose={() => setBoostTarget(null)}
          onSuccess={(paymentId) => {
            setBoostTarget(null);
            setBoostNotice(`Boost activated! Payment ID: ${paymentId.slice(0, 12)}…`);
            setTimeout(() => setBoostNotice(null), 8000);
          }}
        />
      )}
    </section>
  );
}
