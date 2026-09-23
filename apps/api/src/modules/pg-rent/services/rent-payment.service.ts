import { randomBytes } from "node:crypto";
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException
} from "@nestjs/common";
import type { PoolClient } from "pg";
import type {
  PgRentAllocationTarget,
  PgRentBulkResult,
  PgRentClaimInput,
  PgRentConfirmInput,
  PgRentPayment,
  PgRentRecordPaymentInput,
  PgRentRefundInput
} from "@cribliv/shared-types";

import { DatabaseService } from "../../../common/database.service";
import { compareIsoDates, todayIst } from "../../../common/date";
import { transaction } from "../../../common/transaction";
import { inrToPaise } from "../dto/money";
import {
  ALLOCATION_SELECT,
  PAYMENT_SELECT,
  toPaymentDto,
  type RentAllocationRow,
  type RentPaymentRow
} from "../dto/payment.dto";
import { planAllocation } from "../pure/rent-allocation";
import { computeLateFee } from "../pure/rent-late-fee";
import { RentAllocationService } from "./rent-allocation.service";
import { writeRentEvent } from "./rent-events";
import { applyFeeDecision, loadFeeContext } from "./rent-fee-line";
import {
  assertManagedOwnership,
  requireDb,
  resolveTenantAssignmentIds,
  type Queryable,
  type RentActor
} from "./rent-guards";
import { RentReceiptService } from "./rent-receipt.service";
import { RentSettingsService } from "./rent-settings.service";

const RECEIPT_SOURCES = new Set(["operator", "tenant_claim", "gateway"]);

/**
 * Lock order for this file (binding, and consistent with
 * rent-allocation.service.ts:37-45's invoice-before-payment contract):
 *
 *   pg_rent_counters  →  pg_rent_invoices  →  pg_rent_payments
 *
 * This matches the only other writer of all three: RentInvoiceEngineService's
 * issuance path (issueNextRentIfDue / issueDepositIfDue) always runs
 * lockAssignment → nextInvoiceNumber (pg_rent_counters, UPDATE next_invoice_seq)
 * → INSERT the new invoice (a fresh, uncontended row) → applyUnallocatedCredit,
 * which re-locks that same fresh invoice and then takes
 * `FOR UPDATE OF p` on every EXISTING confirmed inflow payment of the
 * assignment (rent-allocation.service.ts:71-77) — i.e. counters, then an
 * existing payment row, with no existing-invoice lock in between (the
 * invoice it locks is always the one it just inserted in the same
 * transaction, never a pre-existing one).
 *
 * A method here that locks an EXISTING, already-committed payment row
 * (`lockPayment`) before it either (a) takes `pg_rent_counters` FOR UPDATE
 * (whenever the same transaction can reach RentReceiptService.mint/remint,
 * which bumps next_receipt_seq) or (b) is done touching any invoice the
 * removal/reallocation will reopen or close, produces the reverse edge —
 * payment → counters or payment → invoice — and deadlocks against the
 * engine's counters → payment edge above (40P01) whenever the two run
 * concurrently against the same assignment/property. `lockCounters` below
 * exists so every method that can mint/remint takes that lock first, before
 * touching anything else this file or the engine also locks.
 */
@Injectable()
export class RentPaymentService {
  constructor(
    @Inject(DatabaseService) private readonly db: DatabaseService,
    @Inject(RentSettingsService) private readonly settings: RentSettingsService,
    @Inject(RentAllocationService) private readonly alloc: RentAllocationService,
    @Inject(RentReceiptService) private readonly receipts: RentReceiptService
  ) {}

  /**
   * Task 6 (fix round 1, Claim A): a handle onto the most recent
   * fire-and-forget immediate-render call from getAndRenderReceipt(),
   * exposed so a test can `await payments.lastMintedReceiptRender` and
   * observe the same attempt production makes — deterministically, without
   * the hook itself blocking the caller (it still doesn't: the promise is
   * assigned here, never awaited by recordByOperator/confirm). Both the
   * hook and the worker's runPgRentReceiptSweep claim through
   * RentReceiptService.renderOne's `FOR UPDATE ... SKIP LOCKED`, so a
   * double render is impossible by construction — this field exists purely
   * for observability, not coordination.
   */
  lastMintedReceiptRender: Promise<"ready" | "failed" | "skipped"> | null = null;

  // ── intake ────────────────────────────────────────────────────────────────

