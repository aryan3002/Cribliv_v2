import type { DraftsService } from "../drafts/drafts.service";
import type { EStampReceipt, EStampStatusResult, EStampingProvider } from "./e-stamping.adapter";

// Orchestrator. Verifies the agreement is owned by the user and is at least step 3
// (where stamp duty is computed), then delegates to the provider and persists the
// reference on the agreement row.

export type EStampingServiceErrorCode =
  | "RENT_AGREEMENT_NOT_FOUND"
  | "RENT_AGREEMENT_ESTAMP_NOT_READY"
  | "RENT_AGREEMENT_ESTAMP_NOT_ISSUED";

export class EStampingServiceError extends Error {
  readonly code: EStampingServiceErrorCode;
  constructor(code: EStampingServiceErrorCode, message: string) {
    super(message);
    this.code = code;
    this.name = "EStampingServiceError";
  }
}

interface Deps {
  drafts: DraftsService;
  provider: EStampingProvider;
}

export class EStampingService {
  private readonly drafts: DraftsService;
  private readonly provider: EStampingProvider;

  constructor(deps: Deps) {
    this.drafts = deps.drafts;
    this.provider = deps.provider;
  }

  async issue(userId: string, agreementId: string): Promise<EStampReceipt> {
    const draft = (await this.drafts.getOne(userId, agreementId)) as unknown as
      | (Record<string, unknown> & {
          id: string;
          current_step: number;
          stamp_duty_paise: number;
          state_code: string | null;
        })
      | null;
    if (!draft) {
      throw new EStampingServiceError(
        "RENT_AGREEMENT_NOT_FOUND",
        `Agreement ${agreementId} not found for user ${userId}`
      );
    }
    if (draft.current_step < 3 || !draft.state_code || draft.stamp_duty_paise <= 0) {
      throw new EStampingServiceError(
        "RENT_AGREEMENT_ESTAMP_NOT_READY",
        "Agreement must have completed step 3 (terms) with stamp duty computed before e-stamping"
      );
    }
    const receipt = await this.provider.issue({
      agreementId: draft.id,
      amountPaise: draft.stamp_duty_paise,
      stateCode: draft.state_code
    });
    await this.drafts.markEStampIssued(draft.id, receipt.referenceId);
    return receipt;
  }

  async status(userId: string, agreementId: string): Promise<EStampStatusResult> {
    const draft = (await this.drafts.getOne(userId, agreementId)) as unknown as
      | (Record<string, unknown> & { e_stamp_reference: string | null })
      | null;
    if (!draft) {
      throw new EStampingServiceError(
        "RENT_AGREEMENT_NOT_FOUND",
        `Agreement ${agreementId} not found for user ${userId}`
      );
    }
    if (!draft.e_stamp_reference) {
      throw new EStampingServiceError(
        "RENT_AGREEMENT_ESTAMP_NOT_ISSUED",
        "No e-stamp has been issued for this agreement yet"
      );
    }
    const s = await this.provider.status(draft.e_stamp_reference);
    if (!s) {
      throw new EStampingServiceError(
        "RENT_AGREEMENT_ESTAMP_NOT_ISSUED",
        "Provider has no record of this reference"
      );
    }
    return s;
  }
}
