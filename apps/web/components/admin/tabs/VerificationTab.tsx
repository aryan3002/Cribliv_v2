"use client";

import { useEffect, useState } from "react";
import { SectionCard } from "../primitives/SectionCard";
import { EmptyState } from "../primitives/EmptyState";
import { DataTable, type Column } from "../primitives/DataTable";
import { Drawer } from "../primitives/Drawer";
import { StatusPill } from "../primitives/StatusPill";
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
}

export function VerificationTab({ accessToken, onCountChange, onToast }: Props) {
  const [items, setItems] = useState<AdminVerificationVm[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"all" | "video_liveness" | "electricity_bill_match">("all");
  const [active, setActive] = useState<AdminVerificationVm | null>(null);
  const [reason, setReason] = useState("");
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

  async function decide(decision: "pass" | "fail" | "manual_review") {
    if (!active) return;
    if (decision === "fail" && !reason.trim()) {
      onToast("Reason is required when failing", "warn");
      return;
    }
    setBusy(decision);
    try {
      await decideAdminVerification(accessToken, active.id, decision, reason.trim() || undefined);
      onToast(`Verification ${decision.replace("_", " ")}`, "trust");
      setActive(null);
      setReason("");
      void load();
    } catch (err) {
      onToast(err instanceof Error ? err.message : "Action failed", "danger");
    } finally {
      setBusy(null);
    }
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
      render: (r) => (r.machineResult ? <StatusPill status={r.machineResult} /> : "—"),
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
          {r.livenessScore == null && r.addressMatchScore == null && "—"}
        </span>
      )
    },
    {
      key: "reason",
      header: "Review reason",
      render: (r) => (
        <span style={{ color: "var(--ad-text-3)", fontSize: 12 }}>
          {r.reviewReason ? r.reviewReason.replace(/_/g, " ") : "—"}
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
        title="Verification attempt"
        subtitle={active?.id}
        footer={
          <>
            <button
              type="button"
              className="admin-btn admin-btn--ghost"
              disabled={!!busy}
              onClick={() => decide("manual_review")}
            >
              Manual review
            </button>
            <button
              type="button"
              className="admin-btn admin-btn--danger"
              disabled={!!busy}
              onClick={() => decide("fail")}
            >
              Fail
            </button>
            <button
              type="button"
              className="admin-btn admin-btn--primary"
              disabled={!!busy}
              onClick={() => decide("pass")}
            >
              Pass
            </button>
          </>
        }
      >
        {active && (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <Row label="Type" value={active.verificationType} />
            <Row label="User" value={active.userId} mono />
            {active.listingId && <Row label="Listing" value={active.listingId} mono />}
            <Row label="Provider" value={active.provider ?? "—"} />
            <Row label="Provider ref" value={active.providerReference ?? "—"} mono />
            <Row label="Provider code" value={active.providerResultCode ?? "—"} mono />
            <Row label="Threshold" value={String(active.threshold)} />
            <Row
              label="Liveness score"
              value={active.livenessScore != null ? String(Math.round(active.livenessScore)) : "—"}
            />
            <Row
              label="Address match"
              value={
                active.addressMatchScore != null
                  ? String(Math.round(active.addressMatchScore))
                  : "—"
              }
            />
            <Row label="Review reason" value={active.reviewReason?.replace(/_/g, " ") ?? "—"} />
            <Row
              label="Retryable"
              value={active.retryable == null ? "—" : active.retryable ? "yes" : "no"}
            />
            <Row label="Submitted" value={formatDate(active.createdAt)} />
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
                Reason (required when failing)
              </label>
              <textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Document why this is being failed or sent to manual review"
                style={{
                  width: "100%",
                  minHeight: 80,
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

function Row({ label, value, mono }: { label: string; value: React.ReactNode; mono?: boolean }) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "140px 1fr",
        gap: 12,
        fontSize: 13,
        alignItems: "center"
      }}
    >
      <span style={{ color: "var(--ad-text-3)", fontWeight: 500 }}>{label}</span>
      <span style={mono ? { fontFamily: "var(--font-mono)", fontSize: 12 } : undefined}>
        {value}
      </span>
    </div>
  );
}
