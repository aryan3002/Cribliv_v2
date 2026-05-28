// Storage port for the PDF render job queue. `PdfJobQueueService` owns the policy
// (MAX_ATTEMPTS, lock duration, backoff schedule); the repository owns the queue
// mechanics — dedup on enqueue, atomic claim on dequeue, status transitions.
//
// `DbPdfJobRepository.dequeue` uses a real `SELECT … FOR UPDATE SKIP LOCKED`
// transaction. `InMemoryPdfJobRepository` is atomic by virtue of the
// single-threaded runtime.

import { randomUUID } from "node:crypto";

import type { DatabaseService } from "../../../common/database.service";

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

export interface EnqueueResult {
  jobId: string;
  alreadyEnqueued: boolean;
}

export interface EnqueueOptions {
  agreementId: string;
  now: Date;
  maxAttempts: number;
}

export interface DequeueOptions {
  now: Date;
  maxAttempts: number;
  lockMs: number;
}

export interface PdfJobRepository {
  /** Insert a pending job unless an active (non-terminal) job already exists. */
  enqueue(opts: EnqueueOptions): Promise<EnqueueResult>;
  /** Atomically claim the oldest eligible job and mark it processing. */
  dequeue(opts: DequeueOptions): Promise<PdfJobRow | null>;
  getById(jobId: string): Promise<PdfJobRow | null>;
  markDone(jobId: string, now: Date): Promise<void>;
  markFailed(jobId: string, error: string, lockedUntil: Date): Promise<void>;
  findByAgreementId(agreementId: string): Promise<PdfJobRow[]>;
  countByStatus(): Promise<Record<PdfJobStatus, number>>;
}

function emptyCounts(): Record<PdfJobStatus, number> {
  return { pending: 0, processing: 0, done: 0, failed: 0 };
}

function cloneJob(job: PdfJobRow): PdfJobRow {
  return { ...job };
}

interface InMemoryDeps {
  uuid?: () => string;
}

export class InMemoryPdfJobRepository implements PdfJobRepository {
  private readonly jobs = new Map<string, PdfJobRow>();
  private readonly uuid: () => string;

  constructor(deps: InMemoryDeps = {}) {
    this.uuid = deps.uuid ?? randomUUID;
  }

  private findActive(agreementId: string, maxAttempts: number): PdfJobRow | null {
    for (const job of this.jobs.values()) {
      if (job.agreement_id !== agreementId) continue;
      if (job.status === "done") continue;
      if (job.status === "failed" && job.attempts >= maxAttempts) continue;
      return job;
    }
    return null;
  }

  async enqueue(opts: EnqueueOptions): Promise<EnqueueResult> {
    const existing = this.findActive(opts.agreementId, opts.maxAttempts);
    if (existing) return { jobId: existing.id, alreadyEnqueued: true };
    const id = this.uuid();
    this.jobs.set(id, {
      id,
      agreement_id: opts.agreementId,
      status: "pending",
      attempts: 0,
      last_error: null,
      locked_until: null,
      started_at: null,
      finished_at: null,
      created_at: opts.now
    });
    return { jobId: id, alreadyEnqueued: false };
  }

  async dequeue(opts: DequeueOptions): Promise<PdfJobRow | null> {
    const eligible = Array.from(this.jobs.values()).filter(
      (job) =>
        job.attempts < opts.maxAttempts &&
        job.status !== "done" &&
        (!job.locked_until || job.locked_until.getTime() <= opts.now.getTime())
    );
    if (eligible.length === 0) return null;
    eligible.sort((a, b) => a.created_at.getTime() - b.created_at.getTime());
    const picked = eligible[0];
    picked.status = "processing";
    picked.attempts += 1;
    picked.started_at = opts.now;
    picked.locked_until = new Date(opts.now.getTime() + opts.lockMs);
    return cloneJob(picked);
  }

  async getById(jobId: string): Promise<PdfJobRow | null> {
    const job = this.jobs.get(jobId);
    return job ? cloneJob(job) : null;
  }

  async markDone(jobId: string, now: Date): Promise<void> {
    const job = this.jobs.get(jobId);
    if (!job) return;
    job.status = "done";
    job.finished_at = now;
    job.locked_until = null;
  }

  async markFailed(jobId: string, error: string, lockedUntil: Date): Promise<void> {
    const job = this.jobs.get(jobId);
    if (!job) return;
    job.status = "failed";
    job.last_error = error;
    job.locked_until = lockedUntil;
  }

  async findByAgreementId(agreementId: string): Promise<PdfJobRow[]> {
    return Array.from(this.jobs.values())
      .filter((job) => job.agreement_id === agreementId)
      .map(cloneJob);
  }

  async countByStatus(): Promise<Record<PdfJobStatus, number>> {
    const counts = emptyCounts();
    for (const job of this.jobs.values()) {
      counts[job.status] += 1;
    }
    return counts;
  }
}

