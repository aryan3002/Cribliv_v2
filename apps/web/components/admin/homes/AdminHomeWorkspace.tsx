"use client";

import { useEffect, useState } from "react";
import { ArrowLeft, Clipboard, ExternalLink, FileSearch, House, RefreshCw } from "lucide-react";
import type { AdminHomeDetail } from "@cribliv/shared-types";
import { ApiError } from "../../../lib/api";
import { fetchAdminHomeDetail } from "../../../lib/admin-api";
import { adminHomePublicUrl, copyAdminHomeUrl } from "../../../lib/admin-home-url";
import {
  formatINRPrecise,
  formatNumber,
  formatPct,
  formatRelativeTime
} from "../../../lib/admin/format";
import { EmptyState } from "../primitives/EmptyState";
import { StatCard } from "../primitives/StatCard";
import { StatusPill } from "../primitives/StatusPill";
import { HomeActivityTab } from "./HomeActivityTab";
import { HomeLeadsTab } from "./HomeLeadsTab";
import { HomeOverviewTab } from "./HomeOverviewTab";
import { HomeOwnerTab } from "./HomeOwnerTab";
import { HomePropertyTab } from "./HomePropertyTab";
import { HomeVerificationTab } from "./HomeVerificationTab";

type WorkspaceTab = "overview" | "property" | "leads" | "verification" | "owner" | "activity";

interface Props {
  accessToken: string;
  listingId: string;
  onBack: () => void;
  onOpenListingReview: (listingId: string) => void;
  onOpenLeadCenter: (listingId: string) => void;
  onToast: (message: string, tone?: "trust" | "warn" | "danger") => void;
}

const TAB_OPTIONS: Array<{ id: WorkspaceTab; label: string }> = [
  { id: "overview", label: "Overview" },
  { id: "property", label: "Property" },
  { id: "leads", label: "Leads" },
  { id: "verification", label: "Verification" },
  { id: "owner", label: "Owner" },
  { id: "activity", label: "Activity" }
];

