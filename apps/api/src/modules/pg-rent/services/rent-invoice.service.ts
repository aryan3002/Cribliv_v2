import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException
} from "@nestjs/common";
import type { PoolClient } from "pg";
import type {
  PgRentBackfillInput,
  PgRentEvent,
  PgRentInvoice,
  PgRentInvoiceListFilters,
  PgRentIssueDraftInput,
  PgRentLineInput,
  PgRentLinePatchInput,
  PgRentManualInvoiceInput,
  PgRentTenantOverridesInput
} from "@cribliv/shared-types";

import { DatabaseService } from "../../../common/database.service";
import { compareIsoDates, todayIst } from "../../../common/date";
import { transaction } from "../../../common/transaction";
import {
  INVOICE_SELECT,
  LINE_SELECT,
  toEventDto,
  toInvoiceDto,
  type RentEventRow,
  type RentInvoiceRow,
  type RentLineRow
} from "../dto/invoice.dto";
import { inrToPaise } from "../dto/money";
import { firstOfMonth } from "../pure/rent-dates";
import { computeLateFee } from "../pure/rent-late-fee";
import { RentAllocationService } from "./rent-allocation.service";
import { writeRentEvent } from "./rent-events";
import { applyFeeDecision, loadFeeContext, setInvoiceTotalFromLines } from "./rent-fee-line";
import { RentInvoiceEngineService } from "./rent-invoice-engine.service";
import { assertManagedOwnership, requireDb, type Queryable, type RentActor } from "./rent-guards";
import { newPayToken, nextInvoiceNumber } from "./rent-numbering";
import { RentPaymentService } from "./rent-payment.service";

@Injectable()
export class RentInvoiceService {
  constructor(
    @Inject(DatabaseService) private readonly db: DatabaseService,
    @Inject(RentAllocationService) private readonly alloc: RentAllocationService,
    @Inject(RentPaymentService) private readonly payments: RentPaymentService,
    @Inject(RentInvoiceEngineService) private readonly engine: RentInvoiceEngineService
  ) {}

  async list(
    operatorId: string,
    propertyId: string,
    filters: PgRentInvoiceListFilters
  ): Promise<PgRentInvoice[]> {
    requireDb(this.db);
    await assertManagedOwnership(this.db, operatorId, propertyId);
    const where: string[] = ["i.pg_property_id = $1::uuid"];
    const params: unknown[] = [propertyId];
    const add = (sql: string, value: unknown) => {
      params.push(value);
      where.push(sql.replace("?", `$${params.length}`));
    };
    if (filters.status) add("i.status = ?::pg_rent_invoice_status", filters.status);
    if (filters.kind) add("i.kind = ?::pg_rent_invoice_kind", filters.kind);
    if (filters.assignment_id) add("i.assignment_id = ?::uuid", filters.assignment_id);
    if (filters.billing_month) add("i.billing_month = ?::date", filters.billing_month);
    const rows = await this.db.query<RentInvoiceRow>(
      `SELECT ${INVOICE_SELECT} FROM pg_rent_invoices i JOIN pg_bed_assignments a ON a.id = i.assignment_id
        WHERE ${where.join(" AND ")} ORDER BY i.due_date DESC, i.created_at DESC LIMIT 500`,
      params
    );
    return this.withLines(this.db, rows.rows);
  }

  async get(operatorId: string, propertyId: string, invoiceId: string): Promise<PgRentInvoice> {
    requireDb(this.db);
    await assertManagedOwnership(this.db, operatorId, propertyId);
    const rows = await this.db.query<RentInvoiceRow>(
      `SELECT ${INVOICE_SELECT} FROM pg_rent_invoices i JOIN pg_bed_assignments a ON a.id = i.assignment_id
        WHERE i.id = $1::uuid AND i.pg_property_id = $2::uuid`,
      [invoiceId, propertyId]
    );
    if (!rows.rows[0]) throw new NotFoundException({ code: "invoice_not_found" });
    return (await this.withLines(this.db, rows.rows))[0];
  }

  async events(operatorId: string, propertyId: string, invoiceId: string): Promise<PgRentEvent[]> {
    await this.get(operatorId, propertyId, invoiceId);
    const rows = await this.db.query<RentEventRow>(
      `SELECT id::text, entity_type, entity_id::text, event_type, actor_user_id::text, actor_role, payload, created_at
         FROM pg_rent_events WHERE entity_type = 'invoice' AND entity_id = $1::uuid ORDER BY id`,
      [invoiceId]
    );
    return rows.rows.map(toEventDto);
  }

