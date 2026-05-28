import { describe, expect, it } from "vitest";

import { InMemoryPdfJobRepository } from "../../pdf/pdf-job.repository";

const AGREEMENT_A = "agr-a";
const MAX = 5;

function makeRepo(
  now: Date,
  uuidSeq = (() => {
    let n = 0;
    return () => `job-${++n}`;
  })()
) {
  return { repo: new InMemoryPdfJobRepository({ uuid: uuidSeq }), now };
}

describe("InMemoryPdfJobRepository", () => {
  it("enqueue inserts a pending job", async () => {
    const now = new Date("2026-05-21T09:00:00Z");
    const { repo } = makeRepo(now);
    const result = await repo.enqueue({ agreementId: AGREEMENT_A, now, maxAttempts: MAX });
    expect(result.alreadyEnqueued).toBe(false);
    const job = await repo.getById(result.jobId);
    expect(job?.status).toBe("pending");
    expect(job?.attempts).toBe(0);
  });

  it("enqueue dedupes while a pending job exists", async () => {
    const now = new Date("2026-05-21T09:00:00Z");
    const { repo } = makeRepo(now);
    const first = await repo.enqueue({ agreementId: AGREEMENT_A, now, maxAttempts: MAX });
    const second = await repo.enqueue({ agreementId: AGREEMENT_A, now, maxAttempts: MAX });
    expect(second.alreadyEnqueued).toBe(true);
    expect(second.jobId).toBe(first.jobId);
  });

  it("dequeue claims the pending job and marks it processing", async () => {
    const now = new Date("2026-05-21T09:00:00Z");
    const { repo } = makeRepo(now);
    await repo.enqueue({ agreementId: AGREEMENT_A, now, maxAttempts: MAX });
    const job = await repo.dequeue({ now, maxAttempts: MAX, lockMs: 120000 });
    expect(job?.status).toBe("processing");
    expect(job?.attempts).toBe(1);
    expect(job?.locked_until?.getTime()).toBe(now.getTime() + 120000);
  });

  it("dequeue returns null while a job is locked", async () => {
    const now = new Date("2026-05-21T09:00:00Z");
    const { repo } = makeRepo(now);
    await repo.enqueue({ agreementId: AGREEMENT_A, now, maxAttempts: MAX });
    await repo.dequeue({ now, maxAttempts: MAX, lockMs: 120000 });
    const again = await repo.dequeue({ now, maxAttempts: MAX, lockMs: 120000 });
    expect(again).toBeNull();
  });

  it("dequeue re-claims a job once its lock has expired", async () => {
    const now = new Date("2026-05-21T09:00:00Z");
    const { repo } = makeRepo(now);
    await repo.enqueue({ agreementId: AGREEMENT_A, now, maxAttempts: MAX });
    await repo.dequeue({ now, maxAttempts: MAX, lockMs: 120000 });
    const later = new Date(now.getTime() + 200000);
    const reclaimed = await repo.dequeue({ now: later, maxAttempts: MAX, lockMs: 120000 });
    expect(reclaimed?.attempts).toBe(2);
  });

  it("dequeue returns null when the queue is empty", async () => {
    const now = new Date("2026-05-21T09:00:00Z");
    const { repo } = makeRepo(now);
    expect(await repo.dequeue({ now, maxAttempts: MAX, lockMs: 120000 })).toBeNull();
  });

  it("markDone transitions the job to done", async () => {
    const now = new Date("2026-05-21T09:00:00Z");
    const { repo } = makeRepo(now);
    const { jobId } = await repo.enqueue({ agreementId: AGREEMENT_A, now, maxAttempts: MAX });
    await repo.dequeue({ now, maxAttempts: MAX, lockMs: 120000 });
    await repo.markDone(jobId, now);
    const job = await repo.getById(jobId);
    expect(job?.status).toBe("done");
    expect(job?.finished_at?.getTime()).toBe(now.getTime());
  });

  it("markFailed sets status, last_error and locked_until", async () => {
    const now = new Date("2026-05-21T09:00:00Z");
    const { repo } = makeRepo(now);
    const { jobId } = await repo.enqueue({ agreementId: AGREEMENT_A, now, maxAttempts: MAX });
    await repo.dequeue({ now, maxAttempts: MAX, lockMs: 120000 });
    const lockedUntil = new Date(now.getTime() + 60000);
    await repo.markFailed(jobId, "boom", lockedUntil);
    const job = await repo.getById(jobId);
    expect(job?.status).toBe("failed");
    expect(job?.last_error).toBe("boom");
    expect(job?.locked_until?.getTime()).toBe(lockedUntil.getTime());
  });

  it("getById returns null for an unknown id", async () => {
    const now = new Date("2026-05-21T09:00:00Z");
    const { repo } = makeRepo(now);
    expect(await repo.getById("nope")).toBeNull();
  });

  it("countByStatus tallies jobs", async () => {
    const now = new Date("2026-05-21T09:00:00Z");
    const { repo } = makeRepo(now);
    await repo.enqueue({ agreementId: "a1", now, maxAttempts: MAX });
    const second = await repo.enqueue({ agreementId: "a2", now, maxAttempts: MAX });
    await repo.dequeue({ now, maxAttempts: MAX, lockMs: 120000 });
    await repo.markDone(second.jobId, now);
    const counts = await repo.countByStatus();
    expect(counts.done).toBe(1);
    expect(counts.processing + counts.pending).toBe(1);
  });
});
