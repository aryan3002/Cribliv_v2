export type VerificationProviderResult = "pass" | "fail" | "manual_review";

export interface ProviderCallContext {
  listingId: string;
  ownerId: string;
}

export interface VideoVerificationInput {
  artifactBlobPath: string;
  vendorReference?: string;
}

export interface ElectricityVerificationInput {
  consumerId: string;
  addressText: string;
  citySlug: string;
  billArtifactBlobPath?: string;
}

export interface ProviderResponseBase {
  provider: string;
  providerReference?: string;
  providerResultCode: string;
  result: VerificationProviderResult;
  reviewReason?: string;
  retryable?: boolean;
  requestPayload: Record<string, unknown>;
  responsePayload: Record<string, unknown>;
}

export interface LivenessProviderResponse extends ProviderResponseBase {
  livenessScore: number;
}

export interface ElectricityProviderResponse extends ProviderResponseBase {
  addressMatchScore: number;
}

export class VerificationProviderError extends Error {
  code: string;
  retryable: boolean;

  constructor(message: string, input: { code: string; retryable: boolean }) {
    super(message);
    this.name = "VerificationProviderError";
    this.code = input.code;
    this.retryable = input.retryable;
  }
}
