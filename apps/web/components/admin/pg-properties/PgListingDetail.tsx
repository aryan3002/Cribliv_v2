"use client";

import { useEffect, useState } from "react";
import { Check, ExternalLink, EyeOff, Link2 } from "lucide-react";
import { StatusPill } from "../primitives/StatusPill";
import { useAdminPgListing, type RangeDays } from "./useAdminPgListing";
import { OverviewSection } from "./tabs/OverviewSection";
import { DetailsSection } from "./tabs/DetailsSection";
import { RoomsSection } from "./tabs/RoomsSection";
import { PhotosSection } from "./tabs/PhotosSection";
import { LocationSection } from "./tabs/LocationSection";
import { OwnerSection } from "./tabs/OwnerSection";
import { publicSiteUrl, copyPublicSiteUrl } from "../../../lib/public-site-url";

interface Props {
  accessToken: string;
  listingId: string;
  onBack: () => void;
  onToast?: (msg: string, kind?: "success" | "error") => void;
}

const RANGES: RangeDays[] = [7, 30, 90];
type MetricKey = "views" | "leads" | "appearances" | "clicks";

type TabKey = "overview" | "details" | "rooms" | "photos" | "location" | "owner";
const TABS: Array<{ key: TabKey; label: string }> = [
  { key: "overview", label: "Overview" },
  { key: "details", label: "Details" },
  { key: "rooms", label: "Rooms" },
  { key: "photos", label: "Photos" },
  { key: "location", label: "Location" },
  { key: "owner", label: "Owner" }
];
// Tabs that read the lazy `/full` payload.
const CONTENT_TABS: TabKey[] = ["details", "rooms", "photos", "location"];

function ScoreBadge({ score }: { score: number }) {
  const color = score >= 70 ? "#065F46" : score >= 40 ? "#92400E" : "#991B1B";
  const bg = score >= 70 ? "#D1FAE5" : score >= 40 ? "#FEF3C7" : "#FEE2E2";
  const border = score >= 70 ? "#6EE7B7" : score >= 40 ? "#FDE68A" : "#FECACA";
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        padding: "3px 12px",
        borderRadius: 20,
        background: bg,
        color,
        fontWeight: 700,
        fontSize: 12,
        border: `1px solid ${border}`
      }}
    >
      Score {score}
    </span>
  );
}

function Skeleton() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12, paddingTop: 4 }}>
      {[120, 220, 200].map((h, i) => (
        <div
          key={i}
          className="admin-card"
          style={{
            height: h,
            background: "linear-gradient(90deg,#F3F4F6 25%,#E9EBEE 50%,#F3F4F6 75%)",
            backgroundSize: "200% 100%",
            animation: "pg-skel-shimmer 1.4s ease-in-out infinite"
          }}
        />
      ))}
      <style>{`@keyframes pg-skel-shimmer { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }`}</style>
    </div>
  );
}

