"use client";

import { useEffect, useMemo, useState } from "react";
import { fetchAdminPgListings } from "../../../lib/admin-api";
import type { PgAdminListingListItem } from "@cribliv/shared-types";
import { DataTable } from "../primitives/DataTable";
import type { Column } from "../primitives/DataTable";
import { StatusPill } from "../primitives/StatusPill";
import { StatCard } from "../primitives/StatCard";
import { EmptyState } from "../primitives/EmptyState";
import { PgListingDetail } from "../pg-properties/PgListingDetail";

interface Props {
  accessToken: string;
}

type StatusFilter = "all" | "active" | "paused" | "pending_review" | "draft";

const FILTER_OPTIONS: Array<{ value: StatusFilter; label: string }> = [
  { value: "all", label: "All" },
  { value: "active", label: "Active" },
  { value: "paused", label: "Paused" },
  { value: "pending_review", label: "Pending" },
  { value: "draft", label: "Draft" }
];

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

export function PgPropertiesTab({ accessToken }: Props) {
  const [rows, setRows] = useState<PgAdminListingListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [selected, setSelected] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchAdminPgListings(accessToken, {
      q: q || undefined,
      status: statusFilter !== "all" ? statusFilter : undefined
    })
      .then((res) => {
        if (!cancelled) setRows(res ?? []);
      })
      .catch(() => {
        if (!cancelled) setRows([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [accessToken, q, statusFilter]);

  const stats = useMemo(() => {
    const total = rows.length;
    const active = rows.filter((r) => r.status === "active").length;
    const totalLeads = rows.reduce((s, r) => s + (r.leads_7d ?? 0), 0);
    const cut = rows.filter((r) => r.analytics_cut).length;
    return {
      total,
      activePct: total > 0 ? Math.round((active / total) * 100) : 0,
      totalLeads,
      cut
    };
  }, [rows]);

  const maxLeads = useMemo(() => Math.max(1, ...rows.map((r) => r.leads_7d ?? 0)), [rows]);

  const columns: Column<PgAdminListingListItem>[] = [
    {
      key: "title",
      header: "Listing",
      render: (r) => (
        <div>
          <div style={{ fontWeight: 600, color: "#111827", fontSize: 13 }}>
            {r.title || "Untitled"}
          </div>
          {r.property_name && (
            <div style={{ fontSize: 11, color: "#9CA3AF", marginTop: 2 }}>{r.property_name}</div>
          )}
        </div>
      ),
      sortValue: (r) => r.title ?? ""
    },
    {
      key: "owner",
      header: "Owner",
      render: (r) => (
        <div>
          <div style={{ fontWeight: 500, fontSize: 13, color: "#111827" }}>
            {r.owner_name ?? "—"}
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
      ),
      sortValue: (r) => r.owner_name ?? ""
    },
    {
      key: "locality",
      header: "Location",
      render: (r) => (
        <span style={{ fontSize: 13, color: "#374151" }}>
          {[r.locality_slug, r.city_slug].filter(Boolean).join(", ") || "—"}
        </span>
      ),
      sortValue: (r) => r.city_slug ?? ""
    },
    {
      key: "status",
      header: "Status",
      render: (r) => <StatusPill status={r.status} />,
      sortValue: (r) => r.status
    },
    {
      key: "leads_7d",
      header: "Leads 7d",
      align: "right",
      render: (r) => <MiniLeadBars value={r.leads_7d ?? 0} max={maxLeads} />,
      sortValue: (r) => r.leads_7d ?? 0
    },
    {
      key: "analytics",
      header: "Analytics",
      render: (r) => <AnalyticsDot cut={r.analytics_cut} />,
      sortValue: (r) => (r.analytics_cut ? 1 : 0)
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
        <span className="admin-page-title__sub">
          {loading ? "loading…" : `${rows.length} shown`}
        </span>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(155px, 1fr))",
          gap: 12,
          marginBottom: 20
        }}
      >
        <StatCard label="Total Listings" value={loading ? "—" : stats.total} />
        <StatCard label="Active Rate" value={loading ? "—" : `${stats.activePct}%`} tone="trust" />
        <StatCard label="Leads / 7d" value={loading ? "—" : stats.totalLeads} tone="brand" />
        <StatCard
          label="Analytics Cut"
          value={loading ? "—" : stats.cut}
          tone={stats.cut > 0 ? "warn" : "default"}
        />
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
        {FILTER_OPTIONS.map((opt) => (
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
        <input
          className="admin-input"
          placeholder="Search listing or owner…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          style={{ maxWidth: 260, marginLeft: "auto" }}
        />
      </div>

      {loading ? (
        <SkeletonRows />
      ) : rows.length === 0 ? (
        <EmptyState
          title="No PG listings found"
          hint={q || statusFilter !== "all" ? "Try clearing the filters." : undefined}
        />
      ) : (
        <DataTable
          columns={columns}
          rows={rows}
          rowKey={(r) => r.listing_id}
          onRowClick={(r) => setSelected(r.listing_id)}
          initialSort={{ key: "leads_7d", dir: "desc" }}
        />
      )}
    </div>
  );
}
