import type { PdfJobQueueService } from "./pdf-job-queue.service";
import type { PdfRendererPort, SignatureProjection } from "./pdf-renderer.port";
import type { PdfStoragePort } from "./pdf-storage.port";
import type { RentAgreementRow } from "../drafts/draft-summary.mapper";

// Single-shot orchestrator. Phase 13 wires this into apps/api/src/worker/worker.ts
// via setInterval(() => worker.tick(), 30_000). Each tick processes at most one job
// (matches existing worker pattern: small steady throughput, deterministic).
//
// Decision A (from plan): if onAgreementGenerated throws AFTER queue.markDone has
// run, the PDF is already uploaded and the queue thinks the job is done — but the
// agreement row's status hasn't been flipped. The error propagates from tick().
// Phase 13 will wrap markDone + onAgreementGenerated in a single transaction and
// this gap dissolves.

export interface LoadAgreementResult {
  row: RentAgreementRow;
  signatures: SignatureProjection[];
}

export type LoadAgreementForRender = (agreementId: string) => Promise<LoadAgreementResult | null>;

export interface OnAgreementGeneratedInput {
  agreementId: string;
  blobPath: string;
  locale: string;
}

export type OnAgreementGenerated = (input: OnAgreementGeneratedInput) => Promise<void>;

export type TickResult = { processed: 1 } | { processed: 0; error?: string };

interface Deps {
  queue: PdfJobQueueService;
  renderer: PdfRendererPort;
  storage: PdfStoragePort;
  loadAgreementForRender: LoadAgreementForRender;
  onAgreementGenerated: OnAgreementGenerated;
  clock?: () => Date;
}

export class PdfJobWorker {
  private readonly queue: PdfJobQueueService;
  private readonly renderer: PdfRendererPort;
  private readonly storage: PdfStoragePort;
  private readonly loadAgreementForRender: LoadAgreementForRender;
  private readonly onAgreementGenerated: OnAgreementGenerated;

  constructor(deps: Deps) {
    this.queue = deps.queue;
    this.renderer = deps.renderer;
    this.storage = deps.storage;
    this.loadAgreementForRender = deps.loadAgreementForRender;
    this.onAgreementGenerated = deps.onAgreementGenerated;
  }

  async tick(): Promise<TickResult> {
    const job = await this.queue.dequeueNext();
    if (!job) return { processed: 0 };

    let loaded: LoadAgreementResult | null;
    try {
      loaded = await this.loadAgreementForRender(job.agreement_id);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await this.queue.markFailed(job.id, `load_agreement_failed: ${message}`);
      return { processed: 0, error: `load_agreement_failed: ${message}` };
    }
    if (!loaded) {
      await this.queue.markFailed(job.id, "agreement_not_found");
      return { processed: 0, error: "agreement_not_found" };
    }

    let buffer: Buffer;
    try {
      buffer = await this.renderer.render({
        row: loaded.row,
        signatures: loaded.signatures,
        locale: loaded.row.locale
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await this.queue.markFailed(job.id, `render_failed: ${message}`);
      return { processed: 0, error: `render_failed: ${message}` };
    }

    let blobPath: string;
    try {
      const uploaded = await this.storage.upload(buffer, job.agreement_id, loaded.row.locale);
      blobPath = uploaded.blobPath;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await this.queue.markFailed(job.id, `storage_failed: ${message}`);
      return { processed: 0, error: `storage_failed: ${message}` };
    }

    await this.queue.markDone(job.id);
    // Decision A: if this throws, the job is already 'done' in the queue.
    // Phase 13 will move both into a single DB transaction.
    await this.onAgreementGenerated({
      agreementId: job.agreement_id,
      blobPath,
      locale: loaded.row.locale
    });

    return { processed: 1 };
  }
}
