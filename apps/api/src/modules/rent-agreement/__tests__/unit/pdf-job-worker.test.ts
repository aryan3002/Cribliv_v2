import { beforeEach, describe, expect, it, vi } from "vitest";

import { InMemoryPdfRenderer } from "../../pdf/in-memory-pdf-renderer";
import { InMemoryPdfStorage } from "../../pdf/in-memory-pdf-storage";
import { PdfJobQueueService } from "../../pdf/pdf-job-queue.service";
import { PdfJobWorker } from "../../pdf/pdf-job-worker";
import type { RentAgreementRow } from "../../drafts/draft-summary.mapper";

const AGREEMENT_A = "11111111-1111-1111-1111-111111111111";
const AGREEMENT_B = "22222222-2222-2222-2222-222222222222";
const ANCHOR = new Date("2026-05-18T12:00:00Z").getTime();

function fakeRow(id: string, locale = "en"): RentAgreementRow {
  return {
    id,
    user_id: "u",
    plan_id: "premium",
    locale,
    state_code: "KA"
  } as unknown as RentAgreementRow;
}

function makeWorld(overrides: { loadAgreement?: (id: string) => RentAgreementRow | null } = {}) {
  let now = ANCHOR;
  let counter = 0;
  const queue = new PdfJobQueueService({
    clock: () => new Date(now),
    uuid: () => `job-${++counter}`
  });
  const renderer = new InMemoryPdfRenderer();
  const storage = new InMemoryPdfStorage({ clock: () => new Date(now) });
  const loadAgreement = overrides.loadAgreement ?? ((id: string) => fakeRow(id));
  const loadAgreementForRender = vi.fn(async (agreementId: string) => {
    const row = loadAgreement(agreementId);
    if (!row) return null;
    return { row, signatures: [] };
  });
  const onAgreementGenerated = vi.fn(async () => undefined);

  const worker = new PdfJobWorker({
    queue,
    renderer,
    storage,
    loadAgreementForRender,
    onAgreementGenerated,
    clock: () => new Date(now)
  });

  return {
    queue,
    renderer,
    storage,
    loadAgreementForRender,
    onAgreementGenerated,
    worker,
    advanceMs: (ms: number) => {
      now += ms;
    }
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

/* ─── Happy path ──────────────────────────────────────────────────────── */

describe("PdfJobWorker.tick: happy path", () => {
  it("dequeues, renders, uploads, marks done, invokes onAgreementGenerated, returns { processed: 1 }", async () => {
    const { queue, renderer, storage, onAgreementGenerated, worker } = makeWorld();
    queue.enqueue({ agreementId: AGREEMENT_A });
    const result = await worker.tick();
    expect(result).toEqual({ processed: 1 });
    expect(renderer.callCount).toBe(1);
    expect(storage.uploadCount).toBe(1);
    expect(onAgreementGenerated).toHaveBeenCalledTimes(1);
  });

  it("onAgreementGenerated receives { agreementId, blobPath, locale } with the exact blobPath returned by storage", async () => {
    const { queue, storage, onAgreementGenerated, worker } = makeWorld();
    queue.enqueue({ agreementId: AGREEMENT_A });
    await worker.tick();
    const expectedPath = `2026/05/${AGREEMENT_A}.pdf`;
    expect(onAgreementGenerated).toHaveBeenCalledWith({
      agreementId: AGREEMENT_A,
      blobPath: expectedPath,
      locale: "en"
    });
    expect(storage.get(expectedPath)).toBeDefined();
  });

  it("after happy tick the job status is 'done'", async () => {
    const { queue, worker } = makeWorld();
    queue.enqueue({ agreementId: AGREEMENT_A });
    await worker.tick();
    const job = queue.findByAgreementId(AGREEMENT_A)[0];
    expect(job.status).toBe("done");
  });
});

/* ─── No work ─────────────────────────────────────────────────────────── */

describe("PdfJobWorker.tick: no eligible jobs", () => {
  it("returns { processed: 0 } without calling renderer / storage / callback", async () => {
    const { renderer, storage, onAgreementGenerated, worker } = makeWorld();
    const r = await worker.tick();
    expect(r).toEqual({ processed: 0 });
    expect(renderer.callCount).toBe(0);
    expect(storage.uploadCount).toBe(0);
    expect(onAgreementGenerated).not.toHaveBeenCalled();
  });
});

/* ─── Failures ────────────────────────────────────────────────────────── */

describe("PdfJobWorker.tick: renderer failure", () => {
  it("marks job failed, does NOT call storage/callback, returns { processed: 0, error }", async () => {
    const { queue, storage, onAgreementGenerated, worker } = makeWorld();
    const renderer = worker as unknown as { renderer: InMemoryPdfRenderer };
    vi.spyOn(renderer.renderer, "render").mockRejectedValueOnce(new Error("render boom"));
    queue.enqueue({ agreementId: AGREEMENT_A });
    const r = await worker.tick();
    expect(r.processed).toBe(0);
    expect((r as { error?: string }).error).toContain("render boom");
    expect(storage.uploadCount).toBe(0);
    expect(onAgreementGenerated).not.toHaveBeenCalled();
    const job = queue.findByAgreementId(AGREEMENT_A)[0];
    expect(job.status).toBe("failed");
    expect(job.attempts).toBe(1);
  });
});

describe("PdfJobWorker.tick: storage failure (after render succeeds)", () => {
  it("marks job failed, does NOT call callback, returns { processed: 0, error }", async () => {
    const { queue, storage, onAgreementGenerated, worker } = makeWorld();
    vi.spyOn(storage, "upload").mockRejectedValueOnce(new Error("storage boom"));
    queue.enqueue({ agreementId: AGREEMENT_A });
    const r = await worker.tick();
    expect(r.processed).toBe(0);
    expect((r as { error?: string }).error).toContain("storage boom");
    expect(onAgreementGenerated).not.toHaveBeenCalled();
    const job = queue.findByAgreementId(AGREEMENT_A)[0];
    expect(job.status).toBe("failed");
  });
});

describe("PdfJobWorker.tick: loadAgreementForRender returns null", () => {
  it("marks job failed with agreement_not_found, does NOT call renderer", async () => {
    const { queue, renderer, worker } = makeWorld({ loadAgreement: () => null });
    queue.enqueue({ agreementId: AGREEMENT_A });
    const r = await worker.tick();
    expect(r.processed).toBe(0);
    expect((r as { error?: string }).error).toContain("agreement_not_found");
    expect(renderer.callCount).toBe(0);
    const job = queue.findByAgreementId(AGREEMENT_A)[0];
    expect(job.status).toBe("failed");
    expect(job.last_error).toContain("agreement_not_found");
  });
});

/* ─── Stuck lock recovery ─────────────────────────────────────────────── */

describe("PdfJobWorker.tick: stuck lock recovery", () => {
  it("a job whose locked_until has passed is picked up on next tick (attempts incremented)", async () => {
    const { queue, advanceMs, worker } = makeWorld();
    queue.enqueue({ agreementId: AGREEMENT_A });
    // First tick: simulate hang by spying on renderer to throw, then advance clock past lock
    const renderer = (worker as unknown as { renderer: InMemoryPdfRenderer }).renderer;
    vi.spyOn(renderer, "render").mockRejectedValueOnce(new Error("first hang"));
    await worker.tick();
    let job = queue.findByAgreementId(AGREEMENT_A)[0];
    expect(job.attempts).toBe(1);
    expect(job.status).toBe("failed");
    advanceMs(2 * 60 * 1000); // past 1m backoff
    await worker.tick();
    job = queue.findByAgreementId(AGREEMENT_A)[0];
    expect(job.status).toBe("done");
    expect(job.attempts).toBe(2);
  });
});

/* ─── Retry cap ───────────────────────────────────────────────────────── */

describe("PdfJobWorker.tick: 5-attempt cap", () => {
  it("after 5 consecutive failures the job stays failed and subsequent ticks return processed:0", async () => {
    const { queue, advanceMs, worker } = makeWorld();
    const renderer = (worker as unknown as { renderer: InMemoryPdfRenderer }).renderer;
    vi.spyOn(renderer, "render").mockRejectedValue(new Error("always-fails"));
    queue.enqueue({ agreementId: AGREEMENT_A });
    for (let i = 0; i < 5; i++) {
      await worker.tick();
      advanceMs(7 * 60 * 60 * 1000); // jump past max backoff
    }
    const job = queue.findByAgreementId(AGREEMENT_A)[0];
    expect(job.status).toBe("failed");
    expect(job.attempts).toBe(5);
    const r = await worker.tick();
    expect(r).toEqual({ processed: 0 });
  });
});

/* ─── onAgreementGenerated error semantics (Decision A) ─────────────── */

describe("PdfJobWorker.tick: onAgreementGenerated throws", () => {
  it("queue.markDone has already been called and the callback error propagates from tick", async () => {
    const { queue, onAgreementGenerated, worker } = makeWorld();
    onAgreementGenerated.mockRejectedValueOnce(new Error("db down"));
    queue.enqueue({ agreementId: AGREEMENT_A });
    await expect(worker.tick()).rejects.toThrow("db down");
    const job = queue.findByAgreementId(AGREEMENT_A)[0];
    expect(job.status).toBe("done");
  });
});

/* ─── Multiple agreements + ordering ─────────────────────────────────── */

describe("PdfJobWorker.tick: two enqueues, two ticks", () => {
  it("processes earliest-created first, single-shot per tick", async () => {
    const { queue, advanceMs, worker, onAgreementGenerated } = makeWorld();
    queue.enqueue({ agreementId: AGREEMENT_A });
    advanceMs(1000);
    queue.enqueue({ agreementId: AGREEMENT_B });
    await worker.tick();
    expect(onAgreementGenerated).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ agreementId: AGREEMENT_A })
    );
    await worker.tick();
    expect(onAgreementGenerated).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ agreementId: AGREEMENT_B })
    );
  });
});

