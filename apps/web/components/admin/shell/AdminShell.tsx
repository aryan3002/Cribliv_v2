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
import { UsersTab } from "../tabs/UsersTab";
import { RevenueTab } from "../tabs/RevenueTab";
import { FraudTab } from "../tabs/FraudTab";
import { SystemTab } from "../tabs/SystemTab";

interface Props {
  accessToken: string;
}

const TAB_TITLES: Record<AdminTab, string> = {
  live: "Live Operations",
  overview: "Overview",
  listings: "Listing Review",
  verifications: "Verification Review",
  leads: "CRM",
  users: "Users",
  revenue: "Revenue",
  fraud: "Fraud Intelligence",
  system: "System Tools"
};

export function AdminShell({ accessToken }: Props) {
  const [tab, setTab] = useState<AdminTab>("live");
  const [refreshNonce, setRefreshNonce] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [lastRefreshed, setLastRefreshed] = useState<number | null>(Date.now());
  const [counts, setCounts] = useState<Partial<Record<AdminTab, number>>>({});
  const [paletteOpen, setPaletteOpen] = useState(false);
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
      case "users":
        return <UsersTab key={`us-${k}`} accessToken={accessToken} onToast={push} />;
      case "revenue":
        return <RevenueTab key={`rv-${k}`} accessToken={accessToken} />;
      case "fraud":
        return <FraudTab key={`fr-${k}`} accessToken={accessToken} onToast={push} />;
      case "system":
        return <SystemTab key={`sy-${k}`} accessToken={accessToken} onToast={push} />;
    }
  }, [tab, refreshNonce, accessToken, handleCount, push]);

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
