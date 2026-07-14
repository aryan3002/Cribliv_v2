"use client";

import { useEffect, useState } from "react";
import { SectionCard } from "../primitives/SectionCard";
import { EmptyState } from "../primitives/EmptyState";
import { DataTable, type Column } from "../primitives/DataTable";
import { StatusPill } from "../primitives/StatusPill";
import { ListingReviewWorkspace } from "../review/ListingReviewWorkspace";
import {
  decideAdminListing,
  fetchAdminListings,
  type AdminListingVm
} from "../../../lib/admin-api";
import { formatDate, formatINRPrecise } from "../../../lib/admin/format";

interface Props {
  accessToken: string;
  initialListingId?: string | null;
  onCountChange?: (count: number) => void;
  onToast: (message: string, tone?: "trust" | "warn" | "danger") => void;
}

export function ListingReviewTab({ accessToken, initialListingId, onCountChange, onToast }: Props) {
  const [items, setItems] = useState<AdminListingVm[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"all" | "flat_house" | "pg">("all");
  const [activeId, setActiveId] = useState<string | null>(initialListingId ?? null);
  const [busy, setBusy] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    try {
      const r = await fetchAdminListings(accessToken);
      setItems(r.items);
      onCountChange?.(r.total);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accessToken]);

  useEffect(() => {
    if (initialListingId) setActiveId(initialListingId);
  }, [initialListingId]);

  const filtered = filter === "all" ? items : items.filter((i) => i.listingType === filter);

  async function decide(decision: "approve" | "reject" | "pause", reason: string) {
    if (!activeId) return;
    if ((decision === "reject" || decision === "pause") && !reason.trim()) {
      onToast("Reason is required for reject/pause", "warn");
      return;
    }
    setBusy(decision);
    try {
      await decideAdminListing(accessToken, activeId, decision, reason.trim() || undefined);
      onToast(`Listing ${decision}d`, "trust");
      setActiveId(null);
      void load();
    } catch (err) {
      onToast(err instanceof Error ? err.message : "Action failed", "danger");
    } finally {
      setBusy(null);
    }
  }

  if (activeId) {
    return (
      <ListingReviewWorkspace
        accessToken={accessToken}
        listingId={activeId}
        onBack={() => setActiveId(null)}
        onDecide={decide}
        busy={busy}
        onToast={onToast}
      />
    );
  }

  const columns: Column<AdminListingVm>[] = [
    {
      key: "title",
      header: "Title",
      render: (r) => (
        <div>
          <div style={{ fontWeight: 500 }}>{r.title}</div>
          <div className="admin-table__id">{r.id.slice(0, 8)}…</div>
        </div>
      ),
      sortValue: (r) => r.title.toLowerCase()
    },
    {
      key: "type",
      header: "Type",
      render: (r) => <StatusPill status={r.listingType} tone="muted" noDot />,
      sortValue: (r) => r.listingType
    },
    { key: "city", header: "City", render: (r) => r.city ?? "-", sortValue: (r) => r.city ?? "" },
    {
      key: "rent",
      header: "Rent",
      align: "right",
      render: (r) => (
        <span className="admin-table__amount">
          {r.monthlyRent ? formatINRPrecise(r.monthlyRent * 100) : "-"}
        </span>
      ),
      sortValue: (r) => r.monthlyRent ?? 0
    },
    {
      key: "status",
      header: "Status",
      render: (r) => <StatusPill status={r.status} />,
      sortValue: (r) => r.status
    },
    {
      key: "verification",
      header: "Verification",
      render: (r) => <StatusPill status={r.verificationStatus} tone="muted" noDot />,
      sortValue: (r) => r.verificationStatus
    },
    {
      key: "created",
      header: "Submitted",
      align: "right",
      render: (r) => formatDate(r.createdAt),
      sortValue: (r) => r.createdAt
    }
  ];

  return (
    <div className="admin-main__section">
      <div className="admin-page-title">
        <h1>Listing Review</h1>
        <span className="admin-page-title__sub">
          {loading ? "loading…" : `${filtered.length} pending`}
        </span>
      </div>

      <SectionCard flush>
        <div className="admin-chip-row">
          {(["all", "flat_house", "pg"] as const).map((f) => (
            <button
              key={f}
              type="button"
              className="admin-chip"
              aria-pressed={f === filter}
              onClick={() => setFilter(f)}
            >
              {f === "all" ? "All" : f === "flat_house" ? "Flat / House" : "PG"}
            </button>
          ))}
        </div>
        {filtered.length === 0 ? (
          <EmptyState
            title="No listings need review"
            hint="Owners will appear here when they submit."
          />
        ) : (
          <DataTable
            columns={columns}
            rows={filtered}
            rowKey={(r) => r.id}
            onRowClick={(r) => setActiveId(r.id)}
          />
        )}
      </SectionCard>
    </div>
  );
}
