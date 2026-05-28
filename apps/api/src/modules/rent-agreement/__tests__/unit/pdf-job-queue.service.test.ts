import { beforeEach, describe, expect, it, vi } from "vitest";

import { PdfJobQueueService, PdfQueueError } from "../../pdf/pdf-job-queue.service";

const AGREEMENT_A = "11111111-1111-1111-1111-111111111111";
const AGREEMENT_B = "22222222-2222-2222-2222-222222222222";

const ANCHOR = new Date("2026-05-18T12:00:00Z").getTime();

function makeQueue(overrides: Partial<ConstructorParameters<typeof PdfJobQueueService>[0]> = {}) {
  let now = ANCHOR;
  let counter = 0;
  return {
    queue: new PdfJobQueueService({
      clock: () => new Date(now),
      uuid: () => `job-${++counter}`,
      ...overrides
    }),
    advanceMs: (ms: number) => {
      now += ms;
    },
    setNow: (ts: number) => {
      now = ts;
    }
  };
}

/* ─── enqueue ────────────────────────────────────────────────────────── */

describe("PdfJobQueueService.enqueue", () => {
  it("returns { jobId, alreadyEnqueued:false } for a fresh agreement", async () => {
    const { queue } = makeQueue();
    const r = await queue.enqueue({ agreementId: AGREEMENT_A });
    expect(r.jobId).toBe("job-1");
    expect(r.alreadyEnqueued).toBe(false);
  });

  it("created job has status='pending', attempts=0, locked_until=null", async () => {
    const { queue } = makeQueue();
    const r = await queue.enqueue({ agreementId: AGREEMENT_A });
    const job = (await queue.findByAgreementId(AGREEMENT_A)).find((j) => j.id === r.jobId);
    expect(job?.status).toBe("pending");
    expect(job?.attempts).toBe(0);
    expect(job?.locked_until).toBeNull();
  });

  it("returns existing jobId + alreadyEnqueued:true when a pending job already exists", async () => {
    const { queue } = makeQueue();
    const a = await queue.enqueue({ agreementId: AGREEMENT_A });
    const b = await queue.enqueue({ agreementId: AGREEMENT_A });
    expect(b.jobId).toBe(a.jobId);
    expect(b.alreadyEnqueued).toBe(true);
  });

  it("returns existing jobId + alreadyEnqueued:true when a processing job exists", async () => {
    const { queue } = makeQueue();
    const a = await queue.enqueue({ agreementId: AGREEMENT_A });
    await queue.dequeueNext(); // marks processing
    const b = await queue.enqueue({ agreementId: AGREEMENT_A });
    expect(b.jobId).toBe(a.jobId);
    expect(b.alreadyEnqueued).toBe(true);
  });

  it("returns a NEW jobId for the same agreement when previous job is done (regenerate)", async () => {
    const { queue } = makeQueue();
    const a = await queue.enqueue({ agreementId: AGREEMENT_A });
    const dequeued = await queue.dequeueNext();
    await queue.markDone(dequeued!.id);
    const b = await queue.enqueue({ agreementId: AGREEMENT_A });
    expect(b.jobId).not.toBe(a.jobId);
    expect(b.alreadyEnqueued).toBe(false);
  });

  it("returns existing jobId when previous job is failed AND attempts < 5", async () => {
    const { queue } = makeQueue();
    const a = await queue.enqueue({ agreementId: AGREEMENT_A });
    const dequeued = await queue.dequeueNext();
    await queue.markFailed(dequeued!.id, "boom");
    const b = await queue.enqueue({ agreementId: AGREEMENT_A });
    expect(b.jobId).toBe(a.jobId);
    expect(b.alreadyEnqueued).toBe(true);
  });
});

/* ─── dequeueNext ────────────────────────────────────────────────────── */