/* ─── Signatures projection passed to renderer ───────────────────────── */

describe("PdfJobWorker.tick: renderer input wiring", () => {
  it("passes row + locale + signatures from loadAgreementForRender into renderer.render", async () => {
    const { queue, worker, loadAgreementForRender } = makeWorld();
    const renderer = (worker as unknown as { renderer: InMemoryPdfRenderer }).renderer;
    const spy = vi.spyOn(renderer, "render");
    queue.enqueue({ agreementId: AGREEMENT_A });
    await worker.tick();
    expect(loadAgreementForRender).toHaveBeenCalledWith(AGREEMENT_A);
    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({
        row: expect.objectContaining({ id: AGREEMENT_A }),
        locale: "en",
        signatures: []
      })
    );
  });
});

/* ─── Regenerate scenario ────────────────────────────────────────────── */

describe("PdfJobWorker.tick: regenerate after done", () => {
  it("an agreement with a done job can be re-enqueued and the new job processes independently", async () => {
    const { queue, worker, onAgreementGenerated } = makeWorld();
    queue.enqueue({ agreementId: AGREEMENT_A });
    await worker.tick();
    queue.enqueue({ agreementId: AGREEMENT_A });
    await worker.tick();
    expect(onAgreementGenerated).toHaveBeenCalledTimes(2);
    expect(queue.findByAgreementId(AGREEMENT_A)).toHaveLength(2);
  });
});

/* ─── tick is single-shot ────────────────────────────────────────────── */

describe("PdfJobWorker.tick: single-shot semantics", () => {
  it("tick processes exactly one job even when many are pending", async () => {
    const { queue, advanceMs, worker } = makeWorld();
    queue.enqueue({ agreementId: AGREEMENT_A });
    advanceMs(1);
    queue.enqueue({ agreementId: AGREEMENT_B });
    advanceMs(1);
    queue.enqueue({ agreementId: "33333333-3333-3333-3333-333333333333" });
    const r = await worker.tick();
    expect(r).toEqual({ processed: 1 });
    expect(queue.countByStatus().pending).toBe(2);
  });
});
