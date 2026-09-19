import { z } from "zod";
import type {
  PgRentEvent,
  PgRentInvoice,
  PgRentInvoiceLine,
  PgRentInvoiceListFilters
} from "@cribliv/shared-types";

import { isIsoDate } from "../../../common/date";
import { toIsoDate, toIsoTs } from "./common";
import { paiseToInr } from "./money";

export interface RentInvoiceRow {
  id: string;
  pg_property_id: string;
  assignment_id: string;
  occupant_name: string;
  bed_id: string | null;
  room_id: string | null;
  room_number: string;
  bed_label: string;
  kind: PgRentInvoice["kind"];
  invoice_number: string;
  period_start: Date | string | null;
  period_end: Date | string | null;
  billing_month: Date | string;
  due_date: Date | string;
  status: PgRentInvoice["status"];
  source: PgRentInvoice["source"];
  total_paise: string;
  amount_paid_paise: string;
  rent_snapshot_paise: string | null;
  rent_source: PgRentInvoice["rent_source"];
  proration_factor: string | null;
  late_fee_eligible: boolean;
  suggested_late_fee_paise: string | null;
  late_fee_waived_at: Date | string | null;
  reprorate_suggestion: {
    leave_on: string;
    from_paise: number;
    to_paise: number;
    mode: "reprorate" | "restore";
  } | null;
  pay_token_expires_at: Date | string | null;
  tenant_note: string | null;
  internal_note: string | null;
  issued_at: Date | string | null;
  paid_at: Date | string | null;
  settled_on: Date | string | null;
  cancelled_at: Date | string | null;
  cancel_reason: string | null;
  created_at: Date | string;
  updated_at: Date | string;
}

export interface RentLineRow {
  id: string;
  invoice_id: string;
  kind: PgRentInvoiceLine["kind"];
  label: string;
  amount_paise: string;
  meta: Record<string, unknown>;
  source: PgRentInvoiceLine["source"];
  expense_id: string | null;
  sort_order: number;
  created_at: Date | string;
}

export const INVOICE_SELECT = `
  i.id::text, i.pg_property_id::text, i.assignment_id::text, a.occupant_name,
  i.bed_id::text, i.room_id::text, i.room_number, i.bed_label, i.kind::text, i.invoice_number,
  i.period_start, i.period_end, i.billing_month, i.due_date, i.status::text, i.source::text,
  i.total_paise::text, i.amount_paid_paise::text, i.rent_snapshot_paise::text, i.rent_source::text,
  i.proration_factor::text, i.late_fee_eligible, i.suggested_late_fee_paise::text, i.late_fee_waived_at,
  i.reprorate_suggestion, i.pay_token_expires_at, i.tenant_note, i.internal_note, i.issued_at, i.paid_at, i.settled_on,
  i.cancelled_at, i.cancel_reason, i.created_at, i.updated_at`;

export const LINE_SELECT = `
  l.id::text, l.invoice_id::text, l.kind::text, l.label, l.amount_paise::text, l.meta, l.source::text,
  l.expense_id::text, l.sort_order, l.created_at`;

export function toLineDto(row: RentLineRow): PgRentInvoiceLine {
  return {
    id: row.id,
    kind: row.kind,
    label: row.label,
    amount_inr: paiseToInr(row.amount_paise),
    meta: row.meta,
    source: row.source,
    expense_id: row.expense_id,
    sort_order: row.sort_order,
    created_at: toIsoTs(row.created_at) as string
  };
}