  /** Spec §11 "Tenant overrides" + §5.7 "Change rent from next cycle" + §5.2 move-in while null. */
  async updateTenantOverrides(
    operatorId: string,
    propertyId: string,
    assignmentId: string,
    input: PgRentTenantOverridesInput
  ): Promise<void> {
    requireDb(this.db);
    await transaction(this.db, async (client) => {
      await assertManagedOwnership(client, operatorId, propertyId, true);
      const current = await client.query<{
        move_in_date: Date | null;
        monthly_rent_paise: string | null;
      }>(
        `SELECT move_in_date, monthly_rent_paise::text FROM pg_bed_assignments
          WHERE id = $1::uuid AND pg_property_id = $2::uuid FOR UPDATE`,
        [assignmentId, propertyId]
      );
      if (!current.rows[0]) throw new NotFoundException({ code: "assignment_not_found" });
      const actor = { id: operatorId, role: "pg_operator" as const };

      if (input.monthly_rent_inr !== undefined) {
        const to = inrToPaise(input.monthly_rent_inr);
        await client.query(
          `UPDATE pg_bed_assignments SET monthly_rent_paise = $2 WHERE id = $1::uuid`,
          [assignmentId, to]
        );
        await writeRentEvent(client, {
          propertyId,
          entityType: "assignment",
          entityId: assignmentId,
          eventType: "rent.changed",
          actor,
          payload: {
            from_paise:
              current.rows[0].monthly_rent_paise === null
                ? null
                : Number(current.rows[0].monthly_rent_paise),
            to_paise: to
          }
        });
      }
      if (input.move_in_date !== undefined) {
        if (current.rows[0].move_in_date !== null)
          throw new ConflictException({ code: "move_in_already_set" });
        await client.query(
          `UPDATE pg_bed_assignments SET move_in_date = $2::date WHERE id = $1::uuid`,
          [assignmentId, input.move_in_date]
        );
        await writeRentEvent(client, {
          propertyId,
          entityType: "assignment",
          entityId: assignmentId,
          eventType: "assignment.move_in_date_set",
          actor,
          payload: { move_in_date: input.move_in_date }
        });
      }
      const overrides: Record<string, unknown> = {};
      if (input.rent_due_day !== undefined) overrides.rent_due_day = input.rent_due_day;
      if (input.late_fee_exempt !== undefined) overrides.late_fee_exempt = input.late_fee_exempt;
      if (input.late_fee_override_inr !== undefined) {
        overrides.late_fee_override_paise =
          input.late_fee_override_inr === null ? null : inrToPaise(input.late_fee_override_inr);
      }
      if (input.default_item_excludes !== undefined) {
        overrides.default_item_overrides = JSON.stringify({ exclude: input.default_item_excludes });
      }
      if (Object.keys(overrides).length) {
        const names = Object.keys(overrides);
        const sets = names
          .map((n, i) => `${n} = $${i + 2}${n === "default_item_overrides" ? "::jsonb" : ""}`)
          .join(", ");
        await client.query(`UPDATE pg_bed_assignments SET ${sets} WHERE id = $1::uuid`, [
          assignmentId,
          ...Object.values(overrides)
        ]);
        await writeRentEvent(client, {
          propertyId,
          entityType: "assignment",
          entityId: assignmentId,
          eventType: "assignment.override_updated",
          actor,
          payload: overrides
        });
      }
    });
  }

  // ── internals shared across mutations ───────────────────────────────────────

  private actor(operatorId: string): RentActor {
    return { id: operatorId, role: "pg_operator" };
  }

  private async readById(propertyId: string, invoiceId: string): Promise<PgRentInvoice> {
    const rows = await this.db.query<RentInvoiceRow>(
      `SELECT ${INVOICE_SELECT} FROM pg_rent_invoices i JOIN pg_bed_assignments a ON a.id = i.assignment_id WHERE i.id = $1::uuid AND i.pg_property_id = $2::uuid`,
      [invoiceId, propertyId]
    );
    if (!rows.rows[0]) throw new NotFoundException({ code: "invoice_not_found" });
    return (await this.withLines(this.db, rows.rows))[0];
  }

  private async lockInvoice(client: PoolClient, propertyId: string, invoiceId: string) {
    const r = await client.query<{
      id: string;
      assignment_id: string;
      kind: string;
      status: string;
      total_paise: string;
      amount_paid_paise: string;
      due_date: string;
      period_start: string | null;
      period_end: string | null;
      late_fee_eligible: boolean;
      suggested_late_fee_paise: string | null;
      reprorate_suggestion: {
        leave_on: string;
        from_paise: number;
        to_paise: number;
        mode: "reprorate" | "restore";
      } | null;
      rent_snapshot_paise: string | null;
    }>(
      `SELECT id::text, assignment_id::text, kind::text, status::text, total_paise::text, amount_paid_paise::text, to_char(due_date,'YYYY-MM-DD') AS due_date,
              to_char(period_start,'YYYY-MM-DD') AS period_start, to_char(period_end,'YYYY-MM-DD') AS period_end, late_fee_eligible, suggested_late_fee_paise::text,
              reprorate_suggestion, rent_snapshot_paise::text
         FROM pg_rent_invoices WHERE id = $1::uuid AND pg_property_id = $2::uuid FOR UPDATE`,
      [invoiceId, propertyId]
    );
    if (!r.rows[0]) throw new NotFoundException({ code: "invoice_not_found" });
    return r.rows[0];
  }

  private assertEditable(status: string): void {
    if (!["draft", "issued", "partially_paid"].includes(status))
      throw new ConflictException({ code: "invoice_not_editable" });
  }

  /**
   * Invariant 14 + 1: apply a line change, releasing excess first when the
   * total drops below amount_paid. `settledOn` defaults to today's IST date —
   * every caller here is an operator mutation (not a payment), so "today" is
   * the natural settlement date if this call is the one that first zeroes the
   * balance (carried requirement 2 / spec §4.4). recomputeInvoice's own
   * COALESCE means this is a no-op whenever the invoice was already settled
   * or does not reach zero here.
   */
  private async settleTotal(
    client: PoolClient,
    invoiceId: string,
    paidPaise: number,
    newTotal: number,
    actor: RentActor
  ): Promise<void> {
    if (paidPaise > newTotal)
      await this.alloc.deallocateExcess(client, invoiceId, paidPaise - newTotal, actor);
    await setInvoiceTotalFromLines(client, invoiceId);
    await this.alloc.recomputeInvoice(client, invoiceId, todayIst());
  }

