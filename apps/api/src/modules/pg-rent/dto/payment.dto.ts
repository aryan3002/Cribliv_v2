import { z } from "zod";
import type {
  PgRentAllocation,
  PgRentAllocationsPatchInput,
  PgRentBackfillInput,
  PgRentClaimInput,
  PgRentConfirmInput,
  PgRentManualInvoiceInput,
  PgRentPayment,
  PgRentRecordPaymentInput,
  PgRentRefundInput,
  PgRentRejectInput,
  PgRentReverseInput
} from "@cribliv/shared-types";

import { isIsoDate } from "../../../common/date";
import { toIsoDate, toIsoTs } from "./common";
import { paiseToInr } from "./money";

const isoDate = z.string().refine(isIsoDate, "must be a real YYYY-MM-DD date");
const uuid = z.string().uuid();
/** ₹1 – ₹10,00,000 whole rupees (spec §4.6). */
const amountInr = z.number().int().min(1).max(1000000);
const reference = z.string().trim().max(64).nullable().optional();
const note = z.string().trim().max(200).nullable().optional();
const proofPaths = z.array(z.string().min(1).max(300)).max(3).optional();
const recordableMethod = z.enum(["cash", "upi", "bank_transfer", "cheque", "card", "other"]);
const claimableMethod = z.enum(["upi", "bank_transfer", "cheque", "card", "other"]);
const allocationTargets = z
  .array(z.object({ invoice_id: uuid, amount_inr: amountInr }).strict())
  .max(20);
const LINE_KINDS = [
  "rent",
  "deposit",
  "late_fee",
  "electricity",
  "meals",
  "maintenance",
  "damage",
  "cleaning",
  "forfeit",
  "other",
  "discount",
  "adjustment"
] as const;
const lineInput = z
  .object({
    kind: z.enum(LINE_KINDS),
    label: z.string().trim().min(1).max(40),
    amount_inr: z.number().int().min(-1000000).max(1000000)
  })
  .strict();

export const RecordPaymentSchema = z.object({
  assignment_id: uuid,
  amount_inr: amountInr,
  method: recordableMethod,
  paid_on: isoDate,
  reference,
  note,
  proof_paths: proofPaths,
  allocations: allocationTargets.optional(),
  claimed_invoice_id: uuid.nullable().optional()
}) satisfies z.ZodType<PgRentRecordPaymentInput, PgRentRecordPaymentInput>;

export const ClaimPaymentSchema = z.object({
  assignment_id: uuid,
  invoice_id: uuid.nullable().optional(),
  amount_inr: amountInr,
  method: claimableMethod,
  paid_on: isoDate,
  reference,
  note,
  proof_paths: proofPaths,
  idempotency_key: z.string().min(8).max(64)
}) satisfies z.ZodType<PgRentClaimInput, PgRentClaimInput>;

export const ConfirmPaymentSchema = z.object({
  amount_inr: amountInr.optional(),
  method: recordableMethod.optional(),
  paid_on: isoDate.optional(),
  allocations: allocationTargets.optional()
}) satisfies z.ZodType<PgRentConfirmInput, PgRentConfirmInput>;

export const RejectPaymentSchema = z.object({
  reason: z.string().trim().min(1).max(200)
}) satisfies z.ZodType<PgRentRejectInput, PgRentRejectInput>;

export const ReversePaymentSchema = z.object({
  reason: z.string().trim().min(1).max(200)
}) satisfies z.ZodType<PgRentReverseInput, PgRentReverseInput>;

export const RefundSchema = z.object({
  assignment_id: uuid,
  amount_inr: amountInr,
  method: recordableMethod,
  paid_on: isoDate,
  reference,
  reason: z.string().trim().min(1).max(200)
}) satisfies z.ZodType<PgRentRefundInput, PgRentRefundInput>;

export const AllocationsPatchSchema = z.object({
  allocations: allocationTargets
}) satisfies z.ZodType<PgRentAllocationsPatchInput, PgRentAllocationsPatchInput>;

export const BackfillSchema = z
  .object({
    assignment_id: uuid,
    kind: z.enum(["rent", "adhoc", "deposit"]),
    period_start: isoDate.optional(),
    period_end: isoDate.optional(),
    due_date: isoDate,
    lines: z.array(lineInput).min(1).max(10),
    payment: z
      .object({ amount_inr: amountInr, method: recordableMethod, paid_on: isoDate, reference })
      .strict()
      .optional()
  })
  .refine(
    (v) => v.kind !== "rent" || (v.period_start && v.period_end && v.period_start <= v.period_end),
    {
      message: "rent backfill needs period_start <= period_end"
    }
  ) satisfies z.ZodType<PgRentBackfillInput, PgRentBackfillInput>;

