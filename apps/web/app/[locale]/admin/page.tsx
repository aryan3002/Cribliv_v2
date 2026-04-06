"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { useSession, signOut } from "next-auth/react";
import { trackEvent } from "../../../lib/analytics";
import {
  decideAdminListing,
  decideAdminVerification,
  fetchAdminListings,
  fetchAdminLeads,
  fetchAdminVerifications,
  updateAdminLeadStatus,
  fetchAdminAnalyticsOverview,
  fetchAdminAnalyticsFunnel,
  fetchAdminAnalyticsResponseRates,
  fetchAdminAnalyticsRevenue,
  fetchAdminAnalyticsByCity,
  fetchAdminUsers,
  changeAdminUserRole,
  fetchAdminRoleRequests,
  decideAdminRoleRequest,
  fetchAdminFraudFlags,
  resolveAdminFraudFlag,
  triggerAiBackfill,
  triggerAiRecomputeScores,
  adjustAdminWallet,
  type AdminListingVm,
  type AdminVerificationVm,
  type AdminLeadVm,
  type AdminAnalyticsOverview,
  type AdminFunnelMetrics,
  type AdminResponseRate,
  type AdminRevenue,
  type AdminCityCount,
  type AdminUserVm,
  type AdminRoleRequestVm,
  type AdminFraudFlagVm
} from "../../../lib/admin-api";
import { t, type Locale } from "../../../lib/i18n";

/* ── Type Aliases ──────────────────────────────────────────────────────── */
type ListingDecision = "approve" | "reject" | "pause";
type VerificationDecision = "pass" | "fail" | "manual_review";
type LeadStatus = "new" | "contacted" | "qualified" | "closed_won" | "closed_lost";
type ActiveTab = "overview" | "content" | "verify" | "sales" | "users" | "fraud";

/* ── Helpers ───────────────────────────────────────────────────────────── */
function formatINR(paise: number) {
  return `₹${(paise / 100).toLocaleString("en-IN")}`;
}
function humanize(str: string) {
  return str.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}
function dateShort(iso: string) {
  return new Date(iso).toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });
}

