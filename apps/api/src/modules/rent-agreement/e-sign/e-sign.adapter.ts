// Aadhaar eSign provider port. Real concrete will plug in a UIDAI AUA/Sub-AUA
// partner (NSDL, Protean, eMudhra) via DI per PRODUCTION-WIRING.md.

export type ESignSessionStatus = "initiated" | "verified" | "expired";

export interface InitiateESignInput {
  agreementId: string;
  aadhaarLast4: string;
  signerName: string;
}

export interface ESignSession {
  sessionId: string;
  status: ESignSessionStatus;
  initiatedAt: Date;
  // The real flow returns a redirect URL to the AUA's OTP page. In dev mode we
  // surface a placeholder so the frontend can show "OTP form here".
  otpUrl: string;
}

export interface ESignVerifyInput {
  sessionId: string;
  otp: string;
}

export interface ESignVerifyResult {
  sessionId: string;
  status: ESignSessionStatus;
  signedAt: Date | null;
}

export interface ESignProvider {
  initiate(input: InitiateESignInput): Promise<ESignSession>;
  verify(input: ESignVerifyInput): Promise<ESignVerifyResult>;
}
