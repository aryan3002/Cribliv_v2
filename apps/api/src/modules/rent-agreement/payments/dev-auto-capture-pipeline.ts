// Dev-only orchestrator. When MockPaymentProvider is wired into CheckoutService,
// no real Razorpay webhook ever arrives — so this pipeline simulates the capture:
// markPaid → enqueue PDF job → fire worker tick. The worker's onAgreementGenerated
// callback (wired in the module) finishes the chain with drafts.markGenerated.
//
// trigger() awaits markPaid + enqueue (caller's HTTP response should reflect them)
// but fires the worker tick asynchronously so the HTTP request returns immediately.
// Tick errors are swallowed — they surface via the queue's failed status, not the
// trigger() caller, matching the real-prod behavior where webhook returns 200 OK
// regardless of whether the downstream PDF render succeeds.

export interface DevAutoCapturePipelineDeps {
  drafts: { markPaid(agreementId: string): Promise<void> };
  queue: {
    enqueue(input: { agreementId: string }): Promise<{ jobId: string; alreadyEnqueued: boolean }>;
  };
  worker: { tick(): Promise<{ processed: 0 | 1; error?: string }> };
  schedule?: (fn: () => Promise<void> | void) => unknown;
}

export class DevAutoCapturePipeline {
  private readonly drafts: DevAutoCapturePipelineDeps["drafts"];
  private readonly queue: DevAutoCapturePipelineDeps["queue"];
  private readonly worker: DevAutoCapturePipelineDeps["worker"];
  private readonly schedule: (fn: () => Promise<void> | void) => unknown;

  constructor(deps: DevAutoCapturePipelineDeps) {
    this.drafts = deps.drafts;
    this.queue = deps.queue;
    this.worker = deps.worker;
    this.schedule =
      deps.schedule ??
      ((fn) => {
        setImmediate(() => {
          void Promise.resolve(fn()).catch(() => {
            // Swallowed — failures surface via queue.markFailed inside worker.tick.
          });
        });
      });
  }

  async trigger(agreementId: string): Promise<void> {
    await this.drafts.markPaid(agreementId);
    await this.queue.enqueue({ agreementId });
    this.schedule(async () => {
      try {
        await this.worker.tick();
      } catch {
        // see schedule fallback comment
      }
    });
  }
}