  /** Spec §6.4. Confirmed at birth; idempotency key on the row (unique) AND in the controller cache. */
  async recordByOperator(
    operatorId: string,
    propertyId: string,
    input: PgRentRecordPaymentInput,
    idempotencyKey: string
  ): Promise<PgRentPayment> {
    requireDb(this.db);
    const actor: RentActor = { id: operatorId, role: "pg_operator" };
    const existing = await this.db.query<{ id: string }>(
      `SELECT id::text FROM pg_rent_payments WHERE pg_property_id = $1::uuid AND idempotency_key = $2`,
      [propertyId, idempotencyKey]
    );
    if (existing.rows[0]) return this.get(operatorId, propertyId, existing.rows[0].id);

    const id = await transaction(
      this.db,
      async (client) => {
        await assertManagedOwnership(client, operatorId, propertyId, true);
        // Lock order (file header): source is always 'operator', always
        // receipt-earning, so finalizeConfirmed below always mints — take
        // counters first, before the invoice/payment locks that follow.
        await this.lockCounters(client, propertyId);
        await this.assertAssignment(client, propertyId, input.assignment_id, [
          "reserved",
          "active",
          "notice_served",
          "move_out_requested",
          "move_out_pending_confirmation",
          "moved_out"
        ]);
        this.assertPaidOn(input.paid_on);
        const paymentId = await this.insertPayment(client, {
          propertyId,
          assignmentId: input.assignment_id,
          direction: "inflow",
          amountPaise: inrToPaise(input.amount_inr),
          method: input.method,
          source: "operator",
          status: "confirmed",
          claimedInvoiceId: input.claimed_invoice_id ?? null,
          paidOn: input.paid_on,
          reference: input.reference ?? null,
          proofPaths: input.proof_paths ?? [],
          note: input.note ?? null,
          idempotencyKey,
          recordedBy: operatorId,
          confirmedBy: operatorId
        });
        await writeRentEvent(client, {
          propertyId,
          entityType: "payment",
          entityId: paymentId,
          eventType: "payment.recorded",
          actor,
          payload: { amount_paise: inrToPaise(input.amount_inr), method: input.method }
        });
        await this.finalizeConfirmed(client, paymentId, input.allocations ?? null, actor);
        return paymentId;
      },
      { uniqueViolationCode: "duplicate_payment" }
    );
    return this.getAndRenderReceipt(operatorId, propertyId, id);
  }

  /** Backfill payment for a backfill invoice (Task 5 calls this inside its transaction). No receipt (D19). */
  async recordBackfillPayment(
    client: PoolClient,
    ctx: {
      propertyId: string;
      assignmentId: string;
      invoiceId: string;
      amountPaise: number;
      method: string;
      paidOn: string;
      reference: string | null;
      actor: RentActor;
    }
  ): Promise<string> {
    const paymentId = await this.insertPayment(client, {
      propertyId: ctx.propertyId,
      assignmentId: ctx.assignmentId,
      direction: "inflow",
      amountPaise: ctx.amountPaise,
      method: ctx.method,
      source: "backfill",
      status: "confirmed",
      claimedInvoiceId: ctx.invoiceId,
      paidOn: ctx.paidOn,
      reference: ctx.reference,
      proofPaths: [],
      note: null,
      idempotencyKey: null,
      recordedBy: ctx.actor.id,
      confirmedBy: ctx.actor.id
    });
    await writeRentEvent(client, {
      propertyId: ctx.propertyId,
      entityType: "payment",
      entityId: paymentId,
      eventType: "payment.recorded",
      actor: ctx.actor,
      payload: { source: "backfill", amount_paise: ctx.amountPaise }
    });
    await this.finalizeConfirmed(
      client,
      paymentId,
      [{ invoice_id: ctx.invoiceId, amount_inr: null as unknown as number }],
      ctx.actor
    );
    return paymentId;
  }

  /** Deposit release at settlement (Task 8). Non-cash inflow, FIFO across open dues incl. settlement, no receipt. */
  async releaseDeposit(
    client: PoolClient,
    ctx: { propertyId: string; assignmentId: string; amountPaise: number; actor: RentActor }
  ): Promise<string> {
    const paymentId = await this.insertPayment(client, {
      propertyId: ctx.propertyId,
      assignmentId: ctx.assignmentId,
      direction: "inflow",
      amountPaise: ctx.amountPaise,
      method: "deposit",
      source: "deposit_release",
      status: "confirmed",
      claimedInvoiceId: null,
      paidOn: todayIst(),
      reference: null,
      proofPaths: [],
      note: "Deposit applied at settlement",
      idempotencyKey: null,
      recordedBy: ctx.actor.id,
      confirmedBy: ctx.actor.id
    });
    await writeRentEvent(client, {
      propertyId: ctx.propertyId,
      entityType: "payment",
      entityId: paymentId,
      eventType: "deposit.released",
      actor: ctx.actor,
      payload: { amount_paise: ctx.amountPaise }
    });
    await this.finalizeConfirmed(client, paymentId, null, ctx.actor);
    return paymentId;
  }

  /** Spec §6.3. Pending; allocates nothing; one pending claim per invoice (unique index → 409 claim_pending). */
  async claimByTenant(tenantUserId: string, input: PgRentClaimInput): Promise<PgRentPayment> {
    requireDb(this.db);
    const actor: RentActor = { id: tenantUserId, role: "tenant" };
    const dup = await this.db.query<{ id: string }>(
      `SELECT p.id::text FROM pg_rent_payments p WHERE p.assignment_id = $1::uuid AND p.idempotency_key = $2`,
      [input.assignment_id, input.idempotency_key]
    );
    if (dup.rows[0]) return this.getForTenant(tenantUserId, dup.rows[0].id);

    const id = await transaction(
      this.db,
      async (client) => {
        const propertyId = await this.assertTenantAssignment(
          client,
          tenantUserId,
          input.assignment_id
        );
        this.assertPaidOn(input.paid_on);
        if (input.invoice_id) {
          const inv = await client.query(
            `SELECT 1 FROM pg_rent_invoices WHERE id = $1::uuid AND assignment_id = $2::uuid AND status IN ('issued','partially_paid')`,
            [input.invoice_id, input.assignment_id]
          );
          if (!inv.rowCount) throw new BadRequestException({ code: "invoice_not_open" });
        }
        const paymentId = await this.insertPayment(client, {
          propertyId,
          assignmentId: input.assignment_id,
          direction: "inflow",
          amountPaise: inrToPaise(input.amount_inr),
          method: input.method,
          source: "tenant_claim",
          status: "pending_confirmation",
          claimedInvoiceId: input.invoice_id ?? null,
          paidOn: input.paid_on,
          reference: input.reference ?? null,
          proofPaths: input.proof_paths ?? [],
          note: input.note ?? null,
          idempotencyKey: input.idempotency_key,
          recordedBy: tenantUserId,
          confirmedBy: null
        });
        await writeRentEvent(client, {
          propertyId,
          entityType: "payment",
          entityId: paymentId,
          eventType: "payment.claimed",
          actor,
          payload: {
            amount_paise: inrToPaise(input.amount_inr),
            invoice_id: input.invoice_id ?? null
          }
        });
        return paymentId;
      },
      { uniqueViolationCode: "claim_pending" }
    );
    return this.getForTenant(tenantUserId, id);
  }

