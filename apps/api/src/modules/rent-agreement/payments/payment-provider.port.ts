// Abstracts the outbound call to the payment provider (Razorpay, UPI, etc.) that
// turns an internal payment_order into a provider-side order id. The rest of the
// flow (webhook signature verification, capture handling) stays in the existing
// payments.controller — this port only handles the outbound order creation.

export interface CreateProviderOrderInput {
  amountPaise: number;
  currency: "INR";
  notes: Record<string, string | number>;
  receipt: string;
}

export interface CreateProviderOrderResult {
  providerOrderId: string;
}

export interface RentAgreementPaymentProviderPort {
  createOrder(input: CreateProviderOrderInput): Promise<CreateProviderOrderResult>;
}
