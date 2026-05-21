import { randomUUID } from "node:crypto";

// In-memory PDF job queue for Phase 8a. Mirrors the rent_agreement_pdf_jobs table
// shape from infra/migrations/0024_rent_agreement_v2.sql:232-248. The dequeue
// semantics emulate SQL `SELECT FOR UPDATE SKIP LOCKED` — atomic in JS because the
// runtime is single-threaded. Phase 13 will swap this for a DB-backed repository
// that wraps the same operations in a transaction.

export type PdfJobStatus = "pending" | "processing" | "done" | "failed";

export interface PdfJobRow {
  id: string;
  agreement_id: string;
  status: PdfJobStatus;
  attempts: number;
  last_error: string | null;
  locked_until: Date | null;
  started_at: Date | null;
  finished_at: Date | null;
  created_at: Date;
}

export interface EnqueueInput {
  agreementId: string;
}

export interface EnqueueResult {
  jobId: string;
  alreadyEnqueued: boolean;
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
  private readonly jobs = new Map<string, PdfJobRow>();
  private readonly clock: () => Date;
  private readonly uuid: () => string;

  constructor(deps: Deps = {}) {
    this.clock = deps.clock ?? (() => new Date());
    this.uuid = deps.uuid ?? randomUUID;
  }

  enqueue(input: EnqueueInput): EnqueueResult {
    const existing = this.findActiveJobForAgreement(input.agreementId);
    if (existing) {
      return { jobId: existing.id, alreadyEnqueued: true };
    }
    const id = this.uuid();
    const row: PdfJobRow = {
      id,
      agreement_id: input.agreementId,
      status: "pending",
      attempts: 0,
      last_error: null,
      locked_until: null,
      started_at: null,
      finished_at: null,
      created_at: this.clock()
    };
    this.jobs.set(id, row);
    return { jobId: id, alreadyEnqueued: false };
  }

  // Atomic in JS (single-threaded). Phase 13 swap: wrap in BEGIN/SELECT FOR UPDATE
  // SKIP LOCKED/UPDATE/COMMIT.
  dequeueNext(): PdfJobRow | null {
    const now = this.clock();
    const eligible: PdfJobRow[] = [];
    for (const job of this.jobs.values()) {
      if (job.attempts >= MAX_ATTEMPTS) continue;
      if (job.status === "done") continue;
      if (job.status === "processing") {
        if (job.locked_until && job.locked_until.getTime() > now.getTime()) continue;
      }
      if (job.status === "failed") {
        if (job.locked_until && job.locked_until.getTime() > now.getTime()) continue;
      }
      // status === 'pending' is always eligible
      eligible.push(job);
    }
    if (eligible.length === 0) return null;
    eligible.sort((a, b) => a.created_at.getTime() - b.created_at.getTime());
    const picked = eligible[0];
    picked.status = "processing";
    picked.attempts += 1;
    picked.started_at = now;
    picked.locked_until = new Date(now.getTime() + PROCESSING_LOCK_MS);
    return picked;
  }

  markDone(jobId: string): void {
    const job = this.jobs.get(jobId);
    if (!job) {
      throw new PdfQueueError("RENT_AGREEMENT_PDF_JOB_NOT_FOUND", `PDF job ${jobId} not found`);
    }
    if (job.status === "done") return; // idempotent
    job.status = "done";
    job.finished_at = this.clock();
    job.locked_until = null;
  }

  markFailed(jobId: string, message: string): void {
    const job = this.jobs.get(jobId);
    if (!job) {
      throw new PdfQueueError("RENT_AGREEMENT_PDF_JOB_NOT_FOUND", `PDF job ${jobId} not found`);
    }
    job.status = "failed";
    job.last_error = message;
    const backoff = BACKOFF_MS[job.attempts] ?? BACKOFF_MS[MAX_ATTEMPTS];
    job.locked_until = new Date(this.clock().getTime() + backoff);
  }

  findByAgreementId(agreementId: string): PdfJobRow[] {
    const out: PdfJobRow[] = [];
    for (const job of this.jobs.values()) {
      if (job.agreement_id === agreementId) out.push(job);
    }
    return out;
  }

  countByStatus(): Record<PdfJobStatus, number> {
    const counts: Record<PdfJobStatus, number> = {
      pending: 0,
      processing: 0,
      done: 0,
      failed: 0
    };
    for (const job of this.jobs.values()) {
      counts[job.status] += 1;
    }
    return counts;
  }

  private findActiveJobForAgreement(agreementId: string): PdfJobRow | null {
    for (const job of this.jobs.values()) {
      if (job.agreement_id !== agreementId) continue;
      if (job.status === "done") continue;
      if (job.status === "failed" && job.attempts >= MAX_ATTEMPTS) continue;
      return job;
    }
    return null;
  }
}