  async cancelClaim(tenantUserId: string, paymentId: string): Promise<void> {
    requireDb(this.db);
    await transaction(this.db, async (client) => {
      const p = await this.lockPayment(client, paymentId);
      const mine = await resolveTenantAssignmentIds(client, tenantUserId);
      if (!mine.includes(p.assignment_id)) throw new ForbiddenException({ code: "forbidden" });
      if (p.status !== "pending_confirmation")
        throw new ConflictException({ code: "payment_not_pending" });
      await client.query(
        `UPDATE pg_rent_payments SET status = 'rejected', rejected_reason = 'cancelled_by_tenant' WHERE id = $1::uuid`,
        [paymentId]
      );
      await writeRentEvent(client, {
        propertyId: p.pg_property_id,
        entityType: "payment",
        entityId: paymentId,
        eventType: "payment.claim_cancelled",
        actor: { id: tenantUserId, role: "tenant" }
      });
    });
  }

  // ── verifier ──────────────────────────────────────────────────────────────

  /** Spec §6.3 Confirm sheet: editable amount/date/method; originals kept in the event. FOR UPDATE + status check → 409. */
  async confirm(
    operatorId: string,
    propertyId: string,
    paymentId: string,
    input: PgRentConfirmInput
  ): Promise<PgRentPayment> {
    await this.confirmTransaction(operatorId, propertyId, paymentId, input);
    return this.getAndRenderReceipt(operatorId, propertyId, paymentId);
  }

  /**
   * The transactional body of confirm(), extracted so confirmBulk() below
   * can drive it directly without going through confirm()'s own
   * getAndRenderReceipt call (Important B, fix round 2 — see confirmBulk's
   * docstring for why).
   */
  private async confirmTransaction(
    operatorId: string,
    propertyId: string,
    paymentId: string,
    input: PgRentConfirmInput
  ): Promise<void> {
    requireDb(this.db);
    const actor: RentActor = { id: operatorId, role: "pg_operator" };
    await transaction(this.db, async (client) => {
      await assertManagedOwnership(client, operatorId, propertyId, true);
      // Lock order (file header): a pending_confirmation payment only ever
      // reaches confirm() via claimByTenant's tenant_claim source, which is
      // always receipt-earning, so finalizeConfirmed below always mints —
      // take counters before the payment lock that follows. (The engine's
      // applyUnallocatedCredit only locks CONFIRMED inflows, so this
      // pending_confirmation row can't itself be the payment-side of a
      // direct invoice/payment inversion the way an already-confirmed one
      // can; counters is the only shared resource this path needs to order.)
      await this.lockCounters(client, propertyId);
      const p = await this.lockPayment(client, paymentId, propertyId);
      if (p.status !== "pending_confirmation")
        throw new ConflictException({ code: "payment_not_pending" });
      if (input.paid_on) this.assertPaidOn(input.paid_on);
      await client.query(
        `UPDATE pg_rent_payments SET status = 'confirmed', confirmed_by = $2::uuid, confirmed_at = now(),
                amount_paise = COALESCE($3, amount_paise), method = COALESCE($4::pg_rent_payment_method, method), paid_on = COALESCE($5::date, paid_on)
          WHERE id = $1::uuid`,
        [
          paymentId,
          operatorId,
          input.amount_inr === undefined ? null : inrToPaise(input.amount_inr),
          input.method ?? null,
          input.paid_on ?? null
        ]
      );
      await writeRentEvent(client, {
        propertyId,
        entityType: "payment",
        entityId: paymentId,
        eventType: "payment.confirmed",
        actor,
        payload: {
          original: { amount_paise: Number(p.amount_paise), method: p.method, paid_on: p.paid_on },
          edited: input.amount_inr !== undefined || !!input.method || !!input.paid_on
        }
      });
      await this.finalizeConfirmed(client, paymentId, input.allocations ?? null, actor);
    });
  }

  /**
   * Per-item results; one conflict never fails the batch (spec §6.3).
   *
   * Important B (fix round 2): deliberately does NOT go through confirm()'s
   * getAndRenderReceipt — confirm()'s immediate-render hook is
   * fire-and-forget, so a loop of N confirms fires N unawaited renderOne()
   * calls that all start racing in the background regardless of how the
   * loop itself is sequenced. BrowserPool.acquire() has no concurrency cap
   * (maxPagesPerBrowser only governs recycling, not in-flight pages), so an
   * N-item bulk confirm would open ~N simultaneous Chromium pages in the API
   * process. Chose to skip the hook here rather than add a semaphore: a bulk
   * confirm is a batch operation, not the "operator standing in front of the
   * tenant" case the hook exists for, so every receipt in the batch simply
   * waits for the 2-minute worker sweep — the same backstop every receipt
   * already relies on if the immediate hook fails or the API restarts
   * mid-render. confirmBulk's own result type only ever carried payment ids
   * (PgRentBulkResult.succeeded: string[]), never full PgRentPayment
   * objects, so this also needs no getAndRenderReceipt/get() call at all.
   */
  async confirmBulk(
    operatorId: string,
    propertyId: string,
    ids: string[]
  ): Promise<PgRentBulkResult> {
    const result: PgRentBulkResult = { succeeded: [], failed: [] };
    for (const id of ids) {
      try {
        await this.confirmTransaction(operatorId, propertyId, id, {});
        result.succeeded.push(id);
      } catch (error) {
        const code = (error as { response?: { code?: string } }).response?.code ?? "error";
        result.failed.push({ id, code });
      }
    }
    return result;
  }

