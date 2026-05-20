import { describe, expect, it } from "vitest";

import { RazorpayPaymentProvider } from "../../payments/razorpay-payment-provider";

describe("RazorpayPaymentProvider", () => {
  it("createOrder throws RENT_AGREEMENT_PAYMENT_PROVIDER_NOT_CONFIGURED until real Razorpay client is wired", async () => {
    const p = new RazorpayPaymentProvider();
    await expect(
      p.createOrder({
        amountPaise: 100,
        currency: "INR",
        notes: {},
        receipt: "r-1"
      })
    ).rejects.toMatchObject({
      code: "RENT_AGREEMENT_PAYMENT_PROVIDER_NOT_CONFIGURED"
    });
  });
});
