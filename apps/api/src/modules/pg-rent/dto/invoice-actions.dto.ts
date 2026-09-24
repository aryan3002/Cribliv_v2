import { z } from "zod";
import type {
  PgRentApplyFeeInput,
  PgRentCancelInvoiceInput,
  PgRentEligibilityInput,
  PgRentExtendDueInput,
  PgRentIssueDraftInput,
  PgRentLineInput,
  PgRentLinePatchInput,
  PgRentWaiveFeeInput
} from "@cribliv/shared-types";

import { isIsoDate } from "../../../common/date";

const isoDate = z.string().refine(isIsoDate, "must be a real YYYY-MM-DD date");
const meta = z.record(z.string(), z.unknown()).optional();
const EDITABLE_KINDS = [
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

export const LineInputSchema = z
  .object({
    kind: z.enum(EDITABLE_KINDS),
    label: z.string().trim().min(1).max(40),
    amount_inr: z.number().int().min(-1000000).max(1000000),
    meta
  })
  .refine(
    (v) => v.amount_inr >= 0 || v.kind === "discount" || v.kind === "adjustment",
    "only discount/adjustment may be negative"
  ) satisfies z.ZodType<PgRentLineInput, PgRentLineInput>;

export const LinePatchSchema = z.object({
  label: z.string().trim().min(1).max(40).optional(),
  amount_inr: z.number().int().min(-1000000).max(1000000).optional(),
  meta
}) satisfies z.ZodType<PgRentLinePatchInput, PgRentLinePatchInput>;

export const ExtendDueSchema = z.object({
  due_date: isoDate
}) satisfies z.ZodType<PgRentExtendDueInput, PgRentExtendDueInput>;

export const CancelInvoiceSchema = z.object({
  reason: z.string().trim().min(1).max(200)
}) satisfies z.ZodType<PgRentCancelInvoiceInput, PgRentCancelInvoiceInput>;

export const IssueDraftSchema = z.object({
  rent_inr: z.number().int().min(1).max(1000000).optional(),
  due_date: isoDate.optional()
}) satisfies z.ZodType<PgRentIssueDraftInput, PgRentIssueDraftInput>;

export const ApplyFeeSchema = z.object({
  amount_inr: z.number().int().min(1).max(50000).optional()
}) satisfies z.ZodType<PgRentApplyFeeInput, PgRentApplyFeeInput>;

export const WaiveFeeSchema = z.object({
  reason: z.string().trim().min(1).max(200)
}) satisfies z.ZodType<PgRentWaiveFeeInput, PgRentWaiveFeeInput>;

export const EligibilitySchema = z.object({
  late_fee_eligible: z.boolean()
}) satisfies z.ZodType<PgRentEligibilityInput, PgRentEligibilityInput>;