  async reject(
    operatorId: string,
    propertyId: string,
    paymentId: string,
    reason: string
  ): Promise<PgRentPayment> {
    requireDb(this.db);
    await transaction(this.db, async (client) => {
      await assertManagedOwnership(client, operatorId, propertyId, true);
      const p = await this.lockPayment(client, paymentId, propertyId);
      if (p.status !== "pending_confirmation")
        throw new ConflictException({ code: "payment_not_pending" });
      await client.query(
        `UPDATE pg_rent_payments SET status = 'rejected', rejected_reason = $2 WHERE id = $1::uuid`,
        [paymentId, reason]
      );
      await writeRentEvent(client, {
        propertyId,
        entityType: "payment",
        entityId: paymentId,
        eventType: "payment.rejected",
        actor: { id: operatorId, role: "pg_operator" },
        payload: { reason }
      });
    });
    return this.get(operatorId, propertyId, paymentId);
  }

  /** Spec §6.5. Terminal. Refused when this inflow funds a live outflow (invariant 15). */
  async reverse(
    operatorId: string,
    propertyId: string,
    paymentId: string,
    reason: string
  ): Promise<PgRentPayment> {
    requireDb(this.db);
    const actor: RentActor = { id: operatorId, role: "pg_operator" };
    await transaction(this.db, async (client) => {
      await assertManagedOwnership(client, operatorId, propertyId, true);
      // Lock order (file header): reverse never mints, so no counters lock —
      // but it does act on an already-confirmed payment, so lock every
      // invoice it currently has an allocation against before the payment
      // lock that follows.
      await this.lockAffectedInvoices(client, paymentId);
      const p = await this.lockPayment(client, paymentId, propertyId);
      if (p.status !== "confirmed") throw new ConflictException({ code: "payment_not_confirmed" });
      const funds = await client.query(
        `SELECT 1 FROM pg_rent_payment_allocations al JOIN pg_rent_payments o ON o.id = al.refund_payment_id
          WHERE al.payment_id = $1::uuid AND o.status = 'confirmed' LIMIT 1`,
        [paymentId]
      );
      if (funds.rowCount)
        throw new ConflictException({
          code: "reverse_outflow_first",
          message: "Reverse the refund this payment funded first"
        });

      const touched = await this.alloc.removeAllocationsOf(client, paymentId);
      await client.query(
        `UPDATE pg_rent_payments SET status = 'reversed', reversed_by = $2::uuid, reversed_at = now(), reversed_reason = $3 WHERE id = $1::uuid`,
        [paymentId, operatorId, reason]
      );
      for (const invoiceId of touched) await this.refreshPayToken(client, invoiceId);
      const live = await client.query<{ id: string }>(
        `SELECT id::text FROM pg_rent_receipts WHERE payment_id = $1::uuid AND voided_at IS NULL`,
        [paymentId]
      );
      if (live.rows[0]) await this.receipts.void(client, live.rows[0].id, "reversed", actor);
      await writeRentEvent(client, {
        propertyId,
        entityType: "payment",
        entityId: paymentId,
        eventType: p.direction === "outflow" ? "refund.reversed" : "payment.reversed",
        actor,
        payload: { reason, touched_invoices: touched }
      });
    });
    return this.get(operatorId, propertyId, paymentId);
  }

  /** Spec §6.11 step 3 / §6.12 Return. Outflow, confirmed at birth, funded from credit (invariant 15). */
  async recordRefund(
    operatorId: string,
    propertyId: string,
    input: PgRentRefundInput,
    idempotencyKey: string
  ): Promise<PgRentPayment> {
    requireDb(this.db);
    const actor: RentActor = { id: operatorId, role: "pg_operator" };
    const existing = await this.db.query<{ id: string }>(
      `SELECT id::text FROM pg_rent_payments WHERE pg_property_id = $1::uuid AND idempotency_key = $2`,
      [propertyId, idempotencyKey]
    );
    if (existing.rows[0]) return this.get(operatorId, propertyId, existing.rows[0].id);
    const id = await transaction(
      this.db,
      async (client) => {
        await assertManagedOwnership(client, operatorId, propertyId, true);
        return this.recordRefundInTransaction(client, {
          propertyId,
          assignmentId: input.assignment_id,
          amountPaise: inrToPaise(input.amount_inr),
          method: input.method,
          paidOn: input.paid_on,
          reference: input.reference ?? null,
          reason: input.reason,
          idempotencyKey,
          actor
        });
      },
      { uniqueViolationCode: "duplicate_payment" }
    );
    return this.get(operatorId, propertyId, id);
  }

