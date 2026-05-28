import type { DraftsService } from "../drafts/drafts.service";
import type {
  AgreementStatus,
  IncrementDownloadCount,
  LoadAgreementForDownload,
  RecordDownloadAudit
} from "./downloads.service";

// Phase 13 wiring. DownloadsService talks to DraftsService through these three
// callbacks. They give DownloadsService a clean shape (AgreementDownloadView,
// counter-increment, audit-sink) while DraftsService stays unaware of download
// concerns. When a DB-backed repository is added later, only these three helpers
// swap — DownloadsService keeps the same Deps.

// WizardStatus on the row uses 'generating_pdf'; DownloadsService uses 'generating'.
function normalizeStatus(raw: string): AgreementStatus {
  if (raw === "generating_pdf") return "generating";
  return raw as AgreementStatus;
}

export function makeDraftsAgreementLoader(drafts: DraftsService): LoadAgreementForDownload {
  return async (agreementId, userId) => {
    const row = (await drafts.getOne(userId, agreementId)) as unknown as
      | (Record<string, unknown> & { id: string; status: string })
      | null;
    if (!row) return null;
    return {
      id: row.id,
      user_id: userId,
      status: normalizeStatus(row.status),
      pdf_blob_path: (row.pdf_blob_path as string | null | undefined) ?? null,
      download_count: (row.download_count as number | undefined) ?? 0,
      max_downloads: (row.max_downloads as number | undefined) ?? 5,
      expires_at: row.expires_at ? new Date(row.expires_at as string) : null
    };
  };
}

export function makeDraftsCounterIncrementer(drafts: DraftsService): IncrementDownloadCount {
  return async (agreementId) => {
    await drafts.incrementDownloadCount(agreementId);
  };
}

// Audit goes to telemetry / DB in production; in dev we just discard. The downloads
// service still receives every claim event — it just doesn't get persisted.
export function makeNoopAuditRecorder(): RecordDownloadAudit {
  return async () => {
    // sink
  };
}
