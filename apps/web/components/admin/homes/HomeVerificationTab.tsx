import { CalendarCheck2, ShieldCheck } from "lucide-react";
import type { AdminHomeDetail, AdminHomeVerificationAttempt } from "@cribliv/shared-types";
import { formatDate, formatNumber } from "../../../lib/admin/format";
import { VerificationEvidence, type EvidenceItem } from "../review/VerificationEvidence";
import { EmptyState } from "../primitives/EmptyState";
import { StatusPill } from "../primitives/StatusPill";

export function HomeVerificationTab({
  accessToken,
  detail,
  onToast
}: {
  accessToken: string;
  detail: AdminHomeDetail;
  onToast: (message: string, tone?: "trust" | "warn" | "danger") => void;
}) {
  const attempts = [...detail.verification_attempts].sort(
    (a, b) => Date.parse(b.created_at) - Date.parse(a.created_at)
  );
  const evidence = attempts.map(mapAttemptToEvidence);

  return (
    <div className="admin-home-workspace__stack">
      <div className="admin-home-workspace__section-head">
        <div>
          <h2>Verification record</h2>
          <p>Artifacts use the audited, short-lived verification evidence endpoint.</p>
        </div>
        <div className="admin-home-workspace__verification-state">
          <ShieldCheck size={18} aria-hidden="true" />
          <div>
            <strong>Verified</strong>
            <span>
              <CalendarCheck2 size={14} aria-hidden="true" />
              {formatDate(detail.verified_at)}
            </span>
          </div>
        </div>
      </div>

      {attempts.length === 0 ? (
        <EmptyState
          title="No verification attempts"
          hint="This verified listing currently has no attempt metadata to display."
          icon={<ShieldCheck size={18} aria-hidden="true" />}
        />
      ) : (
        <>
          <div className="admin-table-wrap admin-home-workspace__attempt-table">
            <table className="admin-table">
              <thead>
                <tr>
                  <th scope="col">Type</th>
                  <th scope="col">Result</th>
                  <th scope="col">Score</th>
                  <th scope="col">Provider</th>
                  <th scope="col">Result code</th>
                  <th scope="col">Review reason</th>
                  <th scope="col">Reviewer</th>
                  <th scope="col">Reviewed</th>
                  <th scope="col">Created</th>
                </tr>
              </thead>
              <tbody>
                {attempts.map((attempt) => (
                  <tr key={attempt.attempt_id}>
                    <td>{attempt.kind.replace(/_/g, " ")}</td>
                    <td>
                      <StatusPill status={attempt.result} />
                    </td>
                    <td>{formatScore(attempt)}</td>
                    <td>{attempt.provider ?? "-"}</td>
                    <td>{attempt.provider_result_code ?? "-"}</td>
                    <td>{attempt.review_reason ?? "-"}</td>
                    <td>{attempt.reviewed_by ?? "-"}</td>
                    <td>{formatDate(attempt.reviewed_at)}</td>
                    <td>{formatDate(attempt.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="admin-home-workspace__evidence">
            <h3>Secure evidence</h3>
            <VerificationEvidence accessToken={accessToken} items={evidence} onToast={onToast} />
          </div>
        </>
      )}
    </div>
  );
}

function mapAttemptToEvidence(attempt: AdminHomeVerificationAttempt): EvidenceItem {
  return {
    attempt_id: attempt.attempt_id,
    kind: attempt.kind,
    result: attempt.result,
    score: attempt.kind === "video_liveness" ? attempt.liveness_score : attempt.address_match_score,
    threshold: attempt.threshold,
    provider_result_code: attempt.provider_result_code,
    review_reason: attempt.review_reason,
    artifact_available: attempt.artifact_available
  };
}

function formatScore(attempt: AdminHomeVerificationAttempt): string {
  const score =
    attempt.kind === "video_liveness" ? attempt.liveness_score : attempt.address_match_score;
  return score == null ? "-" : `${formatNumber(score)} / ${formatNumber(attempt.threshold)}`;
}