  /**
   * Task 7: the body of recordRefund minus the outer transaction/ownership
   * wrapper, so RentSettlementService.settle() can fund the deposit return
   * in the same transaction as the release. Still writes `refund.recorded`
   * itself — fundOutflow deliberately writes no event of its own, so the
   * audit trail for money leaving the system has to live at this level, and
   * recordRefund (above) must not duplicate it by calling both this method
   * and its own writeRentEvent.
   */
  async recordRefundInTransaction(
    client: PoolClient,
    ctx: {
      propertyId: string;
      assignmentId: string;
      amountPaise: number;
      method: string;
      paidOn: string;
      reference: string | null;
      reason: string;
      idempotencyKey: string;
      actor: RentActor;
    }
  ): Promise<string> {
    await this.assertAssignment(client, ctx.propertyId, ctx.assignmentId, null);
    this.assertPaidOn(ctx.paidOn);
    const paymentId = await this.insertPayment(client, {
      propertyId: ctx.propertyId,
      assignmentId: ctx.assignmentId,
      direction: "outflow",
      amountPaise: ctx.amountPaise,
      method: ctx.method,
      source: "operator",
      status: "confirmed",
      claimedInvoiceId: null,
      paidOn: ctx.paidOn,
      reference: ctx.reference,
      proofPaths: [],
      note: ctx.reason,
      idempotencyKey: ctx.idempotencyKey,
      recordedBy: ctx.actor.id,
      confirmedBy: ctx.actor.id
    });
    await this.alloc.fundOutflow(client, paymentId);
    await writeRentEvent(client, {
      propertyId: ctx.propertyId,
      entityType: "payment",
      entityId: paymentId,
      eventType: "refund.recorded",
      actor: ctx.actor,
      payload: { amount_paise: ctx.amountPaise, reason: ctx.reason }
    });
    return paymentId;
  }

  /** Spec §6.7: manual re-allocation restates what the money was for → void + re-mint. */
  async reallocate(
    operatorId: string,
    propertyId: string,
    paymentId: string,
    targets: PgRentAllocationTarget[]
  ): Promise<PgRentPayment> {
    requireDb(this.db);
    const actor: RentActor = { id: operatorId, role: "pg_operator" };
    await transaction(this.db, async (client) => {
      await assertManagedOwnership(client, operatorId, propertyId, true);
      // Lock order (file header): this is THE live cycle — reallocate can
      // remint (counters), and it acts on an already-confirmed payment the
      // engine's applyUnallocatedCredit can independently try to lock while
      // it already holds counters. Take counters first (unconditionally:
      // source is fixed at payment creation and cheap to over-lock for),
      // then every invoice this call can touch — the ones the payment
      // currently funds (status-agnostic, since one may already be `paid`)
      // and the assignment's open invoices (covers the new targets and any
      // FIFO overflow allocateInflow plans against) — and only then the
      // payment row itself.
      await this.lockCounters(client, propertyId);
      const route = await client.query<{ assignment_id: string }>(
        `SELECT assignment_id::text FROM pg_rent_payments WHERE id = $1::uuid AND pg_property_id = $2::uuid`,
        [paymentId, propertyId]
      );
      if (!route.rows[0]) throw new NotFoundException({ code: "payment_not_found" });
      await this.alloc.openInvoices(client, route.rows[0].assignment_id, true);
      await this.lockAffectedInvoices(client, paymentId);
      const p = await this.lockPayment(client, paymentId, propertyId);
      if (p.status !== "confirmed" || p.direction !== "inflow")
        throw new ConflictException({ code: "payment_not_confirmed" });
      const funds = await client.query(
        `SELECT 1 FROM pg_rent_payment_allocations WHERE payment_id = $1::uuid AND refund_payment_id IS NOT NULL LIMIT 1`,
        [paymentId]
      );
      if (funds.rowCount) throw new ConflictException({ code: "reverse_outflow_first" });
      const removed = await this.alloc.removeAllocationsOf(client, paymentId);
      // An invoice this reallocation drops money from can reopen (paid → open)
      // just like a reversal, and one it moves money onto can close (open →
      // paid) just like finalizeConfirmed — refresh/expire both directions the
      // same way those two callers already do, or a reopened invoice is left
      // with a stale expired token (tenant can no longer self-pay it) and a
      // newly-closed one keeps a live token (tenant can pay an already-settled
      // invoice again).
      for (const invoiceId of removed) await this.refreshPayToken(client, invoiceId);
      const plan = await this.alloc.allocateInflow(client, paymentId, targets, actor);
      for (const a of plan.allocations) await this.expireTokenIfPaid(client, a.invoiceId);
      if (RECEIPT_SOURCES.has(p.source)) await this.receipts.remint(client, paymentId, actor);
      await writeRentEvent(client, {
        propertyId,
        entityType: "payment",
        entityId: paymentId,
        eventType: "allocation.changed",
        actor,
        payload: { reason: "operator_reallocation", targets }
      });
    });
    return this.get(operatorId, propertyId, paymentId);
  }

  // ── reads ─────────────────────────────────────────────────────────────────

  async list(
    operatorId: string,
    propertyId: string,
    filters: { assignment_id?: string; status?: string; direction?: string } = {}
  ): Promise<PgRentPayment[]> {
    requireDb(this.db);
    await assertManagedOwnership(this.db, operatorId, propertyId);
    const where = ["p.pg_property_id = $1::uuid"];
    const params: unknown[] = [propertyId];
    if (filters.assignment_id) {
      params.push(filters.assignment_id);
      where.push(`p.assignment_id = $${params.length}::uuid`);
    }
    if (filters.status) {
      params.push(filters.status);
      where.push(`p.status = $${params.length}::pg_rent_payment_status`);
    }
    if (filters.direction) {
      params.push(filters.direction);
      where.push(`p.direction = $${params.length}::pg_rent_payment_direction`);
    }
    const rows = await this.db.query<RentPaymentRow>(
      `SELECT ${PAYMENT_SELECT} FROM pg_rent_payments p JOIN pg_bed_assignments a ON a.id = p.assignment_id WHERE ${where.join(" AND ")} ORDER BY p.paid_on DESC, p.created_at DESC LIMIT 500`,
      params
    );
    return this.withAllocations(this.db, rows.rows);
  }

