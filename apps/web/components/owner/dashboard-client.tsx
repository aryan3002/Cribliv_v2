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
} from "../../lib/owner-api";
import { trackEvent } from "../../lib/analytics";
import { t, type Locale } from "../../lib/i18n";
import { toTitleCase, VERIFICATION_LABELS } from "../../lib/utils";
import { LeadStatsWidget } from "./lead-stats-widget";
import { LeadsPipeline } from "./leads-pipeline";
import { BoostModal } from "./boost-modal";
import { AvailabilityToggle } from "./availability-toggle";
import {
  Plus,
  Settings,
  MapPin,
  Pencil,
  Zap,
  ShieldCheck,
  Building,
  Clock,
  AlertTriangle,
  AlertCircle,
  CheckCircle2,
  XCircle,
  Home,
  BarChart3,
  ArrowRight,
  Layers
} from "lucide-react";

/* ─── Constants ──────────────────────────────────────────────────────────── */

const STATUS_FILTERS: Array<{ value: ListingStatus | "all"; label: string }> = [
  { value: "all", label: "All" },
  { value: "draft", label: "Drafts" },
  { value: "pending_review", label: "Pending" },
  { value: "active", label: "Active" },
  { value: "rejected", label: "Rejected" },
  { value: "paused", label: "Paused" }
];

const STATUS_META: Record<
  ListingStatus,
  { label: string; color: string; bg: string; dot: string }
> = {
  active: { label: "Active", color: "#166534", bg: "#f0fdf4", dot: "#22c55e" },
  pending_review: { label: "Pending", color: "#5046e5", bg: "#eef2ff", dot: "#5046e5" },
  draft: { label: "Draft", color: "#6b7280", bg: "#f9fafb", dot: "#d1d5db" },
  rejected: { label: "Rejected", color: "#b91c1c", bg: "#fef2f2", dot: "#ef4444" },
  paused: { label: "Paused", color: "#92400e", bg: "#fffbeb", dot: "#f59e0b" },
  archived: { label: "Archived", color: "#6b7280", bg: "#f3f4f6", dot: "#9ca3af" }
};

const VERIFICATION_LABEL = VERIFICATION_LABELS;

/* ─── Greeting helper ────────────────────────────────────────────────────── */

function getGreeting(): string {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}

/* ─── Status pill ────────────────────────────────────────────────────────── */

function StatusPill({ status }: { status: ListingStatus }) {
  const meta = STATUS_META[status] ?? STATUS_META.draft;
  return (
    <span className="dash-status-pill" style={{ background: meta.bg, color: meta.color }}>
      <span className="dash-status-pill__dot" style={{ background: meta.dot }} />
      {meta.label}
    </span>
  );
}

/* ─── Verification badge ─────────────────────────────────────────────────── */

function VerifBadge({ status }: { status: string }) {
  const isVerified = status === "verified";
  const isPending = status === "pending";
  const isFailed = status === "failed";
  return (
    <span className={`dash-verif-badge${isVerified ? " dash-verif-badge--ok" : ""}`}>
      {isVerified && <CheckCircle2 size={11} aria-hidden="true" />}
      {isPending && <Clock size={11} aria-hidden="true" />}
      {isFailed && <XCircle size={11} aria-hidden="true" />}
      {!isVerified && !isPending && !isFailed && <AlertCircle size={11} aria-hidden="true" />}
      {VERIFICATION_LABEL[status as keyof typeof VERIFICATION_LABEL]}
    </span>
  );
}

/* ═════════════════════════════════════════════════════════════════════════ */

