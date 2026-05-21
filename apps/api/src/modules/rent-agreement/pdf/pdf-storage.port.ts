// Storage port. Phase 8a uses in-memory stub; Phase 8b/13 lands the real Azure Blob
// implementation behind this same interface.

export interface PdfStorageUploadResult {
  blobPath: string;
}

export interface PdfStoragePort {
  upload(buffer: Buffer, agreementId: string, locale: string): Promise<PdfStorageUploadResult>;
}
