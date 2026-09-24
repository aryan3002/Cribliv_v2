import { z } from "zod";
import type {
  PgRentEvent,
  PgRentIdentityDisputeInput,
  PgRentInvoice,
  PgRentPayInstruction,
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

/** Spec §4.10 tenant-visible subset. */
export const TENANT_VISIBLE_EVENT_SQL = `
  e.event_type IN ('invoice.issued','invoice.confirmed_amount','invoice.line_added','invoice.line_updated','invoice.line_removed','invoice.due_extended','invoice.cancelled','invoice.reprorated','invoice.excess_deallocated',
                   'late_fee.applied','late_fee.updated','late_fee.removed','late_fee.waived')
  AND NOT (e.event_type = 'invoice.line_updated' AND e.payload ? 'internal_note')`;