  private async event(
    client: PoolClient,
    propertyId: string,
    invoiceId: string,
    type: string,
    actor: RentActor,
    payload: Record<string, unknown> = {}
  ) {
    await writeRentEvent(client, {
      propertyId,
      entityType: "invoice",
      entityId: invoiceId,
      eventType: type,
      actor,
      payload
    });
  }

  // ── lines ─────────────────────────────────────────────────────────────────

  async addLine(
    operatorId: string,
    propertyId: string,
    invoiceId: string,
    input: PgRentLineInput
  ): Promise<PgRentInvoice> {
    requireDb(this.db);
    const actor = this.actor(operatorId);
    await transaction(this.db, async (client) => {
      await assertManagedOwnership(client, operatorId, propertyId, true);
      const inv = await this.lockInvoice(client, propertyId, invoiceId);
      this.assertEditable(inv.status);
      const amount = inrToPaise(input.amount_inr, { allowNegative: true });
      const line = await client.query<{ id: string }>(
        `INSERT INTO pg_rent_invoice_lines (invoice_id, kind, label, amount_paise, meta, source, sort_order, created_by)
         VALUES ($1::uuid, $2::pg_rent_line_kind, $3, $4, $5::jsonb, 'operator', (SELECT COALESCE(MAX(sort_order),0)+1 FROM pg_rent_invoice_lines WHERE invoice_id = $1::uuid AND kind <> 'late_fee'), $6::uuid) RETURNING id::text`,
        [invoiceId, input.kind, input.label, amount, JSON.stringify(input.meta ?? {}), operatorId]
      );
      await this.settleTotal(
        client,
        invoiceId,
        Number(inv.amount_paid_paise),
        Number(inv.total_paise) + amount,
        actor
      );
      await this.event(client, propertyId, invoiceId, "invoice.line_added", actor, {
        line_id: line.rows[0].id,
        kind: input.kind,
        label: input.label,
        amount_paise: amount
      });
    });
    return this.readById(propertyId, invoiceId);
  }

  async updateLine(
    operatorId: string,
    propertyId: string,
    invoiceId: string,
    lineId: string,
    input: PgRentLinePatchInput
  ): Promise<PgRentInvoice> {
    requireDb(this.db);
    const actor = this.actor(operatorId);
    await transaction(this.db, async (client) => {
      await assertManagedOwnership(client, operatorId, propertyId, true);
      const inv = await this.lockInvoice(client, propertyId, invoiceId);
      this.assertEditable(inv.status);
      const line = await client.query<{ kind: string; amount_paise: string; label: string }>(
        `SELECT kind::text, amount_paise::text, label FROM pg_rent_invoice_lines WHERE id = $1::uuid AND invoice_id = $2::uuid FOR UPDATE`,
        [lineId, invoiceId]
      );
      if (!line.rows[0]) throw new NotFoundException({ code: "line_not_found" });
      const locked = ["rent", "deposit", "late_fee"].includes(line.rows[0].kind);
      if (locked && input.amount_inr !== undefined)
        throw new ConflictException({
          code: "line_locked",
          message: "Use waive / re-prorate / issue for this line"
        });
      const newAmount =
        input.amount_inr === undefined
          ? Number(line.rows[0].amount_paise)
          : inrToPaise(input.amount_inr, { allowNegative: true });
      await client.query(
        `UPDATE pg_rent_invoice_lines SET label = COALESCE($3, label), amount_paise = $4, meta = COALESCE($5::jsonb, meta) WHERE id = $1::uuid AND invoice_id = $2::uuid`,
        [
          lineId,
          invoiceId,
          input.label ?? null,
          newAmount,
          input.meta ? JSON.stringify(input.meta) : null
        ]
      );
      await this.settleTotal(
        client,
        invoiceId,
        Number(inv.amount_paid_paise),
        Number(inv.total_paise) - Number(line.rows[0].amount_paise) + newAmount,
        actor
      );
      await this.event(client, propertyId, invoiceId, "invoice.line_updated", actor, {
        line_id: lineId,
        from_paise: Number(line.rows[0].amount_paise),
        to_paise: newAmount,
        label: input.label ?? line.rows[0].label
      });
    });
    return this.readById(propertyId, invoiceId);
  }

