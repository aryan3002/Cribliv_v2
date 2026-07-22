"use client";

import { useEffect, useMemo, useState } from "react";
import { Check, ExternalLink, EyeOff, Link2 } from "lucide-react";
import { fetchAdminPgListings } from "../../../lib/admin-api";
import type {
  PgAdminListingListItem,
  PgAdminListingSort,
  PgAdminListingStatusFilter,
  PgAdminListingsResponse,
  PgAdminVerificationFilter
} from "@cribliv/shared-types";
import { publicSiteUrl, copyPublicSiteUrl } from "../../../lib/public-site-url";
import { formatDate, formatINR } from "../../../lib/admin/format";
import { DataTable } from "../primitives/DataTable";
import type { Column } from "../primitives/DataTable";
import { StatusPill } from "../primitives/StatusPill";
import { StatCard } from "../primitives/StatCard";
import { EmptyState } from "../primitives/EmptyState";
import { PgListingDetail } from "../pg-properties/PgListingDetail";

interface Props {
  accessToken: string;
}

function AnalyticsDot({ cut }: { cut: boolean }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
      <span
        style={{
          width: 7,
          height: 7,
          borderRadius: "50%",
          background: cut ? "#D97706" : "#10B981",
          display: "inline-block",
          flexShrink: 0,
          ...(cut ? { animation: "pg-pulse-amber 2s ease-in-out infinite" } : {})
        }}
      />
      <span style={{ color: cut ? "#D97706" : "#10B981", fontSize: 12, fontWeight: 500 }}>
        {cut ? "Cut" : "Live"}
      </span>
    </span>
  );
}

function MiniLeadBars({ value, max }: { value: number; max: number }) {
  const segments = 5;
  const filled = max > 0 ? Math.ceil((value / max) * segments) : 0;
  return (
    <span style={{ display: "inline-flex", gap: 2, alignItems: "flex-end" }}>
      {Array.from({ length: segments }, (_, i) => (
        <span
          key={i}
          style={{
            width: 4,
            height: 6 + i * 3,
            background: i < filled ? "#0066FF" : "#E5E7EB",
            borderRadius: 1,
            display: "block",
            flexShrink: 0
          }}
        />
      ))}
      <span
        style={{
          marginLeft: 5,
          fontSize: 12,
          color: "#374151",
          fontVariantNumeric: "tabular-nums"
        }}
      >
        {value}
      </span>
    </span>
  );
}

function SkeletonRows() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, paddingTop: 8 }}>
      {Array.from({ length: 7 }, (_, i) => (
        <div
          key={i}
          className="pg-skel"
          style={{ height: 44, borderRadius: 6, opacity: 1 - i * 0.1 }}
        />
      ))}
    </div>
  );
}

function PublicActions({ item }: { item: PgAdminListingListItem }) {
  const [copied, setCopied] = useState(false);

  // Icon-only: the label lives in aria-label (screen readers) and title (hover
  // tooltip), so the column stays narrow enough to survive the 375px scroll.
  if (!item.public_path) {
    return (
      <span
        role="img"
        aria-label="Not publicly available"
        title="Not publicly available — the listing must be active and have a city"
        style={{ display: "inline-flex", color: "#D1D5DB" }}
      >
        <EyeOff size={15} aria-hidden="true" />
      </span>
    );
  }
  const path = item.public_path;

  return (
    <div style={{ display: "flex", gap: 6 }}>
      <button
        type="button"
        className="admin-btn admin-btn--ghost admin-btn--icon"
        aria-label={`Copy public URL for ${item.title ?? "listing"}`}
        title="Copy public URL"
        style={copied ? { color: "#10B981", borderColor: "#10B981" } : undefined}
        onClick={async (e) => {
          e.stopPropagation();
          try {
            await copyPublicSiteUrl(path);
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1500);
          } catch {
            /* clipboard unavailable in this context */
          }
        }}
      >
        {copied ? <Check size={15} aria-hidden="true" /> : <Link2 size={15} aria-hidden="true" />}
      </button>
      <a
        className="admin-btn admin-btn--ghost admin-btn--icon"
        href={publicSiteUrl(path)}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={`Open public page for ${item.title ?? "listing"}`}
        title="Open public page"
        onClick={(e) => e.stopPropagation()}
      >
        <ExternalLink size={15} aria-hidden="true" />
      </a>
    </div>
  );
}

