"use client";

import { useState } from "react";
import { setAdminPgOverride, clearAdminPgOverride } from "../../../lib/admin-api";
import type { PgAdminListingDetail } from "@cribliv/shared-types";
import { ConfirmDialog } from "../primitives/ConfirmDialog";

interface Props {
  accessToken: string;
  detail: PgAdminListingDetail;
  onChanged: (next: PgAdminListingDetail) => void;
  onToast?: (msg: string, kind?: "success" | "error") => void;
}

type PendingAction = { scope: "global" | "listing"; turnOn: boolean };

function StatusBadge({ active }: { active: boolean }) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        padding: "2px 10px",
        borderRadius: 20,
        fontSize: 11,
        fontWeight: 600,
        letterSpacing: "0.02em",
        background: active ? "#FEF3C7" : "#D1FAE5",
        color: active ? "#92400E" : "#065F46",
        border: `1px solid ${active ? "#FDE68A" : "#6EE7B7"}`
      }}
    >
      <span
        style={{
          width: 6,
          height: 6,
          borderRadius: "50%",
          background: active ? "#D97706" : "#10B981",
          display: "inline-block",
          flexShrink: 0,
          ...(active ? { animation: "pg-pulse-amber 2s ease-in-out infinite" } : {})
        }}
      />
      {active ? "Cut" : "Live"}
    </span>
  );
}

const ROWS: Array<{
  scope: "global" | "listing";
  getActive: (overrides: PgAdminListingDetail["overrides"]) => boolean;
  label: string;
  hint: string;
}> = [
  {
    scope: "listing",
    getActive: (o) => o.listing,
    label: "This listing’s analytics",
    hint: "Hides analytics for THIS listing only. The operator’s other listings are unaffected."
  },
  {
    scope: "global",
    getActive: (o) => o.global,
    label: "Operator-global analytics",
    hint: "Hides ALL analytics for this operator across every listing they own."
  }
];

export function VisibilityControls({ accessToken, detail, onChanged, onToast }: Props) {
  const [pending, setPending] = useState<PendingAction | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  const operatorId = detail.owner.id;
  const listingId = detail.listing.id;

  const apply = async () => {
    if (!pending) return;
    setBusy(true);
    try {
      const payload = {
        scope: pending.scope,
        operator_id: operatorId,
        reason: reason || undefined
      };
      const next = pending.turnOn
        ? await setAdminPgOverride(accessToken, listingId, payload)
        : await clearAdminPgOverride(accessToken, listingId, payload);
      onChanged(next);
      onToast?.("Visibility updated", "success");
    } catch {
      onToast?.("Update failed — please try again", "error");
    } finally {
      setBusy(false);
      setPending(null);
      setReason("");
    }
  };

  return (
    <div>
      {ROWS.map((row) => {
        const active = row.getActive(detail.overrides);
        // When global is on, the per-listing toggle is effectively superseded.
        const supersededByGlobal = row.scope === "listing" && detail.overrides.global;
        return (
          <div
            key={row.scope}
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              padding: "14px 0",
              borderBottom: "1px solid #F3F4F6",
              opacity: supersededByGlobal ? 0.55 : 1
            }}
          >
            <div style={{ flex: 1, minWidth: 0 }}>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  marginBottom: 4,
                  flexWrap: "wrap"
                }}
              >
                <span style={{ fontWeight: 600, fontSize: 14, color: "#111827" }}>{row.label}</span>
                <StatusBadge active={active || supersededByGlobal} />
              </div>
              <div style={{ fontSize: 12, color: "#6B7280", lineHeight: 1.5 }}>
                {supersededByGlobal
                  ? "Currently hidden by the operator-global cut below."
                  : row.hint}
              </div>
            </div>
            <button
              type="button"
              className={`admin-btn ${active ? "admin-btn--danger" : "admin-btn--ghost"}`}
              style={{ marginLeft: 16, flexShrink: 0, fontSize: 12 }}
              disabled={busy || supersededByGlobal}
              onClick={() => {
                setReason("");
                setPending({ scope: row.scope, turnOn: !active });
              }}
            >
              {active ? "Restore analytics" : "Cut analytics"}
            </button>
          </div>
        );
      })}

      <ConfirmDialog
        open={pending !== null}
        title={pending?.turnOn ? "Cut analytics?" : "Restore analytics?"}
        body={
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <p style={{ fontSize: 13, color: "#374151", margin: 0, lineHeight: 1.6 }}>
              {pending?.turnOn
                ? "The operator will see zeros and an “under review” notice. Data keeps collecting; restoring shows the full history instantly."
                : "The operator will immediately see the full analytics history again."}
            </p>
            {pending?.turnOn && (
              <p
                style={{
                  fontSize: 12,
                  color: "#B45309",
                  fontWeight: 500,
                  margin: 0,
                  background: "#FFFBEB",
                  padding: "6px 10px",
                  borderRadius: 6,
                  border: "1px solid #FDE68A"
                }}
              >
                Affects the operator’s{" "}
                {pending.scope === "global"
                  ? "entire account across all listings"
                  : "view of this listing only"}
                .
              </p>
            )}
            <div>
              <label
                style={{
                  display: "block",
                  fontSize: 11,
                  fontWeight: 600,
                  color: "#6B7280",
                  marginBottom: 4,
                  textTransform: "uppercase",
                  letterSpacing: "0.05em"
                }}
              >
                Reason (optional)
              </label>
              <textarea
                className="admin-input"
                placeholder="Internal note…"
                rows={2}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                style={{ resize: "vertical", fontSize: 13, width: "100%" }}
              />
            </div>
          </div>
        }
        confirmLabel={pending?.turnOn ? "Cut analytics" : "Restore analytics"}
        destructive={pending?.turnOn}
        busy={busy}
        onCancel={() => {
          setPending(null);
          setReason("");
        }}
        onConfirm={apply}
      />
    </div>
  );
}