  async removeLine(
    operatorId: string,
    propertyId: string,
    invoiceId: string,
    lineId: string
  ): Promise<PgRentInvoice> {
    requireDb(this.db);
    const actor = this.actor(operatorId);
    await transaction(this.db, async (client) => {
      await assertManagedOwnership(client, operatorId, propertyId, true);
      const inv = await this.lockInvoice(client, propertyId, invoiceId);
      this.assertEditable(inv.status === "paid" ? "issued" : inv.status); // a paid invoice may still lose a charge (§6.6)
      const line = await client.query<{
        kind: string;
        label: string;
        amount_paise: string;
        meta: unknown;
        source: string;
      }>(
        `SELECT kind::text, label, amount_paise::text, meta, source::text FROM pg_rent_invoice_lines WHERE id = $1::uuid AND invoice_id = $2::uuid FOR UPDATE`,
        [lineId, invoiceId]
      );
      if (!line.rows[0]) throw new NotFoundException({ code: "line_not_found" });
      if (["rent", "deposit", "late_fee"].includes(line.rows[0].kind))
        throw new ConflictException({ code: "line_locked" });
      const amount = Number(line.rows[0].amount_paise);
      await this.settleTotal(
        client,
        invoiceId,
        Number(inv.amount_paid_paise),
        Number(inv.total_paise) - amount,
        actor
      );
      await client.query(`DELETE FROM pg_rent_invoice_lines WHERE id = $1::uuid`, [lineId]);
      await setInvoiceTotalFromLines(client, invoiceId);
      // Carried requirement 2: this recompute (after the row is actually gone) is the one that
      // can newly zero the balance — settleTotal's own recompute above ran against the total
      // BEFORE the DELETE (setInvoiceTotalFromLines re-sums current rows, which still included
      // this line), so it never reaches a fresh "paid" transition on its own.
      await this.alloc.recomputeInvoice(client, invoiceId, todayIst());
      // D14: the event carries the full removed line — that is the audit record.
      await this.event(client, propertyId, invoiceId, "invoice.line_removed", actor, {
        line: { id: lineId, ...line.rows[0], amount_paise: amount }
      });
    });
    return this.readById(propertyId, invoiceId);
  }

  // ── lifecycle ─────────────────────────────────────────────────────────────

  async issueDraft(
    operatorId: string,
    propertyId: string,
    invoiceId: string,
    input: PgRentIssueDraftInput
  ): Promise<PgRentInvoice> {
    requireDb(this.db);
    const actor = this.actor(operatorId);
    await transaction(this.db, async (client) => {
      await assertManagedOwnership(client, operatorId, propertyId, true);
      const inv = await this.lockInvoice(client, propertyId, invoiceId);
      if (inv.status !== "draft") throw new ConflictException({ code: "invoice_not_draft" });
      if (input.rent_inr !== undefined) {
        const rent = inrToPaise(input.rent_inr);
        await client.query(
          `UPDATE pg_rent_invoice_lines SET amount_paise = $2 WHERE invoice_id = $1::uuid AND kind = 'rent'`,
          [invoiceId, rent]
        );
        await client.query(
          `UPDATE pg_rent_invoices SET rent_snapshot_paise = $2, rent_source = 'assignment' WHERE id = $1::uuid`,
          [invoiceId, rent]
        );
        await this.event(client, propertyId, invoiceId, "invoice.confirmed_amount", actor, {
          rent_paise: rent
        });
      }
      const today = todayIst();
      const due =
        input.due_date ?? (compareIsoDates(inv.due_date, today) < 0 ? today : inv.due_date);
      const token = newPayToken();
      await client.query(
        `UPDATE pg_rent_invoices SET status = 'issued', issued_at = now(), due_date = $2::date, pay_token = $3, pay_token_expires_at = $4 WHERE id = $1::uuid`,
        [invoiceId, due, token.token, token.expiresAt]
      );
      await setInvoiceTotalFromLines(client, invoiceId);
      await this.alloc.recomputeInvoice(client, invoiceId);
      await this.event(client, propertyId, invoiceId, "invoice.issued", actor, {
        from: "draft",
        due_date: due
      });
      await this.alloc.applyUnallocatedCredit(client, invoiceId, actor);
    });
    return this.readById(propertyId, invoiceId);
  }

  async extendDue(
    operatorId: string,
    propertyId: string,
    invoiceId: string,
    dueDate: string
  ): Promise<PgRentInvoice> {
    requireDb(this.db);
    const actor = this.actor(operatorId);
    await transaction(this.db, async (client) => {
      await assertManagedOwnership(client, operatorId, propertyId, true);
      const inv = await this.lockInvoice(client, propertyId, invoiceId);
      if (!["issued", "partially_paid"].includes(inv.status))
        throw new ConflictException({ code: "invoice_not_editable" });
      await client.query(`UPDATE pg_rent_invoices SET due_date = $2::date WHERE id = $1::uuid`, [
        invoiceId,
        dueDate
      ]);
      await this.event(client, propertyId, invoiceId, "invoice.due_extended", actor, {
        from: inv.due_date,
        to: dueDate
      });
      const ctx = await loadFeeContext(client, invoiceId);
      if (ctx.policy && (ctx.feeLinePaise !== null || ctx.invoice.suggestedPaise !== null)) {
        const decision = computeLateFee({
          policy: ctx.policy,
          dueDate,
          asOf: todayIst(),
          chargeablePaise: ctx.invoice.totalPaise - ctx.invoice.paidPaise - (ctx.feeLinePaise ?? 0),
          overridePaise: ctx.invoice.overridePaise,
          existingFeePaise: ctx.feeLinePaise ?? ctx.invoice.suggestedPaise,
          frozen: false
        });
        if (decision.action === "remove")
          await applyFeeDecision(client, this.alloc, ctx, decision, actor, {
            applyMode: "line",
            reason: "due_date_extended",
            // Carried requirement 2: extending the due date can remove the only thing keeping
            // the balance above zero (a fee that no longer applies inside the new grace).
            settledOn: todayIst()
          });
      }
    });
    return this.readById(propertyId, invoiceId);
  }

