import { z } from "zod";
import type {
  PgRentEvent,
  PgRentIdentityDisputeInput,
  PgRentInvoice,
  PgRentPayInstruction,
  PgRentSettlementStatement,
  PgRentTenantInvoice
} from "@cribliv/shared-types";

export const IdentityDisputeSchema = z.object({
  assignment_id: z.string().uuid()
}) satisfies z.ZodType<PgRentIdentityDisputeInput, PgRentIdentityDisputeInput>;

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
    pay_link: extras.pay_link,
    instruction: extras.instruction,
    changes: extras.changes
  };
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
