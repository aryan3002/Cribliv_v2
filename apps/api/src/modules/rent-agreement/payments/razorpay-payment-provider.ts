import type {
  CreateProviderOrderInput,
  CreateProviderOrderResult,
  RentAgreementPaymentProviderPort
} from "./payment-provider.port";

// Placeholder for the real Razorpay integration. The real implementation will use
// the `razorpay` npm package + RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET env vars to
// call `orders.create()`. Until that's wired, throw a typed error so the DI binding
// fails loudly if accidentally selected outside dev.

export class RentAgreementPaymentProviderError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = "RentAgreementPaymentProviderError";
  }
}

export class RazorpayPaymentProvider implements RentAgreementPaymentProviderPort {
  async createOrder(_input: CreateProviderOrderInput): Promise<CreateProviderOrderResult> {
    throw new RentAgreementPaymentProviderError(
      "RENT_AGREEMENT_PAYMENT_PROVIDER_NOT_CONFIGURED",
      "Real Razorpay integration pending. Use MockPaymentProvider in dev or wire RAZORPAY_KEY_ID/SECRET."
    );
  }
}
