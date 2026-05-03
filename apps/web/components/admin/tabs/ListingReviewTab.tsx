"use client";

import { useEffect, useState } from "react";
import { SectionCard } from "../primitives/SectionCard";
import { EmptyState } from "../primitives/EmptyState";
import { DataTable, type Column } from "../primitives/DataTable";
import { Drawer } from "../primitives/Drawer";
import { StatusPill } from "../primitives/StatusPill";
import {
  decideAdminListing,
  fetchAdminListings,
  type AdminListingVm
} from "../../../lib/admin-api";
import { formatDate, formatINRPrecise } from "../../../lib/admin/format";

interface Props {
  accessToken: string;
  onCountChange?: (count: number) => void;
  onToast: (message: string, tone?: "trust" | "warn" | "danger") => void;
}

export function ListingReviewTab({ accessToken, onCountChange, onToast }: Props) {
  const [items, setItems] = useState<AdminListingVm[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"all" | "flat_house" | "pg">("all");
  const [active, setActive] = useState<AdminListingVm | null>(null);
  const [reason, setReason] = useState("");
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

  const filtered = filter === "all" ? items : items.filter((i) => i.listingType === filter);

  async function decide(decision: "approve" | "reject" | "pause") {
    if (!active) return;
    if ((decision === "reject" || decision === "pause") && !reason.trim()) {
      onToast("Reason is required for reject/pause", "warn");
      return;
    }
    setBusy(decision);
    try {
      await decideAdminListing(accessToken, active.id, decision, reason.trim() || undefined);
      onToast(`Listing ${decision}d`, "trust");
      setActive(null);
      setReason("");
      void load();
    } catch (err) {
      onToast(err instanceof Error ? err.message : "Action failed", "danger");
    } finally {
      setBusy(null);
    }
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
    {
      key: "city",
      header: "City",
      render: (r) => r.city ?? "—",
      sortValue: (r) => r.city ?? ""
    },
    {
      key: "rent",
      header: "Rent",
      align: "right",
      render: (r) => (
        <span className="admin-table__amount">
          {r.monthlyRent ? formatINRPrecise(r.monthlyRent * 100) : "—"}
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
            onRowClick={(r) => {
              setActive(r);
              setReason("");
            }}
          />
        )}
      </SectionCard>

      <Drawer
        open={!!active}
        onClose={() => setActive(null)}
        title={active?.title ?? ""}
        subtitle={active ? `${active.id} · owner ${active.ownerUserId.slice(0, 8)}…` : undefined}
        footer={
          <>
            <button
              type="button"
              className="admin-btn admin-btn--ghost"
              disabled={!!busy}
              onClick={() => decide("pause")}
            >
              Pause
            </button>
            <button
              type="button"
              className="admin-btn admin-btn--danger"
              disabled={!!busy}
              onClick={() => decide("reject")}
            >
              Reject
            </button>
            <button
              type="button"
              className="admin-btn admin-btn--primary"
              disabled={!!busy}
              onClick={() => decide("approve")}
            >
              Approve
            </button>
          </>
        }
      >
        {active && (
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <DetailRow label="Type" value={active.listingType} />
            <DetailRow label="City" value={active.city ?? "—"} />
            <DetailRow
              label="Rent"
              value={active.monthlyRent ? formatINRPrecise(active.monthlyRent * 100) : "—"}
            />
            <DetailRow label="Status" value={<StatusPill status={active.status} />} />
            <DetailRow
              label="Verification"
              value={<StatusPill status={active.verificationStatus} tone="muted" noDot />}
            />
            <DetailRow label="Submitted" value={formatDate(active.createdAt)} />
            <div>
              <label
                style={{
                  display: "block",
                  fontSize: 12,
                  fontWeight: 600,
                  color: "var(--ad-text-2)",
                  marginBottom: 6
                }}
              >
                Reason (required for reject / pause)
              </label>
              <textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Why is this being rejected or paused?"
                style={{
                  width: "100%",
                  minHeight: 88,
                  padding: 10,
                  border: "1px solid var(--ad-border)",
                  borderRadius: 8,
                  fontFamily: "inherit",
                  fontSize: 13,
                  resize: "vertical"
                }}
              />
            </div>
          </div>
        )}
      </Drawer>
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "120px 1fr",
        gap: 16,
        fontSize: 13,
        alignItems: "center"
      }}
    >
      <span style={{ color: "var(--ad-text-3)", fontWeight: 500 }}>{label}</span>
      <span>{value}</span>
    </div>
  );
}