export function PgPropertiesTab({ accessToken }: Props) {
  const [data, setData] = useState<PgAdminListingsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [q, setQ] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [verification, setVerification] = useState<PgAdminVerificationFilter>("verified");
  const [statusFilter, setStatusFilter] = useState<PgAdminListingStatusFilter>("active");
  const [city, setCity] = useState("");
  const [sort, setSort] = useState<PgAdminListingSort>("leads");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<25 | 50 | 100>(25);
  const [selected, setSelected] = useState<string | null>(null);

  // 300ms debounce on the search box (mirrors HomesInventory).
  useEffect(() => {
    const t = window.setTimeout(() => setDebouncedQ(q.trim()), 300);
    return () => window.clearTimeout(t);
  }, [q]);

  // Any filter change invalidates the current page offset.
  useEffect(() => {
    setPage(1);
  }, [debouncedQ, verification, statusFilter, city, sort, pageSize]);

  useEffect(() => {
    if (!accessToken) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchAdminPgListings(accessToken, {
      q: debouncedQ || undefined,
      verification,
      status: statusFilter,
      city: city || undefined,
      sort,
      page,
      page_size: pageSize
    })
      .then((res) => {
        if (!cancelled) setData(res);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Could not load PG listings");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [accessToken, debouncedQ, verification, statusFilter, city, sort, page, pageSize, reloadKey]);

  const rows = useMemo(() => data?.items ?? [], [data]);
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const maxLeads = useMemo(() => Math.max(1, ...rows.map((r) => r.leads_7d ?? 0)), [rows]);

  const columns: Column<PgAdminListingListItem>[] = [
    {
      key: "cover",
      header: "",
      width: "60px",
      render: (r) =>
        r.cover_photo_url ? (
          // Admin photo URLs are dynamic Azure/CDN values not covered by a fixed Next image host.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={r.cover_photo_url}
            alt=""
            style={{ width: 44, height: 44, borderRadius: 6, objectFit: "cover" }}
          />
        ) : (
          <div style={{ width: 44, height: 44, borderRadius: 6, background: "#F3F4F6" }} />
        )
    },
    {
      key: "title",
      header: "Listing",
      render: (r) => (
        <div>
          <div style={{ fontWeight: 600, color: "#111827", fontSize: 13 }}>
            {r.title || r.property_name || "Untitled PG"}
          </div>
          <div style={{ fontSize: 11, color: "#9CA3AF", marginTop: 2 }}>
            {r.listing_id.slice(0, 8)}
          </div>
        </div>
      )
    },
    {
      key: "owner",
      header: "Owner",
      render: (r) => (
        <div>
          <div style={{ fontWeight: 500, fontSize: 13, color: "#111827" }}>
            {r.owner_name ?? "-"}
          </div>
          {r.owner_phone_masked && (
            <div
              style={{
                fontSize: 11,
                color: "#6B7280",
                fontVariantNumeric: "tabular-nums",
                marginTop: 2
              }}
            >
              {r.owner_phone_masked}
            </div>
          )}
        </div>
      )
    },
    {
      key: "locality",
      header: "Location",
      render: (r) => (
        <span style={{ fontSize: 13, color: "#374151" }}>
          {[r.locality_slug, r.city_slug].filter(Boolean).join(", ") || "-"}
        </span>
      )
    },
    {
      key: "rent",
      header: "From",
      align: "right",
      render: (r) => (r.starting_rent_paise == null ? "—" : formatINR(r.starting_rent_paise))
    },
    {
      key: "gender",
      header: "Gender",
      render: (r) =>
        r.gender_policy === "boys"
          ? "Boys"
          : r.gender_policy === "girls"
            ? "Girls"
            : r.gender_policy === "coed"
              ? "Co-ed"
              : "—"
    },
    {
      key: "status",
      header: "Status",
      render: (r) => <StatusPill status={r.status} />
    },
    {
      key: "verification",
      header: "Verification",
      // StatusPill has no tone mapping for "failed"; pass it explicitly rather
      // than editing the shared primitive.
      render: (r) => (
        <StatusPill
          status={r.verification_status}
          tone={r.verification_status === "failed" ? "danger" : undefined}
        />
      )
    },
    {
      key: "leads_7d",
      header: "Leads 7d",
      align: "right",
      render: (r) => <MiniLeadBars value={r.leads_7d ?? 0} max={maxLeads} />
    },
    {
      key: "analytics",
      header: "Analytics",
      render: (r) => <AnalyticsDot cut={r.analytics_cut} />
    },
    {
      key: "updated",
      header: "Updated",
      render: (r) => formatDate(r.updated_at)
    },
    {
      key: "actions",
      header: "Public URL",
      render: (r) => <PublicActions item={r} />
    }
  ];

  if (selected) {
    return (
      <PgListingDetail
        accessToken={accessToken}
        listingId={selected}
        onBack={() => setSelected(null)}
      />
    );
  }

  return (
    <div className="admin-main__section">
      <style>{`
        @keyframes pg-pulse-amber {
          0%,100% { opacity:1; box-shadow:0 0 0 0 rgba(217,119,6,.35); }
          50%      { opacity:.65; box-shadow:0 0 0 5px rgba(217,119,6,0); }
        }
        @keyframes pg-skel-shimmer { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }
        .pg-skel {
          background: linear-gradient(90deg,#F3F4F6 25%,#E9EBEE 50%,#F3F4F6 75%);
          background-size: 200% 100%;
          animation: pg-skel-shimmer 1.4s ease-in-out infinite;
        }
      `}</style>

      <div className="admin-page-title">
        <h1>PG Listings</h1>
        <span className="admin-page-title__sub">{loading ? "loading…" : `${total} total`}</span>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(155px, 1fr))",
          gap: 12,
          marginBottom: 20
        }}
      >
        <StatCard
          label="Verified PGs"
          value={loading ? "-" : (data?.summary.verified ?? 0)}
          tone="trust"
        />
        <StatCard
          label="Verified & Active"
          value={loading ? "-" : (data?.summary.active ?? 0)}
          tone="brand"
        />
        <StatCard label="Cities" value={loading ? "-" : (data?.summary.cities ?? 0)} />
        <StatCard label="Showing" value={loading ? "-" : total} />
      </div>

      <div
        style={{
          display: "flex",
          gap: 8,
          alignItems: "center",
          flexWrap: "wrap",
          marginBottom: 16
        }}
      >
        {(
          [
            { value: "verified", label: "Verified" },
            { value: "all", label: "All" }
          ] as const
        ).map((opt) => (
          <button
            key={opt.value}
            type="button"
            className="admin-chip"
            aria-pressed={verification === opt.value}
            onClick={() => setVerification(opt.value)}
          >
            {opt.label}
          </button>
        ))}
        <span style={{ width: 1, height: 20, background: "#E5E7EB" }} aria-hidden="true" />
        {(
          [
            { value: "active", label: "Active" },
            { value: "paused", label: "Paused" },
            { value: "pending_review", label: "Pending" },
            { value: "draft", label: "Draft" },
            { value: "archived", label: "Archived" },
            { value: "all", label: "All" }
          ] as const
        ).map((opt) => (
          <button
            key={opt.value}
            type="button"
            className="admin-chip"
            aria-pressed={statusFilter === opt.value}
            onClick={() => setStatusFilter(opt.value)}
          >
            {opt.label}
          </button>
        ))}
        <select
          className="admin-input"
          value={city}
          onChange={(e) => setCity(e.target.value)}
          aria-label="City"
          style={{ maxWidth: 180 }}
        >
          <option value="">All cities</option>
          {(data?.available_cities ?? []).map((c) => (
            <option key={c.slug} value={c.slug}>
              {c.name} ({c.count})
            </option>
          ))}
        </select>
        <select
          className="admin-input"
          value={sort}
          onChange={(e) => setSort(e.target.value as PgAdminListingSort)}
          aria-label="Sort listings"
          style={{ maxWidth: 190 }}
        >
          <option value="leads">Most leads (7d)</option>
          <option value="updated">Recently updated</option>
          <option value="rent_desc">Rent: high → low</option>
          <option value="rent_asc">Rent: low → high</option>
        </select>
        <select
          className="admin-input"
          value={pageSize}
          onChange={(e) => setPageSize(Number(e.target.value) as 25 | 50 | 100)}
          aria-label="Rows per page"
          style={{ maxWidth: 120 }}
        >
          <option value={25}>25 / page</option>
          <option value={50}>50 / page</option>
          <option value={100}>100 / page</option>
        </select>
        <input
          className="admin-input"
          placeholder="Search title, id, property, owner, phone, locality…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          aria-label="Search PG listings"
          style={{ maxWidth: 280, marginLeft: "auto" }}
        />
      </div>

      {error ? (
        <div className="admin-empty" role="alert">
          <div className="admin-empty__title">Could not load PG listings</div>
          <div className="admin-empty__hint">{error}</div>
          <button
            type="button"
            className="admin-btn admin-btn--ghost"
            style={{ minHeight: 40, marginTop: 12 }}
            onClick={() => setReloadKey((k) => k + 1)}
          >
            Retry
          </button>
        </div>
      ) : loading ? (
        <SkeletonRows />
      ) : rows.length === 0 ? (
        <div>
          <EmptyState title="No PGs match these filters" hint="Try clearing the filters." />
          <div style={{ textAlign: "center", marginTop: 12 }}>
            <button
              type="button"
              className="admin-btn admin-btn--ghost"
              style={{ minHeight: 40 }}
              onClick={() => {
                setQ("");
                setVerification("verified");
                setStatusFilter("all");
                setCity("");
                setSort("leads");
              }}
            >
              Show all verified
            </button>
          </div>
        </div>
      ) : (
        <DataTable
          columns={columns}
          rows={rows}
          rowKey={(r) => r.listing_id}
          onRowClick={(r) => setSelected(r.listing_id)}
        />
      )}

      <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 12 }}>
        <button
          type="button"
          className="admin-btn admin-btn--ghost"
          style={{ minHeight: 40 }}
          disabled={page <= 1 || loading}
          onClick={() => setPage((p) => Math.max(1, p - 1))}
        >
          ← Prev
        </button>
        <span style={{ fontSize: 13, color: "#6B7280" }}>
          Page {page} of {totalPages} · {total} total
        </span>
        <button
          type="button"
          className="admin-btn admin-btn--ghost"
          style={{ minHeight: 40 }}
          disabled={page >= totalPages || loading}
          onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
        >
          Next →
        </button>
      </div>
    </div>
  );
}
