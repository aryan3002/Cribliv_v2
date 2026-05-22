// Real Azure Blob Storage adapter implementing PdfStoragePort.
// Phase 8b. Uploads rendered PDFs to Azure Blob Storage.
//
// Blob path convention: <yyyy>/<mm>/<agreement_id>.pdf in container
// RENT_AGREEMENT_AZURE_CONTAINER (default "rent-agreements").
// Content-type: application/pdf; content-disposition: attachment.
//
// Reference pattern: apps/api/src/modules/owner/azure-blob-photo-storage.service.ts
// Spec: [[PDF-Pipeline]] §PDF worker step 2

import { BlobServiceClient } from "@azure/storage-blob";
import type { PdfStoragePort, PdfStorageUploadResult } from "./pdf-storage.port";

interface AzurePdfStorageDeps {
  connectionString: string;
  containerName: string;
  clock?: () => Date;
}

export class AzurePdfStorage implements PdfStoragePort {
  private readonly connectionString: string;
  private readonly containerName: string;
  private readonly clock: () => Date;

  constructor(deps: AzurePdfStorageDeps) {
    this.connectionString = deps.connectionString;
    this.containerName = deps.containerName;
    this.clock = deps.clock ?? (() => new Date());
  }

  async upload(
    buffer: Buffer,
    agreementId: string,
    _locale: string
  ): Promise<PdfStorageUploadResult> {
    const now = this.clock();
    const yyyy = String(now.getUTCFullYear());
    const mm = String(now.getUTCMonth() + 1).padStart(2, "0");
    const blobPath = `${yyyy}/${mm}/${agreementId}.pdf`;

    const blobServiceClient = BlobServiceClient.fromConnectionString(this.connectionString);
    const containerClient = blobServiceClient.getContainerClient(this.containerName);
    // The container must exist before the first upload — create it on demand.
    await containerClient.createIfNotExists();
    const blockBlobClient = containerClient.getBlockBlobClient(blobPath);

    await blockBlobClient.upload(buffer, buffer.length, {
      blobHTTPHeaders: {
        blobContentType: "application/pdf",
        blobContentDisposition: "attachment"
      }
    });

    return { blobPath };
  }

  async download(blobPath: string): Promise<Buffer | null> {
    const blobServiceClient = BlobServiceClient.fromConnectionString(this.connectionString);
    const containerClient = blobServiceClient.getContainerClient(this.containerName);
    const blockBlobClient = containerClient.getBlockBlobClient(blobPath);
    try {
      return await blockBlobClient.downloadToBuffer();
    } catch (err) {
      if ((err as { statusCode?: number }).statusCode === 404) return null;
      throw err;
    }
  }
}