  async get(operatorId: string, propertyId: string, paymentId: string): Promise<PgRentPayment> {
    requireDb(this.db);
    await assertManagedOwnership(this.db, operatorId, propertyId);
    const rows = await this.db.query<RentPaymentRow>(
      `SELECT ${PAYMENT_SELECT} FROM pg_rent_payments p JOIN pg_bed_assignments a ON a.id = p.assignment_id WHERE p.id = $1::uuid AND p.pg_property_id = $2::uuid`,
      [paymentId, propertyId]
    );
    if (!rows.rows[0]) throw new NotFoundException({ code: "payment_not_found" });
    return (await this.withAllocations(this.db, rows.rows))[0];
  }

  async getForTenant(tenantUserId: string, paymentId: string): Promise<PgRentPayment> {
    const mine = await resolveTenantAssignmentIds(this.db, tenantUserId);
    const rows = await this.db.query<RentPaymentRow>(
      `SELECT ${PAYMENT_SELECT} FROM pg_rent_payments p JOIN pg_bed_assignments a ON a.id = p.assignment_id WHERE p.id = $1::uuid AND p.assignment_id = ANY($2::uuid[])`,
      [paymentId, mine]
    );
    if (!rows.rows[0]) throw new NotFoundException({ code: "payment_not_found" });
    return (await this.withAllocations(this.db, rows.rows))[0];
  }

  // ── the only path that can make an invoice paid ───────────────────────────

  /**
   * Spec §6.1. Re-evaluates late fees as of paid_on for invoices this payment
   * settles (§5.6 as-of rule), allocates (targets → FIFO → credit), sets
   * settled_on via recomputeInvoice, expires pay tokens on paid invoices,
   * mints a receipt for receipt-earning sources.
   */
  private async finalizeConfirmed(
    client: PoolClient,
    paymentId: string,
    targets: PgRentAllocationTarget[] | null,
    actor: RentActor
  ): Promise<void> {
    // Lock order (file header): invoice rows before the payment row, matching
    // allocateInflow's own contract. This method never takes pg_rent_counters
    // itself — mint() does that, at the very end, in step 4 — so it relies on
    // every *caller* that can reach that step (recordByOperator, confirm)
    // having already taken the counters lock before calling in here; callers
    // that never mint (recordBackfillPayment, releaseDeposit) never touch
    // counters at all. The assignment id is only needed for routing, so it is
    // read unlocked first — exactly the pattern allocateInflow uses below.
    const route = await client.query<{ assignment_id: string }>(
      `SELECT assignment_id::text FROM pg_rent_payments WHERE id = $1::uuid`,
      [paymentId]
    );
    if (!route.rows[0]) throw new NotFoundException({ code: "payment_not_found" });
    // 1. dry-run to learn which invoices this payment would settle
    const open = await this.alloc.openInvoices(client, route.rows[0].assignment_id, true);
    const p = await this.lockPayment(client, paymentId);
    const wanted = (targets ?? [])
      .filter((t) => open.some((o) => o.invoiceId === t.invoice_id))
      .map((t) => ({
        invoiceId: t.invoice_id,
        amountPaise:
          (t.amount_inr as unknown) === null
            ? Math.min(
                open.find((o) => o.invoiceId === t.invoice_id)!.balancePaise,
                Number(p.amount_paise)
              )
            : inrToPaise(t.amount_inr)
      }));
    let dry;
    try {
      dry = planAllocation(Number(p.amount_paise), open, wanted);
    } catch (error) {
      throw new BadRequestException({
        code: "invalid_allocation",
        message: (error as Error).message
      });
    }

    // 2. fee re-evaluation as of paid_on on invoices whose chargeable balance this payment covers
    for (const a of dry.allocations) {
      const ctx = await loadFeeContext(client, a.invoiceId);
      if (
        ctx.invoice.kind !== "rent" ||
        !ctx.invoice.eligible ||
        ctx.invoice.exempt ||
        ctx.invoice.waivedAt ||
        !ctx.policy
      )
        continue;
      if (ctx.feeLinePaise === null && ctx.invoice.suggestedPaise === null) continue;
      const chargeable = ctx.invoice.totalPaise - ctx.invoice.paidPaise - (ctx.feeLinePaise ?? 0);
      if (a.amountPaise < chargeable) continue;
      const decision = computeLateFee({
        policy: ctx.policy,
        dueDate: ctx.invoice.dueDate,
        asOf: p.paid_on,
        chargeablePaise: chargeable,
        overridePaise: ctx.invoice.overridePaise,
        existingFeePaise: ctx.feeLinePaise ?? ctx.invoice.suggestedPaise,
        // "Compute once" (frozen) only applies to flat/percent/override — a
        // per_day fee without an override must keep accruing/shrinking as
        // asOf moves, per computeLateFee's own contract (pure/rent-late-fee.ts)
        // and the sweep's per_day unit tests, which pass frozen: false on
        // every per_day case. late_fee_computed_at is stamped by every path
        // that creates a real line (rent-fee-line.ts), including per_day
        // ones, so gating solely on it (as before) froze per_day fees after
        // their very first application — the tenant would be charged the
        // sweep's snapshot instead of the amount as of this payment's paid_on.
        frozen:
          ctx.invoice.computedAt !== null &&
          (ctx.policy.kind !== "per_day" || ctx.invoice.overridePaise !== null)
      });
      if (decision.action === "remove") {
        await applyFeeDecision(client, this.alloc, ctx, decision, actor, {
          applyMode: "line",
          reason: "paid_within_grace"
        });
        // applyFeeDecision's own recomputeInvoice call (rent-fee-line.ts) does not
        // know this payment's paid_on — it is a general helper Task 6's sweep also
        // calls with no payment in play. When the fee alone shrinks the balance to
        // zero, that call already flips status to 'paid' but leaves settled_on
        // null. Re-run recomputeInvoice here, now that a paid_on is available, so
        // an invoice this payment closes always carries its settlement date
        // (carried requirement 4 / spec §4.4) even when step 3 below never ends up
        // allocating into it (its balance already reached zero).
        await this.alloc.recomputeInvoice(client, a.invoiceId, p.paid_on);
      } else if (
        decision.action === "update" &&
        // Only ever shrink a REAL, already-charged line here. When
        // ctx.feeLinePaise is null the invoice carries at most a *suggestion*
        // (suggested_late_fee_paise, written with late_fee_auto_apply off —
        // rent-fee-line.ts's "suggest" branch never sets late_fee_computed_at
        // or a line). applyFeeDecision's "line" mode cannot tell a stale
        // update to an existing line apart from a fresh apply of a bare
        // suggestion — passing it a null feeLinePaise here would materialise
        // the suggestion into a real charge nobody (no operator, no
        // auto-apply) approved, which is not this loop's job: it exists only
        // to correct a charge this payment is about to settle, never to
        // invent one.
        ctx.feeLinePaise !== null &&
        decision.feePaise < ctx.feeLinePaise
      ) {
        await applyFeeDecision(client, this.alloc, ctx, decision, actor, {
          applyMode: "line",
          reason: "recomputed_as_of_paid_on"
        });
        await this.alloc.recomputeInvoice(client, a.invoiceId, p.paid_on);
      }
    }

    // 3. real allocation against the (possibly reduced) balances
    const plan = await this.alloc.allocateInflow(client, paymentId, targets, actor);
    for (const a of plan.allocations) await this.expireTokenIfPaid(client, a.invoiceId);

    // 4. receipt
    if (RECEIPT_SOURCES.has(p.source)) await this.receipts.mint(client, paymentId, actor);
  }