export function PgListingDetail({ accessToken, listingId, onBack, onToast }: Props) {
  const [rangeDays, setRangeDays] = useState<RangeDays>(30);
  const [metric, setMetric] = useState<MetricKey>("views");
  const [tab, setTab] = useState<TabKey>("overview");
  const [copied, setCopied] = useState(false);
  const [copiedUrl, setCopiedUrl] = useState(false);

  const {
    detail,
    setDetail,
    analytics,
    analyticsLoading,
    loadError,
    full,
    fullLoading,
    fullError,
    ensureFull,
    refetchFull,
    refetchDetail,
    patchFull
  } = useAdminPgListing(accessToken, listingId, rangeDays);

  // Lazy-load the full content payload the first time a content tab opens.
  useEffect(() => {
    if (CONTENT_TABS.includes(tab)) void ensureFull();
  }, [tab, ensureFull]);

  const copyId = () => {
    void navigator.clipboard?.writeText(listingId);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  };

  const backBtn = (
    <button type="button" className="admin-chip" onClick={onBack} style={{ flexShrink: 0 }}>
      ← Back to listings
    </button>
  );

  if (loadError) {
    return (
      <div
        className="admin-main__section"
        style={{ display: "flex", flexDirection: "column", gap: 16 }}
      >
        {backBtn}
        <div
          style={{
            padding: "48px 0",
            textAlign: "center",
            color: "var(--ad-text-3)",
            fontSize: 13
          }}
        >
          Failed to load listing. Check network or try refreshing.
        </div>
      </div>
    );
  }

  if (!detail) {
    return (
      <div
        className="admin-main__section"
        style={{ display: "flex", flexDirection: "column", gap: 16 }}
      >
        {backBtn}
        <Skeleton />
      </div>
    );
  }

  // Same shareability rule the list endpoint applies: publicly reachable iff
  // active and city-slugged. Verification is a badge, not a gate.
  const publicPath =
    detail.listing.status === "active" && detail.city_slug
      ? `/en/pg/${detail.city_slug}/${detail.listing.id}`
      : null;

  const renderContentTab = (node: (f: NonNullable<typeof full>) => React.ReactNode) => {
    if (fullError) {
      return (
        <div
          style={{
            padding: "32px 0",
            textAlign: "center",
            color: "var(--ad-text-3)",
            fontSize: 13
          }}
        >
          Failed to load this section.{" "}
          <button
            type="button"
            className="admin-chip admin-btn--sm"
            onClick={() => void refetchFull()}
          >
            Retry
          </button>
        </div>
      );
    }
    if (fullLoading || !full) return <Skeleton />;
    return node(full);
  };

  return (
    <div
      className="admin-main__section"
      style={{ display: "flex", flexDirection: "column", gap: 16 }}
    >
      <style>{`
        .pgd-kpis { display:grid; grid-template-columns: repeat(4, 1fr); gap:12px; }
        @media (max-width: 900px) { .pgd-kpis { grid-template-columns: repeat(2,1fr); } }
        .pgd-tabbar { display:flex; gap:6px; flex-wrap:wrap; border-bottom:1px solid var(--ad-border); padding-bottom:10px; }
      `}</style>

      {/* Header */}
      <div style={{ display: "flex", alignItems: "flex-start", gap: 14, flexWrap: "wrap" }}>
        {backBtn}
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <h1
              style={{
                margin: 0,
                fontSize: 22,
                fontWeight: 700,
                letterSpacing: "-0.01em",
                color: "var(--ad-text)",
                fontFamily: "var(--font-heading, inherit)"
              }}
            >
              {detail.listing.title || "Untitled listing"}
            </h1>
            <StatusPill status={detail.listing.status} />
            {analytics?.composite_score != null && (
              <ScoreBadge score={Math.round(analytics.composite_score)} />
            )}
            {detail.overrides.global && (
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 600,
                  color: "var(--ad-warning)",
                  background: "var(--ad-warning-soft)",
                  border: "1px solid #FDE68A",
                  borderRadius: 20,
                  padding: "3px 10px"
                }}
              >
                Operator analytics cut
              </span>
            )}
          </div>
          <div
            style={{
              marginTop: 5,
              fontSize: 13,
              color: "var(--ad-text-2)",
              display: "flex",
              alignItems: "center",
              gap: 8,
              flexWrap: "wrap"
            }}
          >
            <span>
              {[detail.property?.display_name, detail.locality_slug, detail.city_slug]
                .filter(Boolean)
                .join(" · ") || "-"}
            </span>
            <button
              type="button"
              className="admin-chip admin-btn--sm"
              onClick={copyId}
              style={{ fontSize: 11 }}
            >
              {copied ? "Copied ✓" : "Copy listing ID"}
            </button>
            {publicPath ? (
              <>
                <button
                  type="button"
                  className="admin-btn admin-btn--ghost admin-btn--sm admin-btn--icon"
                  aria-label="Copy public URL"
                  title="Copy public URL"
                  style={copiedUrl ? { color: "#10B981", borderColor: "#10B981" } : undefined}
                  onClick={async () => {
                    try {
                      await copyPublicSiteUrl(publicPath);
                      setCopiedUrl(true);
                      window.setTimeout(() => setCopiedUrl(false), 1500);
                    } catch {
                      onToast?.("Could not copy public link", "error");
                    }
                  }}
                >
                  {copiedUrl ? (
                    <Check size={14} aria-hidden="true" />
                  ) : (
                    <Link2 size={14} aria-hidden="true" />
                  )}
                </button>
                <a
                  className="admin-btn admin-btn--ghost admin-btn--sm admin-btn--icon"
                  href={publicSiteUrl(publicPath)}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label="Open public page"
                  title="Open public page"
                >
                  <ExternalLink size={14} aria-hidden="true" />
                </a>
              </>
            ) : (
              <span
                role="img"
                aria-label="Not publicly available"
                title="Not publicly available — the listing must be active and have a city"
                style={{ display: "inline-flex", color: "#D1D5DB" }}
              >
                <EyeOff size={14} aria-hidden="true" />
              </span>
            )}
          </div>
        </div>
        {tab === "overview" && (
          <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
            {RANGES.map((r) => (
              <button
                key={r}
                type="button"
                className="admin-chip"
                aria-pressed={rangeDays === r}
                onClick={() => setRangeDays(r)}
              >
                {r}d
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Tab bar */}
      <div className="pgd-tabbar">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            className="admin-chip"
            aria-pressed={tab === t.key}
            onClick={() => setTab(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {tab === "overview" && (
        <OverviewSection
          detail={detail}
          analytics={analytics}
          analyticsLoading={analyticsLoading}
          rangeDays={rangeDays}
          metric={metric}
          onMetric={setMetric}
          accessToken={accessToken}
          onDetailChange={setDetail}
          onToast={onToast}
        />
      )}
      {tab === "details" &&
        renderContentTab((f) => (
          <DetailsSection
            full={f}
            accessToken={accessToken}
            listingId={listingId}
            onSaved={(pg_details) => patchFull({ pg_details })}
            onTitleSaved={(title) => {
              // Title lives on the head — refresh both the cached full payload and
              // the thin detail that drives the page header.
              patchFull({ listing: { ...f.listing, title } });
              setDetail({ ...detail, listing: { ...detail.listing, title } });
            }}
            onToast={onToast}
          />
        ))}
      {tab === "rooms" &&
        renderContentTab((f) => (
          <RoomsSection
            full={f}
            accessToken={accessToken}
            listingId={listingId}
            onSaved={(room_types) => patchFull({ room_types })}
            onToast={onToast}
            refetchFull={refetchFull}
          />
        ))}
      {tab === "photos" &&
        renderContentTab((f) => (
          <PhotosSection
            full={f}
            accessToken={accessToken}
            listingId={listingId}
            onToast={onToast}
            refetchFull={refetchFull}
          />
        ))}
      {tab === "location" &&
        renderContentTab((f) => (
          <LocationSection
            full={f}
            accessToken={accessToken}
            onSaved={(property) => patchFull({ property })}
            onToast={onToast}
          />
        ))}
      {tab === "owner" && (
        <OwnerSection
          detail={detail}
          accessToken={accessToken}
          onTransferred={() => {
            void refetchDetail();
            onToast?.("Ownership transferred", "success");
          }}
        />
      )}
    </div>
  );
}
