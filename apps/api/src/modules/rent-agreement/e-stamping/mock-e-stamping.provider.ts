import type {
  EStampReceipt,
  EStampStatusResult,
  EStampingProvider,
  IssueEStampInput
} from "./e-stamping.adapter";

// Dev-only deterministic stub. Real implementation will call SHCIL/NSDL APIs +
// persist the reference on the agreement row. NEVER ship to production.

interface Deps {
  clock?: () => Date;
}

export class MockEStampingProvider implements EStampingProvider {
  private readonly clock: () => Date;
  private counter = 0;
  private readonly byAgreement = new Map<string, EStampReceipt>();
  private readonly byReference = new Map<string, EStampReceipt>();

  constructor(deps: Deps = {}) {
    this.clock = deps.clock ?? (() => new Date());
  }

  async issue(input: IssueEStampInput): Promise<EStampReceipt> {
    const existing = this.byAgreement.get(input.agreementId);
    if (existing) return existing;
    this.counter += 1;
    const receipt: EStampReceipt = {
      referenceId: `MOCK-ESTAMP-${this.counter}-${input.agreementId}`,
      status: "issued",
      issuedAt: this.clock()
    };
    this.byAgreement.set(input.agreementId, receipt);
    this.byReference.set(receipt.referenceId, receipt);
    return receipt;
  }

  async status(referenceId: string): Promise<EStampStatusResult | null> {
    const r = this.byReference.get(referenceId);
    if (!r) return null;
    return { referenceId: r.referenceId, status: r.status, issuedAt: r.issuedAt };
  }
}
