// PDF render job queue. Owns the retry policy (MAX_ATTEMPTS, processing lock
// duration, backoff schedule); storage + queue mechanics are delegated to a
// `PdfJobRepository` (in-memory or DB-backed).

import {
  InMemoryPdfJobRepository,
  type EnqueueResult,
  type PdfJobRepository,
  type PdfJobRow,
  type PdfJobStatus
} from "./pdf-job.repository";

export type { EnqueueResult, PdfJobRow, PdfJobStatus } from "./pdf-job.repository";

export interface EnqueueInput {
  agreementId: string;
}

export type PdfQueueErrorCode = "RENT_AGREEMENT_PDF_JOB_NOT_FOUND";

export class PdfQueueError extends Error {
  readonly code: PdfQueueErrorCode;
  constructor(code: PdfQueueErrorCode, message: string) {
    super(message);
    this.name = "PdfQueueError";
    this.code = code;
  }
}

interface Deps {
  clock?: () => Date;
  uuid?: () => string;
  repository?: PdfJobRepository;
}

const MAX_ATTEMPTS = 5;
const PROCESSING_LOCK_MS = 2 * 60 * 1000; // matches spec "locked_until = now() + 2 minutes"

// Backoff schedule keyed by attempts count AFTER the increment (so a freshly-failed
// job with attempts=1 gets the +1m lock, etc.). Spec [[PDF-Pipeline]] §Failure handling.
const BACKOFF_MS: Record<number, number> = {
  1: 1 * 60 * 1000,
  2: 5 * 60 * 1000,
  3: 30 * 60 * 1000,
  4: 2 * 60 * 60 * 1000,
  5: 6 * 60 * 60 * 1000
};

export class PdfJobQueueService {
  private readonly repo: PdfJobRepository;
  private readonly clock: () => Date;

  constructor(deps: Deps = {}) {
    this.repo = deps.repository ?? new InMemoryPdfJobRepository({ uuid: deps.uuid });
    this.clock = deps.clock ?? (() => new Date());
  }

  async enqueue(input: EnqueueInput): Promise<EnqueueResult> {
    return this.repo.enqueue({
      agreementId: input.agreementId,
      now: this.clock(),
      maxAttempts: MAX_ATTEMPTS
    });
  }

  async dequeueNext(): Promise<PdfJobRow | null> {
    return this.repo.dequeue({
      now: this.clock(),
      maxAttempts: MAX_ATTEMPTS,
      lockMs: PROCESSING_LOCK_MS
    });
  }

  async markDone(jobId: string): Promise<void> {
    const job = await this.repo.getById(jobId);
    if (!job) {
      throw new PdfQueueError("RENT_AGREEMENT_PDF_JOB_NOT_FOUND", `PDF job ${jobId} not found`);
    }
    if (job.status === "done") return; // idempotent
    await this.repo.markDone(jobId, this.clock());
  }

  async markFailed(jobId: string, message: string): Promise<void> {
    const job = await this.repo.getById(jobId);
    if (!job) {
      throw new PdfQueueError("RENT_AGREEMENT_PDF_JOB_NOT_FOUND", `PDF job ${jobId} not found`);
    }
    const backoff = BACKOFF_MS[job.attempts] ?? BACKOFF_MS[MAX_ATTEMPTS];
    await this.repo.markFailed(jobId, message, new Date(this.clock().getTime() + backoff));
  }

  async findByAgreementId(agreementId: string): Promise<PdfJobRow[]> {
    return this.repo.findByAgreementId(agreementId);
  }

  async countByStatus(): Promise<Record<PdfJobStatus, number>> {
    return this.repo.countByStatus();
  }
}