export function AdminHomeWorkspace({
  accessToken,
  listingId,
  onBack,
  onOpenListingReview,
  onOpenLeadCenter,
  onToast
}: Props) {
  const [detail, setDetail] = useState<AdminHomeDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [tab, setTab] = useState<WorkspaceTab>("overview");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setDetail(null);
    setError(null);
    setNotFound(false);
    setTab("overview");

    void fetchAdminHomeDetail(accessToken, listingId)
      .then((response) => {
        if (!cancelled) setDetail(response);
      })
      .catch((fetchError: unknown) => {
        if (cancelled) return;
        if (fetchError instanceof ApiError && fetchError.status === 404) {
          setNotFound(true);
          return;
        }
        setError(
          fetchError instanceof Error ? fetchError.message : "Could not load this verified home"
        );
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [accessToken, listingId, reloadKey]);

  async function handleCopy() {
    if (!detail) return;
    try {
      await copyAdminHomeUrl(detail.public_path);
      onToast("Public URL copied", "trust");
    } catch {
      onToast("Could not copy public URL", "danger");
    }
  }

  function handleOpen() {
    if (!detail) return;
    window.open(adminHomePublicUrl(detail.public_path), "_blank", "noopener,noreferrer");
  }

  if (loading) {
    return <WorkspaceLoading onBack={onBack} />;
  }

  if (notFound) {
    return (
      <WorkspaceFrame onBack={onBack}>
        <EmptyState
          title="Verified home not found"
          hint="This listing is no longer available in the verified homes inventory."
          icon={<House size={18} aria-hidden="true" />}
        />
      </WorkspaceFrame>
    );
  }

  if (error) {
    return (
      <WorkspaceFrame onBack={onBack}>
        <div className="admin-home-workspace__error" role="alert">
          <div>
            <strong>Could not load this verified home</strong>
            <span>{error}</span>
          </div>
          <button
            type="button"
            className="admin-btn admin-btn--ghost"
            onClick={() => setReloadKey((key) => key + 1)}
          >
            <RefreshCw size={16} aria-hidden="true" />
            Retry
          </button>
        </div>
      </WorkspaceFrame>
    );
  }

  if (!detail) return null;

  const title = detail.listing.title_en ?? detail.listing.title_hi ?? "Untitled verified home";
  const isPublic = detail.listing.status === "active";

  return (
    <WorkspaceFrame onBack={onBack}>
      <header className="admin-home-workspace__header">
        <CoverPreview detail={detail} title={title} />
        <div className="admin-home-workspace__header-copy">
          <div className="admin-home-workspace__eyebrow">Verified home</div>
          <h1>{title}</h1>
          {detail.listing.title_en && detail.listing.title_hi && <p>{detail.listing.title_hi}</p>}
          <div className="admin-home-workspace__pills">
            <StatusPill status="verified" />
            <StatusPill status={detail.listing.status} />
          </div>
          <div className="admin-home-workspace__meta">
            <span>
              {[detail.location?.locality_name, detail.location?.city_name]
                .filter(Boolean)
                .join(", ") || "Location unavailable"}
            </span>
            <span>{formatINRPrecise(detail.listing.monthly_rent * 100)} / month</span>
            <code>{detail.listing.id}</code>
          </div>
        </div>
        <div className="admin-home-workspace__header-actions">
          {isPublic ? (
            <>
              <button
                type="button"
                className="admin-btn admin-btn--ghost"
                onClick={() => void handleCopy()}
              >
                <Clipboard size={16} aria-hidden="true" />
                Copy public URL
              </button>
              <button type="button" className="admin-btn admin-btn--ghost" onClick={handleOpen}>
                <ExternalLink size={16} aria-hidden="true" />
                Open public page
              </button>
            </>
          ) : (
            <span className="admin-home-workspace__not-public">Not publicly available</span>
          )}
          <button
            type="button"
            className="admin-btn admin-btn--ghost"
            onClick={() => onOpenListingReview(detail.listing.id)}
          >
            <FileSearch size={16} aria-hidden="true" />
            Open in Listing Review
          </button>
        </div>
      </header>

      <div className="admin-stat-grid admin-home-workspace__stats" aria-label="Home metrics">
        <StatCard label="Views 30d" value={formatNumber(detail.metrics_30d.views)} />
        <StatCard label="Leads 30d" value={formatNumber(detail.metrics_30d.leads)} tone="brand" />
        <StatCard
          label="Open leads"
          value={formatNumber(detail.metrics_30d.open_leads)}
          tone="warn"
        />
        <StatCard
          label="Conversion"
          value={formatPct(detail.metrics_30d.conversion_rate, 1)}
          tone="trust"
        />
        <StatCard
          label="Last owner activity"
          value={formatRelativeTime(detail.listing.last_owner_activity_at)}
        />
      </div>

      <nav className="admin-home-workspace__tabs" aria-label="Verified home sections">
        {TAB_OPTIONS.map((option) => (
          <button
            key={option.id}
            type="button"
            className="admin-home-workspace__tab"
            aria-pressed={tab === option.id}
            onClick={() => setTab(option.id)}
          >
            {option.label}
          </button>
        ))}
      </nav>

      <div className="admin-home-workspace__content">
        {tab === "overview" && <HomeOverviewTab detail={detail} />}
        {tab === "property" && <HomePropertyTab detail={detail} />}
        {tab === "leads" && (
          <HomeLeadsTab
            detail={detail}
            onOpenLeadCenter={() => onOpenLeadCenter(detail.listing.id)}
          />
        )}
        {tab === "verification" && (
          <HomeVerificationTab accessToken={accessToken} detail={detail} onToast={onToast} />
        )}
        {tab === "owner" && <HomeOwnerTab detail={detail} />}
        {tab === "activity" && <HomeActivityTab detail={detail} />}
      </div>
    </WorkspaceFrame>
  );
}

function WorkspaceFrame({ onBack, children }: { onBack: () => void; children: React.ReactNode }) {
  return (
    <section
      className="admin-main__section admin-homes-workspace"
      aria-label="Verified home workspace"
    >
      <button type="button" className="admin-btn admin-btn--ghost" onClick={onBack}>
        <ArrowLeft size={16} aria-hidden="true" />
        Back to verified homes
      </button>
      {children}
    </section>
  );
}

function WorkspaceLoading({ onBack }: { onBack: () => void }) {
  return (
    <WorkspaceFrame onBack={onBack}>
      <div
        className="admin-home-workspace__loading"
        role="status"
        aria-label="Loading verified home"
      >
        <span className="admin-homes-skeleton admin-home-workspace__loading-title" />
        <span className="admin-homes-skeleton" />
        <span className="admin-homes-skeleton" />
      </div>
    </WorkspaceFrame>
  );
}

function CoverPreview({ detail, title }: { detail: AdminHomeDetail; title: string }) {
  const cover =
    detail.photos.find((photo) => photo.is_cover && photo.url) ??
    detail.photos.find((photo) => photo.url);

  if (!cover?.url) {
    return (
      <div className="admin-home-workspace__cover admin-home-workspace__cover--placeholder">
        <House size={24} aria-hidden="true" />
      </div>
    );
  }

  // Admin photo URLs are dynamic Azure/CDN values not covered by a fixed Next image host.
  // eslint-disable-next-line @next/next/no-img-element
  return <img className="admin-home-workspace__cover" src={cover.url} alt={`${title} cover`} />;
}
