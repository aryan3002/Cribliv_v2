"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import "../admin.css";
import { AdminSidebar, type AdminTab } from "./AdminSidebar";
import { AdminTopbar } from "./AdminTopbar";
import { CommandPalette } from "./CommandPalette";
import { Toast, useToast } from "../primitives/Toast";
import { LiveOpsTab } from "../tabs/LiveOpsTab";
import { OverviewTab } from "../tabs/OverviewTab";
import { ListingReviewTab } from "../tabs/ListingReviewTab";
import { VerificationTab } from "../tabs/VerificationTab";
import { CrmTab } from "../tabs/CrmTab";
import { LeadCenterTab } from "../lead-center/LeadCenterTab";
import { UsersTab } from "../tabs/UsersTab";
import { RevenueTab } from "../tabs/RevenueTab";
import { RentAgreementsTab } from "../tabs/RentAgreementsTab";
import { PgListingsTab } from "../tabs/PgListingsTab";
import { PgPropertiesTab } from "../tabs/PgPropertiesTab";
import { ManagePgRequestsTab } from "../tabs/ManagePgRequestsTab";
import { FraudTab } from "../tabs/FraudTab";
import { SeoProgrammaticPages } from "../tabs/SeoProgrammaticPages";
import { SearchPerformanceTab } from "../tabs/SearchPerformanceTab";
import { BlogReviewTab } from "../tabs/BlogReviewTab";
import { SystemTab } from "../tabs/SystemTab";
import { AdminTotpPanel } from "../security/AdminTotpPanel";
import { AdminHomesTab } from "../homes/AdminHomesTab";
import { AddListingTab } from "../tabs/AddListingTab";

interface Props {
  accessToken: string;
}

const TAB_TITLES: Record<AdminTab, string> = {
  live: "Live Operations",
  overview: "Overview",
  listings: "Listing Review",
  verifications: "Verification Review",
  leads: "CRM",
  "lead-center": "Lead Center",
  users: "Users",
  revenue: "Revenue",
  "rent-agreements": "Rent Agreements",
  "pg-listings": "PG Overview",
  "pg-properties": "PG Listings",
  "manage-pg-requests": "Manage PG Requests",
  homes: "Verified Homes",
  "add-listing": "Add Listing",
  fraud: "Fraud Intelligence",
  seo: "Programmatic SEO",
  "search-performance": "Search Performance",
  blog: "Blog Review",
  system: "System Tools",
  security: "Security"
};

