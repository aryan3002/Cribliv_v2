import type { SasIssuerPort } from "./sas-issuer.port";
import { hashIp } from "./downloads.audit";

// In-memory orchestration for Phase 9. Pure: no DB, no Azure SDK touched directly.
// All side effects flow through injected callbacks / ports. Phase 13 wires the real
// callbacks against the DB repository.

export type AgreementStatus =
  | "draft"
  | "pending_payment"
  | "paid"
  | "queued"
  | "generating"
  | "generated"
  | "expired"
  | "refunded";

export interface AgreementDownloadView {
  id: string;
  user_id: string;
  status: AgreementStatus;
  pdf_blob_path: string | null;
  download_count: number;
  max_downloads: number;
  expires_at: Date | null;
}

export interface DownloadAuditRecord {
  agreement_id: string;
  ip_hash: string;
  user_agent: string | null;
  sas_expires_at: Date;
  created_at: Date;
}

export type LoadAgreementForDownload = (
  agreementId: string,
  userId: string
) => Promise<AgreementDownloadView | null>;

export type IncrementDownloadCount = (agreementId: string) => Promise<void>;

export type RecordDownloadAudit = (record: DownloadAuditRecord) => Promise<void>;

export interface ClaimInput {
  agreementId: string;
  userId: string;
  ip: string;
  userAgent: string | null;
}

export interface ClaimResult {
  sasUrl: string;
  expiresAt: Date;
  remaining: number;
}

export type DownloadsServiceErrorCode =
  | "RENT_AGREEMENT_NOT_FOUND"
  | "RENT_AGREEMENT_FORBIDDEN"
  | "RENT_AGREEMENT_PDF_NOT_READY"
  | "RENT_AGREEMENT_DOWNLOAD_LIMIT_REACHED"
  | "RENT_AGREEMENT_EXPIRED"
  | "RENT_AGREEMENT_REFUNDED";

export class DownloadsServiceError extends Error {
  readonly code: DownloadsServiceErrorCode;
  constructor(code: DownloadsServiceErrorCode, message: string) {
    super(message);
    this.name = "DownloadsServiceError";
    this.code = code;
  }
}

interface Deps {
  sasIssuer: SasIssuerPort;
  loadAgreementForDownload: LoadAgreementForDownload;
  incrementDownloadCount: IncrementDownloadCount;
  recordDownloadAudit: RecordDownloadAudit;
  clock?: () => Date;
  ipSalt?: string;
  sasTtlSeconds?: number;
}

const DEFAULT_SAS_TTL_SECONDS = 3600;

export class DownloadsService {
  private readonly sasIssuer: SasIssuerPort;
  private readonly load: LoadAgreementForDownload;
  private readonly inc: IncrementDownloadCount;
  private readonly audit: RecordDownloadAudit;
  private readonly clock: () => Date;
  private readonly ipSalt: string | undefined;
  private readonly sasTtlSeconds: number;

  constructor(deps: Deps) {
    this.sasIssuer = deps.sasIssuer;
    this.load = deps.loadAgreementForDownload;
    this.inc = deps.incrementDownloadCount;
    this.audit = deps.recordDownloadAudit;
    this.clock = deps.clock ?? (() => new Date());
    this.ipSalt = deps.ipSalt;
    this.sasTtlSeconds = deps.sasTtlSeconds ?? DEFAULT_SAS_TTL_SECONDS;
  }

  async claim(input: ClaimInput): Promise<ClaimResult> {
    const agreement = await this.load(input.agreementId, input.userId);
    if (!agreement) {
      throw new DownloadsServiceError(
        "RENT_AGREEMENT_NOT_FOUND",
        `Agreement '${input.agreementId}' not found for user '${input.userId}'`
      );
    }

    // Order matters: refunded / expired short-circuit before "not ready" because a
    // refunded-after-generation agreement still has pdf_blob_path set. Spec
    // [[PDF-Pipeline]] §Refund interaction: refund → 410 RENT_AGREEMENT_REFUNDED.
    if (agreement.status === "refunded") {
      throw new DownloadsServiceError("RENT_AGREEMENT_REFUNDED", "Agreement has been refunded");
    }

    const now = this.clock();
    if (
      agreement.status === "expired" ||
      (agreement.expires_at !== null && agreement.expires_at.getTime() <= now.getTime())
    ) {
      throw new DownloadsServiceError(
        "RENT_AGREEMENT_EXPIRED",
        "Agreement download window has expired"
      );
    }

    if (agreement.status !== "generated" || !agreement.pdf_blob_path) {
      throw new DownloadsServiceError(
        "RENT_AGREEMENT_PDF_NOT_READY",
        `Agreement PDF is not yet generated (status='${agreement.status}')`
      );
    }

    if (agreement.download_count >= agreement.max_downloads) {
      throw new DownloadsServiceError(
        "RENT_AGREEMENT_DOWNLOAD_LIMIT_REACHED",
        `Download quota reached (${agreement.download_count}/${agreement.max_downloads})`
      );
    }

    const issued = await this.sasIssuer.issue({
      blobPath: agreement.pdf_blob_path,
      ttlSeconds: this.sasTtlSeconds,
      now
    });
    await this.inc(agreement.id);
    await this.audit({
      agreement_id: agreement.id,
      ip_hash: hashIp(input.ip, this.ipSalt),
      user_agent: input.userAgent,
      sas_expires_at: issued.expiresAt,
      created_at: now
    });
    return {
      sasUrl: issued.sasUrl,
      expiresAt: issued.expiresAt,
      remaining: agreement.max_downloads - (agreement.download_count + 1)
    };
  }
}