  async cancel(
    operatorId: string,
    propertyId: string,
    invoiceId: string,
    reason: string
  ): Promise<PgRentInvoice> {
    requireDb(this.db);
    const actor = this.actor(operatorId);
    await transaction(this.db, async (client) => {
      await assertManagedOwnership(client, operatorId, propertyId, true);
      const inv = await this.lockInvoice(client, propertyId, invoiceId);
      if (inv.status === "cancelled") throw new ConflictException({ code: "invoice_cancelled" });
      if (inv.status === "paid" && Number(inv.amount_paid_paise) > 0)
        throw new ConflictException({
          code: "invoice_paid",
          message: "Reverse its payments first"
        });
      if (inv.status === "partially_paid")
        await this.alloc.releaseAllocations(client, invoiceId, actor);
      await client.query(
        `UPDATE pg_rent_invoices SET status = 'cancelled', cancelled_at = now(), cancel_reason = $2, pay_token_expires_at = now() WHERE id = $1::uuid`,
        [invoiceId, reason]
      );
      await this.event(client, propertyId, invoiceId, "invoice.cancelled", actor, { reason });
    });
    return this.readById(propertyId, invoiceId);
  }

  // ── fees ──────────────────────────────────────────────────────────────────

  async applyFee(
    operatorId: string,
    propertyId: string,
    invoiceId: string,
    amountInr?: number
  ): Promise<PgRentInvoice> {
    requireDb(this.db);
    const actor = this.actor(operatorId);
    await transaction(this.db, async (client) => {
      await assertManagedOwnership(client, operatorId, propertyId, true);
      const inv = await this.lockInvoice(client, propertyId, invoiceId);
      // Carried requirement 5: this status check is the enforcement point that keeps a stale
      // suggested_late_fee_paise from resurrecting an invoice the sweep already settled to
      // `paid` (rent-payment.service.ts's finalizeConfirmed can skip fee re-evaluation on a
      // balance it only partially covers, so `paid` can retain a stale suggestion — status here
      // is read fresh under FOR UPDATE, so it always reflects the true, current state).
      if (
        inv.kind !== "rent" ||
        !inv.late_fee_eligible ||
        !["issued", "partially_paid"].includes(inv.status)
      )
        throw new ConflictException({ code: "fee_not_allowed" });
      const ctx = await loadFeeContext(client, invoiceId);
      const fee = amountInr !== undefined ? inrToPaise(amountInr) : ctx.invoice.suggestedPaise;
      if (fee === null || fee <= 0) throw new BadRequestException({ code: "fee_amount_required" });
      await applyFeeDecision(
        client,
        this.alloc,
        ctx,
        { feePaise: fee, action: ctx.feeLinePaise === null ? "apply" : "update" },
        actor,
        { applyMode: "line", reason: "owner_tap", settledOn: todayIst() }
      );
      await client.query(
        `UPDATE pg_rent_invoices SET late_fee_waived_at = NULL, late_fee_waived_by = NULL, late_fee_waive_reason = NULL WHERE id = $1::uuid`,
        [invoiceId]
      );
    });
    return this.readById(propertyId, invoiceId);
  }

  async waiveFee(
    operatorId: string,
    propertyId: string,
    invoiceId: string,
    reason: string
  ): Promise<PgRentInvoice> {
    requireDb(this.db);
    const actor = this.actor(operatorId);
    await transaction(this.db, async (client) => {
      await assertManagedOwnership(client, operatorId, propertyId, true);
      await this.lockInvoice(client, propertyId, invoiceId);
      const ctx = await loadFeeContext(client, invoiceId);
      await applyFeeDecision(client, this.alloc, ctx, { feePaise: 0, action: "remove" }, actor, {
        applyMode: "line",
        reason: "waived",
        // Carried requirement 2: waiving the only thing above amount_paid closes the invoice.
        settledOn: todayIst()
      });
      await client.query(
        `UPDATE pg_rent_invoices SET late_fee_waived_at = now(), late_fee_waived_by = $2::uuid, late_fee_waive_reason = $3 WHERE id = $1::uuid`,
        [invoiceId, operatorId, reason]
      );
      await this.event(client, propertyId, invoiceId, "late_fee.waived", actor, { reason });
    });
    return this.readById(propertyId, invoiceId);
  }

  async waiveAllFees(
    operatorId: string,
    propertyId: string,
    reason: string
  ): Promise<{ waived: number }> {
    requireDb(this.db);
    await assertManagedOwnership(this.db, operatorId, propertyId);
    const ids = await this.db.query<{ id: string }>(
      `SELECT i.id::text FROM pg_rent_invoices i WHERE i.pg_property_id = $1::uuid AND i.status IN ('issued','partially_paid')
          AND (EXISTS (SELECT 1 FROM pg_rent_invoice_lines l WHERE l.invoice_id = i.id AND l.kind = 'late_fee') OR i.suggested_late_fee_paise IS NOT NULL)`,
      [propertyId]
    );
    for (const row of ids.rows) await this.waiveFee(operatorId, propertyId, row.id, reason);
    return { waived: ids.rows.length };
  }

