import type { PoolClient } from "pg";

import type { LateFeePolicy } from "../pure/rent-late-fee";
import type { RentAllocationService } from "./rent-allocation.service";
import { writeRentEvent } from "./rent-events";
import type { RentActor } from "./rent-guards";

export interface FeeContext {
  policy: LateFeePolicy | null; // null = property policy disabled
  invoice: {
    id: string;
    propertyId: string;
    kind: string;
    status: string;
    dueDate: string;
    totalPaise: number;
    paidPaise: number;
    eligible: boolean;
    waivedAt: Date | null;
    computedAt: Date | null;
    overridePaise: number | null;
    exempt: boolean;
    suggestedPaise: number | null;
  };
  feeLinePaise: number | null;
}

export async function loadFeeContext(client: PoolClient, invoiceId: string): Promise<FeeContext> {
  const r = await client.query<{
    id: string;
    pg_property_id: string;
    kind: string;
    status: string;
    due_date: string;
    total_paise: string;
    amount_paid_paise: string;
    late_fee_eligible: boolean;
    late_fee_waived_at: Date | null;
    late_fee_computed_at: Date | null;
    suggested_late_fee_paise: string | null;
    late_fee_override_paise: string | null;
    late_fee_exempt: boolean;
    fee_line: string | null;
    late_fee_enabled: boolean | null;
    late_fee_kind: string | null;
    late_fee_amount_paise: string | null;
    late_fee_percent_bp: number | null;
    late_fee_cap_paise: string | null;
    late_fee_grace_days: number | null;
  }>(
    `SELECT i.id::text, i.pg_property_id::text, i.kind::text, i.status::text, to_char(i.due_date,'YYYY-MM-DD') AS due_date, i.total_paise::text, i.amount_paid_paise::text,
            i.late_fee_eligible, i.late_fee_waived_at, i.late_fee_computed_at, i.suggested_late_fee_paise::text,
            a.late_fee_override_paise::text, a.late_fee_exempt,
            (SELECT l.amount_paise::text FROM pg_rent_invoice_lines l WHERE l.invoice_id = i.id AND l.kind = 'late_fee') AS fee_line,
            s.late_fee_enabled, s.late_fee_kind::text, s.late_fee_amount_paise::text, s.late_fee_percent_bp, s.late_fee_cap_paise::text, s.late_fee_grace_days
       FROM pg_rent_invoices i
       JOIN pg_bed_assignments a ON a.id = i.assignment_id
       LEFT JOIN pg_rent_settings s ON s.pg_property_id = i.pg_property_id
      WHERE i.id = $1::uuid FOR UPDATE OF i`,
    [invoiceId]
  );
  const x = r.rows[0];
  if (!x) throw new Error(`invoice ${invoiceId} not found`);
  return {
    policy: x.late_fee_enabled
      ? {
          kind: x.late_fee_kind as LateFeePolicy["kind"],
          amountPaise: Number(x.late_fee_amount_paise),
          percentBp: Number(x.late_fee_percent_bp),
          capPaise: x.late_fee_cap_paise === null ? null : Number(x.late_fee_cap_paise),
          graceDays: Number(x.late_fee_grace_days)
        }
      : null,
    invoice: {
      id: x.id,
      propertyId: x.pg_property_id,
      kind: x.kind,
      status: x.status,
      dueDate: x.due_date,
      totalPaise: Number(x.total_paise),
      paidPaise: Number(x.amount_paid_paise),
      eligible: x.late_fee_eligible,
      waivedAt: x.late_fee_waived_at,
      computedAt: x.late_fee_computed_at,
      overridePaise: x.late_fee_override_paise === null ? null : Number(x.late_fee_override_paise),
      exempt: x.late_fee_exempt,
      suggestedPaise:
        x.suggested_late_fee_paise === null ? null : Number(x.suggested_late_fee_paise)
    },
    feeLinePaise: x.fee_line === null ? null : Number(x.fee_line)
  };
}

/** total = Σ lines (invariant 1). Status is recomputed by the caller via RentAllocationService.recomputeInvoice. */
export async function setInvoiceTotalFromLines(
  client: PoolClient,
  invoiceId: string
): Promise<number> {
  const r = await client.query<{ total: string }>(
    `UPDATE pg_rent_invoices i SET total_paise = COALESCE((SELECT SUM(amount_paise) FROM pg_rent_invoice_lines WHERE invoice_id = i.id), 0)
      WHERE i.id = $1::uuid RETURNING total_paise::text AS total`,
    [invoiceId]
  );
  return Number(r.rows[0].total);
}

/**
 * Apply a computeLateFee decision to the invoice's single late_fee line.
 * Reductions run deallocateExcess first (invariant 14). `applyMode` decides
 * whether a positive fee becomes a line (auto_apply / owner tap) or a suggestion.
 */
