import { z } from "zod";
import type {
  PgRentDefaultLineItem,
  PgRentEnableInput,
  PgRentPatchSettingsInput,
  PgRentResumeInput,
  PgRentSettings,
  PgRentSettingsInput
} from "@cribliv/shared-types";

import { isIsoDate } from "../../../common/date";
import { toIsoDate, toIsoTs } from "./common";
import { inrToPaise, paiseToInr, rateInrToPaise, ratePaiseToInr } from "./money";

const LINE_KINDS_FOR_DEFAULTS = [
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

const isoDate = z.string().refine(isIsoDate, "must be a real YYYY-MM-DD date");

export function normaliseOffsets(offsets: number[]): number[] {
  return Array.from(new Set(offsets)).sort((a, b) => a - b);
}

const BankDetailsSchema = z
  .object({
    account_name: z.string().trim().min(1).max(80),
    account_number: z
      .string()
      .trim()
      .regex(/^\d{6,20}$/, "6–20 digits"),
    ifsc: z
      .string()
      .trim()
      .regex(/^[A-Z]{4}0[A-Z0-9]{6}$/, "IFSC format"),
    bank_name: z.string().trim().min(1).max(60)
  })
  .strict();

const DefaultLineItemSchema = z
  .object({
    key: z.string().regex(/^[a-z0-9_]{1,24}$/),
    kind: z.enum(LINE_KINDS_FOR_DEFAULTS),
    label: z.string().trim().min(1).max(40),
    amount_inr: z.number().int().min(1).max(100000)
  })
  .strict();

export const RentSettingsInputSchema = z.object({
  cycle_mode: z.enum(["calendar_month", "anniversary"]).optional(),
  billing_timing: z.enum(["advance", "arrears"]).optional(),
  due_day: z.number().int().min(1).max(28).optional(),
  proration_mode: z.enum(["actual_days", "flat_30"]).optional(),
  prorate_move_out: z.boolean().optional(),
  invoice_lead_days: z.number().int().min(0).max(15).optional(),
  reminder_offsets_days: z
    .array(z.number().int().min(-15).max(30))
    .min(1)
    .max(5)
    .transform(normaliseOffsets)
    .optional(),
  late_fee_enabled: z.boolean().optional(),
  late_fee_grace_days: z.number().int().min(0).max(30).optional(),
  late_fee_kind: z.enum(["flat", "per_day", "percent"]).optional(),
  late_fee_amount_inr: z.number().int().min(1).max(10000).optional(),
  late_fee_percent_bp: z.number().int().min(50).max(1000).optional(),
  late_fee_cap_inr: z.number().int().min(1).max(50000).nullable().optional(),
  late_fee_auto_apply: z.boolean().optional(),
  upi_vpa: z
    .string()
    .trim()
    .regex(/^[\w.-]{2,256}@[a-zA-Z]{2,64}$/, "UPI ID format")
    .nullable()
    .optional(),
  upi_payee_name: z.string().trim().min(1).max(50).nullable().optional(),
  bank_details: BankDetailsSchema.nullable().optional(),
  whatsapp_phone_e164: z
    .string()
    .regex(/^\+[1-9]\d{7,14}$/, "E.164")
    .nullable()
    .optional(),
  msg_reminder: z.string().max(600).nullable().optional(),
  msg_overdue: z.string().max(600).nullable().optional(),
  msg_tenant_paid: z.string().max(600).nullable().optional(),
  msg_receipt_share: z.string().max(600).nullable().optional(),
  receipt_prefix: z
    .string()
    .regex(/^[A-Z0-9]{2,6}$/, "2–6 capitals/digits")
    .optional(),
  receipt_business_name: z.string().trim().max(80).nullable().optional(),
  receipt_address: z.string().trim().max(200).nullable().optional(),
  receipt_footer: z.string().trim().max(200).nullable().optional(),
  receipt_logo_path: z.string().trim().max(300).nullable().optional(),
  default_line_items: z.array(DefaultLineItemSchema).max(10).optional(),
  electricity_unit_rate_inr: z
    .number()
    .min(0.5)
    .max(50)
    .refine((v) => Math.abs(v * 100 - Math.round(v * 100)) < 1e-6, "at most two decimals")
    .nullable()
    .optional()
}) satisfies z.ZodType<PgRentSettingsInput, PgRentSettingsInput>;

export const RentEnableInputSchema = RentSettingsInputSchema.extend({
  billing_starts_on: isoDate.optional()
}) satisfies z.ZodType<PgRentEnableInput, PgRentEnableInput>;

export const RentPatchSettingsInputSchema = RentSettingsInputSchema.extend({
  updated_at: z.string().datetime()
}) satisfies z.ZodType<PgRentPatchSettingsInput, PgRentPatchSettingsInput>;

export const RentResumeInputSchema = z.object({
  billing_starts_on: isoDate.optional()
}) satisfies z.ZodType<PgRentResumeInput, PgRentResumeInput>;

/** Every column of pg_rent_settings as the driver returns it. */
export interface RentSettingsRow {
  pg_property_id: string;
  paused_at: Date | string | null;
  pause_reason: "owner" | "transfer" | null;
  enabled_on: Date | string;
  billing_starts_on: Date | string;
  cycle_mode: "calendar_month" | "anniversary";
  billing_timing: "advance" | "arrears";
  due_day: number;
  proration_mode: "actual_days" | "flat_30";
  prorate_move_out: boolean;
  invoice_lead_days: number;
  reminder_offsets_days: number[];
  late_fee_enabled: boolean;
  late_fee_grace_days: number;
  late_fee_kind: "flat" | "per_day" | "percent";
  late_fee_amount_paise: number | string;
  late_fee_percent_bp: number;
  late_fee_cap_paise: number | string | null;
  late_fee_auto_apply: boolean;
  upi_vpa: string | null;
  upi_payee_name: string | null;
  bank_details: PgRentSettings["bank_details"];
  whatsapp_phone_e164: string | null;
  msg_reminder: string | null;
  msg_overdue: string | null;
  msg_tenant_paid: string | null;
  msg_receipt_share: string | null;
  receipt_prefix: string;
  receipt_business_name: string | null;
  receipt_address: string | null;
  receipt_footer: string | null;
  receipt_logo_path: string | null;
  default_line_items: Array<Omit<PgRentDefaultLineItem, "amount_inr"> & { amount_paise: number }>;
  electricity_unit_rate_paise: number | null;
  created_at: Date | string;
  updated_at: Date | string;
}

export function toSettingsDto(row: RentSettingsRow): PgRentSettings {
  return {
    pg_property_id: row.pg_property_id,
    paused_at: toIsoTs(row.paused_at),
    pause_reason: row.pause_reason,
    enabled_on: toIsoDate(row.enabled_on) as string,
    billing_starts_on: toIsoDate(row.billing_starts_on) as string,
    cycle_mode: row.cycle_mode,
    billing_timing: row.billing_timing,
    due_day: row.due_day,
    proration_mode: row.proration_mode,
    prorate_move_out: row.prorate_move_out,
    invoice_lead_days: row.invoice_lead_days,
    reminder_offsets_days: row.reminder_offsets_days,
    late_fee_enabled: row.late_fee_enabled,
    late_fee_grace_days: row.late_fee_grace_days,
    late_fee_kind: row.late_fee_kind,
    late_fee_amount_inr: paiseToInr(row.late_fee_amount_paise),
    late_fee_percent_bp: row.late_fee_percent_bp,
    late_fee_cap_inr: row.late_fee_cap_paise === null ? null : paiseToInr(row.late_fee_cap_paise),
    late_fee_auto_apply: row.late_fee_auto_apply,
    upi_vpa: row.upi_vpa,
    upi_payee_name: row.upi_payee_name,
    bank_details: row.bank_details,
    whatsapp_phone_e164: row.whatsapp_phone_e164,
    msg_reminder: row.msg_reminder,
    msg_overdue: row.msg_overdue,
    msg_tenant_paid: row.msg_tenant_paid,
    msg_receipt_share: row.msg_receipt_share,
    receipt_prefix: row.receipt_prefix,
    receipt_business_name: row.receipt_business_name,
    receipt_address: row.receipt_address,
    receipt_footer: row.receipt_footer,
    receipt_logo_path: row.receipt_logo_path,
    default_line_items: row.default_line_items.map((item) => ({
      key: item.key,
      kind: item.kind,
      label: item.label,
      amount_inr: paiseToInr(item.amount_paise)
    })),
    electricity_unit_rate_inr: ratePaiseToInr(row.electricity_unit_rate_paise),
    created_at: toIsoTs(row.created_at) as string,
    updated_at: toIsoTs(row.updated_at) as string
  };
}

/**
 * Input → column map for INSERT/UPDATE. Only keys present in `input` appear.
 * jsonb columns are pre-stringified so the caller binds them with `::jsonb`.
 */
export function settingsInputToColumns(input: PgRentSettingsInput): Record<string, unknown> {
  const cols: Record<string, unknown> = {};
  const copy = <K extends keyof PgRentSettingsInput>(key: K, column = key as string) => {
    if (input[key] !== undefined) cols[column] = input[key];
  };
  copy("cycle_mode");
  copy("billing_timing");
  copy("due_day");
  copy("proration_mode");
  copy("prorate_move_out");
  copy("invoice_lead_days");
  copy("reminder_offsets_days");
  copy("late_fee_enabled");
  copy("late_fee_grace_days");
  copy("late_fee_kind");
  copy("late_fee_percent_bp");
  copy("late_fee_auto_apply");
  copy("upi_vpa");
  copy("upi_payee_name");
  copy("whatsapp_phone_e164");
  copy("msg_reminder");
  copy("msg_overdue");
  copy("msg_tenant_paid");
  copy("msg_receipt_share");
  copy("receipt_prefix");
  copy("receipt_business_name");
  copy("receipt_address");
  copy("receipt_footer");
  copy("receipt_logo_path");
  if (input.late_fee_amount_inr !== undefined)
    cols.late_fee_amount_paise = inrToPaise(input.late_fee_amount_inr);
  if (input.late_fee_cap_inr !== undefined) {
    cols.late_fee_cap_paise =
      input.late_fee_cap_inr === null ? null : inrToPaise(input.late_fee_cap_inr);
  }
  if (input.bank_details !== undefined) {
    cols.bank_details = input.bank_details === null ? null : JSON.stringify(input.bank_details);
  }
  if (input.default_line_items !== undefined) {
    cols.default_line_items = JSON.stringify(
      input.default_line_items.map((item) => ({
        key: item.key,
        kind: item.kind,
        label: item.label,
        amount_paise: inrToPaise(item.amount_inr)
      }))
    );
  }
  if (input.electricity_unit_rate_inr !== undefined) {
    cols.electricity_unit_rate_paise =
      input.electricity_unit_rate_inr === null
        ? null
        : rateInrToPaise(input.electricity_unit_rate_inr);
  }
  return cols;
}
