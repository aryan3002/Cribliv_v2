// e-Stamping provider port. The real concrete implementation (SHCIL e-Stamp,
// Stockholding, NSDL eGov, etc.) plugs in via DI per PRODUCTION-WIRING.md.

export type EStampStatus = "issued" | "cancelled" | "pending";

export interface IssueEStampInput {
  agreementId: string;
  amountPaise: number;
  stateCode: string;
}

export interface EStampReceipt {
  referenceId: string;
  status: EStampStatus;
  issuedAt: Date;
}

export interface EStampStatusResult {
  referenceId: string;
  status: EStampStatus;
  issuedAt: Date;
}

export interface EStampingProvider {
  issue(input: IssueEStampInput): Promise<EStampReceipt>;
  status(referenceId: string): Promise<EStampStatusResult | null>;
}
