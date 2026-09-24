import { BadRequestException, Injectable } from "@nestjs/common";
import type { PoolClient } from "pg";
import type { PgRentAllocationTarget, PgRentInvoiceStatus } from "@cribliv/shared-types";

import { inrToPaise } from "../dto/money";
import { planAllocation, planDeallocation, type OpenInvoice } from "../pure/rent-allocation";
import { invoiceStatus } from "../pure/rent-status";
import { writeRentEvent } from "./rent-events";
import type { Queryable, RentActor } from "./rent-guards";

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

  /** Spec §5.4/§6.2. Σ (inflow.amount − Σ its allocations) over confirmed inflows for this assignment. */
  async unallocatedCredit(q: Queryable, assignmentId: string): Promise<number> {
    const r = await q.query<{ credit: string }>(
      `SELECT COALESCE(SUM(p.amount_paise - COALESCE(al.allocated, 0)), 0)::text AS credit
         FROM pg_rent_payments p
         LEFT JOIN (SELECT payment_id, SUM(amount_paise) AS allocated FROM pg_rent_payment_allocations GROUP BY payment_id) al
           ON al.payment_id = p.id
        WHERE p.assignment_id = $1::uuid AND p.direction = 'inflow' AND p.status = 'confirmed'`,
      [assignmentId]
    );
    return Number(r.rows[0].credit);
  }

  /**
   * Open (issued/partially_paid, balance > 0) invoices for an assignment.
   * `ORDER BY due_date, created_at, id` is a TOTAL order: `planAllocation`'s
   * own comparator returns 0 for two invoices sharing both a due date and a
   * kind rank (two rent invoices due the same day, or rent vs adhoc), and
   * `Array.sort` is stable, so ties fall back to the order this query hands
   * it. `due_date` alone is not unique; `created_at` breaks most ties by
   * issue order, and `id` (the primary key, always unique) breaks whatever
   * is left — without it the plan would not be reproducible across runs.
   */
  async openInvoices(q: Queryable, assignmentId: string, lock = false): Promise<OpenInvoice[]> {
    const r = await q.query<{
      id: string;
      kind: OpenInvoice["kind"];
      due_date: string;
      balance: string;
    }>(
      `SELECT id::text, kind::text, to_char(due_date, 'YYYY-MM-DD') AS due_date, (total_paise - amount_paid_paise)::text AS balance
         FROM pg_rent_invoices
        WHERE assignment_id = $1::uuid AND status IN ('issued', 'partially_paid') AND total_paise > amount_paid_paise
        ORDER BY due_date, created_at, id${lock ? " FOR UPDATE" : ""}`,
      [assignmentId]
    );
    return r.rows.map((x) => ({
      invoiceId: x.id,
      kind: x.kind,
      dueDate: x.due_date,
      balancePaise: Number(x.balance)
    }));
  }

  /**
   * Spec §6.2. The payment must be a confirmed inflow; under the normal
   * calling contract it has no allocations yet, but this plans against
   * (amount_paise − Σ existing allocations), not the gross amount, so a
   * payment that already carries some allocation by the time its lock is
   * acquired (e.g. a concurrent `fundOutflow` claim, see the locking note
   * below) is topped up rather than double-spent. A `claimed_invoice_id` is
   * a soft target: if that invoice is no longer open it is silently skipped
   * (spec §6.10 "Claim for a cancelled invoice → FIFO/credit"). Explicit
   * operator `targets` are hard: if any one of them is not an open invoice
   * of this assignment, the whole call is rejected with 400
   * `invalid_allocation`.
   *
   * Locking order: invoices before the payment, matching
   * `applyUnallocatedCredit`'s contract and never the reverse — locking the
   * payment first here would deadlock against a concurrent
   * `applyUnallocatedCredit` call on the same assignment (that method locks
   * an invoice, then this payment, as one of its candidate credits). The
   * assignment id is only known from the payment row, so it is read
   * unlocked first purely for routing; the payment is re-read and validated
   * with `FOR UPDATE` only after the invoice locks are held.
   */
  async allocateInflow(
    client: PoolClient,
    paymentId: string,
    targets: PgRentAllocationTarget[] | null,
    actor: RentActor
  ): Promise<{
    allocations: Array<{ invoiceId: string; amountPaise: number }>;
    creditPaise: number;
  }> {
    const lookup = await client.query<{ assignment_id: string }>(
      `SELECT assignment_id::text FROM pg_rent_payments WHERE id = $1::uuid`,
      [paymentId]
    );
    if (!lookup.rows[0]) {
      throw new BadRequestException({ code: "invalid_allocation", message: "Payment not found" });
    }
    const open = await this.openInvoices(client, lookup.rows[0].assignment_id, true);

    const p = await client.query<{
      assignment_id: string;
      pg_property_id: string;
      amount_paise: string;
      paid_on: string;
      direction: string;
      status: string;
      claimed_invoice_id: string | null;
    }>(
      `SELECT assignment_id::text, pg_property_id::text, amount_paise::text, to_char(paid_on,'YYYY-MM-DD') AS paid_on, direction::text, status::text, claimed_invoice_id::text
         FROM pg_rent_payments WHERE id = $1::uuid FOR UPDATE`,
      [paymentId]
    );
    const payment = p.rows[0];
    if (!payment || payment.direction !== "inflow" || payment.status !== "confirmed") {
      throw new BadRequestException({
        code: "invalid_allocation",
        message: "Only confirmed inflows can be allocated"
      });
    }

    // Locking contract §2: read Σ existing allocations for this payment in a
    // separate statement, taken only after the FOR UPDATE lock above is
    // held, so it reflects everything a concurrent writer committed while
    // this call was waiting on the invoice locks (e.g. a fundOutflow that
    // claimed part of this payment's credit for a refund). Plan against what
    // is actually left, never the gross amount — planning against the gross
    // amount would double-spend this payment's credit (Σ allocations could
    // exceed amount_paise, invariant 3) whenever it already carries an
    // allocation by the time this lock is acquired.
    const already = await client.query<{ sum: string }>(
      `SELECT COALESCE(SUM(amount_paise), 0)::text AS sum FROM pg_rent_payment_allocations WHERE payment_id = $1::uuid`,
      [paymentId]
    );
    const available = Number(payment.amount_paise) - Number(already.rows[0].sum);

    const wanted = (
      targets ??
      (payment.claimed_invoice_id
        ? [{ invoice_id: payment.claimed_invoice_id, amount_inr: null }]
        : [])
    )
      .filter((t) => open.some((o) => o.invoiceId === t.invoice_id))
      .map((t) => {
        const balance = open.find((o) => o.invoiceId === t.invoice_id)!.balancePaise;
        const requested =
          t.amount_inr === null ? Math.min(balance, available) : inrToPaise(t.amount_inr as number);
        return { invoiceId: t.invoice_id, amountPaise: requested };
      });
    if (targets && wanted.length !== targets.length) {
      throw new BadRequestException({
        code: "invalid_allocation",
        message: "An allocation target is not an open invoice of this tenant"
      });
    }
    let plan;
    try {
      plan = planAllocation(available, open, wanted);
    } catch (error) {
      throw new BadRequestException({
        code: "invalid_allocation",
        message: (error as Error).message
      });
    }
    for (const a of plan.allocations) {
      await client.query(
        `INSERT INTO pg_rent_payment_allocations (payment_id, invoice_id, amount_paise) VALUES ($1::uuid, $2::uuid, $3)`,
        [paymentId, a.invoiceId, a.amountPaise]
      );
      await this.recomputeInvoice(client, a.invoiceId, payment.paid_on);
      await writeRentEvent(client, {
        propertyId: payment.pg_property_id,
        entityType: "invoice",
        entityId: a.invoiceId,
        eventType: "allocation.changed",
        actor,
        payload: {
          payment_id: paymentId,
          allocated_paise: a.amountPaise,
          reason: targets ? "operator_split" : "fifo"
        }
      });
    }
    return plan;
  }

  /** Invariant 14 procedure (spec §6.6). Caller applies the total change and recomputes afterwards. */
  async deallocateExcess(
    client: PoolClient,
    invoiceId: string,
    excessPaise: number,
    actor: RentActor
  ): Promise<void> {
    if (excessPaise <= 0) return;
    const inv = await this.lockInvoice(client, invoiceId);
    const rows = await client.query<{
      id: string;
      payment_id: string;
      amount_paise: string;
      created_at: Date;
    }>(
      `SELECT al.id::text, al.payment_id::text, al.amount_paise::text, al.created_at
         FROM pg_rent_payment_allocations al JOIN pg_rent_payments p ON p.id = al.payment_id
        WHERE al.invoice_id = $1::uuid AND p.status = 'confirmed' ORDER BY al.created_at DESC FOR UPDATE OF al`,
      [invoiceId]
    );
    const plan = planDeallocation(
      excessPaise,
      rows.rows.map((r) => ({
        allocationId: r.id,
        paymentId: r.payment_id,
        amountPaise: Number(r.amount_paise),
        createdAt: r.created_at.toISOString()
      }))
    );
    for (const step of plan) {
      const row = rows.rows.find((r) => r.id === step.allocationId)!;
      if (step.reducePaise === Number(row.amount_paise)) {
        await client.query(`DELETE FROM pg_rent_payment_allocations WHERE id = $1::uuid`, [
          step.allocationId
        ]);
      } else {
        await client.query(
          `UPDATE pg_rent_payment_allocations SET amount_paise = amount_paise - $2 WHERE id = $1::uuid`,
          [step.allocationId, step.reducePaise]
        );
      }
      await writeRentEvent(client, {
        propertyId: inv.pg_property_id,
        entityType: "invoice",
        entityId: invoiceId,
        eventType: "invoice.excess_deallocated",
        actor,
        payload: { payment_id: step.paymentId, paise: step.reducePaise }
      });
    }
    await this.recomputeInvoice(client, invoiceId);
  }

  /** Cancel path (spec §5.7): every allocation to this invoice goes back to credit. Returns paise released. */
  async releaseAllocations(
    client: PoolClient,
    invoiceId: string,
    actor: RentActor
  ): Promise<number> {
    const inv = await this.lockInvoice(client, invoiceId);
    const rows = await client.query<{ payment_id: string; amount_paise: string }>(
      `DELETE FROM pg_rent_payment_allocations WHERE invoice_id = $1::uuid RETURNING payment_id::text, amount_paise::text`,
      [invoiceId]
    );
    let total = 0;
    for (const r of rows.rows) {
      total += Number(r.amount_paise);
      await writeRentEvent(client, {
        propertyId: inv.pg_property_id,
        entityType: "invoice",
        entityId: invoiceId,
        eventType: "invoice.excess_deallocated",
        actor,
        payload: { payment_id: r.payment_id, paise: Number(r.amount_paise), reason: "cancelled" }
      });
    }
    await this.recomputeInvoice(client, invoiceId);
    return total;
  }

  /** Reversal path: drop allocations where this payment is the source OR the funded outflow. Returns touched invoice ids. */
  async removeAllocationsOf(client: PoolClient, paymentId: string): Promise<string[]> {
    const rows = await client.query<{ invoice_id: string | null }>(
      `DELETE FROM pg_rent_payment_allocations WHERE payment_id = $1::uuid OR refund_payment_id = $1::uuid RETURNING invoice_id::text`,
      [paymentId]
    );
    const touched = Array.from(
      new Set(rows.rows.map((r) => r.invoice_id).filter((x): x is string => x !== null))
    );
    for (const invoiceId of touched) await this.recomputeInvoice(client, invoiceId);
    return touched;
  }

  /**
   * Invariant 15: an outflow is fully funded from the assignment's credit,
   * oldest inflow first, and the funding either fully succeeds or writes
   * nothing — the take-list is computed entirely in memory and checked
   * before any `INSERT`, so "never partially funds" is a property of this
   * function, not of the caller's transaction rolling back on the eventual
   * throw. Already-funded is a no-op: Σ allocations already targeting this
   * outflow is read first (after its own lock), so a second call against an
   * outflow that is already fully funded does nothing instead of doubling
   * its allocations. Postgres rejects `FOR UPDATE` combined with
   * `GROUP BY`/`HAVING` (same constraint documented on
   * `applyUnallocatedCredit`), so the lock (on payment rows only,
   * oldest-first) and the allocated-sum aggregation are two queries instead
   * of one.
   */
  async fundOutflow(client: PoolClient, outflowId: string): Promise<void> {
    const o = await client.query<{
      assignment_id: string;
      amount_paise: string;
      direction: string;
    }>(
      `SELECT assignment_id::text, amount_paise::text, direction::text FROM pg_rent_payments WHERE id = $1::uuid FOR UPDATE`,
      [outflowId]
    );
    if (!o.rows[0] || o.rows[0].direction !== "outflow")
      throw new BadRequestException({ code: "invalid_refund" });

    const funded = await client.query<{ sum: string }>(
      `SELECT COALESCE(SUM(amount_paise), 0)::text AS sum FROM pg_rent_payment_allocations WHERE refund_payment_id = $1::uuid`,
      [outflowId]
    );
    const left = Number(o.rows[0].amount_paise) - Number(funded.rows[0].sum);
    if (left <= 0) return;

    const locked = await client.query<{ id: string; amount_paise: string }>(
      `SELECT id::text, amount_paise::text
         FROM pg_rent_payments
        WHERE assignment_id = $1::uuid AND direction = 'inflow' AND status = 'confirmed'
        ORDER BY paid_on ASC, created_at ASC
        FOR UPDATE`,
      [o.rows[0].assignment_id]
    );
    const allocatedSums = locked.rows.length
      ? await client.query<{ payment_id: string; sum: string }>(
          `SELECT payment_id::text, COALESCE(SUM(amount_paise), 0)::text AS sum
             FROM pg_rent_payment_allocations
            WHERE payment_id = ANY($1::uuid[])
            GROUP BY payment_id`,
          [locked.rows.map((r) => r.id)]
        )
      : { rows: [] as Array<{ payment_id: string; sum: string }> };
    const allocatedByPayment = new Map(
      allocatedSums.rows.map((r) => [r.payment_id, Number(r.sum)])
    );

    const takes: Array<{ paymentId: string; amountPaise: number }> = [];
    let remaining = left;
    for (const c of locked.rows) {
      if (remaining <= 0) break;
      const unallocated = Number(c.amount_paise) - (allocatedByPayment.get(c.id) ?? 0);
      if (unallocated <= 0) continue;
      const take = Math.min(remaining, unallocated);
      takes.push({ paymentId: c.id, amountPaise: take });
      remaining -= take;
    }
    if (remaining > 0) {
      throw new BadRequestException({
        code: "refund_exceeds_credit",
        message: "The tenant does not have that much credit to return"
      });
    }
    for (const t of takes) {
      await client.query(
        `INSERT INTO pg_rent_payment_allocations (payment_id, refund_payment_id, amount_paise) VALUES ($1::uuid, $2::uuid, $3)`,
        [t.paymentId, outflowId, t.amountPaise]
      );
    }
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
