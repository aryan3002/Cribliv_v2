import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException
} from "@nestjs/common";
import type {
  PgRentForfeitInput,
  PgRentInvoice,
  PgRentSettleInput,
  PgRentSettlementStatement,
  PgRentSettlementStatus
} from "@cribliv/shared-types";

import { DatabaseService } from "../../../common/database.service";
import { todayIst } from "../../../common/date";
import { transaction } from "../../../common/transaction";
import { inrToPaise, paiseToInr } from "../dto/money";
import { settlementNet } from "../pure/rent-settlement";
import { RentAllocationService } from "./rent-allocation.service";
import { writeRentEvent } from "./rent-events";
import { setInvoiceTotalFromLines } from "./rent-fee-line";
import { assertManagedOwnership, requireDb, type Queryable, type RentActor } from "./rent-guards";
import { RentInvoiceEngineService } from "./rent-invoice-engine.service";
import { RentInvoiceService } from "./rent-invoice.service";
import { RentPaymentService } from "./rent-payment.service";

const LEAVING = [
  "notice_served",
  "move_out_requested",
  "move_out_pending_confirmation",
  "moved_out"
];

@Injectable()
export class RentSettlementService {
  constructor(
    @Inject(DatabaseService) private readonly db: DatabaseService,
    @Inject(RentAllocationService) private readonly alloc: RentAllocationService,
    @Inject(RentPaymentService) private readonly payments: RentPaymentService,
    @Inject(RentInvoiceService) private readonly invoices: RentInvoiceService,
    @Inject(RentInvoiceEngineService) private readonly engine: RentInvoiceEngineService
  ) {}

  /** Spec §6.11 "Before the statement": generate first so the final cut period exists. */
  async statement(
    operatorId: string,
    propertyId: string,
    assignmentId: string
  ): Promise<PgRentSettlementStatement> {
    requireDb(this.db);
    await assertManagedOwnership(this.db, operatorId, propertyId);
    await this.engine.generateInvoicesForProperty(
      propertyId,
      todayIst(),
      { id: operatorId, role: "pg_operator" },
      { assignmentId }
    );
    return this.compute(this.db, propertyId, assignmentId);
  }

