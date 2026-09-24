import { ForbiddenException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import type {
  PgRentBankDetails,
  PgRentHeroState,
  PgRentSettlementStatement,
  PgRentTenantHero,
  PgRentTenantHistory,
  PgRentTenantInvoice,
  PgRentTenantResidence,
  PgRentTenantSummary
} from "@cribliv/shared-types";

import { DatabaseService } from "../../../common/database.service";
import { todayIst } from "../../../common/date";
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
import { paiseToInr } from "../dto/money";
import {
  PAYMENT_SELECT,
  ALLOCATION_SELECT,
  toPaymentDto,
  type RentAllocationRow,
  type RentPaymentRow
} from "../dto/payment.dto";
import { RECEIPT_SELECT, toReceiptDto, type RentReceiptRow } from "../dto/receipt.dto";
import {
  TENANT_VISIBLE_EVENT_SQL,
  toTenantInvoiceDto,
  toTenantPaymentDto,
  toTenantReceiptDto,
  toTenantSettlementDto
} from "../dto/tenant-reads.dto";
import { addDays, dayOf } from "../pure/rent-dates";
import { naturalDueDate, nextPeriod, type DueSpec, type PeriodSpec } from "../pure/rent-period";
import { reminderState } from "../pure/rent-reminder-state";
import { buildWaMeLink } from "../pure/rent-upi";
import { RentAllocationService } from "./rent-allocation.service";
import { writeRentEvent } from "./rent-events";
import { assertManagedOwnership, requireDb, resolveTenantAssignmentIds } from "./rent-guards";
import { RentPayInstructionService } from "./rent-pay-instruction.service";
import { RentSettlementService } from "./rent-settlement.service";

const LEAVING = [
  "notice_served",
  "move_out_requested",
  "move_out_pending_confirmation",
  "moved_out"
];

@Injectable()
export class RentTenantService {
  constructor(
    @Inject(DatabaseService) private readonly db: DatabaseService,
    @Inject(RentAllocationService) private readonly alloc: RentAllocationService,
    @Inject(RentPayInstructionService) private readonly pay: RentPayInstructionService,
    @Inject(RentSettlementService) private readonly settlement: RentSettlementService
  ) {}

  async summary(userId: string, today = todayIst()): Promise<PgRentTenantSummary> {
    requireDb(this.db);
    const ids = await resolveTenantAssignmentIds(this.db, userId);
    if (ids.length === 0) return { residences: [] };
    const rows = await this.db.query<{
      id: string;
      pg_property_id: string;
      property_name: string;
      room_number: string;
      bed_label: string;
      status: string;
      enabled: boolean;
      upi_payee_name: string | null;
      upi_vpa: string | null;
      bank_details: PgRentBankDetails | null;
      whatsapp_phone_e164: string | null;
      operator_phone: string;
      locale: string;
      invoice_lead_days: number | null;
      disputed: boolean;
    }>(
      `SELECT a.id::text, a.pg_property_id::text, p.display_name AS property_name, r.room_number, b.bed_label, a.status::text,
              (s.pg_property_id IS NOT NULL) AS enabled, s.upi_payee_name, s.upi_vpa, s.bank_details, s.whatsapp_phone_e164, op.phone_e164 AS operator_phone,
              COALESCE(op.preferred_language,'en') AS locale, s.invoice_lead_days,
              COALESCE((SELECT e.payload->>'flag' FROM pg_rent_events e WHERE e.entity_type = 'assignment' AND e.entity_id = a.id AND e.payload->>'flag' IN ('identity_disputed','identity_dispute_cleared') ORDER BY e.id DESC LIMIT 1) = 'identity_disputed', false) AS disputed
         FROM pg_bed_assignments a JOIN pg_beds b ON b.id = a.bed_id JOIN pg_rooms r ON r.id = b.room_id JOIN pg_properties p ON p.id = a.pg_property_id JOIN users op ON op.id = p.operator_id
         LEFT JOIN pg_rent_settings s ON s.pg_property_id = a.pg_property_id
        WHERE a.id = ANY($1::uuid[])
        ORDER BY CASE a.status::text WHEN 'active' THEN 1 WHEN 'notice_served' THEN 2 WHEN 'move_out_requested' THEN 3 WHEN 'move_out_pending_confirmation' THEN 4 WHEN 'reserved' THEN 5 WHEN 'moved_out' THEN 6 ELSE 7 END, a.updated_at DESC`,
      [ids]
    );
    const residences: PgRentTenantResidence[] = [];
    for (const x of rows.rows) {
      const ownerPhone = x.whatsapp_phone_e164 ?? x.operator_phone;
      const base = {
        assignment_id: x.id,
        property_id: x.pg_property_id,
        property_name: x.property_name,
        room_number: x.room_number,
        bed_label: x.bed_label,
        assignment_status: x.status,
        identity_disputed: x.disputed,
        owner_wa_digits: ownerPhone ? ownerPhone.replace(/\D/g, "") : null
      };
      if (!x.enabled) {
        residences.push({
          ...base,
          enabled: false,
          payee: null,
          hero: this.emptyHero("not_enabled"),
          deposit: null
        });
        continue;
      }
      residences.push({
        ...base,
        enabled: true,
        payee: { name: x.upi_payee_name, vpa: x.upi_vpa, bank: x.bank_details },
        hero: await this.hero(
          x.id,
          x.pg_property_id,
          x.status,
          x.locale === "hi" ? "hi" : "en",
          today,
          x.invoice_lead_days ?? 5,
          x
        ),
        deposit: await this.deposit(x.id)
      });
    }
    return { residences };
  }

  private emptyHero(state: PgRentHeroState): PgRentTenantHero {
    return {
      state,
      invoice: null,
      more_open_count: 0,
      more_open_inr: 0,
      pending_claim: null,
      credit_inr: 0,
      last_receipt: null,
      next_invoice_expected_on: null,
      settlement: null
    };
  }

  private async hero(
    assignmentId: string,
    propertyId: string,
    status: string,
    locale: "en" | "hi",
    today: string,
    leadDays: number,
    settingsRow: {
      upi_vpa: string | null;
      upi_payee_name: string | null;
      bank_details: PgRentBankDetails | null;
    }
  ): Promise<PgRentTenantHero> {
    const credit = paiseToInr(await this.alloc.unallocatedCredit(this.db, assignmentId));
    const pending = await this.db.query<RentPaymentRow>(
      `SELECT ${PAYMENT_SELECT} FROM pg_rent_payments p JOIN pg_bed_assignments a ON a.id = p.assignment_id WHERE p.assignment_id = $1::uuid AND p.status = 'pending_confirmation' ORDER BY p.created_at DESC LIMIT 1`,
      [assignmentId]
    );
    const open = await this.db.query<RentInvoiceRow>(
      `SELECT ${INVOICE_SELECT} FROM pg_rent_invoices i JOIN pg_bed_assignments a ON a.id = i.assignment_id WHERE i.assignment_id = $1::uuid AND i.status IN ('issued','partially_paid') ORDER BY i.due_date, i.created_at`,
      [assignmentId]
    );
    const openDtos = await this.withLines(open.rows);
    const first = openDtos[0] ?? null;
    const rest = openDtos.slice(1);
    // Read-only statement: a tenant GET never generates invoices or writes events.
    // toTenantSettlementDto strips the owner-only pending_suggestion / maintenance_prefills
    // (fix round 1: spec §9/§6.11 — an unactioned suggestion and an unapplied damage
    // prefill are never shown to the tenant).
    const settlement: PgRentSettlementStatement | null = LEAVING.includes(status)
      ? toTenantSettlementDto(await this.settlement.computeStatement(propertyId, assignmentId))
      : null;
    let state: PgRentHeroState;
    if (settlement && settlement.status === "settled") state = "settled";
    else if (settlement && settlement.status === "leaving") state = "leaving";
    else if (pending.rows[0]) state = "awaiting";
    else if (first) {
      const st = reminderState({
        dueDate: first.due_date,
        today,
        offsets: [-3, 0, 1],
        graceDays: 0
      });
      state =
        first.status === "partially_paid"
          ? "partially_paid"
          : st.state === "overdue"
            ? "overdue"
            : "due";
    } else {
      const last = await this.db.query<{ id: string }>(
        `SELECT id::text FROM pg_rent_invoices WHERE assignment_id = $1::uuid AND status = 'paid' ORDER BY due_date DESC LIMIT 1`,
        [assignmentId]
      );
      state = last.rows[0] ? "paid" : "nothing_due";
    }
    const invoice = first ?? (state === "paid" ? await this.lastPaid(assignmentId) : null);
    const lastReceipt = await this.db.query<RentReceiptRow>(
      `SELECT ${RECEIPT_SELECT} FROM pg_rent_receipts r WHERE r.assignment_id = $1::uuid AND r.voided_at IS NULL ORDER BY r.created_at DESC LIMIT 1`,
      [assignmentId]
    );
    // Spec §9: the next invoice appears on the next period's due date minus the lead days
    // (the engine's own specFor rule: tenant rent_due_day overrides, anchor = move-in day).
    const next = await this.db.query<{
      last_end: string | null;
      cycle_mode: "calendar_month" | "anniversary";
      billing_timing: "advance" | "arrears";
      due_day: number;
      rent_due_day: number | null;
      move_in_date: string | null;
    }>(
      `SELECT (SELECT to_char(MAX(i.period_end), 'YYYY-MM-DD') FROM pg_rent_invoices i
                WHERE i.assignment_id = a.id AND i.kind = 'rent' AND i.status <> 'cancelled') AS last_end,
              s.cycle_mode::text AS cycle_mode, s.billing_timing::text AS billing_timing, s.due_day,
              a.rent_due_day, to_char(a.move_in_date, 'YYYY-MM-DD') AS move_in_date
         FROM pg_bed_assignments a JOIN pg_rent_settings s ON s.pg_property_id = a.pg_property_id
        WHERE a.id = $1::uuid`,
      [assignmentId]
    );
    const n = next.rows[0];
    let nextExpected: string | null = null;
    if (n?.last_end && (state === "paid" || state === "nothing_due")) {
      const spec: PeriodSpec = {
        cycleMode: n.cycle_mode,
        anchorDay: n.rent_due_day ?? (n.move_in_date ? dayOf(n.move_in_date) : 1)
      };
      const due: DueSpec = { timing: n.billing_timing, dueDay: n.rent_due_day ?? n.due_day };
      nextExpected = addDays(naturalDueDate(nextPeriod(n.last_end, spec), spec, due), -leadDays);
    }
    return {
      state,
      invoice: invoice ? await this.decorate(invoice, locale, settingsRow) : null,
      more_open_count: rest.length,
      more_open_inr: rest.reduce((s, i) => s + i.balance_inr, 0),
      pending_claim: pending.rows[0] ? (await this.paymentsDto(pending.rows))[0] : null,
      credit_inr: credit,
      last_receipt: lastReceipt.rows[0]
        ? toTenantReceiptDto(toReceiptDto(lastReceipt.rows[0]))
        : null,
      next_invoice_expected_on: nextExpected,
      settlement
    };
  }

  private async lastPaid(assignmentId: string) {
    const r = await this.db.query<RentInvoiceRow>(
      `SELECT ${INVOICE_SELECT} FROM pg_rent_invoices i JOIN pg_bed_assignments a ON a.id = i.assignment_id WHERE i.assignment_id = $1::uuid AND i.status = 'paid' ORDER BY i.due_date DESC LIMIT 1`,
      [assignmentId]
    );
    return (await this.withLines(r.rows))[0] ?? null;
  }

  private async withLines(rows: RentInvoiceRow[]) {
    if (!rows.length) return [];
    const lines = await this.db.query<RentLineRow>(
      `SELECT ${LINE_SELECT} FROM pg_rent_invoice_lines l WHERE l.invoice_id = ANY($1::uuid[])`,
      [rows.map((r) => r.id)]
    );
    return rows.map((r) => toInvoiceDto(r, lines.rows));
  }

  private async paymentsDto(rows: RentPaymentRow[]) {
    if (!rows.length) return [];
    const allocs = await this.db.query<RentAllocationRow>(
      `SELECT ${ALLOCATION_SELECT} FROM pg_rent_payment_allocations al LEFT JOIN pg_rent_invoices i ON i.id = al.invoice_id WHERE al.payment_id = ANY($1::uuid[]) ORDER BY al.created_at, al.seq`,
      [rows.map((r) => r.id)]
    );
    // Fix (final review, finding 2): this service is tenant-only, so every payment
    // it returns goes through the tenant DTO (drops note/recorded_by/confirmed_by
    // unless the tenant claimed the payment themselves).
    return rows.map((r) => toTenantPaymentDto(toPaymentDto(r, allocs.rows)));
  }

  /** Attach pay link + instruction + tenant-visible change log. */
  private async decorate(
    dto: ReturnType<typeof toInvoiceDto>,
    locale: "en" | "hi",
    settingsRow: {
      upi_vpa: string | null;
      upi_payee_name: string | null;
      bank_details: PgRentBankDetails | null;
    }
  ): Promise<PgRentTenantInvoice> {
    const token = await this.db.query<{ t: string | null; live: boolean }>(
      `SELECT pay_token AS t, (pay_token_expires_at > now()) AS live FROM pg_rent_invoices WHERE id = $1::uuid`,
      [dto.id]
    );
    const payable = dto.status === "issued" || dto.status === "partially_paid";
    const link =
      payable && token.rows[0]?.t && token.rows[0].live
        ? this.pay.payLinkFor(locale, token.rows[0].t)
        : null;
    const instruction = payable
      ? await this.pay.buildPayInstruction({
          settings: settingsRow,
          amountInr: dto.balance_inr,
          note: `${dto.period_start ? dto.invoice_number : dto.kind} Room ${dto.room_number}`,
          tr: dto.invoice_number
        })
      : null;
    const ev = await this.db.query<RentEventRow>(
      `SELECT e.id::text, e.entity_type, e.entity_id::text, e.event_type, e.actor_user_id::text, e.actor_role, e.payload, e.created_at
         FROM pg_rent_events e JOIN pg_rent_invoices i ON i.id = e.entity_id
        WHERE e.entity_type = 'invoice' AND e.entity_id = $1::uuid AND i.issued_at IS NOT NULL AND e.created_at >= i.issued_at AND ${TENANT_VISIBLE_EVENT_SQL} ORDER BY e.id`,
      [dto.id]
    );
    return toTenantInvoiceDto(dto, {
      pay_link: link,
      instruction,
      // owner-only keys never reach the tenant, even inside an event payload (spec §9)
      changes: ev.rows.map(toEventDto).map((e) => {
        const { rent_source: _rentSource, ...payload } = e.payload;
        return { ...e, payload };
      })
    });
  }

  private async deposit(assignmentId: string) {
    const r = await this.db.query<{ paid: string; total: string; paid_on: string | null }>(
      `SELECT COALESCE(SUM(i.amount_paid_paise),0)::text AS paid, COALESCE(SUM(i.total_paise),0)::text AS total, to_char(MAX(i.settled_on),'YYYY-MM-DD') AS paid_on
         FROM pg_rent_invoices i WHERE i.assignment_id = $1::uuid AND i.kind = 'deposit' AND i.status <> 'cancelled'`,
      [assignmentId]
    );
    const released = await this.db.query<{ v: string }>(
      `SELECT COALESCE(SUM(amount_paise),0)::text AS v FROM pg_rent_payments WHERE assignment_id = $1::uuid AND source = 'deposit_release' AND status = 'confirmed'`,
      [assignmentId]
    );
    if (Number(r.rows[0].total) === 0) return null;
    return {
      held_inr: paiseToInr(Number(r.rows[0].paid) - Number(released.rows[0].v)),
      paid_on: r.rows[0].paid_on,
      uncollected_inr: paiseToInr(Number(r.rows[0].total) - Number(r.rows[0].paid))
    };
  }

  async history(userId: string, assignmentId: string): Promise<PgRentTenantHistory> {
    requireDb(this.db);
    const mine = await resolveTenantAssignmentIds(this.db, userId);
    if (!mine.includes(assignmentId)) throw new ForbiddenException({ code: "forbidden" });
    const ctx = await this.db.query<{
      locale: string;
      upi_vpa: string | null;
      upi_payee_name: string | null;
      bank_details: PgRentBankDetails | null;
    }>(
      `SELECT COALESCE(op.preferred_language,'en') AS locale, s.upi_vpa, s.upi_payee_name, s.bank_details FROM pg_bed_assignments a JOIN pg_properties p ON p.id = a.pg_property_id JOIN users op ON op.id = p.operator_id LEFT JOIN pg_rent_settings s ON s.pg_property_id = p.id WHERE a.id = $1::uuid`,
      [assignmentId]
    );
    const locale = ctx.rows[0]?.locale === "hi" ? "hi" : "en";
    const inv = await this.db.query<RentInvoiceRow>(
      `SELECT ${INVOICE_SELECT} FROM pg_rent_invoices i JOIN pg_bed_assignments a ON a.id = i.assignment_id WHERE i.assignment_id = $1::uuid AND i.status <> 'draft' ORDER BY i.due_date DESC`,
      [assignmentId]
    );
    const invoices: PgRentTenantInvoice[] = [];
    for (const dto of await this.withLines(inv.rows))
      invoices.push(await this.decorate(dto, locale, ctx.rows[0]));
    const pays = await this.db.query<RentPaymentRow>(
      `SELECT ${PAYMENT_SELECT} FROM pg_rent_payments p JOIN pg_bed_assignments a ON a.id = p.assignment_id WHERE p.assignment_id = $1::uuid ORDER BY p.paid_on DESC, p.created_at DESC`,
      [assignmentId]
    );
    const rec = await this.db.query<RentReceiptRow>(
      `SELECT ${RECEIPT_SELECT} FROM pg_rent_receipts r WHERE r.assignment_id = $1::uuid ORDER BY r.created_at DESC`,
      [assignmentId]
    );
    return {
      assignment_id: assignmentId,
      invoices,
      payments: await this.paymentsDto(pays.rows),
      receipts: rec.rows.map((r) => toTenantReceiptDto(toReceiptDto(r)))
    };
  }

  async invoice(userId: string, invoiceId: string): Promise<PgRentTenantInvoice> {
    requireDb(this.db);
    const mine = await resolveTenantAssignmentIds(this.db, userId);
    const r = await this.db.query<
      RentInvoiceRow & {
        locale: string;
        upi_vpa: string | null;
        upi_payee_name: string | null;
        bank_details: PgRentBankDetails | null;
      }
    >(
      `SELECT ${INVOICE_SELECT}, COALESCE(op.preferred_language,'en') AS locale, s.upi_vpa, s.upi_payee_name, s.bank_details
         FROM pg_rent_invoices i JOIN pg_bed_assignments a ON a.id = i.assignment_id JOIN pg_properties p ON p.id = i.pg_property_id JOIN users op ON op.id = p.operator_id LEFT JOIN pg_rent_settings s ON s.pg_property_id = p.id
        WHERE i.id = $1::uuid AND i.assignment_id = ANY($2::uuid[]) AND i.status <> 'draft'`,
      [invoiceId, mine]
    );
    if (!r.rows[0]) throw new NotFoundException({ code: "invoice_not_found" });
    const dto = (await this.withLines([r.rows[0]]))[0];
    return this.decorate(dto, r.rows[0].locale === "hi" ? "hi" : "en", r.rows[0]);
  }

  /** Spec §7.9. Fixed system text; logs the flag; never blocks anything. */
  async identityDispute(
    userId: string,
    assignmentId: string
  ): Promise<{ wa_me_url: string | null }> {
    requireDb(this.db);
    const mine = await resolveTenantAssignmentIds(this.db, userId);
    if (!mine.includes(assignmentId)) throw new ForbiddenException({ code: "forbidden" });
    const r = await this.db.query<{
      pg_property_id: string;
      property_name: string;
      room_number: string;
      bed_label: string;
      owner_phone: string;
      locale: string;
    }>(
      `SELECT a.pg_property_id::text, p.display_name AS property_name, r.room_number, b.bed_label, COALESCE(s.whatsapp_phone_e164, op.phone_e164) AS owner_phone, COALESCE(op.preferred_language,'en') AS locale
         FROM pg_bed_assignments a JOIN pg_beds b ON b.id = a.bed_id JOIN pg_rooms r ON r.id = b.room_id JOIN pg_properties p ON p.id = a.pg_property_id JOIN users op ON op.id = p.operator_id LEFT JOIN pg_rent_settings s ON s.pg_property_id = p.id
        WHERE a.id = $1::uuid`,
      [assignmentId]
    );
    const x = r.rows[0];
    await transaction(this.db, (client) =>
      writeRentEvent(client, {
        propertyId: x.pg_property_id,
        entityType: "assignment",
        entityId: assignmentId,
        eventType: "assignment.override_updated",
        actor: { id: userId, role: "tenant" },
        payload: { flag: "identity_disputed" }
      })
    );
    const text =
      x.locale === "hi"
        ? `नमस्ते, Cribliv पर ${x.property_name} (कमरा ${x.room_number}, बेड ${x.bed_label}) मेरे नंबर से जुड़ा दिख रहा है, लेकिन मैं वहाँ नहीं रहता/रहती। कृपया जाँच लें।`
        : `Hi, Cribliv shows ${x.property_name} (Room ${x.room_number}, Bed ${x.bed_label}) linked to my number, but I don't live there. Please check.`;
    return { wa_me_url: x.owner_phone ? buildWaMeLink(x.owner_phone, text) : null };
  }

  async resolveDispute(
    operatorId: string,
    propertyId: string,
    assignmentId: string
  ): Promise<void> {
    requireDb(this.db);
    await transaction(this.db, async (client) => {
      await assertManagedOwnership(client, operatorId, propertyId, true);
      const a = await client.query(
        `SELECT 1 FROM pg_bed_assignments WHERE id = $1::uuid AND pg_property_id = $2::uuid`,
        [assignmentId, propertyId]
      );
      if (!a.rowCount) throw new NotFoundException({ code: "assignment_not_found" });
      await writeRentEvent(client, {
        propertyId,
        entityType: "assignment",
        entityId: assignmentId,
        eventType: "assignment.override_updated",
        actor: { id: operatorId, role: "pg_operator" },
        payload: { flag: "identity_dispute_cleared" }
      });
    });
  }
}
