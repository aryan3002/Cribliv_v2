// Storage port for rendered agreement PDFs. Implementations: `InMemoryPdfStorage`
// (dev / no Azure creds) and `AzurePdfStorage` (Azure Blob).

export interface PdfStorageUploadResult {
  blobPath: string;
}

export interface PdfStoragePort {
  upload(buffer: Buffer, agreementId: string, locale: string): Promise<PdfStorageUploadResult>;
  /** Read raw PDF bytes for a stored blob path. Returns null if the blob is absent. */
  download(blobPath: string): Promise<Buffer | null>;
}
