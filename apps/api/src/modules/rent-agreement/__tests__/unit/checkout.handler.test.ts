import { describe, expect, it, vi } from "vitest";

import { CheckoutService } from "../../checkout/checkout.service";
import { handlePaymentCaptured } from "../../checkout/checkout.handler";

function makeCheckout() {
  const draftRow = {
    id: "draft-1",
    user_id: "user-1",
    plan_id: "premium",
    state_code: "KA",
    locale: "en",
    current_step: 7,
    status: "draft",
    stamp_duty_paise: 30000
  };
  return new CheckoutService({
    draftsService: { getOne: vi.fn(async () => draftRow) } as never,
    signaturesService: { hasBothSignatures: vi.fn(() => true) } as never,
    planLookup: vi.fn(() => ({ amount_paise: 49900 })),
    uuid: () => "uuid-1",
    clock: () => new Date("2026-05-18T13:00:00Z"),
    providerOrderIdGenerator: () => "order_1"
  });
}

async function seedOrder(checkout: CheckoutService) {
  return checkout.createOrder({
    userId: "user-1",
    draftId: "draft-1",
    idempotencyKey: "k",
    provider: "razorpay"
  });
}

describe("handlePaymentCaptured: happy path", () => {
  it("marks order paid + enqueues PDF job on first capture", async () => {
    const checkout = makeCheckout();
    await seedOrder(checkout);
    const enqueuePdfJob = vi.fn(async () => undefined);
    const result = await handlePaymentCaptured({
      providerOrderId: "order_1",
      providerPaymentId: "pay_xyz",
      checkout,
      enqueuePdfJob
    });
    expect(result).toEqual({ processed: true });
    expect(checkout.findByProviderOrderId("order_1")?.status).toBe("paid");
    expect(enqueuePdfJob).toHaveBeenCalledWith({
      agreementId: "draft-1",
      userId: "user-1"
    });
  });

  it("records the provider_payment_id on the order", async () => {
    const checkout = makeCheckout();
    await seedOrder(checkout);
    const enqueuePdfJob = vi.fn(async () => undefined);
    await handlePaymentCaptured({
      providerOrderId: "order_1",
      providerPaymentId: "pay_abc",
      checkout,
      enqueuePdfJob
    });
    expect(checkout.findByProviderOrderId("order_1")?.provider_payment_id).toBe("pay_abc");
  });
});

describe("handlePaymentCaptured: replay safety", () => {
  it("replay (same provider_order_id, same payment_id) is a no-op", async () => {
    const checkout = makeCheckout();
    await seedOrder(checkout);
    const enqueuePdfJob = vi.fn(async () => undefined);
    await handlePaymentCaptured({
      providerOrderId: "order_1",
      providerPaymentId: "pay_xyz",
      checkout,
      enqueuePdfJob
    });
    const second = await handlePaymentCaptured({
      providerOrderId: "order_1",
      providerPaymentId: "pay_xyz",
      checkout,
      enqueuePdfJob
    });
    expect(second).toEqual({ processed: false, reason: "already_paid" });
    expect(enqueuePdfJob).toHaveBeenCalledTimes(1);
  });

  it("does NOT enqueue PDF job when order is already paid", async () => {
    const checkout = makeCheckout();
    await seedOrder(checkout);
    const enqueuePdfJob = vi.fn(async () => undefined);
    await handlePaymentCaptured({
      providerOrderId: "order_1",
      providerPaymentId: "pay_xyz",
      checkout,
      enqueuePdfJob
    });
    enqueuePdfJob.mockClear();
    await handlePaymentCaptured({
      providerOrderId: "order_1",
      providerPaymentId: "pay_xyz",
      checkout,
      enqueuePdfJob
    });
    expect(enqueuePdfJob).not.toHaveBeenCalled();
  });

  it("replay with a different payment_id still treated as already_paid (first wins)", async () => {
    const checkout = makeCheckout();
    await seedOrder(checkout);
    const enqueuePdfJob = vi.fn(async () => undefined);
    await handlePaymentCaptured({
      providerOrderId: "order_1",
      providerPaymentId: "pay_first",
      checkout,
      enqueuePdfJob
    });
    const second = await handlePaymentCaptured({
      providerOrderId: "order_1",
      providerPaymentId: "pay_second",
      checkout,
      enqueuePdfJob
    });
    expect(second).toEqual({ processed: false, reason: "already_paid" });
    expect(checkout.findByProviderOrderId("order_1")?.provider_payment_id).toBe("pay_first");
  });
});

describe("handlePaymentCaptured: missing order", () => {
  it("returns order_not_found without throwing when provider_order_id unknown", async () => {
    const checkout = makeCheckout();
    const enqueuePdfJob = vi.fn(async () => undefined);
    const result = await handlePaymentCaptured({
      providerOrderId: "missing",
      providerPaymentId: "pay_xyz",
      checkout,
      enqueuePdfJob
    });
    expect(result).toEqual({ processed: false, reason: "order_not_found" });
    expect(enqueuePdfJob).not.toHaveBeenCalled();
  });
});

describe("handlePaymentCaptured: error propagation", () => {
  it("propagates enqueuePdfJob errors (caller decides what to do)", async () => {
    const checkout = makeCheckout();
    await seedOrder(checkout);
    const enqueuePdfJob = vi.fn(async () => {
      throw new Error("queue down");
    });
    await expect(
      handlePaymentCaptured({
        providerOrderId: "order_1",
        providerPaymentId: "pay_xyz",
        checkout,
        enqueuePdfJob
      })
    ).rejects.toThrow("queue down");
  });

  it("order is still marked paid even if enqueuePdfJob throws (status flip happens first)", async () => {
    // This documents the current behavior: status is flipped before enqueue. If enqueue fails,
    // the caller is responsible for retrying enqueue (job is durable) — the order isn't replayed.
    const checkout = makeCheckout();
    await seedOrder(checkout);
    const enqueuePdfJob = vi.fn(async () => {
      throw new Error("queue down");
    });
    await expect(
      handlePaymentCaptured({
        providerOrderId: "order_1",
        providerPaymentId: "pay_xyz",
        checkout,
        enqueuePdfJob
      })
    ).rejects.toThrow();
    expect(checkout.findByProviderOrderId("order_1")?.status).toBe("paid");
  });
});
