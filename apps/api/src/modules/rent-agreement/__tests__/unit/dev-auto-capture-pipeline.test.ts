import { describe, expect, it, vi } from "vitest";

import { DevAutoCapturePipeline } from "../../payments/dev-auto-capture-pipeline";

function makeDeps(over: Partial<ConstructorParameters<typeof DevAutoCapturePipeline>[0]> = {}) {
  const drafts = { markPaid: vi.fn(async () => {}) };
  const queue = { enqueue: vi.fn(() => ({ jobId: "job-1", alreadyEnqueued: false })) };
  const worker = { tick: vi.fn(async () => ({ processed: 1 as const })) };
  // synchronous schedule for tests — caller resolves the scheduled work in-line
  const schedule = (fn: () => Promise<void> | void) => {
    return Promise.resolve(fn());
  };
  return {
    drafts: drafts as never,
    queue: queue as never,
    worker: worker as never,
    schedule,
    ...over
  };
}

describe("DevAutoCapturePipeline.trigger", () => {
  it("marks the draft as paid", async () => {
    const deps = makeDeps();
    const p = new DevAutoCapturePipeline(deps);
    await p.trigger("agr-1");
    expect(deps.drafts.markPaid).toHaveBeenCalledWith("agr-1");
  });

  it("enqueues a PDF job for the agreement", async () => {
    const deps = makeDeps();
    const p = new DevAutoCapturePipeline(deps);
    await p.trigger("agr-1");
    expect(deps.queue.enqueue).toHaveBeenCalledWith({ agreementId: "agr-1" });
  });

  it("schedules a worker tick after markPaid + enqueue", async () => {
    const deps = makeDeps();
    const p = new DevAutoCapturePipeline(deps);
    await p.trigger("agr-1");
    expect(deps.worker.tick).toHaveBeenCalledTimes(1);
  });

  it("calls markPaid before enqueue (ordering)", async () => {
    const callOrder: string[] = [];
    const deps = makeDeps({
      drafts: {
        markPaid: vi.fn(async () => {
          callOrder.push("markPaid");
        })
      } as never,
      queue: {
        enqueue: vi.fn(() => {
          callOrder.push("enqueue");
          return { jobId: "job-1", alreadyEnqueued: false };
        })
      } as never
    });
    const p = new DevAutoCapturePipeline(deps);
    await p.trigger("agr-1");
    expect(callOrder).toEqual(["markPaid", "enqueue"]);
  });

  it("propagates markPaid failures and does not enqueue", async () => {
    const deps = makeDeps({
      drafts: {
        markPaid: vi.fn(async () => {
          throw new Error("not found");
        })
      } as never
    });
    const p = new DevAutoCapturePipeline(deps);
    await expect(p.trigger("agr-1")).rejects.toThrow("not found");
    expect(deps.queue.enqueue).not.toHaveBeenCalled();
  });

  it("worker tick errors do not propagate to the caller (fire-and-forget)", async () => {
    const deps = makeDeps({
      worker: {
        tick: vi.fn(async () => {
          throw new Error("render boom");
        })
      } as never
    });
    const p = new DevAutoCapturePipeline(deps);
    // trigger resolves successfully because the tick is fire-and-forget
    await expect(p.trigger("agr-1")).resolves.toBeUndefined();
  });
});