  async setEligibility(
    operatorId: string,
    propertyId: string,
    invoiceId: string,
    eligible: boolean
  ): Promise<PgRentInvoice> {
    requireDb(this.db);
    const actor = this.actor(operatorId);
    await transaction(this.db, async (client) => {
      await assertManagedOwnership(client, operatorId, propertyId, true);
      const inv = await this.lockInvoice(client, propertyId, invoiceId);
      if (inv.kind !== "rent") throw new ConflictException({ code: "fee_not_allowed" });
      if (!eligible) {
        // Invariant 16: an ineligible invoice may not carry a late_fee line. Turning eligibility
        // off after a fee was already applied (or merely suggested) must clear it here — nothing
        // else in the mutation surface revisits an existing charge when eligibility flips.
        const ctx = await loadFeeContext(client, invoiceId);
        if (ctx.feeLinePaise !== null || ctx.invoice.suggestedPaise !== null) {
          await applyFeeDecision(
            client,
            this.alloc,
            ctx,
            { feePaise: 0, action: "remove" },
            actor,
            {
              applyMode: "line",
              reason: "made_ineligible",
              settledOn: todayIst()
            }
          );
        }
      }
      await client.query(`UPDATE pg_rent_invoices SET late_fee_eligible = $2 WHERE id = $1::uuid`, [
        invoiceId,
        eligible
      ]);
      await this.event(client, propertyId, invoiceId, "late_fee.eligibility_changed", actor, {
        late_fee_eligible: eligible
      });
    });
    return this.readById(propertyId, invoiceId);
  }

  // ── manual & backfill ─────────────────────────────────────────────────────

  private async insertInvoice(
    client: PoolClient,
    v: {
      propertyId: string;
      assignmentId: string;
      kind: string;
      source: "manual" | "backfill";
      periodStart: string | null;
      periodEnd: string | null;
      dueDate: string;
      lines: Array<{ kind: string; label: string; amountPaise: number }>;
      eligible: boolean;
      tenantNote: string | null;
      actor: RentActor;
    }
  ): Promise<string> {
    const a = await client.query<{
      bed_id: string;
      bed_label: string;
      room_id: string;
      room_number: string;
      receipt_prefix: string;
    }>(
      `SELECT b.id::text AS bed_id, b.bed_label, r.id::text AS room_id, r.room_number, s.receipt_prefix
         FROM pg_bed_assignments asg JOIN pg_beds b ON b.id = asg.bed_id JOIN pg_rooms r ON r.id = b.room_id JOIN pg_rent_settings s ON s.pg_property_id = asg.pg_property_id
        WHERE asg.id = $1::uuid AND asg.pg_property_id = $2::uuid FOR UPDATE OF asg`,
      [v.assignmentId, v.propertyId]
    );
    if (!a.rows[0]) throw new NotFoundException({ code: "assignment_not_found" });
    if (v.kind === "rent") {
      // Fix round 1, Important 3: a NULL period_start/period_end makes daterange(NULL,NULL,'[]')
      // the universal range (confirmed on the dev DB), so a bounds-less rent backfill was either
      // wrongly refused as period_overlap (when another rent invoice existed) or silently
      // inserted with NULL bounds (when none did) — the latter violates invariant 5b, which
      // assumes every rent invoice carries real bounds. createBackfill is the only caller that
      // can reach kind='rent' here with operator-supplied (optional) bounds; require both.
      if (v.periodStart === null || v.periodEnd === null)
        throw new BadRequestException({ code: "period_required" });
      const overlap = await client.query(
        `SELECT 1 FROM pg_rent_invoices WHERE assignment_id = $1::uuid AND kind = 'rent' AND status <> 'cancelled' AND daterange(period_start, period_end, '[]') && daterange($2::date, $3::date, '[]')`,
        [v.assignmentId, v.periodStart, v.periodEnd]
      );
      if (overlap.rowCount) throw new ConflictException({ code: "period_overlap" });
    }
    if (v.kind === "deposit") {
      const dup = await client.query(
        `SELECT 1 FROM pg_rent_invoices WHERE assignment_id = $1::uuid AND kind = 'deposit' AND status <> 'cancelled'`,
        [v.assignmentId]
      );
      if (dup.rowCount) throw new ConflictException({ code: "deposit_exists" });
    }
    const number = await nextInvoiceNumber(client, v.propertyId, a.rows[0].receipt_prefix);
    const token = newPayToken();
    const total = v.lines.reduce((s, l) => s + l.amountPaise, 0);
    if (total < 0) throw new BadRequestException({ code: "invalid_total" });
    const inserted = await client.query<{ id: string }>(
      `INSERT INTO pg_rent_invoices (pg_property_id, assignment_id, bed_id, room_id, room_number, bed_label, kind, invoice_number, period_start, period_end, billing_month, due_date, status, source, total_paise, late_fee_eligible, pay_token, pay_token_expires_at, tenant_note, issued_at, created_by)
       VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5, $6, $7::pg_rent_invoice_kind, $8, $9::date, $10::date, $11::date, $12::date, 'issued', $13::pg_rent_invoice_source, $14, $15, $16, $17, $18, now(), $19::uuid) RETURNING id::text`,
      [
        v.propertyId,
        v.assignmentId,
        a.rows[0].bed_id,
        a.rows[0].room_id,
        a.rows[0].room_number,
        a.rows[0].bed_label,
        v.kind,
        number,
        v.periodStart,
        v.periodEnd,
        firstOfMonth(v.periodStart ?? v.dueDate),
        v.dueDate,
        v.source,
        total,
        v.eligible,
        token.token,
        token.expiresAt,
        v.tenantNote,
        v.actor.id
      ]
    );
    const id = inserted.rows[0].id;
    for (const [i, l] of v.lines.entries()) {
      await client.query(
        `INSERT INTO pg_rent_invoice_lines (invoice_id, kind, label, amount_paise, source, sort_order, created_by) VALUES ($1::uuid, $2::pg_rent_line_kind, $3, $4, 'operator', $5, $6::uuid)`,
        [id, l.kind, l.label, l.amountPaise, i, v.actor.id]
      );
    }
    await this.alloc.recomputeInvoice(client, id);
    await this.event(client, v.propertyId, id, "invoice.issued", v.actor, {
      kind: v.kind,
      source: v.source,
      total_paise: total,
      due_date: v.dueDate
    });
    return id;
  }