  private async compute(
    q: Queryable,
    propertyId: string,
    assignmentId: string,
    extraDeductionsPaise = 0
  ): Promise<PgRentSettlementStatement> {
    const a = await q.query<{ status: string }>(
      `SELECT status::text FROM pg_bed_assignments WHERE id = $1::uuid AND pg_property_id = $2::uuid`,
      [assignmentId, propertyId]
    );
    if (!a.rows[0]) throw new NotFoundException({ code: "assignment_not_found" });

    const deposit = await q.query<{ paid: string; total: string }>(
      `SELECT COALESCE(SUM(amount_paid_paise),0)::text AS paid, COALESCE(SUM(total_paise),0)::text AS total FROM pg_rent_invoices WHERE assignment_id = $1::uuid AND kind = 'deposit' AND status <> 'cancelled'`,
      [assignmentId]
    );
    const released = await q.query<{ v: string }>(
      `SELECT COALESCE(SUM(amount_paise),0)::text AS v FROM pg_rent_payments WHERE assignment_id = $1::uuid AND source = 'deposit_release' AND status = 'confirmed'`,
      [assignmentId]
    );
    const depositHeld = Number(deposit.rows[0].paid) - Number(released.rows[0].v);
    const depositUncollected = Number(deposit.rows[0].total) - Number(deposit.rows[0].paid);
    const credit = await this.alloc.unallocatedCredit(q, assignmentId);
    const open = await q.query<{
      id: string;
      invoice_number: string;
      kind: PgRentInvoice["kind"];
      balance: string;
    }>(
      `SELECT id::text, invoice_number, kind::text, (total_paise - amount_paid_paise)::text AS balance FROM pg_rent_invoices
        WHERE assignment_id = $1::uuid AND status IN ('issued','partially_paid') AND kind <> 'deposit' ORDER BY due_date`,
      [assignmentId]
    );
    const openDues = open.rows.reduce((s, r) => s + Number(r.balance), 0);
    const suggestion = await q.query<{
      id: string;
      s: { leave_on: string; from_paise: number; to_paise: number; mode: string };
    }>(
      `SELECT id::text, reprorate_suggestion AS s FROM pg_rent_invoices WHERE assignment_id = $1::uuid AND reprorate_suggestion->>'mode' = 'reprorate' LIMIT 1`,
      [assignmentId]
    );
    const settlementInv = await q.query<{ id: string }>(
      `SELECT id::text FROM pg_rent_invoices WHERE assignment_id = $1::uuid AND kind = 'settlement' AND status <> 'cancelled'`,
      [assignmentId]
    );
    const deductions = settlementInv.rows[0]
      ? (
          await q.query<{
            kind: PgRentInvoice["kind"] extends never
              ? never
              : "damage" | "cleaning" | "forfeit" | "other";
            label: string;
            amount: string;
          }>(
            `SELECT kind::text, label, amount_paise::text AS amount FROM pg_rent_invoice_lines WHERE invoice_id = $1::uuid AND kind <> 'adjustment' ORDER BY sort_order`,
            [settlementInv.rows[0].id]
          )
        ).rows
      : [];
    const maintenance = await q.query<{ id: string; label: string; cost: string | null }>(
      `SELECT id::text, category || ': ' || left(description, 30) AS label, resolution_cost_paise::text AS cost FROM pg_maintenance_requests
        WHERE assignment_id = $1::uuid AND chargeable_damage = true ORDER BY created_at DESC LIMIT 10`,
      [assignmentId]
    );

    // A settlement invoice can only ever be created inside settle(), so its
    // (non-cancelled) existence already means settle() ran to completion.
    // `released > 0` is the reversible half of the signal — reversing the
    // deposit_release payment (test: "re-settle updates the same settlement
    // invoice after a reversed release") must un-settle so the operator can
    // re-run settle(). But when the deposit was never collected in the first
    // place (depositHeld is 0 both before and after settle(), since there is
    // nothing to release — settle() takes the applyUnallocatedCredit branch,
    // not releaseDeposit, and writes no deposit_release payment at all)
    // `released > 0` can never become true, so it alone would leave a
    // genuinely completed settlement stuck at "leaving" forever. depositHeld
    // === 0 covers exactly that case without misfiring on a reversal: a
    // reversed release makes the deposit invoice's own paid amount exceed
    // released again (nothing was ever deducted from it), so depositHeld
    // goes back to a positive number, not 0.
    const settled =
      settlementInv.rows.length > 0 && (Number(released.rows[0].v) > 0 || depositHeld === 0);
    const leaving = LEAVING.includes(a.rows[0].status);
    let status: PgRentSettlementStatus = !leaving ? "not_leaving" : settled ? "settled" : "leaving";
    // settlement-invoice dues are already in openDues; deductions being entered now come via extraDeductionsPaise
    const { net, toReturn } = settlementNet({
      depositHeld,
      credit,
      openDues,
      deductions: extraDeductionsPaise
    });
    if (
      leaving &&
      !settled &&
      depositHeld === 0 &&
      credit === 0 &&
      openDues === 0 &&
      depositUncollected === 0 &&
      !suggestion.rows[0]
    )
      status = "nothing_to_settle";

    return {
      assignment_id: assignmentId,
      status,
      deposit_held_inr: paiseToInr(depositHeld),
      credit_inr: paiseToInr(credit),
      open_dues_inr: paiseToInr(openDues),
      open_invoices: open.rows.map((r) => ({
        invoice_id: r.id,
        invoice_number: r.invoice_number,
        kind: r.kind,
        balance_inr: paiseToInr(r.balance)
      })),
      deposit_uncollected_inr: paiseToInr(depositUncollected),
      pending_suggestion: suggestion.rows[0]
        ? {
            invoice_id: suggestion.rows[0].id,
            leave_on: suggestion.rows[0].s.leave_on,
            from_inr: paiseToInr(suggestion.rows[0].s.from_paise),
            to_inr: paiseToInr(suggestion.rows[0].s.to_paise)
          }
        : null,
      maintenance_prefills: maintenance.rows.map((m) => ({
        request_id: m.id,
        label: m.label,
        amount_inr: m.cost === null ? null : paiseToInr(m.cost)
      })),
      deductions: deductions.map((d) => ({
        kind: d.kind,
        label: d.label,
        amount_inr: paiseToInr(d.amount)
      })),
      net_inr: paiseToInr(net),
      to_return_inr: paiseToInr(toReturn),
      settlement_invoice_id: settlementInv.rows[0]?.id ?? null
    };
  }

