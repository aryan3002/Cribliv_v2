import { describe, it, expect } from "vitest";
import { PdfPreviewService, PdfPreviewError } from "../../pdf/pdf-preview.service";
import type { AgreementDownloadView } from "../../downloads/downloads.service";

const GENERATED: AgreementDownloadView = {
  id: "agr-1",
  user_id: "user-1",
  status: "generated",
  pdf_blob_path: "2026/05/agr-1.pdf",
  download_count: 0,
  max_downloads: 5,
  expires_at: null
};

function make(overrides: {
  agreement?: AgreementDownloadView | null;
  bytes?: Buffer | undefined;
  clock?: () => Date;
}) {
  return new PdfPreviewService({
    loadAgreement: async () => ("agreement" in overrides ? overrides.agreement! : GENERATED),
    loadPdfBytes: async () =>
      "bytes" in overrides ? overrides.bytes : Buffer.from("%PDF-1.4 fake"),
    clock: overrides.clock
  });
}

describe("PdfPreviewService.getPdfBytes", () => {
  it("returns the stored PDF bytes for a generated agreement the caller owns", async () => {
    const bytes = Buffer.from("%PDF-1.4 hello");
    const out = await make({ bytes }).getPdfBytes("agr-1", "user-1");
    expect(out).toBe(bytes);
  });

  it("throws NOT_FOUND when the loader returns null (missing or cross-user)", async () => {
    await expect(make({ agreement: null }).getPdfBytes("agr-x", "user-2")).rejects.toMatchObject({
      code: "RENT_AGREEMENT_NOT_FOUND"
    });
  });

  it("throws PDF_NOT_READY when status is not generated", async () => {
    const svc = make({ agreement: { ...GENERATED, status: "draft", pdf_blob_path: null } });
    await expect(svc.getPdfBytes("agr-1", "user-1")).rejects.toMatchObject({
      code: "RENT_AGREEMENT_PDF_NOT_READY"
    });
  });

  it("throws PDF_NOT_READY when the blob is absent from storage", async () => {
    await expect(make({ bytes: undefined }).getPdfBytes("agr-1", "user-1")).rejects.toMatchObject({
      code: "RENT_AGREEMENT_PDF_NOT_READY"
    });
  });

  it("throws REFUNDED for a refunded agreement", async () => {
    const svc = make({ agreement: { ...GENERATED, status: "refunded" } });
    await expect(svc.getPdfBytes("agr-1", "user-1")).rejects.toMatchObject({
      code: "RENT_AGREEMENT_REFUNDED"
    });
  });

  it("throws EXPIRED once the download window has passed", async () => {
    const svc = make({
      agreement: { ...GENERATED, expires_at: new Date("2020-01-01T00:00:00Z") },
      clock: () => new Date("2026-05-21T00:00:00Z")
    });
    await expect(svc.getPdfBytes("agr-1", "user-1")).rejects.toMatchObject({
      code: "RENT_AGREEMENT_EXPIRED"
    });
  });

  it("raises a typed PdfPreviewError", async () => {
    await make({ agreement: null })
      .getPdfBytes("a", "b")
      .catch((e) => expect(e).toBeInstanceOf(PdfPreviewError));
  });
});
