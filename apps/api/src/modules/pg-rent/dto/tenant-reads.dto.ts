import { z } from "zod";
import type {
  PgRentEvent,
  PgRentIdentityDisputeInput,
  PgRentInvoice,
  PgRentPayInstruction,
  PgRentPayment,
  PgRentReceipt,
  PgRentSettlementStatement,
  PgRentTenantInvoice
} from "@cribliv/shared-types";

import { paiseKeysToInr } from "./invoice.dto";

export const IdentityDisputeSchema = z.object({
  assignment_id: z.string().uuid()
}) satisfies z.ZodType<PgRentIdentityDisputeInput, PgRentIdentityDisputeInput>;

/**
 * Whitelist for tenant-visible line `meta` (spec §9). Grepping every writer of
 * `pg_rent_invoice_lines.meta` turns up exactly two system-written keys that are
 * legitimate display data: `proration_factor` (the partial-period factor for a rent
 * line, set by rent-invoice-engine.service.ts's planNextRent) and `key` (which
 * default line item this is, same file). Everything else is owner/operator-only:
 * `reprorated` (rent-invoice.service.ts's applyReprorate/restoreReprorate baseline —
 * spec §5.8 says the re-proration offer itself is owner-only) and any operator
 * free-form meta from PATCH .../lines/:id (invoice-actions.dto.ts's
 * `z.record(z.unknown())` — spec-unbounded, could hold anything). `_paise` keys are
 * converted before the whitelist filter runs so a kept key never carries one.
 */
const TENANT_LINE_META_KEYS = ["proration_factor", "key"] as const;

function toTenantLineMeta(meta: Record<string, unknown>): Record<string, unknown> {
  const converted = paiseKeysToInr(meta) as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of TENANT_LINE_META_KEYS) {
    if (key in converted) out[key] = converted[key];
  }
  return out;
}

/** Spec §9: the tenant sees the invoice the owner sees, minus owner-only fields. */
export function toTenantInvoiceDto(
  dto: PgRentInvoice,
  extras: {
    pay_link: string | null;
    instruction: PgRentPayInstruction | null;
    changes: PgRentEvent[];
  }
): PgRentTenantInvoice {
  const {
    internal_note: _i,
    rent_snapshot_inr: _r,
    rent_source: _s,
    suggested_late_fee_inr: _f,
    reprorate_suggestion: _p,
    ...rest
  } = dto;
  return {
    ...rest,
    lines: rest.lines.map((line) => ({ ...line, meta: toTenantLineMeta(line.meta) })),
    pay_link: extras.pay_link,
    instruction: extras.instruction,
    changes: extras.changes
  };
}

/**
 * Spec §9: the tenant sees method, reference, and the amounts/dates/status needed to
 * render history — not `note` (free text the OWNER typed while recording a payment),
 * `recorded_by`, or `confirmed_by` (both internal actor ids). Exception: a payment the
 * tenant claimed themselves (`source: 'tenant_claim'`, rent-payment.service.ts's
 * claimByTenant) carries the tenant's own note, so that one is kept.
 * `PgRentPayment` is used verbatim (not an `Omit`) on `PgRentTenantHero.pending_claim`
 * and `PgRentTenantHistory.payments` (shared-types is not edited here), so the fields
 * are nulled in place rather than stripped from the shape — same pattern as
 * `toTenantSettlementDto` below.
 */
export function toTenantPaymentDto(p: PgRentPayment): PgRentPayment {
  return {
    ...p,
    note: p.source === "tenant_claim" ? p.note : null,
    recorded_by: null,
    confirmed_by: null
  };
}

/**
 * Spec §9: `last_error` (a PDF-render failure detail) is operator-only diagnostics.
 * `PgRentReceipt` is used verbatim on `PgRentTenantHero.last_receipt` and
 * `PgRentTenantHistory.receipts`, so the field is nulled in place.
 */
export function toTenantReceiptDto(r: PgRentReceipt): PgRentReceipt {
  return { ...r, last_error: null };
}

/**
 * Fix round 1 (Task 5 review): spec §9/§6.11 — `pending_suggestion` (an unactioned
 * final-period re-proration offer) and `maintenance_prefills` (chargeable-damage line
 * items the owner is only being OFFERED, not yet charged) are owner-only. The tenant's
 * settlement view is deposit − dues − applied deductions; suggested/unapplied items are
 * invisible to them.
 *
 * `PgRentTenantHero.settlement` is typed as the full `PgRentSettlementStatement` (Task 1,
 * shared-types) rather than an Omit — that type is not edited here — so the two owner-only
 * fields are nulled/emptied in place instead of stripped from the shape.
 */
export function toTenantSettlementDto(s: PgRentSettlementStatement): PgRentSettlementStatement {
  return { ...s, pending_suggestion: null, maintenance_prefills: [] };
}

/** Spec §4.10 tenant-visible subset. */
export const TENANT_VISIBLE_EVENT_SQL = `
  e.event_type IN ('invoice.issued','invoice.confirmed_amount','invoice.line_added','invoice.line_updated','invoice.line_removed','invoice.due_extended','invoice.cancelled','invoice.reprorated','invoice.excess_deallocated',
                   'late_fee.applied','late_fee.updated','late_fee.removed','late_fee.waived')
  AND NOT (e.event_type = 'invoice.line_updated' AND e.payload ? 'internal_note')`;
