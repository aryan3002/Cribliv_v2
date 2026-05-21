// Pure mapper: draft row + amount components → Razorpay-shaped order request.
// `notes` doubles as the metadata persisted on payment_orders (Architecture §A1, API-Contract §B1).

import type { RentAgreementRow } from "../drafts/draft-summary.mapper";

export type CheckoutMapperErrorCode =
  | "RENT_AGREEMENT_CHECKOUT_INVALID_AMOUNT"
  | "RENT_AGREEMENT_CHECKOUT_INCOMPLETE_DRAFT";

export class CheckoutMapperError extends Error {
  readonly code: CheckoutMapperErrorCode;
  constructor(code: CheckoutMapperErrorCode, message: string) {
    super(message);
    this.name = "CheckoutMapperError";
    this.code = code;
  }
}

export interface ProviderOrderNotes {
  purpose: "rent_agreement";
  agreement_id: string;
  plan_id: string;
  user_id: string;
  state_code: string;
  locale: string;
}

export interface ProviderOrderRequest {
  amount_paise: number;
  currency: "INR";
  receipt: string;
  notes: ProviderOrderNotes;
}

export interface BuildPayloadInput {
  row: Pick<RentAgreementRow, "id" | "user_id" | "plan_id" | "state_code" | "locale">;
  planAmountPaise: number;
  stampDutyPaise: number;
  idempotencyKey: string;
}

export function buildRentAgreementProviderPayload(input: BuildPayloadInput): ProviderOrderRequest {
  const { row, planAmountPaise, stampDutyPaise } = input;
  if (!row.id || !row.user_id || !row.plan_id || !row.state_code) {
    throw new CheckoutMapperError(
      "RENT_AGREEMENT_CHECKOUT_INCOMPLETE_DRAFT",
      "Draft is missing required fields for checkout (id, user_id, plan_id, state_code)"
    );
  }
  const total = planAmountPaise + stampDutyPaise;
  if (!Number.isFinite(total) || total <= 0) {
    throw new CheckoutMapperError(
      "RENT_AGREEMENT_CHECKOUT_INVALID_AMOUNT",
      `Total amount_paise must be > 0 (got ${total})`
    );
  }
  return {
    amount_paise: total,
    currency: "INR",
    receipt: `rentagr_${row.id.slice(0, 12)}`,
    notes: {
      purpose: "rent_agreement",
      agreement_id: row.id,
      plan_id: row.plan_id,
      user_id: row.user_id,
      state_code: row.state_code,
      locale: row.locale
    }
  };
}