  async createManual(
    operatorId: string,
    propertyId: string,
    input: PgRentManualInvoiceInput
  ): Promise<PgRentInvoice> {
    requireDb(this.db);
    const actor = this.actor(operatorId);
    const id = await transaction(this.db, async (client) => {
      await assertManagedOwnership(client, operatorId, propertyId, true);
      const id = await this.insertInvoice(client, {
        propertyId,
        assignmentId: input.assignment_id,
        kind: "adhoc",
        source: "manual",
        periodStart: null,
        periodEnd: null,
        dueDate: input.due_date,
        lines: input.lines.map((l) => ({
          kind: l.kind,
          label: l.label,
          amountPaise: inrToPaise(l.amount_inr, { allowNegative: true })
        })),
        eligible: false,
        tenantNote: input.tenant_note ?? null,
        actor
      });
      await this.alloc.applyUnallocatedCredit(client, id, actor);
      return id;
    });
    return this.readById(propertyId, id);
  }

  /** Spec §6.4 / §5.5 "Deposit held": invoice (+ optional backfill payment) in one transaction; no receipt; fee-exempt. */
  async createBackfill(
    operatorId: string,
    propertyId: string,
    input: PgRentBackfillInput
  ): Promise<PgRentInvoice> {
    requireDb(this.db);
    const actor = this.actor(operatorId);
    const id = await transaction(this.db, async (client) => {
      await assertManagedOwnership(client, operatorId, propertyId, true);
      const id = await this.insertInvoice(client, {
        propertyId,
        assignmentId: input.assignment_id,
        kind: input.kind,
        source: "backfill",
        periodStart: input.period_start ?? null,
        periodEnd: input.period_end ?? null,
        dueDate: input.due_date,
        lines: input.lines.map((l) => ({
          kind: l.kind,
          label: l.label,
          amountPaise: inrToPaise(l.amount_inr, { allowNegative: true })
        })),
        eligible: false,
        tenantNote: null,
        actor
      });
      if (input.payment) {
        await this.payments.recordBackfillPayment(client, {
          propertyId,
          assignmentId: input.assignment_id,
          invoiceId: id,
          amountPaise: inrToPaise(input.payment.amount_inr),
          method: input.payment.method,
          paidOn: input.payment.paid_on,
          reference: input.payment.reference ?? null,
          actor
        });
      } else {
        await this.alloc.applyUnallocatedCredit(client, id, actor);
      }
      return id;
    });
    return this.readById(propertyId, id);
  }

  // ── re-proration (spec §5.8, D18) ─────────────────────────────────────────

  async applyReprorate(
    operatorId: string,
    propertyId: string,
    invoiceId: string
  ): Promise<PgRentInvoice> {
    requireDb(this.db);
    const actor = this.actor(operatorId);
    await transaction(this.db, async (client) => {
      await assertManagedOwnership(client, operatorId, propertyId, true);
      const inv = await this.lockInvoice(client, propertyId, invoiceId);
      const s = inv.reprorate_suggestion;
      if (!s || s.mode !== "reprorate") throw new ConflictException({ code: "no_suggestion" });
      const line = await client.query<{
        id: string;
        amount_paise: string;
        meta: Record<string, unknown>;
      }>(
        `SELECT id::text, amount_paise::text, meta FROM pg_rent_invoice_lines WHERE invoice_id = $1::uuid AND kind = 'rent' FOR UPDATE`,
        [invoiceId]
      );
      const original = Number(line.rows[0].amount_paise);
      // Fix round 1, Important 1: a second re-proration (e.g. notice served for the 15th, applied,
      // then an earlier move-out confirmed for the 10th) must not overwrite an already-reprorated
      // invoice's `meta.reprorated` baseline — doing so replaced the TRUE original (9000/Sep30)
      // with the already-shrunk intermediate value (4500/Sep15), so a later restore returned the
      // tenant to the wrong, smaller amount (silent money loss). The billed amount still updates
      // every time; only the restore baseline is write-once.
      await client.query(
        `UPDATE pg_rent_invoice_lines
            SET amount_paise = $2,
                meta = CASE WHEN meta ? 'reprorated' THEN meta ELSE meta || $3::jsonb END
          WHERE id = $1::uuid`,
        [
          line.rows[0].id,
          s.to_paise,
          JSON.stringify({
            reprorated: {
              original_paise: original,
              original_end: inv.period_end,
              leave_on: s.leave_on
            }
          })
        ]
      );
      await client.query(
        `UPDATE pg_rent_invoices SET period_end = $2::date, proration_factor = NULL, reprorate_suggestion = NULL WHERE id = $1::uuid`,
        [invoiceId, s.leave_on]
      );
      await this.settleTotal(
        client,
        invoiceId,
        Number(inv.amount_paid_paise),
        Number(inv.total_paise) - original + s.to_paise,
        actor
      );
      await this.event(client, propertyId, invoiceId, "invoice.reprorated", actor, {
        leave_on: s.leave_on,
        from_paise: original,
        to_paise: s.to_paise
      });
    });
    return this.readById(propertyId, invoiceId);
  }