function dbRowToJob(row: Record<string, unknown>): PdfJobRow {
  const toDate = (v: unknown): Date | null => (v == null ? null : new Date(v as string));
  return {
    id: String(row.id),
    agreement_id: String(row.agreement_id),
    status: row.status as PdfJobStatus,
    attempts: Number(row.attempts),
    last_error: (row.last_error as string | null) ?? null,
    locked_until: toDate(row.locked_until),
    started_at: toDate(row.started_at),
    finished_at: toDate(row.finished_at),
    created_at: new Date(row.created_at as string)
  };
}

const JOB_COLUMNS =
  "id::text, agreement_id::text, status, attempts, last_error, locked_until, started_at, finished_at, created_at";

export class DbPdfJobRepository implements PdfJobRepository {
  constructor(private readonly db: DatabaseService) {}

  async enqueue(opts: EnqueueOptions): Promise<EnqueueResult> {
    // One round-trip: reuse an active job if present, else insert a pending one.
    const result = await this.db.query<{ id: string; already: boolean }>(
      `WITH existing AS (
         SELECT id FROM rent_agreement_pdf_jobs
         WHERE agreement_id = $1
           AND status <> 'done'
           AND NOT (status = 'failed' AND attempts >= $2)
         LIMIT 1
       ), inserted AS (
         INSERT INTO rent_agreement_pdf_jobs (agreement_id, status, created_at)
         SELECT $1, 'pending', $3
         WHERE NOT EXISTS (SELECT 1 FROM existing)
         RETURNING id
       )
       SELECT id::text, false AS already FROM inserted
       UNION ALL
       SELECT id::text, true AS already FROM existing`,
      [opts.agreementId, opts.maxAttempts, opts.now.toISOString()]
    );
    const row = result.rows[0];
    return { jobId: row.id, alreadyEnqueued: row.already };
  }

  async dequeue(opts: DequeueOptions): Promise<PdfJobRow | null> {
    const client = await this.db.getClient();
    try {
      await client.query("BEGIN");
      const picked = await client.query<{ id: string }>(
        `SELECT id FROM rent_agreement_pdf_jobs
         WHERE status <> 'done'
           AND attempts < $1
           AND (locked_until IS NULL OR locked_until <= $2)
         ORDER BY created_at
         LIMIT 1
         FOR UPDATE SKIP LOCKED`,
        [opts.maxAttempts, opts.now.toISOString()]
      );
      if (picked.rowCount === 0) {
        await client.query("COMMIT");
        return null;
      }
      const lockedUntil = new Date(opts.now.getTime() + opts.lockMs);
      const updated = await client.query(
        `UPDATE rent_agreement_pdf_jobs
         SET status = 'processing',
             attempts = attempts + 1,
             started_at = $2,
             locked_until = $3
         WHERE id = $1
         RETURNING ${JOB_COLUMNS}`,
        [picked.rows[0].id, opts.now.toISOString(), lockedUntil.toISOString()]
      );
      await client.query("COMMIT");
      return dbRowToJob(updated.rows[0]);
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }

  async getById(jobId: string): Promise<PdfJobRow | null> {
    const result = await this.db.query(
      `SELECT ${JOB_COLUMNS} FROM rent_agreement_pdf_jobs WHERE id = $1`,
      [jobId]
    );
    return result.rows[0] ? dbRowToJob(result.rows[0]) : null;
  }

  async markDone(jobId: string, now: Date): Promise<void> {
    await this.db.query(
      `UPDATE rent_agreement_pdf_jobs
       SET status = 'done', finished_at = $2, locked_until = NULL
       WHERE id = $1`,
      [jobId, now.toISOString()]
    );
  }

  async markFailed(jobId: string, error: string, lockedUntil: Date): Promise<void> {
    await this.db.query(
      `UPDATE rent_agreement_pdf_jobs
       SET status = 'failed', last_error = $2, locked_until = $3
       WHERE id = $1`,
      [jobId, error, lockedUntil.toISOString()]
    );
  }

  async findByAgreementId(agreementId: string): Promise<PdfJobRow[]> {
    const result = await this.db.query(
      `SELECT ${JOB_COLUMNS} FROM rent_agreement_pdf_jobs WHERE agreement_id = $1`,
      [agreementId]
    );
    return result.rows.map(dbRowToJob);
  }

  async countByStatus(): Promise<Record<PdfJobStatus, number>> {
    const result = await this.db.query<{ status: PdfJobStatus; count: number }>(
      `SELECT status, count(*)::int AS count FROM rent_agreement_pdf_jobs GROUP BY status`
    );
    const counts = emptyCounts();
    for (const row of result.rows) {
      counts[row.status] = Number(row.count);
    }
    return counts;
  }
}