/* ══════════════════════════════════════════════════════════════════════ */
export default function AdminDashboardPage({ params }: { params: { locale: string } }) {
  const locale = params.locale as Locale;
  const { data: nextAuthSession } = useSession();
  const accessToken = (nextAuthSession as { accessToken?: string } | null)?.accessToken ?? null;

  /* ── Tab state ─────────────────────────────────────────────────────── */
  const [activeTab, setActiveTab] = useState<ActiveTab>("overview");
  const loadedTabs = useRef(new Set<string>());
  const [lastRefreshed, setLastRefreshed] = useState<Date>(new Date());

  /* ── KPI / Analytics ───────────────────────────────────────────────── */
  const [overview, setOverview] = useState<AdminAnalyticsOverview | null>(null);
  const [funnel, setFunnel] = useState<AdminFunnelMetrics | null>(null);
  const [responseRate, setResponseRate] = useState<AdminResponseRate | null>(null);
  const [revenue, setRevenue] = useState<AdminRevenue | null>(null);
  const [cityBreakdown, setCityBreakdown] = useState<AdminCityCount[]>([]);
  const [loadingOverview, setLoadingOverview] = useState(false);

  /* ── Listings (content review) ─────────────────────────────────────── */
  const [listings, setListings] = useState<AdminListingVm[]>([]);
  const [listingsLoading, setListingsLoading] = useState(false);
  const [listingsError, setListingsError] = useState<string | null>(null);
  const [listingReasons, setListingReasons] = useState<Record<string, string>>({});
  const [listingErrors, setListingErrors] = useState<Record<string, string>>({});
  const [listingProcessing, setListingProcessing] = useState<Record<string, boolean>>({});
  const [listingTypeFilter, setListingTypeFilter] = useState<"all" | "flat_house" | "pg">("all");

  /* ── Verifications ─────────────────────────────────────────────────── */
  const [verifications, setVerifications] = useState<AdminVerificationVm[]>([]);
  const [verificationsLoading, setVerificationsLoading] = useState(false);
  const [verificationsError, setVerificationsError] = useState<string | null>(null);
  const [verificationReasons, setVerificationReasons] = useState<Record<string, string>>({});
  const [verificationErrors, setVerificationErrors] = useState<Record<string, string>>({});
  const [verificationProcessing, setVerificationProcessing] = useState<Record<string, boolean>>({});
  const [verTypeFilter, setVerTypeFilter] = useState<
    "all" | "video_liveness" | "electricity_bill_match"
  >("all");

  /* ── Leads ─────────────────────────────────────────────────────────── */
  const [leads, setLeads] = useState<AdminLeadVm[]>([]);
  const [leadsLoading, setLeadsLoading] = useState(false);
  const [leadsError, setLeadsError] = useState<string | null>(null);
  const [leadReasons, setLeadReasons] = useState<Record<string, string>>({});
  const [leadErrors, setLeadErrors] = useState<Record<string, string>>({});
  const [leadProcessing, setLeadProcessing] = useState<Record<string, boolean>>({});

  /* ── Users ─────────────────────────────────────────────────────────── */
  const [users, setUsers] = useState<AdminUserVm[]>([]);
  const [usersLoading, setUsersLoading] = useState(false);
  const [roleRequests, setRoleRequests] = useState<AdminRoleRequestVm[]>([]);
  const [roleRequestProcessing, setRoleRequestProcessing] = useState<Record<string, boolean>>({});

  /* ── Fraud ─────────────────────────────────────────────────────────── */
  const [fraudFlags, setFraudFlags] = useState<AdminFraudFlagVm[]>([]);
  const [fraudLoading, setFraudLoading] = useState(false);
  const [fraudProcessing, setFraudProcessing] = useState<Record<string, boolean>>({});

  /* ── System Panel ──────────────────────────────────────────────────── */
  const [systemOpen, setSystemOpen] = useState(false);
  const [aiBackfillStatus, setAiBackfillStatus] = useState<
    "idle" | "loading" | "success" | "error"
  >("idle");
  const [aiScoresStatus, setAiScoresStatus] = useState<"idle" | "loading" | "success" | "error">(
    "idle"
  );
  const [walletUserId, setWalletUserId] = useState("");
  const [walletDelta, setWalletDelta] = useState("");
  const [walletReason, setWalletReason] = useState("");
  const [walletStatus, setWalletStatus] = useState<"idle" | "loading" | "success" | "error">(
    "idle"
  );
  const [walletMsg, setWalletMsg] = useState("");

  /* ── Token helper ──────────────────────────────────────────────────── */
  const getToken = useCallback(() => accessToken, [accessToken]);

  /* ── Data loaders ──────────────────────────────────────────────────── */
  const loadOverview = useCallback(async () => {
    const token = getToken();
    if (!token) return;
    setLoadingOverview(true);
    try {
      const data = await fetchAdminAnalyticsOverview(token);
      setOverview(data);
    } catch {
      /* silent */
    }
    setLoadingOverview(false);
  }, [getToken]);

  const loadOverviewTab = useCallback(async () => {
    const token = getToken();
    if (!token) return;
    try {
      const [f, rr, rev, cities] = await Promise.all([
        fetchAdminAnalyticsFunnel(token),
        fetchAdminAnalyticsResponseRates(token),
        fetchAdminAnalyticsRevenue(token),
        fetchAdminAnalyticsByCity(token)
      ]);
      setFunnel(f);
      setResponseRate(rr);
      setRevenue(rev);
      setCityBreakdown(cities);
    } catch {
      /* silent */
    }
  }, [getToken]);

  const loadListings = useCallback(async () => {
    const token = getToken();
    if (!token) {
      setListingsError(t(locale, "loginRequired"));
      return;
    }
    setListingsLoading(true);
    setListingsError(null);
    try {
      const res = await fetchAdminListings(token);
      setListings(res.items);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to load listings";
      if (msg.toLowerCase().includes("unauthorized")) void signOut({ redirect: false });
      setListingsError(msg);
    }
    setListingsLoading(false);
  }, [getToken, locale]);

  const loadVerifications = useCallback(async () => {
    const token = getToken();
    if (!token) {
      setVerificationsError(t(locale, "loginRequired"));
      return;
    }
    setVerificationsLoading(true);
    setVerificationsError(null);
    try {
      const res = await fetchAdminVerifications(token);
      setVerifications(res.items);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to load verifications";
      if (msg.toLowerCase().includes("unauthorized")) void signOut({ redirect: false });
      setVerificationsError(msg);
    }
    setVerificationsLoading(false);
  }, [getToken, locale]);

  const loadLeads = useCallback(async () => {
    const token = getToken();
    if (!token) {
      setLeadsError(t(locale, "loginRequired"));
      return;
    }
    setLeadsLoading(true);
    setLeadsError(null);
    try {
      const res = await fetchAdminLeads(token);
      setLeads(res.items);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to load leads";
      if (msg.toLowerCase().includes("unauthorized")) void signOut({ redirect: false });
      setLeadsError(msg);
    }
    setLeadsLoading(false);
  }, [getToken, locale]);

  const loadUsers = useCallback(async () => {
    const token = getToken();
    if (!token) return;
    setUsersLoading(true);
    try {
      const [u, rr] = await Promise.all([fetchAdminUsers(token), fetchAdminRoleRequests(token)]);
      setUsers(u);
      setRoleRequests(rr.filter((r) => r.status === "pending"));
    } catch {
      /* silent */
    }
    setUsersLoading(false);
  }, [getToken]);

  const loadFraud = useCallback(async () => {
    const token = getToken();
    if (!token) return;
    setFraudLoading(true);
    try {
      const flags = await fetchAdminFraudFlags(token);
      setFraudFlags(flags.filter((f) => !f.resolved));
    } catch {
      /* silent */
    }
    setFraudLoading(false);
  }, [getToken]);

  /* ── Initial load: KPI overview + overview tab ─────────────────────── */
  useEffect(() => {
    if (!accessToken) return;
    void loadOverview();
    void loadOverviewTab();
    loadedTabs.current.add("overview");
  }, [accessToken, loadOverview, loadOverviewTab]);

  /* ── Lazy load per tab ─────────────────────────────────────────────── */
  useEffect(() => {
    if (loadedTabs.current.has(activeTab)) return;
    loadedTabs.current.add(activeTab);

    switch (activeTab) {
      case "content":
        void loadListings();
        break;
      case "verify":
        void loadVerifications();
        break;
      case "sales":
        void loadLeads();
        break;
      case "users":
        void loadUsers();
        break;
      case "fraud":
        void loadFraud();
        break;
    }
  }, [activeTab, loadListings, loadVerifications, loadLeads, loadUsers, loadFraud]);

  /* ── Refresh all ───────────────────────────────────────────────────── */
  function handleRefreshAll() {
    loadedTabs.current.clear();
    loadedTabs.current.add(activeTab);
    setLastRefreshed(new Date());
    void loadOverview();

    switch (activeTab) {
      case "overview":
        void loadOverviewTab();
        break;
      case "content":
        void loadListings();
        break;
      case "verify":
        void loadVerifications();
        break;
      case "sales":
        void loadLeads();
        break;
      case "users":
        void loadUsers();
        break;
      case "fraud":
        void loadFraud();
        break;
    }
  }

  /* ── Decision handlers (existing) ──────────────────────────────────── */
  async function handleListingDecision(listingId: string, decision: ListingDecision) {
    if (decision === "reject" || decision === "pause") {
      const reason = (listingReasons[listingId] || "").trim();
      if (!reason) {
        setListingErrors((p) => ({ ...p, [listingId]: t(locale, "reasonRequired") }));
        return;
      }
    }
    const token = getToken();
    if (!token) return;
    setListingProcessing((p) => ({ ...p, [listingId]: true }));
    setListingErrors((p) => ({ ...p, [listingId]: "" }));
    try {
      const reason = (listingReasons[listingId] || "").trim();
      await decideAdminListing(token, listingId, decision, reason || undefined);
      trackEvent("admin_listing_decision", { listing_id: listingId, decision });
      setListings((p) => p.filter((i) => i.id !== listingId));
      setListingReasons((p) => {
        const n = { ...p };
        delete n[listingId];
        return n;
      });
    } catch (err) {
      setListingErrors((p) => ({
        ...p,
        [listingId]: err instanceof Error ? err.message : "Decision failed"
      }));
    }
    setListingProcessing((p) => ({ ...p, [listingId]: false }));
  }

  async function handleVerificationDecision(attemptId: string, decision: VerificationDecision) {
    if (decision === "fail") {
      const reason = (verificationReasons[attemptId] || "").trim();
      if (!reason) {
        setVerificationErrors((p) => ({ ...p, [attemptId]: t(locale, "reasonRequired") }));
        return;
      }
    }
    const token = getToken();
    if (!token) return;
    setVerificationProcessing((p) => ({ ...p, [attemptId]: true }));
    setVerificationErrors((p) => ({ ...p, [attemptId]: "" }));
    try {
      const reason = (verificationReasons[attemptId] || "").trim();
      await decideAdminVerification(token, attemptId, decision, reason || undefined);
      trackEvent("admin_verification_decision", { attempt_id: attemptId, decision });
      setVerifications((p) => p.filter((i) => i.id !== attemptId));
      setVerificationReasons((p) => {
        const n = { ...p };
        delete n[attemptId];
        return n;
      });
    } catch (err) {
      setVerificationErrors((p) => ({
        ...p,
        [attemptId]: err instanceof Error ? err.message : "Decision failed"
      }));
    }
    setVerificationProcessing((p) => ({ ...p, [attemptId]: false }));
  }

  async function handleLeadStatus(leadId: string, status: LeadStatus) {
    const token = getToken();
    if (!token) return;
    setLeadProcessing((p) => ({ ...p, [leadId]: true }));
    setLeadErrors((p) => ({ ...p, [leadId]: "" }));
    try {
      const reason = (leadReasons[leadId] || "").trim();
      await updateAdminLeadStatus(token, leadId, status, reason || undefined);
      trackEvent("admin_lead_status_updated", { lead_id: leadId, status });
      setLeads((p) => p.map((l) => (l.id === leadId ? { ...l, status } : l)));
      setLeadReasons((p) => ({ ...p, [leadId]: "" }));
    } catch (err) {
      setLeadErrors((p) => ({
        ...p,
        [leadId]: err instanceof Error ? err.message : "Lead update failed"
      }));
    }
    setLeadProcessing((p) => ({ ...p, [leadId]: false }));
  }

  /* ── New handlers ──────────────────────────────────────────────────── */
  async function handleRoleRequestDecision(requestId: string, decision: "approve" | "reject") {
    const token = getToken();
    if (!token) return;
    setRoleRequestProcessing((p) => ({ ...p, [requestId]: true }));
    try {
      await decideAdminRoleRequest(token, requestId, decision);
      setRoleRequests((p) => p.filter((r) => r.id !== requestId));
    } catch {
      /* silent */
    }
    setRoleRequestProcessing((p) => ({ ...p, [requestId]: false }));
  }

  async function handleUserRoleChange(userId: string, newRole: string) {
    const token = getToken();
    if (!token) return;
    if (!confirm(`Change this user's role to "${humanize(newRole)}"?`)) return;
    try {
      await changeAdminUserRole(token, userId, newRole);
      setUsers((p) => p.map((u) => (u.id === userId ? { ...u, role: newRole } : u)));
    } catch {
      /* silent */
    }
  }

  async function handleResolveFraud(flagId: string) {
    const token = getToken();
    if (!token) return;
    setFraudProcessing((p) => ({ ...p, [flagId]: true }));
    try {
      await resolveAdminFraudFlag(token, flagId);
      setFraudFlags((p) => p.filter((f) => f.id !== flagId));
    } catch {
      /* silent */
    }
    setFraudProcessing((p) => ({ ...p, [flagId]: false }));
  }

  async function handleAiBackfill() {
    const token = getToken();
    if (!token) return;
    setAiBackfillStatus("loading");
    try {
      await triggerAiBackfill(token);
      setAiBackfillStatus("success");
    } catch {
      setAiBackfillStatus("error");
    }
  }

  async function handleAiRecompute() {
    const token = getToken();
    if (!token) return;
    setAiScoresStatus("loading");
    try {
      await triggerAiRecomputeScores(token);
      setAiScoresStatus("success");
    } catch {
      setAiScoresStatus("error");
    }
  }

  async function handleWalletAdjust() {
    const token = getToken();
    if (!token || !walletUserId.trim() || !walletDelta || !walletReason.trim()) return;
    setWalletStatus("loading");
    try {
      const res = await adjustAdminWallet(
        token,
        walletUserId.trim(),
        Number(walletDelta),
        walletReason.trim()
      );
      setWalletStatus("success");
      setWalletMsg(`New balance: ${res.new_balance} credits`);
      setWalletUserId("");
      setWalletDelta("");
      setWalletReason("");
    } catch (err) {
      setWalletStatus("error");
      setWalletMsg(err instanceof Error ? err.message : "Wallet adjustment failed");
    }
  }

  /* ── Skeleton helper ───────────────────────────────────────────────── */
  function renderSkeleton(count = 3) {
    return (
      <div
        style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)" }}
        aria-busy="true"
      >
        {Array.from({ length: count }).map((_, i) => (
          <div key={i} className="skeleton-card" />
        ))}
      </div>
    );
  }

  /* ══════════════════════════════════════════════════════════════════════
     KPI Strip
     ══════════════════════════════════════════════════════════════════════ */
  function renderKpiStrip() {
    const pendingReview =
      listings.filter((l) => l.status === "pending_review").length +
      verifications.filter((v) => v.result === "manual_review" || v.result === "pending").length;

    const kpis = [
      {
        label: "Total Listings",
        value: overview?.totalListings ?? "—",
        color: "var(--brand)",
        icon: "🏢"
      },
      {
        label: "Active Listings",
        value: overview?.activeListings ?? "—",
        color: "var(--trust)",
        icon: "✅"
      },
      {
        label: "Total Users",
        value: overview?.totalUsers ?? "—",
        color: "var(--accent)",
        icon: "👥"
      },
      {
        label: "Contact Unlocks",
        value: overview?.totalUnlocks ?? "—",
        color: "var(--amber)",
        icon: "🔓"
      },
      {
        label: "Revenue",
        value: overview ? formatINR(overview.totalRevenuePaise) : "—",
        color: "#7c3aed",
        icon: "₹"
      },
      { label: "Pending Review", value: pendingReview, color: "var(--danger)", icon: "⏳" }
    ];

    return (
      <div className="admin-kpi-grid">
        {kpis.map((kpi) => (
          <div key={kpi.label} className="admin-kpi-card" style={{ borderTopColor: kpi.color }}>
            <span className="admin-kpi-card__icon">{kpi.icon}</span>
            <span className="admin-kpi-card__value">
              {loadingOverview && typeof kpi.value !== "number" ? "…" : kpi.value}
            </span>
            <span className="admin-kpi-card__label">{kpi.label}</span>
          </div>
        ))}
      </div>
    );
  }

  /* ══════════════════════════════════════════════════════════════════════
     Tab: Overview
     ══════════════════════════════════════════════════════════════════════ */
  function renderOverviewTab() {
    const maxVal = Math.max(funnel?.views ?? 1, 1);
    const pct = (n: number) => `${Math.round((n / maxVal) * 100)}%`;
    const funnelSteps = funnel
      ? [
          { label: "Views", value: funnel.views, color: "var(--brand)" },
          { label: "Enquiries", value: funnel.enquiries, color: "var(--brand-dark)" },
          { label: "Unlocks", value: funnel.unlocks, color: "var(--trust)" },
          { label: "Leads", value: funnel.leadsCreated, color: "var(--accent)" }
        ]
      : [];

    return (
      <div className="admin-overview-grid">
        {/* Left — Funnel */}
        <div>
          <h3 className="h4" style={{ marginBottom: "var(--space-4)" }}>
            Conversion Funnel (30d)
          </h3>
          {!funnel ? (
            renderSkeleton(1)
          ) : (
            <div className="admin-funnel">
              {funnelSteps.map((step) => (
                <div key={step.label} className="admin-funnel__step">
                  <span className="admin-funnel__label">{step.label}</span>
                  <div className="admin-funnel__bar-wrap">
                    <div
                      className="admin-funnel__bar"
                      style={{ width: pct(step.value), background: step.color }}
                    >
                      {step.value > 0 && <span>{step.value.toLocaleString()}</span>}
                    </div>
                  </div>
                  <span className="admin-funnel__value">{step.value.toLocaleString()}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Right — Metrics */}
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
          <div className="admin-metric-card">
            <div className="admin-metric-card__value">
              {responseRate ? `${Math.round(responseRate.avgResponseRate)}%` : "—"}
            </div>
            <div className="admin-metric-card__label">
              Avg owner response rate
              {responseRate
                ? ` · ${responseRate.responded}/${responseRate.totalUnlocks} responded`
                : ""}
            </div>
          </div>

          <div className="admin-metric-card">
            <div className="admin-metric-card__value">
              {revenue ? formatINR(revenue.totalPaise) : "—"}
            </div>
            <div className="admin-metric-card__label">
              Boost revenue (30d){revenue ? ` · ${revenue.orderCount} orders` : ""}
            </div>
          </div>

          <div className="admin-metric-card">
            <h4 className="h4" style={{ marginBottom: "var(--space-3)" }}>
              Top Cities
            </h4>
            {cityBreakdown.length === 0 ? (
              <div className="body-sm text-tertiary">No city data yet</div>
            ) : (
              cityBreakdown.slice(0, 5).map((c, i) => (
                <div key={i} className="admin-city-row">
                  <span>
                    {c.city}
                    {c.locality ? `, ${c.locality}` : ""}
                  </span>
                  <strong>{c.count}</strong>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    );
  }

  /* ══════════════════════════════════════════════════════════════════════
     Tab: Content Review (enhanced)
     ══════════════════════════════════════════════════════════════════════ */
  function renderContentTab() {
    if (listingsLoading) return renderSkeleton();
    if (listingsError)
      return (
        <div className="alert alert--error" role="alert">
          {listingsError}
        </div>
      );

    const filtered =
      listingTypeFilter === "all"
        ? listings
        : listings.filter((l) => l.listingType === listingTypeFilter);

    return (
      <>
        <div className="admin-filter-row">
          {(["all", "flat_house", "pg"] as const).map((f) => (
            <button
              key={f}
              type="button"
              className={`chip${listingTypeFilter === f ? " chip--active" : ""}`}
              onClick={() => setListingTypeFilter(f)}
            >
              {f === "all" ? "All" : f === "flat_house" ? "Flat / House" : "PG"}
            </button>
          ))}
        </div>

        {filtered.length === 0 ? (
          <div className="empty-state">
            <span className="empty-state__icon">📋</span>
            <h3 className="empty-state__heading">No listings pending review</h3>
            <p className="empty-state__description">All submitted listings have been reviewed.</p>
          </div>
        ) : (
          filtered.map((listing) => {
            const processing = listingProcessing[listing.id] || false;
            const fieldError = listingErrors[listing.id] || "";
            return (
              <div key={listing.id} className="queue-card">
                <div className="queue-card__header">
                  <div>
                    <h3 className="queue-card__title">{listing.title || "Untitled"}</h3>
                    <div className="queue-card__meta">
                      {listing.city || "City unknown"} &middot;{" "}
                      {listing.listingType === "pg" ? "PG" : "Flat/House"}
                      {typeof listing.monthlyRent === "number" && (
                        <>
                          {" "}
                          &middot;{" "}
                          <strong>₹{listing.monthlyRent.toLocaleString("en-IN")}/mo</strong>
                        </>
                      )}{" "}
                      &middot; Owner: {listing.ownerUserId}
                    </div>
                  </div>
                  <span className={`status-pill status-pill--${listing.status}`}>
                    {listing.status.replace(/_/g, " ")}
                  </span>
                </div>
                <div className="queue-card__meta">
                  Submitted: {dateShort(listing.createdAt)} &middot; Verification:{" "}
                  <span className={`status-pill status-pill--${listing.verificationStatus}`}>
                    {listing.verificationStatus}
                  </span>
                </div>
                <div>
                  <label htmlFor={`reason-listing-${listing.id}`} className="form-label">
                    Reason (required for reject/pause)
                  </label>
                  <textarea
                    id={`reason-listing-${listing.id}`}
                    className="textarea"
                    placeholder="Enter reason for rejection or pause..."
                    value={listingReasons[listing.id] || ""}
                    onChange={(e) =>
                      setListingReasons((p) => ({ ...p, [listing.id]: e.target.value }))
                    }
                  />
                  {fieldError && <p className="form-error">{fieldError}</p>}
                </div>
                <div className="queue-card__actions">
                  <button
                    type="button"
                    className="btn btn--primary btn--sm"
                    disabled={processing}
                    onClick={() => handleListingDecision(listing.id, "approve")}
                  >
                    {t(locale, "approve")}
                  </button>
                  <button
                    type="button"
                    className="btn btn--danger btn--sm"
                    disabled={processing}
                    onClick={() => handleListingDecision(listing.id, "reject")}
                  >
                    {t(locale, "reject")}
                  </button>
                  <button
                    type="button"
                    className="btn btn--secondary btn--sm"
                    disabled={processing}
                    onClick={() => handleListingDecision(listing.id, "pause")}
                  >
                    {t(locale, "pause")}
                  </button>
                </div>
              </div>
            );
          })
        )}
      </>
    );
  }

  /* ══════════════════════════════════════════════════════════════════════
     Tab: Verifications (enhanced)
     ══════════════════════════════════════════════════════════════════════ */
  function renderVerifyTab() {
    if (verificationsLoading) return renderSkeleton();
    if (verificationsError)
      return (
        <div className="alert alert--error" role="alert">
          {verificationsError}
        </div>
      );

    const filtered =
      verTypeFilter === "all"
        ? verifications
        : verifications.filter((v) => v.verificationType === verTypeFilter);

    return (
      <>
        <div className="admin-filter-row">
          {(["all", "video_liveness", "electricity_bill_match"] as const).map((f) => (
            <button
              key={f}
              type="button"
              className={`chip${verTypeFilter === f ? " chip--active" : ""}`}
              onClick={() => setVerTypeFilter(f)}
            >
              {f === "all" ? "All" : f === "video_liveness" ? "Video Liveness" : "Electricity Bill"}
            </button>
          ))}
        </div>

        {filtered.length === 0 ? (
          <div className="empty-state">
            <span className="empty-state__icon">🔍</span>
            <h3 className="empty-state__heading">No verifications pending review</h3>
            <p className="empty-state__description">
              All submitted verifications have been reviewed.
            </p>
          </div>
        ) : (
          filtered.map((ver) => {
            const processing = verificationProcessing[ver.id] || false;
            const fieldError = verificationErrors[ver.id] || "";
            return (
              <div key={ver.id} className="queue-card">
                <div className="queue-card__header">
                  <div>
                    <h3 className="queue-card__title">
                      {ver.verificationType === "video_liveness"
                        ? "Video Liveness"
                        : "Electricity Bill Match"}
                    </h3>
                    <div className="queue-card__meta">
                      User: {ver.userId}
                      {ver.listingId && <> &middot; Listing: {ver.listingId}</>}
                      {ver.provider && <> &middot; Provider: {ver.provider}</>}
                      {ver.providerResultCode && <> &middot; Code: {ver.providerResultCode}</>}
                      {typeof ver.addressMatchScore === "number" && (
                        <>
                          {" "}
                          &middot;{" "}
                          <span
                            className={`badge ${ver.addressMatchScore >= ver.threshold ? "badge--verified" : "badge--failed"}`}
                          >
                            Match: {ver.addressMatchScore}%
                          </span>
                        </>
                      )}
                      {typeof ver.livenessScore === "number" && (
                        <> &middot; Liveness: {ver.livenessScore}%</>
                      )}
                      {ver.retryable && (
                        <>
                          {" "}
                          &middot; <em>Retryable</em>
                        </>
                      )}
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: "var(--space-2)", alignItems: "center" }}>
                    {ver.machineResult && (
                      <span
                        className={`status-pill status-pill--${ver.machineResult}`}
                        title="Machine result"
                      >
                        🤖 {ver.machineResult.replace(/_/g, " ")}
                      </span>
                    )}
                    <span className={`status-pill status-pill--${ver.result}`}>
                      {ver.result.replace(/_/g, " ")}
                    </span>
                  </div>
                </div>

                {ver.reviewReason && (
                  <div className="queue-card__meta">Review reason: {ver.reviewReason}</div>
                )}
                <div className="queue-card__meta">Submitted: {dateShort(ver.createdAt)}</div>

                <div>
                  <label htmlFor={`reason-ver-${ver.id}`} className="form-label">
                    Reason (required for fail)
                  </label>
                  <textarea
                    id={`reason-ver-${ver.id}`}
                    className="textarea"
                    placeholder="Enter reason for failure..."
                    value={verificationReasons[ver.id] || ""}
                    onChange={(e) =>
                      setVerificationReasons((p) => ({ ...p, [ver.id]: e.target.value }))
                    }
                  />
                  {fieldError && <p className="form-error">{fieldError}</p>}
                </div>
                <div className="queue-card__actions">
                  <button
                    type="button"
                    className="btn btn--primary btn--sm"
                    disabled={processing}
                    onClick={() => handleVerificationDecision(ver.id, "pass")}
                  >
                    {t(locale, "pass")}
                  </button>
                  <button
                    type="button"
                    className="btn btn--danger btn--sm"
                    disabled={processing}
                    onClick={() => handleVerificationDecision(ver.id, "fail")}
                  >
                    {t(locale, "fail")}
                  </button>
                  <button
                    type="button"
                    className="btn btn--secondary btn--sm"
                    disabled={processing}
                    onClick={() => handleVerificationDecision(ver.id, "manual_review")}
                  >
                    {t(locale, "manualReview")}
                  </button>
                </div>
              </div>
            );
          })
        )}
      </>
    );
  }

  /* ══════════════════════════════════════════════════════════════════════
     Tab: Sales (unchanged)
     ══════════════════════════════════════════════════════════════════════ */
  function renderSalesTab() {
    if (leadsLoading) return renderSkeleton();
    if (leadsError)
      return (
        <div className="alert alert--error" role="alert">
          {leadsError}
        </div>
      );

    if (leads.length === 0) {
      return (
        <div className="empty-state">
          <span className="empty-state__icon">📊</span>
          <h3 className="empty-state__heading">No sales leads yet</h3>
          <p className="empty-state__description">
            New leads from PG sales assist and property management requests will appear here.
          </p>
        </div>
      );
    }

    return (
      <div>
        {leads.map((lead) => {
          const processing = leadProcessing[lead.id] || false;
          const fieldError = leadErrors[lead.id] || "";
          return (
            <div key={lead.id} className="queue-card">
              <div className="queue-card__header">
                <div>
                  <h3 className="queue-card__title">
                    {lead.source === "pg_sales_assist"
                      ? "PG Sales Assist Lead"
                      : "Property Management Lead"}
                  </h3>
                  <div className="queue-card__meta">
                    Owner: {lead.createdByUserId}
                    {lead.listingId && <> &middot; Listing: {lead.listingId}</>}
                    {lead.notes && <> &middot; {lead.notes}</>}
                  </div>
                </div>
                <span className={`status-pill status-pill--${lead.status}`}>
                  {lead.status.replace(/_/g, " ")}
                </span>
              </div>
              <div className="queue-card__meta">
                Created: {dateShort(lead.createdAt)}
                {" · "}CRM: {lead.crmSyncStatus}
                {lead.lastCrmPushAt && (
                  <> (last push {new Date(lead.lastCrmPushAt).toLocaleString("en-IN")})</>
                )}
              </div>
              <div>
                <label htmlFor={`reason-lead-${lead.id}`} className="form-label">
                  Note (optional)
                </label>
                <textarea
                  id={`reason-lead-${lead.id}`}
                  className="textarea"
                  placeholder="Add context for this status change..."
                  value={leadReasons[lead.id] || ""}
                  onChange={(e) => setLeadReasons((p) => ({ ...p, [lead.id]: e.target.value }))}
                />
                {fieldError && <p className="form-error">{fieldError}</p>}
              </div>
              <div className="queue-card__actions">
                <button
                  type="button"
                  className="btn btn--secondary btn--sm"
                  disabled={processing}
                  onClick={() => handleLeadStatus(lead.id, "contacted")}
                >
                  Mark Contacted
                </button>
                <button
                  type="button"
                  className="btn btn--primary btn--sm"
                  disabled={processing}
                  onClick={() => handleLeadStatus(lead.id, "qualified")}
                >
                  Mark Qualified
                </button>
                <button
                  type="button"
                  className="btn btn--ghost btn--sm"
                  disabled={processing}
                  onClick={() => handleLeadStatus(lead.id, "closed_won")}
                >
                  Close Won
                </button>
                <button
                  type="button"
                  className="btn btn--danger btn--sm"
                  disabled={processing}
                  onClick={() => handleLeadStatus(lead.id, "closed_lost")}
                >
                  Close Lost
                </button>
              </div>
            </div>
          );
        })}
      </div>
    );
  }

  /* ══════════════════════════════════════════════════════════════════════
     Tab: Users (NEW)
     ══════════════════════════════════════════════════════════════════════ */
  function renderUsersTab() {
    if (usersLoading) return renderSkeleton();

    return (
      <>
        {/* Role Requests Queue */}
        {roleRequests.length > 0 && (
          <div style={{ marginBottom: "var(--space-6)" }}>
            <h3 className="h4" style={{ marginBottom: "var(--space-3)" }}>
              Pending Role Requests ({roleRequests.length})
            </h3>
            {roleRequests.map((rr) => (
              <div key={rr.id} className="queue-card">
                <div className="queue-card__header">
                  <div>
                    <h3 className="queue-card__title">{rr.phone}</h3>
                    <div className="queue-card__meta">
                      Requested role: <strong>{humanize(rr.requestedRole)}</strong> &middot;
                      Submitted: {dateShort(rr.createdAt)}
                    </div>
                  </div>
                  <span className="badge badge--pending">{rr.status}</span>
                </div>
                <div className="queue-card__actions">
                  <button
                    type="button"
                    className="btn btn--primary btn--sm"
                    disabled={roleRequestProcessing[rr.id] || false}
                    onClick={() => handleRoleRequestDecision(rr.id, "approve")}
                  >
                    Approve
                  </button>
                  <button
                    type="button"
                    className="btn btn--danger btn--sm"
                    disabled={roleRequestProcessing[rr.id] || false}
                    onClick={() => handleRoleRequestDecision(rr.id, "reject")}
                  >
                    Reject
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* User Table */}
        <div
          style={{
            border: "1px solid var(--border)",
            borderRadius: "var(--radius-lg)",
            overflow: "hidden"
          }}
        >
          <div className="admin-user-table-header">
            <span style={{ flex: "0 0 160px" }}>Phone</span>
            <span style={{ flex: "0 0 120px" }}>Role</span>
            <span style={{ flex: 1 }}>Name</span>
            <span style={{ flex: "0 0 140px" }}>Joined</span>
            <span style={{ flex: "0 0 140px" }}>Change Role</span>
          </div>
          {users.length === 0 ? (
            <div
              style={{ padding: "var(--space-6)", textAlign: "center" }}
              className="text-tertiary"
            >
              No users found
            </div>
          ) : (
            users.map((user) => (
              <div key={user.id} className="admin-user-row">
                <span style={{ flex: "0 0 160px", fontWeight: 600, fontSize: "14px" }}>
                  {user.phone}
                </span>
                <span style={{ flex: "0 0 120px" }}>
                  <span
                    className={`badge badge--${user.role === "admin" ? "brand" : user.role === "owner" ? "verified" : "pending"}`}
                  >
                    {humanize(user.role)}
                  </span>
                </span>
                <span style={{ flex: 1, fontSize: "14px" }}>{user.fullName || "—"}</span>
                <span
                  style={{ flex: "0 0 140px", fontSize: "13px", color: "var(--text-secondary)" }}
                >
                  {new Date(user.createdAt).toLocaleDateString("en-IN", {
                    day: "2-digit",
                    month: "short",
                    year: "numeric"
                  })}
                </span>
                <span style={{ flex: "0 0 140px" }}>
                  <select
                    className="admin-role-select"
                    value={user.role}
                    onChange={(e) => handleUserRoleChange(user.id, e.target.value)}
                  >
                    <option value="tenant">Tenant</option>
                    <option value="owner">Owner</option>
                    <option value="pg_operator">PG Operator</option>
                    <option value="admin">Admin</option>
                  </select>
                </span>
              </div>
            ))
          )}
        </div>
      </>
    );
  }

  /* ══════════════════════════════════════════════════════════════════════
     Tab: Fraud (NEW)
     ══════════════════════════════════════════════════════════════════════ */
  function renderFraudTab() {
    if (fraudLoading) return renderSkeleton();

    if (fraudFlags.length === 0) {
      return (
        <div className="empty-state">
          <span className="empty-state__icon">🛡️</span>
          <h3 className="empty-state__heading">No unresolved fraud flags</h3>
          <p className="empty-state__description">All fraud reports have been resolved.</p>
        </div>
      );
    }

    return (
      <div>
        {fraudFlags.map((flag) => (
          <div key={flag.id} className="queue-card">
            <div className="queue-card__header">
              <div>
                <h3 className="queue-card__title">{humanize(flag.flagType)} Report</h3>
                <div className="queue-card__meta">
                  Reporter: {flag.reportedByUserId}
                  {flag.targetUserId && <> &middot; Target User: {flag.targetUserId}</>}
                  {flag.targetListingId && (
                    <> &middot; Target Listing: {flag.targetListingId}</>
                  )}{" "}
                  &middot; Submitted: {dateShort(flag.createdAt)}
                </div>
              </div>
              <span className="badge badge--failed">Unresolved</span>
            </div>
            <div className="queue-card__actions">
              <button
                type="button"
                className="btn btn--primary btn--sm"
                disabled={fraudProcessing[flag.id] || false}
                onClick={() => handleResolveFraud(flag.id)}
              >
                {fraudProcessing[flag.id] ? "Resolving…" : "Resolve"}
              </button>
            </div>
          </div>
        ))}
      </div>
    );
  }

  /* ══════════════════════════════════════════════════════════════════════
     System Tools Panel
     ══════════════════════════════════════════════════════════════════════ */
  function renderSystemPanel() {
    return (
      <div className="admin-system-panel">
        <button
          type="button"
          className="admin-system-panel__header"
          onClick={() => setSystemOpen((p) => !p)}
          aria-expanded={systemOpen}
        >
          <span>⚙️ System Tools</span>
          <span
            style={{
              transition: "transform 0.2s",
              transform: systemOpen ? "rotate(180deg)" : "rotate(0)"
            }}
          >
            ▾
          </span>
        </button>

        {systemOpen && (
          <div className="admin-system-panel__body">
            {/* AI Maintenance */}
            <div className="admin-system-section">
              <div className="admin-system-section__title">AI Maintenance</div>
              <div style={{ display: "flex", gap: "var(--space-3)", flexWrap: "wrap" }}>
                <button
                  type="button"
                  className="btn btn--secondary btn--sm"
                  disabled={aiBackfillStatus === "loading"}
                  onClick={handleAiBackfill}
                >
                  {aiBackfillStatus === "loading" ? "Running…" : "Backfill Embeddings"}
                </button>
                <button
                  type="button"
                  className="btn btn--secondary btn--sm"
                  disabled={aiScoresStatus === "loading"}
                  onClick={handleAiRecompute}
                >
                  {aiScoresStatus === "loading" ? "Running…" : "Recompute Scores"}
                </button>
              </div>
              {aiBackfillStatus === "success" && (
                <div className="admin-result-msg admin-result-msg--success">
                  ✓ Embeddings backfill triggered
                </div>
              )}
              {aiBackfillStatus === "error" && (
                <div className="admin-result-msg admin-result-msg--error">✕ Backfill failed</div>
              )}
              {aiScoresStatus === "success" && (
                <div className="admin-result-msg admin-result-msg--success">
                  ✓ Score recomputation triggered
                </div>
              )}
              {aiScoresStatus === "error" && (
                <div className="admin-result-msg admin-result-msg--error">
                  ✕ Recomputation failed
                </div>
              )}
            </div>

            {/* Wallet Adjustment */}
            <div className="admin-system-section">
              <div className="admin-system-section__title">Wallet Adjustment</div>
              <div className="admin-inline-form">
                <div className="form-group">
                  <label className="form-label">User ID</label>
                  <input
                    type="text"
                    className="input"
                    placeholder="User UUID"
                    value={walletUserId}
                    onChange={(e) => setWalletUserId(e.target.value)}
                    style={{ width: 220, height: 36 }}
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">Credits (±)</label>
                  <input
                    type="number"
                    className="input"
                    placeholder="+5 or -2"
                    value={walletDelta}
                    onChange={(e) => setWalletDelta(e.target.value)}
                    style={{ width: 100, height: 36 }}
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">Reason</label>
                  <input
                    type="text"
                    className="input"
                    placeholder="e.g. Support refund"
                    value={walletReason}
                    onChange={(e) => setWalletReason(e.target.value)}
                    style={{ width: 200, height: 36 }}
                  />
                </div>
                <button
                  type="button"
                  className="btn btn--primary btn--sm"
                  disabled={
                    walletStatus === "loading" || !walletUserId || !walletDelta || !walletReason
                  }
                  onClick={handleWalletAdjust}
                >
                  {walletStatus === "loading" ? "Processing…" : "Adjust Wallet"}
                </button>
              </div>
              {walletStatus === "success" && (
                <div className="admin-result-msg admin-result-msg--success">✓ {walletMsg}</div>
              )}
              {walletStatus === "error" && (
                <div className="admin-result-msg admin-result-msg--error">✕ {walletMsg}</div>
              )}
            </div>
          </div>
        )}
      </div>
    );
  }

  /* ══════════════════════════════════════════════════════════════════════
     Main Render
     ══════════════════════════════════════════════════════════════════════ */
  const tabs: { key: ActiveTab; label: string; count?: number }[] = [
    { key: "overview", label: "Overview" },
    { key: "content", label: t(locale, "listingReviewQueue"), count: listings.length },
    { key: "verify", label: t(locale, "verificationQueue"), count: verifications.length },
    { key: "sales", label: "Sales Leads", count: leads.length },
    { key: "users", label: "Users" },
    { key: "fraud", label: "Fraud", count: fraudFlags.length }
  ];

  return (
    <section className="container" style={{ paddingBlock: "var(--space-6)" }}>
      {/* Page Header */}
      <div className="admin-page-header">
        <h1 className="h2 admin-page-header__title">{t(locale, "adminDashboard")}</h1>
        <div className="admin-page-header__right">
          <span>
            Last refreshed:{" "}
            {lastRefreshed.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}
          </span>
          <button type="button" className="btn btn--secondary btn--sm" onClick={handleRefreshAll}>
            ↻ Refresh All
          </button>
        </div>
      </div>

      {/* KPI Strip */}
      {renderKpiStrip()}

      {/* Tab Navigation */}
      <div className="tab-row" role="tablist" aria-label="Admin sections">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            type="button"
            role="tab"
            aria-selected={activeTab === tab.key}
            className={`tab-btn${activeTab === tab.key ? " tab-btn--active" : ""}`}
            onClick={() => setActiveTab(tab.key)}
          >
            {tab.label}
            {typeof tab.count === "number" && tab.count > 0 ? ` (${tab.count})` : ""}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      <div style={{ marginTop: "var(--space-5)" }}>
        {activeTab === "overview" && renderOverviewTab()}
        {activeTab === "content" && renderContentTab()}
        {activeTab === "verify" && renderVerifyTab()}
        {activeTab === "sales" && renderSalesTab()}
        {activeTab === "users" && renderUsersTab()}
        {activeTab === "fraud" && renderFraudTab()}
      </div>

      {/* System Tools Panel */}
      {renderSystemPanel()}
    </section>
  );
}