  async dismissReprorate(
    operatorId: string,
    propertyId: string,
    invoiceId: string
  ): Promise<PgRentInvoice> {
    requireDb(this.db);
    await transaction(this.db, async (client) => {
      await assertManagedOwnership(client, operatorId, propertyId, true);
      await this.lockInvoice(client, propertyId, invoiceId);
      await client.query(
        `UPDATE pg_rent_invoices SET reprorate_suggestion = NULL WHERE id = $1::uuid`,
        [invoiceId]
      );
      await this.event(
        client,
        propertyId,
        invoiceId,
        "invoice.reprorate_dismissed",
        this.actor(operatorId)
      );
    });
    return this.readById(propertyId, invoiceId);
  }

  async restoreReprorate(
    operatorId: string,
    propertyId: string,
    invoiceId: string
  ): Promise<PgRentInvoice> {
    requireDb(this.db);
    const actor = this.actor(operatorId);
    await transaction(this.db, async (client) => {
      await assertManagedOwnership(client, operatorId, propertyId, true);
      const inv = await this.lockInvoice(client, propertyId, invoiceId);
      const s = inv.reprorate_suggestion;
      if (!s || s.mode !== "restore") throw new ConflictException({ code: "no_suggestion" });
      const line = await client.query<{
        id: string;
        amount_paise: string;
        meta: { reprorated?: { original_paise: number; original_end: string } };
      }>(
        `SELECT id::text, amount_paise::text, meta FROM pg_rent_invoice_lines WHERE invoice_id = $1::uuid AND kind = 'rent' FOR UPDATE`,
        [invoiceId]
      );
      const r = line.rows[0].meta.reprorated;
      if (!r) throw new ConflictException({ code: "no_suggestion" });
      // Fix round 1, Critical: onAssignmentEvent runs generateInvoicesForProperty BEFORE this
      // suggestion is even offered, so on the default production path a "staying" transition can
      // already have auto-issued a gap invoice for leave_date+1..natural end (the same days this
      // restore is about to re-cover) and FIFO-allocated floating credit to it. Restoring
      // period_end back to the original end with no check would create two non-cancelled rent
      // invoices covering the same days (invariant 5) and double-bill the tenant. Refuse instead;
      // the operator must resolve the conflicting invoice (e.g. reverse its payment and cancel it)
      // before retrying.
      const overlap = await client.query(
        `SELECT 1 FROM pg_rent_invoices WHERE assignment_id = $1::uuid AND kind = 'rent' AND status <> 'cancelled' AND id <> $2::uuid AND daterange(period_start, period_end, '[]') && daterange($3::date, $4::date, '[]')`,
        [inv.assignment_id, invoiceId, inv.period_start, r.original_end]
      );
      if (overlap.rowCount) throw new ConflictException({ code: "period_overlap" });
      await client.query(
        `UPDATE pg_rent_invoice_lines SET amount_paise = $2, meta = meta - 'reprorated' WHERE id = $1::uuid`,
        [line.rows[0].id, r.original_paise]
      );
      await client.query(
        `UPDATE pg_rent_invoices SET period_end = $2::date, reprorate_suggestion = NULL WHERE id = $1::uuid`,
        [invoiceId, r.original_end]
      );
      await setInvoiceTotalFromLines(client, invoiceId);
      await this.alloc.recomputeInvoice(client, invoiceId);
      await this.event(client, propertyId, invoiceId, "invoice.line_updated", actor, {
        reason: "reprorate_restored",
        from_paise: Number(line.rows[0].amount_paise),
        to_paise: r.original_paise
      });
      // applyReprorate's own settleTotal call can leave a *partial* allocation row for
      // (payment, invoiceId) when the shrink only partly exceeded amount_paid (deallocateExcess
      // reduces the row in place rather than deleting it — rent-allocation.service.ts's
      // deallocateExcess). applyUnallocatedCredit always INSERTs a fresh row and has no "top up
      // an existing one" path (uq_pg_rent_alloc_invoice is a unique index on (payment_id,
      // invoice_id), migration 0072), so calling it directly here throws 23505 whenever that
      // partial row survived the round trip. Releasing back to credit first — a no-op when
      // nothing is allocated yet — lets applyUnallocatedCredit's ordinary FIFO re-allocate the
      // full amount fresh, without touching RentAllocationService itself.
      await this.alloc.releaseAllocations(client, invoiceId, actor);
      await this.alloc.applyUnallocatedCredit(client, invoiceId, actor);
    });
    return this.readById(propertyId, invoiceId);
  }

  private async withLines(q: Queryable, rows: RentInvoiceRow[]): Promise<PgRentInvoice[]> {
    if (rows.length === 0) return [];
    const lines = await q.query<RentLineRow>(
      `SELECT ${LINE_SELECT} FROM pg_rent_invoice_lines l WHERE l.invoice_id = ANY($1::uuid[])`,
      [rows.map((r) => r.id)]
    );
    return rows.map((r) => toInvoiceDto(r, lines.rows));
  }
}