describe("PdfJobQueueService.dequeueNext", () => {
  it("returns null when queue is empty", async () => {
    const { queue } = makeQueue();
    expect(await queue.dequeueNext()).toBeNull();
  });

  it("returns null when only done jobs exist", async () => {
    const { queue } = makeQueue();
    await queue.enqueue({ agreementId: AGREEMENT_A });
    const d = await queue.dequeueNext();
    await queue.markDone(d!.id);
    expect(await queue.dequeueNext()).toBeNull();
  });

  it("returns null when only processing jobs (locked_until in future) exist", async () => {
    const { queue } = makeQueue();
    await queue.enqueue({ agreementId: AGREEMENT_A });
    await queue.dequeueNext(); // → processing, locked_until = now+2m
    expect(await queue.dequeueNext()).toBeNull();
  });

  it("picks pending job with earliest created_at when multiple eligible", async () => {
    const { queue, advanceMs } = makeQueue();
    const a = await queue.enqueue({ agreementId: AGREEMENT_A });
    advanceMs(1000);
    await queue.enqueue({ agreementId: AGREEMENT_B });
    const picked = await queue.dequeueNext();
    expect(picked?.id).toBe(a.jobId);
  });

  it("picks failed job whose locked_until < now() and attempts < 5", async () => {
    const { queue, advanceMs } = makeQueue();
    await queue.enqueue({ agreementId: AGREEMENT_A });
    const d = await queue.dequeueNext();
    await queue.markFailed(d!.id, "transient"); // attempts=1, locked_until = now+1m
    advanceMs(70_000); // past 1m lock
    const picked = await queue.dequeueNext();
    expect(picked?.id).toBe(d!.id);
    expect(picked?.attempts).toBe(2);
  });

  it("SKIPS failed job whose attempts >= 5", async () => {
    const { queue, advanceMs } = makeQueue();
    await queue.enqueue({ agreementId: AGREEMENT_A });
    for (let i = 0; i < 5; i++) {
      const d = await queue.dequeueNext();
      await queue.markFailed(d!.id, `fail-${i}`);
      advanceMs(7 * 60 * 60 * 1000); // jump past max backoff
    }
    expect(await queue.dequeueNext()).toBeNull();
  });

  it("dequeue side effects: status='processing', locked_until=now+2m, attempts++, started_at=now", async () => {
    const { queue } = makeQueue();
    await queue.enqueue({ agreementId: AGREEMENT_A });
    const picked = await queue.dequeueNext();
    expect(picked?.status).toBe("processing");
    expect(picked?.attempts).toBe(1);
    expect(picked?.started_at).toBeInstanceOf(Date);
    const expectedLockUntil = ANCHOR + 2 * 60 * 1000;
    expect(picked?.locked_until?.getTime()).toBe(expectedLockUntil);
  });

  it("two consecutive dequeues return different jobs (mimics SKIP LOCKED)", async () => {
    const { queue, advanceMs } = makeQueue();
    await queue.enqueue({ agreementId: AGREEMENT_A });
    advanceMs(1000);
    await queue.enqueue({ agreementId: AGREEMENT_B });
    const first = await queue.dequeueNext();
    const second = await queue.dequeueNext();
    expect(first?.id).not.toBe(second?.id);
    expect(second).not.toBeNull();
  });
});

/* ─── markDone ───────────────────────────────────────────────────────── */

describe("PdfJobQueueService.markDone", () => {
  it("flips status='done' + finished_at=now", async () => {
    const { queue, advanceMs } = makeQueue();
    await queue.enqueue({ agreementId: AGREEMENT_A });
    const d = await queue.dequeueNext();
    advanceMs(500);
    await queue.markDone(d!.id);
    const job = (await queue.findByAgreementId(AGREEMENT_A))[0];
    expect(job.status).toBe("done");
    expect(job.finished_at?.getTime()).toBe(ANCHOR + 500);
  });

  it("second markDone call is idempotent (no throw, no state change)", async () => {
    const { queue, advanceMs } = makeQueue();
    await queue.enqueue({ agreementId: AGREEMENT_A });
    const d = await queue.dequeueNext();
    advanceMs(500);
    await queue.markDone(d!.id);
    advanceMs(500);
    await expect(queue.markDone(d!.id)).resolves.toBeUndefined();
    const job = (await queue.findByAgreementId(AGREEMENT_A))[0];
    expect(job.finished_at?.getTime()).toBe(ANCHOR + 500); // unchanged
  });

  it("throws RENT_AGREEMENT_PDF_JOB_NOT_FOUND for unknown id", async () => {
    const { queue } = makeQueue();
    await expect(queue.markDone("missing")).rejects.toMatchObject({
      code: "RENT_AGREEMENT_PDF_JOB_NOT_FOUND"
    });
  });
});