export async function applyFeeDecision(
  client: PoolClient,
  alloc: RentAllocationService,
  ctx: FeeContext,
  decision: { feePaise: number; action: "none" | "apply" | "update" | "remove" | "freeze" },
  actor: RentActor,
  /**
   * `settledOn` (carried requirement, Task 5): the date to stamp on
   * `settled_on` if this decision is the one that closes the invoice's
   * balance to zero. Every caller that can leave the invoice `paid` — Task 4's
   * finalizeConfirmed already passes its payment's paid_on via a follow-up
   * recomputeInvoice call, but a fee change with no payment in play (waive,
   * extend-due, owner-applied fee) has no payment date to draw on, so those
   * callers pass today's IST date. Omitted = null, matching recomputeInvoice's
   * own default (spec §4.4 is violated only when a `paid` invoice keeps a NULL
   * settled_on, never by a non-paid one, so the default is safe for the
   * "none"/"freeze"/"suggest" paths that never reach paid here).
   */
  opts: { applyMode: "line" | "suggest"; reason?: string; settledOn?: string }
): Promise<void> {
  const { invoice } = ctx;
  const event = (type: string, payload: Record<string, unknown>) =>
    writeRentEvent(client, {
      propertyId: invoice.propertyId,
      entityType: "invoice",
      entityId: invoice.id,
      eventType: type,
      actor,
      payload
    });

  if (decision.action === "none") return;

  if (decision.action === "freeze") {
    await client.query(
      `UPDATE pg_rent_invoices SET late_fee_computed_at = COALESCE(late_fee_computed_at, now()) WHERE id = $1::uuid`,
      [invoice.id]
    );
    return;
  }

  if (decision.action === "remove") {
    if (ctx.feeLinePaise !== null) {
      const newTotal = invoice.totalPaise - ctx.feeLinePaise;
      if (invoice.paidPaise > newTotal)
        await alloc.deallocateExcess(client, invoice.id, invoice.paidPaise - newTotal, actor);
      await client.query(
        `DELETE FROM pg_rent_invoice_lines WHERE invoice_id = $1::uuid AND kind = 'late_fee'`,
        [invoice.id]
      );
      await setInvoiceTotalFromLines(client, invoice.id);
    }
    await client.query(
      `UPDATE pg_rent_invoices SET suggested_late_fee_paise = NULL, late_fee_computed_at = NULL WHERE id = $1::uuid`,
      [invoice.id]
    );
    await alloc.recomputeInvoice(client, invoice.id, opts.settledOn ?? null);
    await event("late_fee.removed", {
      reason: opts.reason ?? "recomputed",
      previous_paise: ctx.feeLinePaise ?? invoice.suggestedPaise
    });
    return;
  }

  if (opts.applyMode === "suggest" && ctx.feeLinePaise === null) {
    await client.query(
      `UPDATE pg_rent_invoices SET suggested_late_fee_paise = $2 WHERE id = $1::uuid`,
      [invoice.id, decision.feePaise]
    );
    await event("late_fee.suggested", { paise: decision.feePaise });
    return;
  }

  // apply / update as a line
  if (ctx.feeLinePaise === null) {
    await client.query(
      `INSERT INTO pg_rent_invoice_lines (invoice_id, kind, label, amount_paise, source, sort_order) VALUES ($1::uuid, 'late_fee', 'Late fee', $2, 'system', 99)`,
      [invoice.id, decision.feePaise]
    );
    await client.query(
      `UPDATE pg_rent_invoices SET suggested_late_fee_paise = NULL, late_fee_computed_at = now() WHERE id = $1::uuid`,
      [invoice.id]
    );
    await setInvoiceTotalFromLines(client, invoice.id);
    await alloc.recomputeInvoice(client, invoice.id, opts.settledOn ?? null);
    await event("late_fee.applied", { paise: decision.feePaise });
    return;
  }
  const newTotal = invoice.totalPaise - ctx.feeLinePaise + decision.feePaise;
  if (invoice.paidPaise > newTotal)
    await alloc.deallocateExcess(client, invoice.id, invoice.paidPaise - newTotal, actor);
  await client.query(
    `UPDATE pg_rent_invoice_lines SET amount_paise = $2 WHERE invoice_id = $1::uuid AND kind = 'late_fee'`,
    [invoice.id, decision.feePaise]
  );
  await setInvoiceTotalFromLines(client, invoice.id);
  await alloc.recomputeInvoice(client, invoice.id, opts.settledOn ?? null);
  await event("late_fee.updated", { from_paise: ctx.feeLinePaise, to_paise: decision.feePaise });
}