export function AdminShell({ accessToken }: Props) {
  const [tab, setTab] = useState<AdminTab>("live");
  const [refreshNonce, setRefreshNonce] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [lastRefreshed, setLastRefreshed] = useState<number | null>(Date.now());
  const [counts, setCounts] = useState<Partial<Record<AdminTab, number>>>({});
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [homeTarget, setHomeTarget] = useState<string | null>(null);
  const [listingReviewTarget, setListingReviewTarget] = useState<string | null>(null);
  const [leadCenterListingTarget, setLeadCenterListingTarget] = useState<string | null>(null);
  const { toast, push, dismiss } = useToast();

  // Persist last tab per session
  useEffect(() => {
    const saved = window.sessionStorage.getItem("admin:tab") as AdminTab | null;
    if (saved && TAB_TITLES[saved]) setTab(saved);
  }, []);
  useEffect(() => {
    window.sessionStorage.setItem("admin:tab", tab);
  }, [tab]);

  const triggerRefresh = useCallback(() => {
    setRefreshing(true);
    setRefreshNonce((n) => n + 1);
    setLastRefreshed(Date.now());
    window.setTimeout(() => setRefreshing(false), 800);
  }, []);

  const handleCount = useCallback((forTab: AdminTab) => {
    return (count: number) => {
      setCounts((prev) => (prev[forTab] === count ? prev : { ...prev, [forTab]: count }));
    };
  }, []);

  const openListingReview = useCallback((listingId: string) => {
    setListingReviewTarget(listingId);
    setTab("listings");
  }, []);

  const openHome = useCallback((listingId: string) => {
    setHomeTarget(listingId);
    setTab("homes");
  }, []);

  const openLeadCenterForListing = useCallback((listingId: string) => {
    setLeadCenterListingTarget(listingId);
    setTab("lead-center");
  }, []);

  // Clear one-shot cross-navigation targets after leaving their destination,
  // so later sidebar visits open the normal unscoped tab state.
  useEffect(() => {
    if (tab !== "homes" && homeTarget) setHomeTarget(null);
    if (tab !== "listings" && listingReviewTarget) setListingReviewTarget(null);
    if (tab !== "lead-center" && leadCenterListingTarget) setLeadCenterListingTarget(null);
  }, [homeTarget, leadCenterListingTarget, listingReviewTarget, tab]);

  const view = useMemo(() => {
    // Force-remount tabs on refresh nonce to re-fetch.
    const k = refreshNonce;
    switch (tab) {
      case "live":
        return (
          <LiveOpsTab key={`live-${k}`} accessToken={accessToken} onJumpToTab={(t) => setTab(t)} />
        );
      case "overview":
        return <OverviewTab key={`ov-${k}`} accessToken={accessToken} />;
      case "listings":
        return (
          <ListingReviewTab
            key={`li-${k}`}
            accessToken={accessToken}
            initialListingId={listingReviewTarget}
            onCountChange={handleCount("listings")}
            onToast={push}
          />
        );
      case "verifications":
        return (
          <VerificationTab
            key={`vf-${k}`}
            accessToken={accessToken}
            onCountChange={handleCount("verifications")}
            onToast={push}
            onOpenListing={openListingReview}
          />
        );
      case "leads":
        return (
          <CrmTab
            key={`le-${k}`}
            accessToken={accessToken}
            onCountChange={handleCount("leads")}
            onToast={push}
          />
        );
      case "lead-center":
        return (
          <LeadCenterTab
            key={`lc-${k}`}
            accessToken={accessToken}
            initialListingId={leadCenterListingTarget}
            onOpenHome={openHome}
            onCountChange={handleCount("lead-center")}
            onToast={push}
          />
        );
      case "users":
        return <UsersTab key={`us-${k}`} accessToken={accessToken} onToast={push} />;
      case "revenue":
        return <RevenueTab key={`rv-${k}`} accessToken={accessToken} />;
      case "rent-agreements":
        return <RentAgreementsTab key={`ra-${k}`} accessToken={accessToken} />;
      case "pg-listings":
        return <PgListingsTab key={`pg-${k}`} accessToken={accessToken} />;
      case "pg-properties":
        return (
          <PgPropertiesTab
            key={`pgp-${k}`}
            accessToken={accessToken}
            onToast={(message, kind) =>
              push(message, kind === "success" ? "trust" : kind === "error" ? "danger" : undefined)
            }
          />
        );
      case "manage-pg-requests":
        return <ManagePgRequestsTab key={`pgm-${k}`} accessToken={accessToken} onToast={push} />;
      case "homes":
        return (
          <AdminHomesTab
            key={`homes-${k}`}
            accessToken={accessToken}
            initialListingId={homeTarget}
            onOpenListingReview={openListingReview}
            onOpenLeadCenter={openLeadCenterForListing}
            onToast={push}
          />
        );
      case "add-listing":
        // No key tied to refreshNonce (unlike the other cases): this tab hosts
        // the ListingWizard, which keeps in-flight photo uploads in plain React
        // state (only form/step/listingId are persisted to sessionStorage).
        // Force-remounting on every topbar "Refresh" click would silently
        // drop any photos the worker had already queued or uploaded.
        return <AddListingTab />;
      case "fraud":
        return <FraudTab key={`fr-${k}`} accessToken={accessToken} onToast={push} />;
      case "seo":
        return <SeoProgrammaticPages key={`seo-${k}`} accessToken={accessToken} onToast={push} />;
      case "search-performance":
        return <SearchPerformanceTab key={`sp-${k}`} accessToken={accessToken} onToast={push} />;
      case "blog":
        return <BlogReviewTab key={`blog-${k}`} accessToken={accessToken} onToast={push} />;
      case "system":
        return <SystemTab key={`sy-${k}`} accessToken={accessToken} onToast={push} />;
      case "security":
        return <AdminTotpPanel key={`security-${k}`} accessToken={accessToken} />;
    }
  }, [
    tab,
    refreshNonce,
    accessToken,
    handleCount,
    push,
    homeTarget,
    listingReviewTarget,
    leadCenterListingTarget,
    openHome,
    openListingReview,
    openLeadCenterForListing
  ]);

  return (
    <div className="admin-shell">
      <div className="admin-layout">
        <AdminSidebar active={tab} onChange={setTab} counts={counts} />
        <div style={{ minWidth: 0, display: "flex", flexDirection: "column" }}>
          <AdminTopbar
            title={TAB_TITLES[tab]}
            lastRefreshed={lastRefreshed}
            onRefresh={triggerRefresh}
            onOpenCommand={() => setPaletteOpen(true)}
            refreshing={refreshing}
          />
          <label className="admin-mobile-nav">
            <span>Section</span>
            <select
              aria-label="Admin section"
              value={tab}
              onChange={(event) => setTab(event.target.value as AdminTab)}
            >
              {Object.entries(TAB_TITLES).map(([id, title]) => (
                <option key={id} value={id}>
                  {title}
                </option>
              ))}
            </select>
          </label>
          <main className="admin-main">{view}</main>
        </div>
      </div>
      <CommandPalette
        open={paletteOpen}
        onOpenChange={setPaletteOpen}
        onNavigate={setTab}
        onRefresh={triggerRefresh}
      />
      <Toast toast={toast} onDismiss={dismiss} />
    </div>
  );
}