  /** Spec §6.11 steps 0–5 in one transaction. Idempotent by key (stored on the deposit-release payment). */
  async settle(
    operatorId: string,
    propertyId: string,
    assignmentId: string,
    input: PgRentSettleInput,
    idempotencyKey: string
  ): Promise<PgRentSettlementStatement> {
    requireDb(this.db);
    const actor: RentActor = { id: operatorId, role: "pg_operator" };
    const dup = await this.db.query(
      `SELECT 1 FROM pg_rent_payments WHERE pg_property_id = $1::uuid AND idempotency_key = $2`,
      [propertyId, idempotencyKey]
    );
    if (dup.rowCount) return this.statement(operatorId, propertyId, assignmentId);

    await this.engine.generateInvoicesForProperty(propertyId, todayIst(), actor, { assignmentId });
    await transaction(this.db, async (client) => {
      // Lock order: pg_properties (this call) → pg_rent_counters (none needed
      // here — settlement never mints a numbered invoice/receipt) →
      // pg_rent_invoices (deposit + settlement, below) → pg_rent_payments
      // (deposit release / refund, below). Every UPDATE pg_rent_invoices and
      // every INSERT INTO pg_rent_events takes an implicit FK FOR KEY SHARE
      // on the parent pg_properties row, which conflicts with the FOR UPDATE
      // every operator transaction holds — settle() writes both, so the
      // property lock must come first (Task 6's production deadlock).
      await assertManagedOwnership(client, operatorId, propertyId, true);
      const a = await client.query<{ status: string }>(
        `SELECT status::text FROM pg_bed_assignments WHERE id = $1::uuid AND pg_property_id = $2::uuid FOR UPDATE`,
        [assignmentId, propertyId]
      );
      if (!a.rows[0]) throw new NotFoundException({ code: "assignment_not_found" });
      if (!LEAVING.includes(a.rows[0].status)) throw new ConflictException({ code: "not_leaving" });
      const pending = await client.query(
        `SELECT 1 FROM pg_rent_invoices WHERE assignment_id = $1::uuid AND reprorate_suggestion->>'mode' = 'reprorate'`,
        [assignmentId]
      );
      if (pending.rowCount)
        throw new ConflictException({
          code: "suggestion_pending",
          message: "Act on the final-period re-proration first"
        });
      const live = await client.query(
        `SELECT 1 FROM pg_rent_payments WHERE assignment_id = $1::uuid AND source = 'deposit_release' AND status = 'confirmed'`,
        [assignmentId]
      );
      if (live.rowCount)
        throw new ConflictException({
          code: "already_settled",
          message: "Reverse the deposit release to re-settle"
        });

      // step 0: write the uncollected deposit down. Not a payment (there is
      // no paid_on to attribute this to) — an operator mutation of the
      // invoice's own lines/total, so `settledOn` is today's IST date if
      // this is what first zeroes the balance (carried requirement 3 / spec
      // §4.4; same rule as RentInvoiceService.settleTotal).
      const dep = await client.query<{ id: string; total: string; paid: string }>(
        `SELECT id::text, total_paise::text AS total, amount_paid_paise::text AS paid FROM pg_rent_invoices WHERE assignment_id = $1::uuid AND kind = 'deposit' AND status IN ('issued','partially_paid') FOR UPDATE`,
        [assignmentId]
      );
      if (dep.rows[0]) {
        const shortfall = Number(dep.rows[0].total) - Number(dep.rows[0].paid);
        await client.query(
          `INSERT INTO pg_rent_invoice_lines (invoice_id, kind, label, amount_paise, source, sort_order, created_by) VALUES ($1::uuid, 'adjustment', 'Not collected at move-out', $2, 'operator', 50, $3::uuid)`,
          [dep.rows[0].id, -shortfall, operatorId]
        );
        await setInvoiceTotalFromLines(client, dep.rows[0].id);
        await this.alloc.recomputeInvoice(client, dep.rows[0].id, todayIst());
        await writeRentEvent(client, {
          propertyId,
          entityType: "invoice",
          entityId: dep.rows[0].id,
          eventType: "invoice.line_added",
          actor,
          payload: { reason: "deposit_settled", amount_paise: -shortfall }
        });
      }

      // step 1: settlement invoice (create or replace its deduction lines)
      const deductions = input.deductions.map((d) => ({
        kind: d.kind,
        label: d.label,
        amountPaise: inrToPaise(d.amount_inr)
      }));
      const existing = await client.query<{ id: string }>(
        `SELECT id::text FROM pg_rent_invoices WHERE assignment_id = $1::uuid AND kind = 'settlement' AND status <> 'cancelled' FOR UPDATE`,
        [assignmentId]
      );
      let settlementId: string;
      if (existing.rows[0]) {
        settlementId = existing.rows[0].id;
        await client.query(`DELETE FROM pg_rent_invoice_lines WHERE invoice_id = $1::uuid`, [
          settlementId
        ]);
        for (const [i, d] of deductions.entries()) {
          await client.query(
            `INSERT INTO pg_rent_invoice_lines (invoice_id, kind, label, amount_paise, source, sort_order, created_by) VALUES ($1::uuid, $2::pg_rent_line_kind, $3, $4, 'operator', $5, $6::uuid)`,
            [settlementId, d.kind, d.label, d.amountPaise, i, operatorId]
          );
        }
        await setInvoiceTotalFromLines(client, settlementId);
        // Same rule as step 0: replacing lines is an operator mutation, not
        // a payment — pass today's IST date so a replace that happens to
        // zero the balance (e.g. re-settling with deductions that exactly
        // match what is already allocated) still gets a settled_on.
        await this.alloc.recomputeInvoice(client, settlementId, todayIst());
        await writeRentEvent(client, {
          propertyId,
          entityType: "invoice",
          entityId: settlementId,
          eventType: "invoice.line_updated",
          actor,
          payload: { reason: "settlement_replaced", deductions }
        });
      } else {
        settlementId = await this.invoices.insertSettlementInvoice(client, {
          propertyId,
          assignmentId,
          deductions,
          actor
        });
      }

      // "settlement.created" describes what was just decided (steps 0-1),
      // so it has to land before the deposit-release / refund events steps
      // 2-3 write next — otherwise the event log would read as effect before
      // cause (deposit released, then "settlement created"). Snapshot the
      // pre-money-movement state for its payload here, once, rather than
      // after steps 2-3 like the rest of this transaction's writes.
      const preSt = await this.compute(client, propertyId, assignmentId);
      const held = await client.query<{ v: string }>(
        `SELECT COALESCE(SUM(amount_paid_paise),0)::text AS v FROM pg_rent_invoices WHERE assignment_id = $1::uuid AND kind = 'deposit' AND status <> 'cancelled'`,
        [assignmentId]
      );
      const depositHeld = Number(held.rows[0].v);
      await writeRentEvent(client, {
        propertyId,
        entityType: "assignment",
        entityId: assignmentId,
        eventType: "settlement.created",
        actor,
        payload: {
          deposit_held_paise: depositHeld,
          credit_inr: preSt.credit_inr,
          dues_inr: preSt.open_dues_inr,
          deductions,
          net_inr: preSt.net_inr,
          note: input.note ?? null
        }
      });

      // step 2: deposit release → FIFO across open dues, settlement last
      if (depositHeld > 0)
        await this.payments.releaseDeposit(client, {
          propertyId,
          assignmentId,
          amountPaise: depositHeld,
          actor
        });
      else await this.alloc.applyUnallocatedCredit(client, settlementId, actor);

      // step 3: return now (funded from credit)
      if (input.return_now) {
        const credit = await this.alloc.unallocatedCredit(client, assignmentId);
        const want = inrToPaise(input.return_now.amount_inr);
        if (want > credit) throw new BadRequestException({ code: "refund_exceeds_credit" });
        await this.payments.recordRefundInTransaction(client, {
          propertyId,
          assignmentId,
          amountPaise: want,
          method: input.return_now.method,
          paidOn: input.return_now.paid_on,
          reference: input.return_now.reference ?? null,
          reason: "Deposit returned at move-out",
          idempotencyKey,
          actor
        });
      } else {
        // the idempotency key still has to live somewhere: pin it on the deposit-release row
        await client.query(
          `UPDATE pg_rent_payments SET idempotency_key = $2 WHERE assignment_id = $1::uuid AND source = 'deposit_release' AND status = 'confirmed' AND idempotency_key IS NULL`,
          [assignmentId, idempotencyKey]
        );
      }
    });
    return this.compute(this.db, propertyId, assignmentId);
  }

  /** Spec §6.12: forfeit ≤ credit on a cancelled/reserved assignment → adhoc invoice with a forfeit line, paid from the credit. */
  async forfeit(
    operatorId: string,
    propertyId: string,
    assignmentId: string,
    input: PgRentForfeitInput
  ): Promise<PgRentInvoice> {
    requireDb(this.db);
    const credit = await this.alloc.unallocatedCredit(this.db, assignmentId);
    if (inrToPaise(input.amount_inr) > credit)
      throw new BadRequestException({ code: "forfeit_exceeds_credit" });
    return this.invoices.createManual(operatorId, propertyId, {
      assignment_id: assignmentId,
      kind: "adhoc",
      due_date: todayIst(),
      lines: [
        {
          kind: "forfeit",
          label: input.label ?? "Booking amount forfeited",
          amount_inr: input.amount_inr
        }
      ]
    });
  }
}
