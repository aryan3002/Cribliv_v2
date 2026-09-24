import type { PgRentReceipt } from "@cribliv/shared-types";

import { toIsoTs } from "./common";
import { paiseToInr } from "./money";

export interface RentReceiptRow {
  id: string;
  pg_property_id: string;
  payment_id: string;
  assignment_id: string;
  receipt_number: string;
  amount_paise: string;
  pdf_status: PgRentReceipt["pdf_status"];
  attempts: number;
  last_error: string | null;
  generated_at: Date | string | null;
  voided_at: Date | string | null;
  void_reason: string | null;
  superseded_by: string | null;
  share_expires_at: Date | string | null;
  created_at: Date | string;
}

/** No alias — every caller uses this on an `UPDATE pg_rent_receipts ... RETURNING` with no table alias. */
export const RECEIPT_SELECT = `
  id::text, pg_property_id::text, payment_id::text, assignment_id::text, receipt_number,
  amount_paise::text, pdf_status::text, attempts, last_error, generated_at, voided_at, void_reason,
  superseded_by::text, share_token_expires_at AS share_expires_at, created_at`;

export function toReceiptDto(row: RentReceiptRow): PgRentReceipt {
  return {
    id: row.id,
    payment_id: row.payment_id,
    assignment_id: row.assignment_id,
    receipt_number: row.receipt_number,
    amount_inr: paiseToInr(row.amount_paise),
    pdf_status: row.pdf_status,
    attempts: row.attempts,
    last_error: row.last_error,
    generated_at: toIsoTs(row.generated_at),
    voided_at: toIsoTs(row.voided_at),
    void_reason: row.void_reason,
    superseded_by: row.superseded_by,
    share_expires_at: toIsoTs(row.share_expires_at),
    created_at: toIsoTs(row.created_at) as string
  };
}
