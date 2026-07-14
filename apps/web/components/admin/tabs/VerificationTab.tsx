"use client";

import { useEffect, useState } from "react";
import { SectionCard } from "../primitives/SectionCard";
import { EmptyState } from "../primitives/EmptyState";
import { DataTable, type Column } from "../primitives/DataTable";
import { StatusPill } from "../primitives/StatusPill";
import { VerificationReviewView } from "../review/VerificationReviewView";
import {
  decideAdminVerification,
  fetchAdminVerifications,
  type AdminVerificationVm
} from "../../../lib/admin-api";
import { formatDate } from "../../../lib/admin/format";

interface Props {
  accessToken: string;
  onCountChange?: (count: number) => void;
  onToast: (message: string, tone?: "trust" | "warn" | "danger") => void;
  onOpenListing?: (listingId: string) => void;
}

export function VerificationTab({ accessToken, onCountChange, onToast, onOpenListing }: Props) {
  const [items, setItems] = useState<AdminVerificationVm[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"all" | "video_liveness" | "electricity_bill_match">("all");
  const [activeId, setActiveId] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    try {
      const r = await fetchAdminVerifications(accessToken);
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

  const filtered = filter === "all" ? items : items.filter((i) => i.verificationType === filter);

  async function decide(decision: "pass" | "fail" | "manual_review", reason: string) {
    if (!activeId) return;
    if (decision === "fail" && !reason.trim()) {
      onToast("Reason is required when failing", "warn");
      return;
    }
    setBusy(decision);
    try {
      await decideAdminVerification(accessToken, activeId, decision, reason.trim() || undefined);
      onToast(`Verification ${decision.replace("_", " ")}`, "trust");
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
      <VerificationReviewView
        accessToken={accessToken}
        attemptId={activeId}
        onBack={() => setActiveId(null)}
        onDecide={decide}
        busy={busy}
        onToast={onToast}
        onOpenListing={onOpenListing}
      />
    );
  }

  const columns: Column<AdminVerificationVm>[] = [
    {
      key: "type",
      header: "Type",
      render: (r) => (
        <StatusPill
          status={r.verificationType}
          label={r.verificationType === "video_liveness" ? "Video Liveness" : "Electricity Bill"}
          tone="muted"
          noDot
        />
      ),
      sortValue: (r) => r.verificationType
    },
    {
      key: "user",
      header: "User",
      render: (r) => <span className="admin-table__id">{r.userId.slice(0, 8)}…</span>,
      sortValue: (r) => r.userId
    },
    {
      key: "machine",
      header: "Machine result",
      render: (r) => (r.machineResult ? <StatusPill status={r.machineResult} /> : "-"),
      sortValue: (r) => r.machineResult ?? ""
    },
    {
      key: "result",
      header: "Current",
      render: (r) => <StatusPill status={r.result} />,
      sortValue: (r) => r.result
    },
    {
      key: "scores",
      header: "Scores",
      align: "right",
      render: (r) => (
        <span className="admin-table__amount" style={{ fontSize: 11.5 }}>
          {r.livenessScore != null && `live ${Math.round(r.livenessScore)}`}
          {r.livenessScore != null && r.addressMatchScore != null && " · "}
          {r.addressMatchScore != null && `addr ${Math.round(r.addressMatchScore)}`}
          {r.livenessScore == null && r.addressMatchScore == null && "-"}
        </span>
      )
    },
    {
      key: "reason",
      header: "Review reason",
      render: (r) => (
        <span style={{ color: "var(--ad-text-3)", fontSize: 12 }}>
          {r.reviewReason ? r.reviewReason.replace(/_/g, " ") : "-"}
        </span>
      )
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
        <h1>Verification Review</h1>
        <span className="admin-page-title__sub">
          {loading ? "loading…" : `${filtered.length} attempts`}
        </span>
      </div>

      <SectionCard flush>
        <div className="admin-chip-row">
          {(["all", "video_liveness", "electricity_bill_match"] as const).map((f) => (
            <button
              key={f}
              type="button"
              className="admin-chip"
              aria-pressed={f === filter}
              onClick={() => setFilter(f)}
            >
              {f === "all" ? "All" : f === "video_liveness" ? "Video Liveness" : "Electricity Bill"}
            </button>
          ))}
        </div>
        {filtered.length === 0 ? (
          <EmptyState title="No verifications waiting" />
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