/** Rupees out, no `_paise`, no `pay_token` (the token only ever leaves through the messages endpoint in slice 2). */
export function toInvoiceDto(row: RentInvoiceRow, lines: RentLineRow[]): PgRentInvoice {
  const total = paiseToInr(row.total_paise);
  const paid = paiseToInr(row.amount_paid_paise);
  return {
    id: row.id,
    pg_property_id: row.pg_property_id,
    assignment_id: row.assignment_id,
    occupant_name: row.occupant_name,
    bed_id: row.bed_id,
    room_id: row.room_id,
    room_number: row.room_number,
    bed_label: row.bed_label,
    kind: row.kind,
    invoice_number: row.invoice_number,
    period_start: toIsoDate(row.period_start),
    period_end: toIsoDate(row.period_end),
    billing_month: toIsoDate(row.billing_month) as string,
    due_date: toIsoDate(row.due_date) as string,
    status: row.status,
    source: row.source,
    total_inr: total,
    amount_paid_inr: paid,
    balance_inr: total - paid,
    rent_snapshot_inr:
      row.rent_snapshot_paise === null ? null : paiseToInr(row.rent_snapshot_paise),
    rent_source: row.rent_source,
    proration_factor: row.proration_factor === null ? null : Number(row.proration_factor),
    late_fee_eligible: row.late_fee_eligible,
    suggested_late_fee_inr:
      row.suggested_late_fee_paise === null ? null : paiseToInr(row.suggested_late_fee_paise),
    late_fee_waived_at: toIsoTs(row.late_fee_waived_at),
    reprorate_suggestion: row.reprorate_suggestion
      ? {
          leave_on: row.reprorate_suggestion.leave_on,
          from_inr: paiseToInr(row.reprorate_suggestion.from_paise),
          to_inr: paiseToInr(row.reprorate_suggestion.to_paise),
          mode: row.reprorate_suggestion.mode
        }
      : null,
    pay_token_expires_at: toIsoTs(row.pay_token_expires_at),
    tenant_note: row.tenant_note,
    internal_note: row.internal_note,
    issued_at: toIsoTs(row.issued_at),
    paid_at: toIsoTs(row.paid_at),
    settled_on: toIsoDate(row.settled_on),
    cancelled_at: toIsoTs(row.cancelled_at),
    cancel_reason: row.cancel_reason,
    lines: lines
      .filter((l) => l.invoice_id === row.id)
      .sort((a, b) => a.sort_order - b.sort_order)
      .map(toLineDto),
    created_at: toIsoTs(row.created_at) as string,
    updated_at: toIsoTs(row.updated_at) as string
  };
}

export const RentInvoiceListFiltersSchema = z.object({
  status: z.enum(["draft", "issued", "partially_paid", "paid", "cancelled"]).optional(),
  kind: z.enum(["rent", "deposit", "adhoc", "settlement"]).optional(),
  assignment_id: z.string().uuid().optional(),
  billing_month: z.string().refine(isIsoDate).optional()
}) satisfies z.ZodType<PgRentInvoiceListFilters, PgRentInvoiceListFilters>;

export interface RentEventRow {
  id: string;
  entity_type: PgRentEvent["entity_type"];
  entity_id: string;
  event_type: string;
  actor_user_id: string | null;
  actor_role: PgRentEvent["actor_role"];
  payload: Record<string, unknown>;
  created_at: Date | string;
}

/**
 * Recursively rewrites every `*_paise` key to `*_inr`, converting its value
 * through `paiseToInr`. Only applies when the value is a number or numeric
 * string (Fix round 1, finding 1): a `_paise` key holding `null` is left
 * untouched rather than guessed at. Non-object values pass through unchanged.
 */
export function paiseKeysToInr(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(paiseKeysToInr);
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
      if (key.endsWith("_paise") && (typeof v === "number" || typeof v === "string")) {
        out[`${key.slice(0, -"_paise".length)}_inr`] = paiseToInr(v);
      } else {
        out[key] = paiseKeysToInr(v);
      }
    }
    return out;
  }
  return value;
}

/** Event payloads cross the money boundary too (Fix round 1, finding 1): no `_paise` over HTTP. */
export function toEventDto(row: RentEventRow): PgRentEvent {
  return {
    id: row.id,
    entity_type: row.entity_type,
    entity_id: row.entity_id,
    event_type: row.event_type,
    actor_user_id: row.actor_user_id,
    actor_role: row.actor_role,
    payload: paiseKeysToInr(row.payload) as Record<string, unknown>,
    created_at: toIsoTs(row.created_at) as string
  };
}
