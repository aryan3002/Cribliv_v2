"use client";

import { useEffect, useState } from "react";
import {
  fetchAdminVerificationDetail,
  type AdminVerificationDetailVm
} from "../../../lib/admin-api";
import { SectionCard } from "../primitives/SectionCard";
import { StatusPill } from "../primitives/StatusPill";
import { VerificationEvidence, type EvidenceItem } from "./VerificationEvidence";
import { DecisionBar } from "./DecisionBar";
import { formatDate } from "../../../lib/admin/format";

const VERIF_ACTIONS = [
  { key: "manual_review", label: "Manual review", variant: "ghost" as const },
  { key: "fail", label: "Fail", variant: "danger" as const, requiresReason: true },
  { key: "pass", label: "Pass", variant: "primary" as const }
];

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        gap: 12,
        borderBottom: "1px dashed var(--ad-border)",
        padding: "4px 0"
      }}
    >
      <span style={{ fontSize: 12, color: "var(--ad-text-3)" }}>{label}</span>
      <span style={{ fontSize: 13, color: "var(--ad-text)", textAlign: "right" }}>
        {value ?? "-"}
      </span>
    </div>
  );
}

export function VerificationReviewView({
  accessToken,
  attemptId,
  onBack,
  onDecide,
  busy,
  onToast,
  onOpenListing
}: {
  accessToken: string;
  attemptId: string;
  onBack: () => void;
  onDecide: (decision: "pass" | "fail" | "manual_review", reason: string) => void;
  busy: string | null;
  onToast: (m: string, tone?: "trust" | "warn" | "danger") => void;
  onOpenListing?: (listingId: string) => void;
}) {
  const [detail, setDetail] = useState<AdminVerificationDetailVm | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    fetchAdminVerificationDetail(accessToken, attemptId)
      .then((d) => alive && setDetail(d))
      .catch(() => alive && onToast("Failed to load verification", "danger"))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accessToken, attemptId]);

  if (loading)
    return (
      <div style={{ padding: 24, color: "var(--ad-text-3)", fontSize: 13 }}>
        Loading verification…
      </div>
    );
  if (!detail)
    return (
      <div style={{ padding: 24, color: "var(--ad-text-3)", fontSize: 13 }}>
        Verification attempt not found.
      </div>
    );

  const evidence: EvidenceItem[] = [
    {
      attempt_id: detail.attempt_id,
      kind: detail.kind,
      result: detail.result,
      score: detail.kind === "video_liveness" ? detail.liveness_score : detail.address_match_score,
      threshold: detail.threshold,
      provider_result_code: detail.provider_result_code,
      review_reason: detail.review_reason,
      artifact_available: detail.artifact_available
    }
  ];

  return (
    <div className="admin-main__section">
      <button
        type="button"
        className="admin-btn admin-btn--ghost admin-btn--sm"
        onClick={onBack}
        style={{ alignSelf: "flex-start" }}
      >
        ← Back to verification queue
      </button>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(0, 1.2fr) minmax(0, 1fr)",
          gap: 16,
          alignItems: "start"
        }}
      >
        <div>
          <div
            style={{
              fontSize: 9,
              textTransform: "uppercase",
              letterSpacing: ".06em",
              color: "var(--ad-text-3)",
              fontWeight: 800,
              marginBottom: 8
            }}
          >
            Evidence
          </div>
          <VerificationEvidence accessToken={accessToken} onToast={onToast} items={evidence} />
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <SectionCard title="What's being verified">
            <Row label="Listing" value={detail.listing.title ?? "-"} />
            <Row label="Address" value={detail.listing.address ?? "-"} />
            <Row label="Type" value={detail.kind.replace(/_/g, " ")} />
            {detail.listing.id && onOpenListing && (
              <button
                type="button"
                className="admin-btn admin-btn--ghost admin-btn--sm"
                style={{ marginTop: 8 }}
                onClick={() => onOpenListing(detail.listing.id!)}
              >
                Open full listing
              </button>
            )}
          </SectionCard>

          <SectionCard title="Owner / submitter">
            <Row label="Name" value={detail.owner.name} />
            <Row
              label="Phone"
              value={
                detail.owner.phone ? (
                  <a href={`tel:${detail.owner.phone}`} style={{ color: "var(--ad-trust)" }}>
                    {detail.owner.phone}
                  </a>
                ) : (
                  "-"
                )
              }
            />
            <Row label="WhatsApp" value={detail.owner.whatsapp_opt_in ? "Opted in" : "No"} />
            <Row
              label="Member since"
              value={detail.owner.member_since ? formatDate(detail.owner.member_since) : "-"}
            />
          </SectionCard>

          <SectionCard title="Provider & attempt data">
            <Row label="Provider" value={detail.provider ?? "-"} />
            <Row label="Provider ref" value={detail.provider_reference ?? "-"} />
            <Row label="Result code" value={detail.provider_result_code ?? "-"} />
            <Row label="Review reason" value={detail.review_reason?.replace(/_/g, " ") ?? "-"} />
            <Row
              label="Retryable"
              value={detail.retryable == null ? "-" : detail.retryable ? "yes" : "no"}
            />
            <Row label="Current result" value={<StatusPill status={detail.result} />} />
            <Row label="Submitted" value={formatDate(detail.created_at)} />
          </SectionCard>

          <DecisionBar
            actions={VERIF_ACTIONS}
            busy={busy}
            onDecide={(key, reason) => onDecide(key as "pass" | "fail" | "manual_review", reason)}
          />
        </div>
      </div>
    </div>
  );
}
