import type { DraftsService } from "../drafts/drafts.service";
import type {
  AgreementStatus,
  IncrementDownloadCount,
  LoadAgreementForDownload,
  RecordDownloadAudit
} from "./downloads.service";

// Bridges DraftsService (Phase 5 in-memory) → the AgreementDownloadView shape
// the DownloadsService needs. Phase 13 swaps this for the real DB repository.
// Until Phase 8a job worker is wired into the worker.ts loop (Phase 13), the
// `pdf_blob_path` is null on all rows, so this loader effectively reports
// "not ready" for all agreements — that's correct for the in-memory phase.

// The DraftsService row uses WizardStatus ('generating_pdf'); DownloadsService
// uses AgreementStatus ('generating'). Normalize here.
function normalizeStatus(raw: string): AgreementStatus {
  if (raw === "generating_pdf") return "generating";
  return raw as AgreementStatus;
}

export function makeNullAgreementLoader(drafts: DraftsService): LoadAgreementForDownload {
  return async (agreementId, userId) => {
    const row = (await drafts.getOne(userId, agreementId)) as unknown as
      | (Record<string, unknown> & { id: string; user_id: string; status: string })
      | null;
    if (!row) return null;
    return {
      id: row.id,
      user_id: row.user_id,
      status: normalizeStatus(row.status),
      pdf_blob_path: (row.pdf_blob_path as string | null | undefined) ?? null,
      download_count: (row.download_count as number | undefined) ?? 0,
      max_downloads: (row.max_downloads as number | undefined) ?? 5,
      expires_at: row.expires_at ? new Date(row.expires_at as string) : null
    };
  };
}

// In-memory counter increment (mutates a side Map for the lifetime of the process).
// Phase 13 wires the real UPDATE.
export function makeInMemoryCounterIncrementer(): IncrementDownloadCount {
  const counts = new Map<string, number>();
  return async (agreementId) => {
    counts.set(agreementId, (counts.get(agreementId) ?? 0) + 1);
  };
}

// In-memory audit sink for Phase 11. Phase 13 wires the INSERT.
export function makeInMemoryAuditRecorder(): RecordDownloadAudit {
  return async () => {
    // sink — discarded
  };
}
