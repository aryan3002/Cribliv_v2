import type { PdfStoragePort, PdfStorageUploadResult } from "./pdf-storage.port";

// Phase 8a stub. Stores uploaded buffers in a Map for test assertions. Blob path
// matches the real-Azure convention from [[PDF-Pipeline]] §PDF worker step 2:
// `<yyyy>/<mm>/<agreement_id>.pdf` inside container `rent-agreements`. Phase 8b/13
// replaces with the real Azure Blob upload (container=rent-agreements, content-type
// application/pdf, content-disposition attachment).

interface Deps {
  clock?: () => Date;
}

export class InMemoryPdfStorage implements PdfStoragePort {
  private readonly blobs = new Map<string, Buffer>();
  private readonly clock: () => Date;

  constructor(deps: Deps = {}) {
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
    this.blobs.set(blobPath, buffer);
    return { blobPath };
  }

  async download(blobPath: string): Promise<Buffer | null> {
    return this.blobs.get(blobPath) ?? null;
  }

  get(blobPath: string): Buffer | undefined {
    return this.blobs.get(blobPath);
  }

  get uploadCount(): number {
    return this.blobs.size;
  }
}
