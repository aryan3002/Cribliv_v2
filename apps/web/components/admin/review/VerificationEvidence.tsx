"use client";

import { useState } from "react";
import { fetchVerificationArtifactLink, type AdminReviewEvidenceVm } from "../../../lib/admin-api";

export interface EvidenceItem {
  attempt_id: string;
  kind: string;
  result: string;
  score: number | null;
  threshold: number;
  provider_result_code: string | null;
  review_reason: string | null;
  artifact_available: boolean;
}

export function mapEvidence(v: AdminReviewEvidenceVm): EvidenceItem {
  return {
    attempt_id: v.attempt_id,
    kind: v.kind,
    result: v.result,
    score: v.kind === "video_liveness" ? v.liveness_score : v.address_match_score,
    threshold: v.threshold,
    provider_result_code: v.provider_result_code,
    review_reason: v.review_reason,
    artifact_available: v.artifact_available
  };
}

function linkKind(kind: string): "video_liveness" | "electricity_bill" {
  return kind === "video_liveness" ? "video_liveness" : "electricity_bill";
}

function EvidenceCard({
  item,
  accessToken,
  onToast
}: {
  item: EvidenceItem;
  accessToken: string;
  onToast: (m: string, tone?: "trust" | "warn" | "danger") => void;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const isVideo = item.kind === "video_liveness";
  const label = isVideo ? "liveness video" : "electricity bill";
  const below = item.score != null && item.score < item.threshold;

  async function load() {
    setBusy(true);
    try {
      const res = await fetchVerificationArtifactLink(
        accessToken,
        item.attempt_id,
        linkKind(item.kind)
      );
      if (!res) {
        onToast("Artifact link unavailable", "warn");
        return;
      }
      setUrl(res.url);
    } catch {
      onToast("Failed to load artifact", "danger");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      style={{
        border: "1px solid var(--ad-border)",
        borderRadius: "var(--ad-radius)",
        padding: 12
      }}
    >
      <div
        style={{
          fontSize: 12,
          fontWeight: 700,
          color: "var(--ad-text-2)",
          textTransform: "capitalize",
          marginBottom: 6
        }}
      >
        {label}
      </div>

      {!item.artifact_available ? (
        <p style={{ fontSize: 12, color: "var(--ad-text-3)", margin: "8px 0" }}>
          No artifact uploaded.
        </p>
      ) : url ? (
        isVideo ? (
          <video
            data-testid="evidence-video"
            src={url}
            controls
            style={{ width: "100%", borderRadius: 6, maxHeight: 320 }}
          />
        ) : (
          <iframe
            data-testid="evidence-bill"
            src={url}
            title="bill"
            style={{
              width: "100%",
              height: 320,
              border: "1px solid var(--ad-border)",
              borderRadius: 6
            }}
          />
        )
      ) : (
        <button
          type="button"
          className="admin-btn admin-btn--ghost admin-btn--sm"
          disabled={busy}
          onClick={load}
        >
          {busy ? "Loading…" : isVideo ? "Play liveness video" : "Open electricity bill"}
        </button>
      )}

      <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, marginTop: 8 }}>
        <span style={{ color: "var(--ad-text-3)", width: 54 }}>
          {isVideo ? "Liveness" : "Address"}
        </span>
        <div
          style={{
            flex: 1,
            height: 7,
            background: "var(--ad-surface-2)",
            borderRadius: 4,
            overflow: "hidden"
          }}
        >
          <span
            style={{
              display: "block",
              height: "100%",
              width: `${Math.max(0, Math.min(100, item.score ?? 0))}%`,
              background: below ? "var(--ad-warning)" : "var(--ad-trust)"
            }}
          />
        </div>
        <b>{item.score != null ? Math.max(0, Math.min(100, Number(item.score))) : "-"}</b>
      </div>
      <div style={{ fontSize: 11, color: "var(--ad-text-3)", marginTop: 3 }}>
        threshold {item.threshold}
        {below ? " · below" : ""}
        {item.provider_result_code ? ` · ${item.provider_result_code}` : ""}
      </div>
    </div>
  );
}

export function VerificationEvidence({
  accessToken,
  items,
  onToast
}: {
  accessToken: string;
  items: EvidenceItem[];
  onToast: (m: string, tone?: "trust" | "warn" | "danger") => void;
}) {
  if (items.length === 0) {
    return (
      <p style={{ fontSize: 13, color: "var(--ad-text-3)" }}>
        No verification submitted for this listing.
      </p>
    );
  }
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
        gap: 10
      }}
    >
      {items.map((it) => (
        <EvidenceCard key={it.attempt_id} item={it} accessToken={accessToken} onToast={onToast} />
      ))}
    </div>
  );
}
