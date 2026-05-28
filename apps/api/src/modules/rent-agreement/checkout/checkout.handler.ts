// Pure async webhook handler. Caller (Phase 13 wiring in payments.controller.ts) is
// responsible for HMAC verification + dispatching only when the order has
// purpose === 'rent_agreement'. This handler is defense-in-depth: if a stranger order
// id slips through, returns { processed: false } without throwing.
//
// Status flips happen *before* the PDF enqueue. If enqueue fails, the order stays
// paid and the caller is expected to retry the enqueue (PDF job table will be the
// durable surface in Phase 8 — for now the enqueue callback is fully pluggable).

import type { CheckoutService } from "./checkout.service";

export interface HandlePaymentCapturedInput {
  providerOrderId: string;
  providerPaymentId: string;
  checkout: CheckoutService;
  enqueuePdfJob: (input: { agreementId: string; userId: string }) => Promise<void>;
}

export type HandlePaymentCapturedResult =
  | { processed: true }
  | { processed: false; reason: "order_not_found" | "already_paid" };

export async function handlePaymentCaptured(
  input: HandlePaymentCapturedInput
): Promise<HandlePaymentCapturedResult> {
  const order = await input.checkout.findByProviderOrderId(input.providerOrderId);
  if (!order) {
    return { processed: false, reason: "order_not_found" };
  }
  if (order.status === "paid") {
    return { processed: false, reason: "already_paid" };
  }
  await input.checkout.markPaid(order.id, input.providerPaymentId);
  await input.enqueuePdfJob({ agreementId: order.draft_id, userId: order.user_id });
  return { processed: true };
}
