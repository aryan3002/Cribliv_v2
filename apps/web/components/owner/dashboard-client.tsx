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
  BarChart3,
  Settings,
  MapPin,
  Pencil,
  Zap,
  ShieldCheck,
  Home,
  Building,
  Clock,
  AlertTriangle,
  CheckCircle2,
  XCircle
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

const STATUS_LABEL: Record<ListingStatus, string> = {
  draft: "Draft",
  pending_review: "Pending Review",
  active: "Active",
  rejected: "Rejected",
  paused: "Paused",
  archived: "Archived"
};

const STATUS_ACCENT: Record<ListingStatus, string> = {
  active: "#22c55e",
  pending_review: "#5046e5",
  draft: "var(--border)",
  rejected: "#dc2626",
  paused: "#f59e0b",
  archived: "#94a3b8"
};

const VERIFICATION_LABEL = VERIFICATION_LABELS;

/* ─── Greeting helper ────────────────────────────────────────────────────── */

function getGreeting(): string {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
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

  /* ── Last updated timestamp ── */
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

  /* ── Derive counts ── */
  const hasUnverified = listings.some(
    (l) => l.verificationStatus !== "verified" && l.status === "active"
  );

  return (
    <section className="container container--narrow" style={{ paddingBlock: "var(--space-6)" }}>
      {/* ═══ GREETING HEADER ═══ */}
      <div style={{ marginBottom: "var(--space-6)" }}>
        <h1
          style={{
            margin: 0,
            fontFamily: "var(--font-heading)",
            fontSize: 26,
            fontWeight: 700,
            letterSpacing: "-0.02em",
            lineHeight: 1.2
          }}
        >
          {getGreeting()}
          {userName ? `, ${userName.split(" ")[0]}` : ""}
        </h1>
        <p
          style={{
            margin: 0,
            marginTop: "var(--space-1)",
            fontSize: 14,
            color: "var(--text-tertiary)"
          }}
        >
          {isPgOperator ? "PG Operator Dashboard" : "Owner Dashboard"}
          {lastUpdated && (
            <span style={{ marginLeft: "var(--space-3)" }}>
              · Updated {lastUpdated.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
            </span>
          )}
        </p>
      </div>

      {/* ═══ VERIFICATION BANNER ═══ */}
      {hasUnverified && (
        <div
          role="alert"
          style={{
            display: "flex",
            alignItems: "center",
            gap: "var(--space-3)",
            padding: "var(--space-3) var(--space-4)",
            borderRadius: "var(--radius-md)",
            background: "rgba(245,158,11,0.08)",
            border: "1px solid rgba(245,158,11,0.2)",
            marginBottom: "var(--space-4)",
            fontSize: 14
          }}
        >
          <AlertTriangle size={16} style={{ color: "#f59e0b", flexShrink: 0 }} />
          <span style={{ color: "var(--text-secondary)" }}>
            Some listings are not verified yet.{" "}
            <Link
              href={`/${locale}/owner/verification`}
              style={{ color: "#f59e0b", fontWeight: 600, textDecoration: "underline" }}
            >
              Complete verification
            </Link>{" "}
            to earn a Verified badge.
          </span>
        </div>
      )}

      {/* ═══ QUICK ACTIONS ═══ */}
      <div
        style={{
          display: "flex",
          gap: "var(--space-2)",
          marginBottom: "var(--space-5)",
          flexWrap: "wrap"
        }}
      >
        <Link
          className="btn btn--primary btn--sm"
          href={newListingHref}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            fontWeight: 600
          }}
        >
          <Plus size={15} /> {createListingLabel}
        </Link>
        {accessToken && (
          <Link
            className="btn btn--secondary btn--sm"
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            href={`/${locale}/owner/leads` as any}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              fontWeight: 500
            }}
          >
            <BarChart3 size={14} /> All Leads
          </Link>
        )}
        <Link
          className="btn btn--secondary btn--sm"
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          href={`/${locale}/settings` as any}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            fontWeight: 500
          }}
        >
          <Settings size={14} /> Settings
        </Link>
      </div>

      {/* ═══ LEAD STATS ═══ */}
      {accessToken && (
        <div style={{ marginBottom: "var(--space-5)" }}>
          <LeadStatsWidget accessToken={accessToken} />
        </div>
      )}

      {/* ═══ TABS: Listings / Leads ═══ */}
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
          <Home size={14} style={{ marginRight: 4 }} />
          Listings
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
          <BarChart3 size={14} style={{ marginRight: 4 }} />
          Leads
        </button>
      </div>

      {/* ═══ LISTINGS PANEL ═══ */}
      {activeTab === "listings" && (
        <>
          {/* Status filter chips */}
          {listings.length > 0 && (
            <div
              style={{
                display: "flex",
                gap: "var(--space-2)",
                marginBottom: "var(--space-4)",
                flexWrap: "wrap",
                paddingTop: "var(--space-2)"
              }}
            >
              {STATUS_FILTERS.map((filter) => (
                <button
                  key={filter.value}
                  type="button"
                  onClick={() => setStatusFilter(filter.value)}
                  style={{
                    padding: "4px 12px",
                    borderRadius: "var(--radius-full)",
                    fontSize: 13,
                    fontWeight: statusFilter === filter.value ? 600 : 400,
                    background: statusFilter === filter.value ? "var(--brand)" : "var(--surface)",
                    color: statusFilter === filter.value ? "white" : "var(--text-secondary)",
                    border: `1px solid ${statusFilter === filter.value ? "var(--brand)" : "var(--border)"}`,
                    cursor: "pointer",
                    transition: "all 150ms ease"
                  }}
                >
                  {filter.label}
                </button>
              ))}
            </div>
          )}

          {boostNotice && (
            <div className="alert alert--success" style={{ marginBottom: "var(--space-4)" }}>
              {boostNotice}
            </div>
          )}

          {/* Loading skeleton */}
          {loading ? (
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: "var(--space-3)",
                marginTop: "var(--space-3)"
              }}
              aria-busy="true"
              aria-label="Loading listings"
            >
              {[1, 2, 3].map((i) => (
                <div
                  key={i}
                  className="skeleton-card"
                  style={{ height: 120, borderRadius: "var(--radius-lg)" }}
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
            /* ═══ EMPTY STATE ═══ */
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                padding: "var(--space-12) var(--space-6)",
                marginTop: "var(--space-4)",
                background: "var(--surface)",
                borderRadius: "var(--radius-lg)",
                border: "1px dashed var(--border)",
                textAlign: "center"
              }}
            >
              <div
                style={{
                  width: 56,
                  height: 56,
                  borderRadius: "var(--radius-lg)",
                  background: "rgba(0,102,255,0.06)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  marginBottom: "var(--space-4)"
                }}
              >
                <Home size={28} style={{ color: "var(--brand)", opacity: 0.7 }} />
              </div>
              <h3
                style={{
                  fontFamily: "var(--font-heading)",
                  fontSize: 18,
                  fontWeight: 600,
                  margin: "0 0 var(--space-2)"
                }}
              >
                {t(loc, "noListings")}
              </h3>
              <p
                style={{
                  color: "var(--text-secondary)",
                  maxWidth: 340,
                  margin: "0 0 var(--space-5)",
                  fontSize: 14,
                  lineHeight: 1.5
                }}
              >
                {isPgOperator
                  ? "No PG spaces listed yet. Add your first PG to start receiving tenant enquiries."
                  : statusFilter === "all"
                    ? t(loc, "noListingsDescription")
                    : `No listings with status "${STATUS_LABEL[statusFilter as ListingStatus]}".`}
              </p>
              <Link
                className="btn btn--primary"
                href={newListingHref}
                style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
              >
                <Plus size={16} /> {createListingLabel}
              </Link>
            </div>
          ) : (
            /* ═══ LISTING CARDS ═══ */
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: "var(--space-3)",
                marginTop: "var(--space-3)"
              }}
            >
              {listings.map((listing) => (
                <article
                  key={listing.id}
                  style={{
                    display: "flex",
                    borderRadius: "var(--radius-lg)",
                    background: "var(--surface)",
                    border: "1px solid var(--border)",
                    overflow: "hidden",
                    transition: "box-shadow 200ms ease, transform 200ms ease",
                    opacity: listing.status === "paused" ? 0.75 : 1,
                    cursor: "default"
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.boxShadow = "0 4px 16px rgba(0,0,0,0.06)";
                    e.currentTarget.style.transform = "translateY(-1px)";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.boxShadow = "none";
                    e.currentTarget.style.transform = "none";
                  }}
                >
                  {/* Accent bar */}
                  <div
                    style={{
                      width: 3,
                      flexShrink: 0,
                      background: STATUS_ACCENT[listing.status] ?? "var(--border)"
                    }}
                  />

                  {/* Card content */}
                  <div
                    style={{
                      flex: 1,
                      padding: "var(--space-4) var(--space-5)",
                      display: "flex",
                      flexDirection: "column",
                      gap: "var(--space-2)",
                      minWidth: 0
                    }}
                  >
                    {/* Row 1: Title + Status */}
                    <div
                      style={{
                        display: "flex",
                        alignItems: "flex-start",
                        justifyContent: "space-between",
                        gap: "var(--space-3)"
                      }}
                    >
                      <h3
                        style={{
                          margin: 0,
                          fontSize: 16,
                          fontWeight: 600,
                          fontFamily: "var(--font-heading)",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                          flex: 1,
                          minWidth: 0
                        }}
                      >
                        {listing.title || "Untitled listing"}
                      </h3>
                      <span
                        className={`status-pill status-pill--${listing.status}`}
                        style={{ flexShrink: 0, fontSize: 11 }}
                      >
                        {STATUS_LABEL[listing.status]}
                      </span>
                    </div>

                    {/* Row 2: Location + Price */}
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        gap: "var(--space-4)"
                      }}
                    >
                      <span
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 4,
                          fontSize: 13,
                          color: "var(--text-secondary)"
                        }}
                      >
                        <MapPin size={13} style={{ flexShrink: 0, opacity: 0.6 }} />
                        {listing.city ? toTitleCase(listing.city) : "City not set"}
                        {" · "}
                        {listing.listingType === "pg" ? "PG" : "Flat/House"}
                      </span>

                      {typeof listing.monthlyRent === "number" ? (
                        <span
                          style={{
                            fontFamily: "var(--font-heading)",
                            fontWeight: 700,
                            fontSize: 16,
                            color: "var(--brand)",
                            whiteSpace: "nowrap"
                          }}
                        >
                          ₹{listing.monthlyRent.toLocaleString("en-IN")}
                          <span
                            style={{
                              fontSize: 12,
                              fontWeight: 400,
                              color: "var(--text-tertiary)",
                              marginLeft: 2
                            }}
                          >
                            /mo
                          </span>
                        </span>
                      ) : (
                        <span style={{ fontSize: 13, color: "var(--text-tertiary)" }}>
                          Rent not set
                        </span>
                      )}
                    </div>

                    {/* Row 3: Badges + Actions */}
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        gap: "var(--space-2)",
                        marginTop: "var(--space-1)",
                        paddingTop: "var(--space-2)",
                        borderTop: "1px solid var(--border)"
                      }}
                    >
                      {/* Left: verification badge */}
                      <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
                        <span
                          className={`badge badge--${
                            listing.verificationStatus === "verified"
                              ? "verified"
                              : listing.verificationStatus === "pending"
                                ? "pending"
                                : "default"
                          }`}
                          style={{
                            fontSize: 11,
                            display: "inline-flex",
                            alignItems: "center",
                            gap: 3
                          }}
                        >
                          {listing.verificationStatus === "verified" && <CheckCircle2 size={11} />}
                          {listing.verificationStatus === "pending" && <Clock size={11} />}
                          {listing.verificationStatus === "failed" && <XCircle size={11} />}
                          {VERIFICATION_LABEL[listing.verificationStatus]}
                        </span>
                      </div>

                      {/* Right: action buttons */}
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: "var(--space-2)"
                        }}
                      >
                        {/* Availability toggle */}
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

                        {/* Edit */}
                        {(listing.status === "draft" || listing.status === "rejected") && (
                          <Link
                            className="btn btn--primary btn--sm"
                            href={`/${locale}/owner/listings/new?edit=${listing.id}`}
                            style={{
                              display: "inline-flex",
                              alignItems: "center",
                              gap: 4,
                              fontSize: 12,
                              padding: "4px 10px"
                            }}
                          >
                            <Pencil size={12} />
                            {listing.status === "rejected" ? "Fix & Resubmit" : "Edit & Submit"}
                          </Link>
                        )}
                        {(listing.status === "active" || listing.status === "paused") && (
                          <Link
                            className="btn btn--secondary btn--sm"
                            href={`/${locale}/owner/listings/new?edit=${listing.id}`}
                            style={{
                              display: "inline-flex",
                              alignItems: "center",
                              gap: 4,
                              fontSize: 12,
                              padding: "4px 10px"
                            }}
                          >
                            <Pencil size={12} /> Edit
                          </Link>
                        )}

                        {/* Boost */}
                        {listing.status === "active" && (
                          <button
                            type="button"
                            onClick={() => setBoostTarget(listing)}
                            style={{
                              display: "inline-flex",
                              alignItems: "center",
                              gap: 4,
                              padding: "4px 10px",
                              fontSize: 12,
                              fontWeight: 700,
                              background: "linear-gradient(135deg, #f59e0b 0%, #d97706 100%)",
                              color: "white",
                              border: "none",
                              borderRadius: "var(--radius-sm)",
                              cursor: "pointer",
                              transition: "opacity 150ms ease"
                            }}
                          >
                            <Zap size={12} /> Boost
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          )}
        </>
      )}

      {/* ═══ LEADS PANEL ═══ */}
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

      {/* ═══ INLINE LINKS (Verification + PM) ═══ */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: "var(--space-3)",
          marginTop: "var(--space-6)",
          paddingTop: "var(--space-5)",
          borderTop: "1px solid var(--border)"
        }}
      >
        {/* Verification */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: "var(--space-4)",
            padding: "var(--space-3) var(--space-4)",
            borderRadius: "var(--radius-md)",
            background: "var(--surface)",
            border: "1px solid var(--border)"
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "var(--space-3)" }}>
            <div
              style={{
                width: 32,
                height: 32,
                borderRadius: "var(--radius-md)",
                background: "rgba(34,197,94,0.08)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0
              }}
            >
              <ShieldCheck size={16} style={{ color: "var(--trust)" }} />
            </div>
            <div>
              <span style={{ fontSize: 14, fontWeight: 600 }}>Verification status</span>
              <span
                style={{
                  display: "block",
                  fontSize: 12,
                  color: "var(--text-tertiary)",
                  marginTop: 1
                }}
              >
                Get verified to earn a trust badge
              </span>
            </div>
          </div>
          <Link
            className="btn btn--primary btn--sm"
            href={`/${locale}/owner/verification`}
            style={{ fontSize: 12, padding: "4px 12px", whiteSpace: "nowrap" }}
          >
            {t(loc, "verification")}
          </Link>
        </div>

        {/* Property Management */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: "var(--space-4)",
            padding: "var(--space-3) var(--space-4)",
            borderRadius: "var(--radius-md)",
            background: "var(--surface)",
            border: "1px solid var(--border)"
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "var(--space-3)" }}>
            <div
              style={{
                width: 32,
                height: 32,
                borderRadius: "var(--radius-md)",
                background: "rgba(0,102,255,0.06)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0
              }}
            >
              <Building size={16} style={{ color: "var(--brand)" }} />
            </div>
            <div>
              <span style={{ fontSize: 14, fontWeight: 600 }}>Property management</span>
              <span
                style={{
                  display: "block",
                  fontSize: 12,
                  color: "var(--text-tertiary)",
                  marginTop: 1
                }}
              >
                Managed onboarding & operations support
              </span>
            </div>
          </div>
          <button
            type="button"
            className="btn btn--secondary btn--sm"
            onClick={() => void requestPropertyManagementAssist()}
            disabled={pmRequesting}
            style={{ fontSize: 12, padding: "4px 12px", whiteSpace: "nowrap" }}
          >
            {pmRequesting ? "Requesting\u2026" : "Request Callback"}
          </button>
        </div>
        {pmNotice && (
          <p
            className="caption"
            role="status"
            style={{ color: "var(--text-tertiary)", marginLeft: "var(--space-4)" }}
          >
            {pmNotice}
          </p>
        )}
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
            setBoostNotice(`Boost activated! Payment ID: ${paymentId.slice(0, 12)}\u2026`);
            setTimeout(() => setBoostNotice(null), 8000);
          }}
        />
      )}
    </section>
  );
}
