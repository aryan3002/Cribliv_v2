// In-page PDF preview — serves the generated agreement PDF bytes for an
// authenticated owner WITHOUT consuming a download. Deliberately has no
// download-counter dependency: previewing can never decrement the quota.
// The counted save path stays in DownloadsService.

import type {
  AgreementDownloadView,
  LoadAgreementForDownload
} from "../downloads/downloads.service";

export type PdfPreviewErrorCode =
  | "RENT_AGREEMENT_NOT_FOUND"
  | "RENT_AGREEMENT_PDF_NOT_READY"
  | "RENT_AGREEMENT_EXPIRED"
  | "RENT_AGREEMENT_REFUNDED";

export class PdfPreviewError extends Error {
  readonly code: PdfPreviewErrorCode;
  constructor(code: PdfPreviewErrorCode, message: string) {
    super(message);
    this.name = "PdfPreviewError";
    this.code = code;
  }
}

interface Deps {
  /** Loads the agreement scoped to the caller — returns null for missing/cross-user. */
  loadAgreement: LoadAgreementForDownload;
  /** Reads raw PDF bytes for a stored blob path (InMemory or Azure). */
  loadPdfBytes: (blobPath: string) => Promise<Buffer | undefined>;
  clock?: () => Date;
}

export class PdfPreviewService {
  private readonly load: LoadAgreementForDownload;
  private readonly loadBytes: (blobPath: string) => Promise<Buffer | undefined>;
  private readonly clock: () => Date;

  constructor(deps: Deps) {
    this.load = deps.loadAgreement;
    this.loadBytes = deps.loadPdfBytes;
    this.clock = deps.clock ?? (() => new Date());
  }

  async getPdfBytes(agreementId: string, userId: string): Promise<Buffer> {
    const agreement: AgreementDownloadView | null = await this.load(agreementId, userId);
    if (!agreement) {
      throw new PdfPreviewError(
        "RENT_AGREEMENT_NOT_FOUND",
        `Agreement '${agreementId}' not found for user '${userId}'`
      );
    }

    // Mirror the download guards: a refunded/expired agreement is not viewable.
    if (agreement.status === "refunded") {
      throw new PdfPreviewError("RENT_AGREEMENT_REFUNDED", "Agreement has been refunded");
    }

    const now = this.clock();
    if (
      agreement.status === "expired" ||
      (agreement.expires_at !== null && agreement.expires_at.getTime() <= now.getTime())
    ) {
      throw new PdfPreviewError("RENT_AGREEMENT_EXPIRED", "Agreement preview window has expired");
    }

    if (agreement.status !== "generated" || !agreement.pdf_blob_path) {
      throw new PdfPreviewError(
        "RENT_AGREEMENT_PDF_NOT_READY",
        `Agreement PDF is not yet generated (status='${agreement.status}')`
      );
    }

    const bytes = await this.loadBytes(agreement.pdf_blob_path);
    if (!bytes) {
      throw new PdfPreviewError(
        "RENT_AGREEMENT_PDF_NOT_READY",
        `PDF blob '${agreement.pdf_blob_path}' not found in storage`
      );
    }

    return bytes;
  }
}
