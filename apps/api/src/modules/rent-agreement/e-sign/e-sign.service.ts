import type { DraftsService } from "../drafts/drafts.service";
import type { ESignProvider, ESignSession, ESignVerifyResult } from "./e-sign.adapter";

export type ESignServiceErrorCode =
  | "RENT_AGREEMENT_NOT_FOUND"
  | "RENT_AGREEMENT_ESIGN_NOT_READY"
  | "RENT_AGREEMENT_ESIGN_NOT_INITIATED"
  | "RENT_AGREEMENT_ESIGN_OTP_INVALID";

export class ESignServiceError extends Error {
  readonly code: ESignServiceErrorCode;
  constructor(code: ESignServiceErrorCode, message: string) {
    super(message);
    this.code = code;
    this.name = "ESignServiceError";
  }
}

interface Deps {
  drafts: DraftsService;
  provider: ESignProvider;
}

interface AgreementShape {
  id: string;
  current_step: number;
  owner_full_name: string | null;
  tenant_full_name: string | null;
  owner_aadhaar_last4: string | null;
  tenant_aadhaar_last4: string | null;
  e_sign_session_id: string | null;
}

export class ESignService {
  private readonly drafts: DraftsService;
  private readonly provider: ESignProvider;

  constructor(deps: Deps) {
    this.drafts = deps.drafts;
    this.provider = deps.provider;
  }

  // Initiate for owner; the same flow handles tenant via the party arg.
  async initiate(
    userId: string,
    agreementId: string,
    party: "owner" | "tenant"
  ): Promise<ESignSession> {
    const draft = (await this.drafts.getOne(
      userId,
      agreementId
    )) as unknown as AgreementShape | null;
    if (!draft) {
      throw new ESignServiceError(
        "RENT_AGREEMENT_NOT_FOUND",
        `Agreement ${agreementId} not found for user ${userId}`
      );
    }
    const signerName = party === "owner" ? draft.owner_full_name : draft.tenant_full_name;
    const aadhaarLast4 = party === "owner" ? draft.owner_aadhaar_last4 : draft.tenant_aadhaar_last4;
    if (!signerName || !aadhaarLast4) {
      throw new ESignServiceError(
        "RENT_AGREEMENT_ESIGN_NOT_READY",
        `Party '${party}' must have full_name + aadhaar_last4 captured before eSign`
      );
    }
    const session = await this.provider.initiate({
      agreementId: draft.id,
      aadhaarLast4,
      signerName
    });
    await this.drafts.markESignSession(draft.id, session.sessionId);
    return session;
  }

  async verify(userId: string, agreementId: string, otp: string): Promise<ESignVerifyResult> {
    const draft = (await this.drafts.getOne(
      userId,
      agreementId
    )) as unknown as AgreementShape | null;
    if (!draft) {
      throw new ESignServiceError(
        "RENT_AGREEMENT_NOT_FOUND",
        `Agreement ${agreementId} not found for user ${userId}`
      );
    }
    if (!draft.e_sign_session_id) {
      throw new ESignServiceError(
        "RENT_AGREEMENT_ESIGN_NOT_INITIATED",
        "Call /e-sign/initiate before verifying"
      );
    }
    const result = await this.provider.verify({
      sessionId: draft.e_sign_session_id,
      otp
    });
    if (result.status !== "verified") {
      throw new ESignServiceError("RENT_AGREEMENT_ESIGN_OTP_INVALID", "OTP verification failed");
    }
    await this.drafts.markESignCompleted(draft.id);
    return result;
  }
}
