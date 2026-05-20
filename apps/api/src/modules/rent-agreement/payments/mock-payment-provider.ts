import type {
  CreateProviderOrderInput,
  CreateProviderOrderResult,
  RentAgreementPaymentProviderPort
} from "./payment-provider.port";

// Dev-only provider. Returns a deterministic, monotonic provider_order_id so the
// dev auto-capture pipeline can simulate a captured payment without a real Razorpay
// call. NEVER use in production.

export class MockPaymentProvider implements RentAgreementPaymentProviderPort {
  private counter = 0;
  private readonly prefix: string;

  constructor(opts: { prefix?: string } = {}) {
    this.prefix = opts.prefix ?? "mock_order_";
  }

  async createOrder(input: CreateProviderOrderInput): Promise<CreateProviderOrderResult> {
    this.counter += 1;
    return { providerOrderId: `${this.prefix}${this.counter}_${input.receipt}` };
  }
}