export const ManualInvoiceSchema = z.object({
  assignment_id: uuid,
  kind: z.literal("adhoc"),
  due_date: isoDate,
  lines: z.array(lineInput).min(1).max(10),
  tenant_note: note
}) satisfies z.ZodType<PgRentManualInvoiceInput, PgRentManualInvoiceInput>;

export interface RentPaymentRow {
  id: string;
  pg_property_id: string;
  assignment_id: string;
  occupant_name: string;
  direction: PgRentPayment["direction"];
  amount_paise: string;
  method: PgRentPayment["method"];
  source: PgRentPayment["source"];
  status: PgRentPayment["status"];
  claimed_invoice_id: string | null;
  paid_on: Date | string;
  reference: string | null;
  proof_paths: string[];
  note: string | null;
  recorded_by: string | null;
  confirmed_by: string | null;
  confirmed_at: Date | string | null;
  rejected_reason: string | null;
  reversed_at: Date | string | null;
  reversed_reason: string | null;
  receipt_id: string | null;
  created_at: Date | string;
  updated_at: Date | string;
}

export interface RentAllocationRow {
  id: string;
  payment_id: string;
  invoice_id: string | null;
  invoice_number: string | null;
  refund_payment_id: string | null;
  amount_paise: string;
  created_at: Date | string;
}

export const PAYMENT_SELECT = `
  p.id::text, p.pg_property_id::text, p.assignment_id::text, a.occupant_name, p.direction::text, p.amount_paise::text,
  p.method::text, p.source::text, p.status::text, p.claimed_invoice_id::text, p.paid_on, p.reference, p.proof_paths, p.note,
  p.recorded_by::text, p.confirmed_by::text, p.confirmed_at, p.rejected_reason, p.reversed_at, p.reversed_reason,
  (SELECT r.id::text FROM pg_rent_receipts r WHERE r.payment_id = p.id AND r.voided_at IS NULL LIMIT 1) AS receipt_id,
  p.created_at, p.updated_at`;

export const ALLOCATION_SELECT = `
  al.id::text, al.payment_id::text, al.invoice_id::text, i.invoice_number, al.refund_payment_id::text, al.amount_paise::text, al.created_at`;

export function toAllocationDto(row: RentAllocationRow): PgRentAllocation {
  return {
    id: row.id,
    payment_id: row.payment_id,
    invoice_id: row.invoice_id,
    invoice_number: row.invoice_number,
    refund_payment_id: row.refund_payment_id,
    amount_inr: paiseToInr(row.amount_paise),
    created_at: toIsoTs(row.created_at) as string
  };
}

export function toPaymentDto(row: RentPaymentRow, allocations: RentAllocationRow[]): PgRentPayment {
  const mine = allocations.filter((a) => a.payment_id === row.id);
  const allocated = mine.reduce((sum, a) => sum + Number(a.amount_paise), 0);
  return {
    id: row.id,
    pg_property_id: row.pg_property_id,
    assignment_id: row.assignment_id,
    occupant_name: row.occupant_name,
    direction: row.direction,
    amount_inr: paiseToInr(row.amount_paise),
    unallocated_inr:
      row.direction === "inflow" && row.status === "confirmed"
        ? paiseToInr(Number(row.amount_paise) - allocated)
        : 0,
    method: row.method,
    source: row.source,
    status: row.status,
    claimed_invoice_id: row.claimed_invoice_id,
    paid_on: toIsoDate(row.paid_on) as string,
    reference: row.reference,
    proof_paths: row.proof_paths ?? [],
    note: row.note,
    recorded_by: row.recorded_by,
    confirmed_by: row.confirmed_by,
    confirmed_at: toIsoTs(row.confirmed_at),
    rejected_reason: row.rejected_reason,
    reversed_at: toIsoTs(row.reversed_at),
    reversed_reason: row.reversed_reason,
    receipt_id: row.receipt_id,
    allocations: mine.map(toAllocationDto),
    created_at: toIsoTs(row.created_at) as string,
    updated_at: toIsoTs(row.updated_at) as string
  };
}