export function DashboardClient({ locale }: { locale: string }) {
  const loc = locale as Locale;
  const { data: nextAuthSession } = useSession();
  const accessToken = nextAuthSession?.accessToken ?? null;
  const userName = nextAuthSession?.user?.name ?? "";
  const userRole = nextAuthSession?.user?.role as "owner" | "pg_operator" | undefined;

  const isPgOperator = userRole === "pg_operator";
  const createListingLabel = isPgOperator ? "Add PG" : t(loc, "createListing");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const newListingHref = `/${locale}/owner/listings/new${isPgOperator ? "?type=pg" : ""}` as any;

  const [listings, setListings] = useState<OwnerListingVm[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<ListingStatus | "all">("all");
  const [pmRequesting, setPmRequesting] = useState(false);
  const [pmNotice, setPmNotice] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"listings" | "leads">("listings");
  const [boostTarget, setBoostTarget] = useState<OwnerListingVm | null>(null);
  const [boostNotice, setBoostNotice] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  useEffect(() => {
    void loadListings();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter, accessToken]);

  async function loadListings() {
    setLoading(true);
    setError(null);
    if (!accessToken) {
      setError(t(loc, "loginRequired"));
      setLoading(false);
      return;
    }
    try {
      const response = await listOwnerListings(
        accessToken,
        statusFilter === "all" ? undefined : statusFilter
      );
      setListings(response.items);
      setLastUpdated(new Date());
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
      setPmNotice(t(loc, "loginRequired"));
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
      setPmNotice("Request submitted. Our team will contact you shortly.");
      trackEvent("property_management_requested", { listing_count: listings.length });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to submit request";
      if (message.toLowerCase().includes("unauthorized")) void signOut({ redirect: false });
      setPmNotice(message);
    } finally {
      setPmRequesting(false);
    }
  }

  /* ── Derived ── */
  const hasUnverified = listings.some(
    (l) => l.verificationStatus !== "verified" && l.status === "active"
  );
  const allListings = listings; // always use unfiltered count for header stat
  const statusCounts = allListings.reduce<Record<string, number>>((acc, l) => {
    acc[l.status] = (acc[l.status] ?? 0) + 1;
    return acc;
  }, {});
  const activeCount = statusCounts.active ?? 0;
  const pendingCount = statusCounts.pending_review ?? 0;
  const draftCount = statusCounts.draft ?? 0;

  return (
    <div className="dash-page">
      {/* ═══ GREETING BANNER ═══ */}
      <div className="dash-greeting">
        <div className="dash-greeting__inner container container--narrow">
          <div className="dash-greeting__left">
            <p className="dash-greeting__eyebrow">
              {isPgOperator ? "PG Operator" : "Owner"} Dashboard
              {lastUpdated && (
                <span className="dash-greeting__time">
                  · Updated{" "}
                  {lastUpdated.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                </span>
              )}
            </p>
            <h1 className="dash-greeting__title">
              {getGreeting()}
              {userName ? `, ${userName.split(" ")[0]}` : ""}
            </h1>
          </div>

          <div className="dash-greeting__actions">
            <Link href={newListingHref} className="btn btn--primary">
              <Plus size={15} aria-hidden="true" />
              {createListingLabel}
            </Link>
            <Link
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              href={`/${locale}/settings` as any}
              className="dash-icon-btn"
              title="Account settings"
              aria-label="Account settings"
            >
              <Settings size={17} />
            </Link>
          </div>
        </div>

        {/* Quick stats strip */}
        {!loading && allListings.length > 0 && (
          <div className="dash-stats-strip container container--narrow">
            <div className="dash-stat-chip dash-stat-chip--active">
              <span className="dash-stat-chip__num">{activeCount}</span>
              <span className="dash-stat-chip__label">Active</span>
            </div>
            {pendingCount > 0 && (
              <div className="dash-stat-chip dash-stat-chip--pending">
                <span className="dash-stat-chip__num">{pendingCount}</span>
                <span className="dash-stat-chip__label">Pending</span>
              </div>
            )}
            {draftCount > 0 && (
              <div className="dash-stat-chip">
                <span className="dash-stat-chip__num">{draftCount}</span>
                <span className="dash-stat-chip__label">Draft</span>
              </div>
            )}
            <div className="dash-stat-chip">
              <span className="dash-stat-chip__num">{allListings.length}</span>
              <span className="dash-stat-chip__label">Total listings</span>
            </div>
          </div>
        )}
      </div>

      {/* ═══ MAIN CONTENT ═══ */}
      <div className="container container--narrow dash-body">
        {/* Verification banner */}
        {hasUnverified && (
          <div className="dash-banner dash-banner--warn" role="alert">
            <AlertTriangle size={16} className="dash-banner__icon" aria-hidden="true" />
            <p className="dash-banner__text">
              Some active listings aren't verified.{" "}
              <Link href={`/${locale}/owner/verification`} className="dash-banner__link">
                Complete verification
              </Link>{" "}
              to earn the Verified badge and more tenant trust.
            </p>
            <Link href={`/${locale}/owner/verification`} className="dash-banner__cta">
              Verify now <ArrowRight size={13} />
            </Link>
          </div>
        )}

        {/* ═══ TABS ═══ */}
        <div className="dash-tabs" role="tablist" aria-label="Dashboard sections">
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "listings"}
            className={`dash-tab${activeTab === "listings" ? " dash-tab--active" : ""}`}
            onClick={() => setActiveTab("listings")}
          >
            <Layers size={15} aria-hidden="true" />
            Listings
            {allListings.length > 0 && (
              <span className="dash-tab__badge">{allListings.length}</span>
            )}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "leads"}
            className={`dash-tab${activeTab === "leads" ? " dash-tab--active" : ""}`}
            onClick={() => setActiveTab("leads")}
          >
            <BarChart3 size={15} aria-hidden="true" />
            Leads
          </button>
        </div>

        {/* ═══ LISTINGS PANEL ═══ */}
        {activeTab === "listings" && (
          <>
            {boostNotice && (
              <div className="alert alert--success" style={{ marginBottom: "var(--space-4)" }}>
                {boostNotice}
              </div>
            )}

            {/* Filter chips */}
            {allListings.length > 0 && (
              <div className="dash-filter-row">
                {STATUS_FILTERS.map((filter) => {
                  const count =
                    filter.value === "all" ? allListings.length : (statusCounts[filter.value] ?? 0);
                  if (filter.value !== "all" && count === 0) return null;
                  return (
                    <button
                      key={filter.value}
                      type="button"
                      className={`dash-filter-chip${statusFilter === filter.value ? " dash-filter-chip--active" : ""}`}
                      onClick={() => setStatusFilter(filter.value)}
                    >
                      {filter.label}
                      {count > 0 && <span className="dash-filter-chip__count">{count}</span>}
                    </button>
                  );
                })}
              </div>
            )}

            {/* Loading */}
            {loading ? (
              <div className="dash-skeleton-list">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="skeleton-card dash-skeleton-item" />
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
              /* Empty state */
              <div className="dash-empty">
                <div className="dash-empty__icon">
                  <Home size={30} aria-hidden="true" />
                </div>
                <h3 className="dash-empty__title">{t(loc, "noListings")}</h3>
                <p className="dash-empty__desc">
                  {isPgOperator
                    ? "Add your first PG space to start receiving tenant enquiries."
                    : statusFilter === "all"
                      ? t(loc, "noListingsDescription")
                      : `No listings with status "${STATUS_META[statusFilter as ListingStatus]?.label ?? statusFilter}".`}
                </p>
                <Link href={newListingHref} className="btn btn--primary">
                  <Plus size={15} /> {createListingLabel}
                </Link>
              </div>
            ) : (
              /* Listing cards */
              <ul className="dash-listing-list">
                {listings.map((listing) => (
                  <li key={listing.id} className="dash-listing-card">
                    {/* Left: property type icon */}
                    <div
                      className="dash-listing-card__thumb"
                      style={{ opacity: listing.status === "paused" ? 0.5 : 1 }}
                    >
                      {listing.listingType === "pg" ? (
                        <Building size={20} aria-hidden="true" />
                      ) : (
                        <Home size={20} aria-hidden="true" />
                      )}
                    </div>

                    {/* Main content */}
                    <div className="dash-listing-card__body">
                      {/* Row 1: title + status */}
                      <div className="dash-listing-card__row1">
                        <h3 className="dash-listing-card__title">
                          {listing.title || "Untitled listing"}
                        </h3>
                        <StatusPill status={listing.status} />
                      </div>

                      {/* Row 2: location + price */}
                      <div className="dash-listing-card__row2">
                        <span className="dash-listing-card__loc">
                          <MapPin size={11} aria-hidden="true" />
                          {listing.city ? toTitleCase(listing.city) : "City not set"}
                          {" · "}
                          {listing.listingType === "pg" ? "PG" : "Flat/House"}
                        </span>
                        {typeof listing.monthlyRent === "number" ? (
                          <span className="dash-listing-card__price">
                            ₹{listing.monthlyRent.toLocaleString("en-IN")}
                            <span className="dash-listing-card__price-per">/mo</span>
                          </span>
                        ) : (
                          <span className="dash-listing-card__price-empty">Rent not set</span>
                        )}
                      </div>

                      {/* Row 3: verification + actions */}
                      <div className="dash-listing-card__row3">
                        <VerifBadge status={listing.verificationStatus} />

                        <div className="dash-listing-card__actions">
                          {/* Availability toggle */}
                          {(listing.status === "active" || listing.status === "paused") &&
                            accessToken && (
                              <AvailabilityToggle
                                listingId={listing.id}
                                currentStatus={listing.status as "active" | "paused"}
                                accessToken={accessToken}
                                showLabel={false}
                                onStatusChange={(newStatus) =>
                                  setListings((prev) =>
                                    prev.map((l) =>
                                      l.id === listing.id ? { ...l, status: newStatus } : l
                                    )
                                  )
                                }
                              />
                            )}

                          {/* Edit */}
                          {(listing.status === "draft" ||
                            listing.status === "rejected" ||
                            listing.status === "pending_review" ||
                            listing.status === "active" ||
                            listing.status === "paused") && (
                            <Link
                              className="dash-action-btn dash-action-btn--edit"
                              href={`/${locale}/owner/listings/new?edit=${listing.id}`}
                            >
                              <Pencil size={12} aria-hidden="true" />
                              {listing.status === "rejected" ? "Fix & Resubmit" : "Edit"}
                            </Link>
                          )}

                          {/* Boost */}
                          {listing.status === "active" && (
                            <button
                              type="button"
                              className="dash-action-btn dash-action-btn--boost"
                              onClick={() => setBoostTarget(listing)}
                            >
                              <Zap size={12} aria-hidden="true" />
                              Boost
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}

        {/* ═══ LEADS PANEL ═══ */}
        {activeTab === "leads" && (
          <div className="dash-leads-panel">
            {accessToken ? (
              <>
                <LeadStatsWidget accessToken={accessToken} />
                <div style={{ marginTop: "var(--space-6)" }}>
                  <LeadsPipeline accessToken={accessToken} />
                </div>
              </>
            ) : (
              <div className="alert alert--error">Please log in to view leads.</div>
            )}
          </div>
        )}

        {/* ═══ FOOTER CARDS ═══ */}
        <div className="dash-footer-cards">
          {/* Verification */}
          <div className="dash-footer-card">
            <div className="dash-footer-card__icon" style={{ background: "rgba(34,197,94,0.1)" }}>
              <ShieldCheck size={18} style={{ color: "var(--trust)" }} />
            </div>
            <div className="dash-footer-card__text">
              <span className="dash-footer-card__label">{t(loc, "verification")}</span>
              <span className="dash-footer-card__sub">Get verified to earn a trust badge</span>
            </div>
            <Link className="dash-footer-card__btn" href={`/${locale}/owner/verification`}>
              Verify <ArrowRight size={13} />
            </Link>
          </div>

          {/* Property Management */}
          <div className="dash-footer-card">
            <div className="dash-footer-card__icon" style={{ background: "rgba(0,102,255,0.07)" }}>
              <Building size={18} style={{ color: "var(--brand)" }} />
            </div>
            <div className="dash-footer-card__text">
              <span className="dash-footer-card__label">Property management</span>
              <span className="dash-footer-card__sub">
                Managed onboarding &amp; operations support
              </span>
            </div>
            <button
              type="button"
              className="dash-footer-card__btn"
              onClick={() => void requestPropertyManagementAssist()}
              disabled={pmRequesting}
            >
              {pmRequesting ? "Sending…" : "Get help"} <ArrowRight size={13} />
            </button>
          </div>

          {pmNotice && (
            <p className="dash-pm-notice" role="status">
              {pmNotice}
            </p>
          )}
        </div>
      </div>

      {/* ═══ BOOST MODAL ═══ */}
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
    </div>
  );
}