/* ─── markFailed ─────────────────────────────────────────────────────── */

describe("PdfJobQueueService.markFailed", () => {
  it("sets status='failed', last_error=message", async () => {
    const { queue } = makeQueue();
    await queue.enqueue({ agreementId: AGREEMENT_A });
    const d = await queue.dequeueNext();
    await queue.markFailed(d!.id, "render timeout");
    const job = (await queue.findByAgreementId(AGREEMENT_A))[0];
    expect(job.status).toBe("failed");
    expect(job.last_error).toBe("render timeout");
  });

  it("backoff schedule attempts=1→+1m", async () => {
    const { queue } = makeQueue();
    await queue.enqueue({ agreementId: AGREEMENT_A });
    const d = await queue.dequeueNext(); // attempts=1
    await queue.markFailed(d!.id, "x");
    const job = (await queue.findByAgreementId(AGREEMENT_A))[0];
    expect(job.locked_until?.getTime()).toBe(ANCHOR + 1 * 60 * 1000);
  });

  it("backoff schedule attempts=2→+5m", async () => {
    const { queue, advanceMs } = makeQueue();
    await queue.enqueue({ agreementId: AGREEMENT_A });
    await queue.markFailed((await queue.dequeueNext())!.id, "x"); // attempts=1
    advanceMs(2 * 60 * 1000);
    await queue.markFailed((await queue.dequeueNext())!.id, "x"); // attempts=2
    const job = (await queue.findByAgreementId(AGREEMENT_A))[0];
    expect(job.locked_until?.getTime()).toBe(ANCHOR + 2 * 60 * 1000 + 5 * 60 * 1000);
  });

  it("backoff schedule attempts=3→+30m", async () => {
    const { queue, advanceMs } = makeQueue();
    await queue.enqueue({ agreementId: AGREEMENT_A });
    await queue.markFailed((await queue.dequeueNext())!.id, "x"); // 1
    advanceMs(2 * 60 * 1000);
    await queue.markFailed((await queue.dequeueNext())!.id, "x"); // 2
    advanceMs(6 * 60 * 1000);
    await queue.markFailed((await queue.dequeueNext())!.id, "x"); // 3
    const lockedAt = ANCHOR + 2 * 60 * 1000 + 6 * 60 * 1000;
    const job = (await queue.findByAgreementId(AGREEMENT_A))[0];
    expect(job.locked_until?.getTime()).toBe(lockedAt + 30 * 60 * 1000);
  });

  it("backoff schedule attempts=4→+2h", async () => {
    const { queue, advanceMs } = makeQueue();
    await queue.enqueue({ agreementId: AGREEMENT_A });
    await queue.markFailed((await queue.dequeueNext())!.id, "x"); // 1
    advanceMs(2 * 60 * 1000);
    await queue.markFailed((await queue.dequeueNext())!.id, "x"); // 2
    advanceMs(6 * 60 * 1000);
    await queue.markFailed((await queue.dequeueNext())!.id, "x"); // 3
    advanceMs(31 * 60 * 1000);
    await queue.markFailed((await queue.dequeueNext())!.id, "x"); // 4
    const lockedAt = ANCHOR + 2 * 60 * 1000 + 6 * 60 * 1000 + 31 * 60 * 1000;
    const job = (await queue.findByAgreementId(AGREEMENT_A))[0];
    expect(job.locked_until?.getTime()).toBe(lockedAt + 2 * 60 * 60 * 1000);
  });

  it("backoff schedule attempts=5→+6h", async () => {
    const { queue, advanceMs } = makeQueue();
    await queue.enqueue({ agreementId: AGREEMENT_A });
    await queue.markFailed((await queue.dequeueNext())!.id, "x"); // 1
    advanceMs(2 * 60 * 1000);
    await queue.markFailed((await queue.dequeueNext())!.id, "x"); // 2
    advanceMs(6 * 60 * 1000);
    await queue.markFailed((await queue.dequeueNext())!.id, "x"); // 3
    advanceMs(31 * 60 * 1000);
    await queue.markFailed((await queue.dequeueNext())!.id, "x"); // 4
    advanceMs(125 * 60 * 1000);
    await queue.markFailed((await queue.dequeueNext())!.id, "x"); // 5
    const lockedAt = ANCHOR + 2 * 60 * 1000 + 6 * 60 * 1000 + 31 * 60 * 1000 + 125 * 60 * 1000;
    const job = (await queue.findByAgreementId(AGREEMENT_A))[0];
    expect(job.locked_until?.getTime()).toBe(lockedAt + 6 * 60 * 60 * 1000);
  });

  it("after 5th failure, status stays 'failed' and worker dequeue skips it", async () => {
    const { queue, advanceMs } = makeQueue();
    await queue.enqueue({ agreementId: AGREEMENT_A });
    for (let i = 0; i < 5; i++) {
      await queue.markFailed((await queue.dequeueNext())!.id, `f${i}`);
      advanceMs(7 * 60 * 60 * 1000);
    }
    const job = (await queue.findByAgreementId(AGREEMENT_A))[0];
    expect(job.status).toBe("failed");
    expect(job.attempts).toBe(5);
    expect(await queue.dequeueNext()).toBeNull();
  });

  it("throws RENT_AGREEMENT_PDF_JOB_NOT_FOUND for unknown id", async () => {
    const { queue } = makeQueue();
    await expect(queue.markFailed("missing", "x")).rejects.toMatchObject({
      code: "RENT_AGREEMENT_PDF_JOB_NOT_FOUND"
    });
  });
});

