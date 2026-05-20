import { describe, expect, it } from "vitest";

import { MockPaymentProvider } from "../../payments/mock-payment-provider";

describe("MockPaymentProvider.createOrder", () => {
  it("returns a providerOrderId derived from receipt + monotonic counter", async () => {
    const p = new MockPaymentProvider();
    const r1 = await p.createOrder({
      amountPaise: 49900,
      currency: "INR",
      notes: { purpose: "rent_agreement" },
      receipt: "abc-001"
    });
    const r2 = await p.createOrder({
      amountPaise: 49900,
      currency: "INR",
      notes: { purpose: "rent_agreement" },
      receipt: "abc-002"
    });
    expect(r1.providerOrderId).toMatch(/^mock_order_1_abc-001$/);
    expect(r2.providerOrderId).toMatch(/^mock_order_2_abc-002$/);
  });

  it("accepts a custom prefix", async () => {
    const p = new MockPaymentProvider({ prefix: "dev_rzp_" });
    const r = await p.createOrder({
      amountPaise: 100,
      currency: "INR",
      notes: {},
      receipt: "r-1"
    });
    expect(r.providerOrderId.startsWith("dev_rzp_")).toBe(true);
  });
});