  // ── helpers ───────────────────────────────────────────────────────────────

  /**
   * Task 6, Claim A (fix round 1, restored): best-effort immediate render
   * right after a receipt-minting transaction commits — never inside the
   * transaction, since rendering is slow (Chromium) and must never hold the
   * payment/invoice/counters locks. Fire-and-forget for the caller
   * (recordByOperator/confirm return as soon as get() resolves, same as
   * before); the promise is only stashed on lastMintedReceiptRender for a
   * test to observe. A failure here is silently swallowed — the 2-minute
   * worker sweep (runPgRentReceiptSweep) and RentReceiptService.renderOne's
   * `FOR UPDATE ... SKIP LOCKED` claim are the backstop and the concurrency
   * guard, respectively, for exactly this hook racing the worker.
   */
  private async getAndRenderReceipt(
    operatorId: string,
    propertyId: string,
    paymentId: string
  ): Promise<PgRentPayment> {
    const payment = await this.get(operatorId, propertyId, paymentId);
    if (payment.receipt_id) {
      const render = this.receipts.renderOne(payment.receipt_id).catch(() => "failed" as const);
      this.lastMintedReceiptRender = render;
    }
    return payment;
  }

  private assertPaidOn(paidOn: string): void {
    if (compareIsoDates(paidOn, todayIst()) > 0)
      throw new BadRequestException({ code: "paid_on_in_future" });
  }

  private async assertAssignment(
    client: Queryable,
    propertyId: string,
    assignmentId: string,
    statuses: string[] | null
  ): Promise<void> {
    const r = await client.query<{ status: string }>(
      `SELECT status::text FROM pg_bed_assignments WHERE id = $1::uuid AND pg_property_id = $2::uuid`,
      [assignmentId, propertyId]
    );
    if (!r.rows[0]) throw new NotFoundException({ code: "assignment_not_found" });
    if (statuses && !statuses.includes(r.rows[0].status))
      throw new ConflictException({ code: "assignment_status_invalid" });
  }

  private async assertTenantAssignment(
    client: Queryable,
    tenantUserId: string,
    assignmentId: string
  ): Promise<string> {
    const mine = await resolveTenantAssignmentIds(client, tenantUserId);
    if (!mine.includes(assignmentId)) throw new ForbiddenException({ code: "forbidden" });
    const r = await client.query<{ pg_property_id: string; enabled: boolean }>(
      `SELECT a.pg_property_id::text, (s.pg_property_id IS NOT NULL) AS enabled FROM pg_bed_assignments a LEFT JOIN pg_rent_settings s ON s.pg_property_id = a.pg_property_id WHERE a.id = $1::uuid`,
      [assignmentId]
    );
    if (!r.rows[0].enabled) throw new NotFoundException({ code: "rent_not_enabled" });
    return r.rows[0].pg_property_id;
  }

