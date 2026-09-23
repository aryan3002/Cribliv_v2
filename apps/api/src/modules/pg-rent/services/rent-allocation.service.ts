import { Injectable } from "@nestjs/common";
import type { PoolClient } from "pg";
import type { PgRentInvoiceStatus } from "@cribliv/shared-types";

import { invoiceStatus } from "../pure/rent-status";
import { writeRentEvent } from "./rent-events";
import type { RentActor } from "./rent-guards";

interface InvoiceMoneyRow {
  pg_property_id: string;
  assignment_id: string;
  status: PgRentInvoiceStatus;
  total_paise: string;
  amount_paid_paise: string;
  paid_at: Date | null;
}

interface LockedPaymentRow {
  id: string;
  amount_paise: string;
  paid_on: string;
}

interface AllocatedSumRow {
  payment_id: string;
  sum: string;
}

@Injectable()
export class RentAllocationService {
  /**
   * Spec §5.4 step 4 / §6.2 step 3. Unallocated credit = confirmed inflows'
   * amount − Σ allocations (to invoices AND to outflows, invariant 3), oldest
   * paid_on first. Never touches drafts or cancelled invoices.
   *
   * Locking contract (binding on slice 1b and every future writer of
   * pg_rent_payment_allocations):
   * 1. Lock order is always invoice row → source pg_rent_payments row(s).
   *    This method takes the invoice's FOR UPDATE lock first, then locks the
   *    candidate inflow payments; never lock in the reverse order (a writer
   *    that locks payment → invoice can deadlock against a concurrent call
   *    to this method).
   * 2. Before inserting, updating or deleting any pg_rent_payment_allocations
   *    row, first `SELECT … FOR UPDATE` the source inflow payment row(s),
   *    then read Σ allocations for that payment in a separate statement.
   *    Under READ COMMITTED, the second statement's snapshot is taken after
   *    the lock wait, so it sees every allocation committed by whoever held
   *    the lock before you — reading Σ allocations without first locking the
   *    payment (or reading it in the same snapshot as an earlier, unlocked
   *    read) can double-spend the same unallocated credit across concurrent
   *    callers.
   * 3. recomputeInvoice re-takes the invoice's FOR UPDATE lock itself, so it
   *    is safe to call standalone (not only from inside this method).
   */
  async applyUnallocatedCredit(
    client: PoolClient,
    invoiceId: string,
    actor: RentActor
  ): Promise<number> {
    const invoice = await this.lockInvoice(client, invoiceId);
    if (invoice.status === "draft" || invoice.status === "cancelled") return 0;
    let balance = Number(invoice.total_paise) - Number(invoice.amount_paid_paise);
    if (balance <= 0) return 0;

    // Postgres rejects `FOR UPDATE` combined with `GROUP BY`, so the lock (on
    // payment rows only, oldest-first) and the allocated-sum aggregation are
    // two queries instead of one; the merge below preserves the same order
    // and the same "unallocated = amount - Σ allocations" arithmetic.
    const locked = await client.query<LockedPaymentRow>(
      `SELECT p.id::text AS id, p.amount_paise::text AS amount_paise, to_char(p.paid_on, 'YYYY-MM-DD') AS paid_on
         FROM pg_rent_payments p
        WHERE p.assignment_id = $1::uuid AND p.direction = 'inflow' AND p.status = 'confirmed'
        ORDER BY p.paid_on ASC, p.created_at ASC
        FOR UPDATE OF p`,
      [invoice.assignment_id]
    );

    const allocatedSums = locked.rows.length
      ? await client.query<AllocatedSumRow>(
          `SELECT payment_id::text, COALESCE(SUM(amount_paise), 0)::text AS sum
             FROM pg_rent_payment_allocations
            WHERE payment_id = ANY($1::uuid[])
            GROUP BY payment_id`,
          [locked.rows.map((r) => r.id)]
        )
      : { rows: [] as AllocatedSumRow[] };
    const allocatedByPayment = new Map(
      allocatedSums.rows.map((r) => [r.payment_id, Number(r.sum)])
    );

    let applied = 0;
    let lastPaidOn: string | null = null;
    for (const payment of locked.rows) {
      if (balance <= 0) break;
      const unallocated = Number(payment.amount_paise) - (allocatedByPayment.get(payment.id) ?? 0);
      if (unallocated <= 0) continue;
      const take = Math.min(balance, unallocated);
      await client.query(
        `INSERT INTO pg_rent_payment_allocations (payment_id, invoice_id, amount_paise) VALUES ($1::uuid, $2::uuid, $3)`,
        [payment.id, invoiceId, take]
      );
      applied += take;
      balance -= take;
      lastPaidOn = payment.paid_on;
    }
    if (applied === 0) return 0;

    await this.recomputeInvoice(client, invoiceId, lastPaidOn);
    await writeRentEvent(client, {
      propertyId: invoice.pg_property_id,
      entityType: "invoice",
      entityId: invoiceId,
      eventType: "allocation.changed",
      actor,
      payload: { reason: "credit_auto_apply", applied_paise: applied }
    });
    return applied;
  }

  /**
   * Invariants 2 and 4 for one invoice. `settledOn` is the paid_on of the
   * payment that closed the balance; kept only when the balance reaches zero
   * for the first time (spec §4.4 settled_on).
   */
  async recomputeInvoice(
    client: PoolClient,
    invoiceId: string,
    settledOn: string | null = null
  ): Promise<PgRentInvoiceStatus> {
    const invoice = await this.lockInvoice(client, invoiceId);
    const sums = await client.query<{ paid: string }>(
      `SELECT COALESCE(SUM(a.amount_paise), 0)::text AS paid
         FROM pg_rent_payment_allocations a JOIN pg_rent_payments p ON p.id = a.payment_id
        WHERE a.invoice_id = $1::uuid AND p.status = 'confirmed'`,
      [invoiceId]
    );
    const paid = Number(sums.rows[0].paid);
    const total = Number(invoice.total_paise);
    const status = invoiceStatus({
      draft: invoice.status === "draft",
      cancelled: invoice.status === "cancelled",
      totalPaise: total,
      paidPaise: paid
    });
    const reachedZero = status === "paid" && total > 0;
    await client.query(
      `UPDATE pg_rent_invoices
          SET amount_paid_paise = $2,
              status = $3::pg_rent_invoice_status,
              paid_at = CASE WHEN $4::boolean THEN COALESCE(paid_at, now()) ELSE NULL END,
              settled_on = CASE WHEN $4::boolean THEN COALESCE(settled_on, $5::date) ELSE NULL END
        WHERE id = $1::uuid`,
      [invoiceId, paid, status, reachedZero, settledOn]
    );
    return status;
  }

  private async lockInvoice(client: PoolClient, invoiceId: string): Promise<InvoiceMoneyRow> {
    const result = await client.query<InvoiceMoneyRow>(
      `SELECT pg_property_id::text, assignment_id::text, status::text, total_paise::text, amount_paid_paise::text, paid_at
         FROM pg_rent_invoices WHERE id = $1::uuid FOR UPDATE`,
      [invoiceId]
    );
    if (!result.rows[0]) throw new Error(`invoice ${invoiceId} not found`);
    return result.rows[0];
  }
}
