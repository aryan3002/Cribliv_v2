import { describe, expect, it } from "vitest";

import { InMemoryPaymentOrdersRepository } from "../../checkout/payment-orders.repository";
import type { PaymentOrderRow } from "../../checkout/checkout.service";

function makeRow(overrides: Partial<PaymentOrderRow> = {}): PaymentOrderRow {
  return {
    id: overrides.id ?? "order-1",
    user_id: overrides.user_id ?? "user-1",
    draft_id: overrides.draft_id ?? "draft-1",
    provider: overrides.provider ?? "razorpay",
    idempotency_key: overrides.idempotency_key ?? "idem-1",
    provider_order_id: overrides.provider_order_id ?? "prov-order-1",
    provider_payment_id: overrides.provider_payment_id ?? null,
    amount_paise: overrides.amount_paise ?? 199900,
    status: overrides.status ?? "pending_payment",
    metadata: overrides.metadata ?? ({ purpose: "rent_agreement" } as PaymentOrderRow["metadata"]),
    created_at: overrides.created_at ?? "2026-05-21T09:00:00.000Z"
  };
}

describe("InMemoryPaymentOrdersRepository", () => {
  it("insert then findById returns the row", async () => {
    const repo = new InMemoryPaymentOrdersRepository();
    await repo.insert(makeRow());
    expect((await repo.findById("order-1"))?.provider_order_id).toBe("prov-order-1");
  });

  it("findByIdempotency scopes to (userId, key)", async () => {
    const repo = new InMemoryPaymentOrdersRepository();
    await repo.insert(makeRow({ user_id: "user-1", idempotency_key: "idem-1" }));
    expect(await repo.findByIdempotency("user-1", "idem-1")).not.toBeNull();
    expect(await repo.findByIdempotency("user-1", "other")).toBeNull();
    expect(await repo.findByIdempotency("user-2", "idem-1")).toBeNull();
  });

  it("duplicate insert on (userId, key) is a no-op", async () => {
    const repo = new InMemoryPaymentOrdersRepository();
    await repo.insert(makeRow({ id: "order-1", idempotency_key: "idem-1" }));
    await repo.insert(makeRow({ id: "order-2", idempotency_key: "idem-1" }));
    expect((await repo.findByIdempotency("user-1", "idem-1"))?.id).toBe("order-1");
    expect(await repo.findById("order-2")).toBeNull();
  });

  it("findByProviderOrderId locates the order", async () => {
    const repo = new InMemoryPaymentOrdersRepository();
    await repo.insert(makeRow({ provider_order_id: "prov-xyz" }));
    expect((await repo.findByProviderOrderId("prov-xyz"))?.id).toBe("order-1");
    expect(await repo.findByProviderOrderId("nope")).toBeNull();
  });

  it("markPaid flips status and records provider_payment_id", async () => {
    const repo = new InMemoryPaymentOrdersRepository();
    await repo.insert(makeRow());
    await repo.markPaid("order-1", "pay-abc");
    const row = await repo.findById("order-1");
    expect(row?.status).toBe("paid");
    expect(row?.provider_payment_id).toBe("pay-abc");
  });

  it("findById returns a distinct object (no shared reference)", async () => {
    const repo = new InMemoryPaymentOrdersRepository();
    await repo.insert(makeRow());
    const a = await repo.findById("order-1");
    a!.status = "paid";
    expect((await repo.findById("order-1"))?.status).toBe("pending_payment");
  });
});