  /** Lock order (file header): first lock taken by any transaction that can reach mint/remint. */
  private async lockCounters(client: PoolClient, propertyId: string): Promise<void> {
    await client.query(
      `SELECT 1 FROM pg_rent_counters WHERE pg_property_id = $1::uuid FOR UPDATE`,
      [propertyId]
    );
  }

  /**
   * Lock order (file header): every invoice this payment currently has an
   * allocation against, locked by status-agnostic lookup on
   * pg_rent_payment_allocations rather than `openInvoices` — an invoice this
   * payment fully paid is `paid` (not `issued`/`partially_paid`), so
   * `openInvoices` would miss exactly the invoice a reversal or
   * reallocation is most likely to reopen.
   */
  private async lockAffectedInvoices(client: PoolClient, paymentId: string): Promise<void> {
    const affected = await client.query<{ invoice_id: string }>(
      `SELECT DISTINCT invoice_id FROM pg_rent_payment_allocations WHERE payment_id = $1::uuid AND invoice_id IS NOT NULL`,
      [paymentId]
    );
    if (affected.rows.length) {
      await client.query(`SELECT 1 FROM pg_rent_invoices WHERE id = ANY($1::uuid[]) FOR UPDATE`, [
        affected.rows.map((r) => r.invoice_id)
      ]);
    }
  }

  private async lockPayment(client: PoolClient, paymentId: string, propertyId?: string) {
    const r = await client.query<{
      id: string;
      pg_property_id: string;
      assignment_id: string;
      direction: string;
      source: string;
      status: string;
      amount_paise: string;
      method: string;
      paid_on: string;
    }>(
      `SELECT id::text, pg_property_id::text, assignment_id::text, direction::text, source::text, status::text, amount_paise::text, method::text, to_char(paid_on,'YYYY-MM-DD') AS paid_on
         FROM pg_rent_payments WHERE id = $1::uuid${propertyId ? " AND pg_property_id = $2::uuid" : ""} FOR UPDATE`,
      propertyId ? [paymentId, propertyId] : [paymentId]
    );
    if (!r.rows[0]) throw new NotFoundException({ code: "payment_not_found" });
    return r.rows[0];
  }

  private async insertPayment(
    client: PoolClient,
    v: {
      propertyId: string;
      assignmentId: string;
      direction: "inflow" | "outflow";
      amountPaise: number;
      method: string;
      source: string;
      status: string;
      claimedInvoiceId: string | null;
      paidOn: string;
      reference: string | null;
      proofPaths: string[];
      note: string | null;
      idempotencyKey: string | null;
      recordedBy: string | null;
      confirmedBy: string | null;
    }
  ): Promise<string> {
    const r = await client.query<{ id: string }>(
      `INSERT INTO pg_rent_payments
         (pg_property_id, assignment_id, direction, amount_paise, method, source, status, claimed_invoice_id, paid_on, reference, proof_paths, note, idempotency_key, recorded_by, confirmed_by, confirmed_at)
       VALUES ($1::uuid, $2::uuid, $3::pg_rent_payment_direction, $4, $5::pg_rent_payment_method, $6::pg_rent_payment_source, $7::pg_rent_payment_status, $8::uuid, $9::date, $10, $11::jsonb, $12, $13, $14::uuid, $15::uuid,
               CASE WHEN $7 = 'confirmed' THEN now() ELSE NULL END)
       RETURNING id::text`,
      [
        v.propertyId,
        v.assignmentId,
        v.direction,
        v.amountPaise,
        v.method,
        v.source,
        v.status,
        v.claimedInvoiceId,
        v.paidOn,
        v.reference,
        JSON.stringify(v.proofPaths),
        v.note,
        v.idempotencyKey,
        v.recordedBy,
        v.confirmedBy
      ]
    );
    return r.rows[0].id;
  }

  /** Spec §4.4: the pay token expires on `paid` … */
  private async expireTokenIfPaid(client: PoolClient, invoiceId: string): Promise<void> {
    await client.query(
      `UPDATE pg_rent_invoices SET pay_token_expires_at = now() WHERE id = $1::uuid AND status = 'paid' AND pay_token IS NOT NULL`,
      [invoiceId]
    );
  }

  /** … and is regenerated when a reversal reopens the invoice. */
  private async refreshPayToken(client: PoolClient, invoiceId: string): Promise<void> {
    await client.query(
      `UPDATE pg_rent_invoices SET pay_token = $2, pay_token_expires_at = now() + interval '45 days'
        WHERE id = $1::uuid AND status IN ('issued','partially_paid') AND (pay_token IS NULL OR pay_token_expires_at <= now())`,
      [invoiceId, randomBytes(32).toString("base64url")]
    );
  }

  /**
   * Allocations come back in the order they were written, which is the order
   * the operator and the tenant read on a receipt (deposit before rent).
   *
   * `al.seq` (0073) is what actually settles that: allocateFifo writes every
   * row of one payment inside a single transaction, so they all share
   * created_at — now() is the transaction timestamp — and created_at alone
   * leaves the sort tied and the returned order unspecified.
   */
  private async withAllocations(q: Queryable, rows: RentPaymentRow[]): Promise<PgRentPayment[]> {
    if (!rows.length) return [];
    const allocs = await q.query<RentAllocationRow>(
      `SELECT ${ALLOCATION_SELECT} FROM pg_rent_payment_allocations al LEFT JOIN pg_rent_invoices i ON i.id = al.invoice_id WHERE al.payment_id = ANY($1::uuid[]) ORDER BY al.created_at, al.seq`,
      [rows.map((r) => r.id)]
    );
    return rows.map((r) => toPaymentDto(r, allocs.rows));
  }
}