/* ─── findByAgreementId + countByStatus ──────────────────────────────── */

describe("PdfJobQueueService.findByAgreementId", () => {
  it("returns empty array for unknown agreement", async () => {
    const { queue } = makeQueue();
    expect(await queue.findByAgreementId("nope")).toEqual([]);
  });

  it("returns all jobs for an agreement (including regenerate history)", async () => {
    const { queue } = makeQueue();
    await queue.enqueue({ agreementId: AGREEMENT_A });
    await queue.markDone((await queue.dequeueNext())!.id);
    await queue.enqueue({ agreementId: AGREEMENT_A });
    await queue.markDone((await queue.dequeueNext())!.id);
    expect(await queue.findByAgreementId(AGREEMENT_A)).toHaveLength(2);
  });
});

describe("PdfJobQueueService.countByStatus", () => {
  it("returns counts for each enum value", async () => {
    const { queue, advanceMs } = makeQueue();
    await queue.enqueue({ agreementId: AGREEMENT_A });
    await queue.enqueue({ agreementId: AGREEMENT_B });
    await queue.markDone((await queue.dequeueNext())!.id);
    advanceMs(1000);
    await queue.markFailed((await queue.dequeueNext())!.id, "x");
    const c = await queue.countByStatus();
    expect(c).toEqual({ pending: 0, processing: 0, done: 1, failed: 1 });
  });
});

/* ─── Error shape ────────────────────────────────────────────────────── */

describe("PdfQueueError", () => {
  it("is an Error subclass with name 'PdfQueueError' + string code", async () => {
    const { queue } = makeQueue();
    try {
      await queue.markDone("missing");
    } catch (err) {
      expect(err).toBeInstanceOf(PdfQueueError);
      expect((err as PdfQueueError).name).toBe("PdfQueueError");
      expect(typeof (err as PdfQueueError).code).toBe("string");
      return;
    }
    throw new Error("expected throw");
  });
});

/* keep vi referenced so eslint/imports don't complain */
void vi;
beforeEach(() => undefined);
