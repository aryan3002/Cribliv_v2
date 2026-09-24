import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException
} from "@nestjs/common";
import type {
  PgRentInvoiceMessages,
  PgRentMergeFields,
  PgRentReminderState,
  PgRentRenderedMessage,
  PgRentTemplateKey,
  PgRentTemplatePreviewInput
} from "@cribliv/shared-types";

import { DatabaseService } from "../../../common/database.service";
import { todayIst } from "../../../common/date";
import { transaction } from "../../../common/transaction";
import { paiseToInr } from "../dto/money";
import { periodLabel } from "../pure/rent-period";
import { duePhrase, reminderState } from "../pure/rent-reminder-state";
import {
  DEFAULT_TEMPLATES,
  MAX_TEMPLATE_CHARS,
  formatInrGrouped,
  mergeTemplate
} from "../pure/rent-template";
import { buildWaMeLink } from "../pure/rent-upi";
import { writeRentEvent } from "./rent-events";
import {
  assertManagedOwnership,
  requireDb,
  resolveTenantAssignmentIds,
  type Queryable
} from "./rent-guards";
import { newPayToken } from "./rent-numbering";
import { RentPayInstructionService, SITE_URL } from "./rent-pay-instruction.service";

interface FieldsRow {
  id: string;
  pg_property_id: string;
  assignment_id: string;
  invoice_number: string;
  kind: string;
  status: string;
  period_start: string | null;
  period_end: string | null;
  due_date: string;
  total_paise: string;
  amount_paid_paise: string;
  pay_token: string | null;
  pay_token_live: boolean;
  fee_line: string | null;
  occupant_name: string;
  occupant_phone_e164: string;
  tenant_user_id: string | null;
  room_number: string;
  bed_label: string;
  property_name: string;
  operator_name: string | null;
  operator_phone: string;
  whatsapp_phone_e164: string | null;
  upi_vpa: string | null;
  cycle_mode: "calendar_month" | "anniversary";
  reminder_offsets_days: number[];
  late_fee_grace_days: number;
  locale: string;
  msg_reminder: string | null;
  msg_overdue: string | null;
  msg_tenant_paid: string | null;
  msg_receipt_share: string | null;
  receipt_id: string | null;
  receipt_share_token: string | null;
  receipt_amount_paise: string | null;
}

const FIELDS_SQL = `
  SELECT i.id::text, i.pg_property_id::text, i.assignment_id::text, i.invoice_number, i.kind::text, i.status::text,
         to_char(i.period_start,'YYYY-MM-DD') AS period_start, to_char(i.period_end,'YYYY-MM-DD') AS period_end, to_char(i.due_date,'YYYY-MM-DD') AS due_date,
         i.total_paise::text, i.amount_paid_paise::text, i.pay_token, (i.pay_token_expires_at > now()) AS pay_token_live,
         (SELECT l.amount_paise::text FROM pg_rent_invoice_lines l WHERE l.invoice_id = i.id AND l.kind = 'late_fee') AS fee_line,
         a.occupant_name, a.occupant_phone_e164, a.tenant_user_id::text, i.room_number, i.bed_label,
         p.display_name AS property_name, op.full_name AS operator_name, op.phone_e164 AS operator_phone, s.whatsapp_phone_e164, s.upi_vpa,
         s.cycle_mode::text, s.reminder_offsets_days, s.late_fee_grace_days, COALESCE(op.preferred_language,'en') AS locale,
         s.msg_reminder, s.msg_overdue, s.msg_tenant_paid, s.msg_receipt_share,
         r.id::text AS receipt_id, r.share_token AS receipt_share_token, r.amount_paise::text AS receipt_amount_paise
    FROM pg_rent_invoices i
    JOIN pg_bed_assignments a ON a.id = i.assignment_id
    JOIN pg_properties p ON p.id = i.pg_property_id
    JOIN users op ON op.id = p.operator_id
    JOIN pg_rent_settings s ON s.pg_property_id = i.pg_property_id
    LEFT JOIN LATERAL (
      SELECT r.id, r.share_token, r.amount_paise FROM pg_rent_receipts r JOIN pg_rent_payment_allocations al ON al.payment_id = r.payment_id
       WHERE al.invoice_id = i.id AND r.voided_at IS NULL AND r.pdf_status = 'ready'
         AND r.share_token IS NOT NULL AND r.share_token_expires_at > now()
       ORDER BY r.created_at DESC LIMIT 1
    ) r ON true
   WHERE i.id = $1::uuid`;

@Injectable()
export class RentMessageService {
  constructor(
    @Inject(DatabaseService) private readonly db: DatabaseService,
    @Inject(RentPayInstructionService) private readonly pay: RentPayInstructionService
  ) {}

  /** Spec §7.4 merge fields for one invoice. Shared with the tenant service. */
  async fieldsForInvoice(
    q: Queryable,
    invoiceId: string,
    opts: { utr?: string; today?: string } = {}
  ) {
    const r = await q.query<FieldsRow>(FIELDS_SQL, [invoiceId]);
    const x = r.rows[0];
    if (!x) throw new NotFoundException({ code: "invoice_not_found" });
    const today = opts.today ?? todayIst();
    const locale: "en" | "hi" = x.locale === "hi" ? "hi" : "en";
    const balance = paiseToInr(Number(x.total_paise) - Number(x.amount_paid_paise));
    const state = reminderState({
      dueDate: x.due_date,
      today,
      offsets: x.reminder_offsets_days,
      graceDays: x.late_fee_grace_days
    });
    const period =
      x.period_start && x.period_end
        ? periodLabel(
            { start: x.period_start, end: x.period_end },
            { cycleMode: x.cycle_mode, anchorDay: 1 }
          )
        : x.kind === "deposit"
          ? "Security deposit"
          : x.invoice_number;
    const openStatus = x.status !== "paid" && x.status !== "cancelled";
    // A token lives 45 days; without this check the most-overdue tenants (the ones
    // most likely to still be reminded) get links that silently 404 on the pay page.
    const payLinkExpired = Boolean(x.pay_token) && !x.pay_token_live && openStatus;
    const payLink =
      x.pay_token && x.pay_token_live && openStatus ? this.pay.payLinkFor(locale, x.pay_token) : "";
    const fields: PgRentMergeFields = {
      tenant_name: x.occupant_name,
      owner_name: x.operator_name ?? "",
      property_name: x.property_name,
      room: x.room_number,
      bed: x.bed_label,
      period,
      amount: formatInrGrouped(paiseToInr(x.total_paise)),
      balance: formatInrGrouped(balance),
      due_date: x.due_date,
      due_phrase: duePhrase({ dueDate: x.due_date, today }, locale),
      days_overdue: String(state.daysOverdue),
      late_fee: formatInrGrouped(x.fee_line === null ? 0 : paiseToInr(x.fee_line)),
      invoice_no: x.invoice_number,
      pay_link: payLink,
      upi_id: x.upi_vpa ?? "(not set)",
      receipt_link: x.receipt_share_token
        ? `${(process.env.NEXT_PUBLIC_API_BASE_URL || `${SITE_URL()}/v1`).replace(/\/$/, "")}/public/pg-rent/receipts/${x.receipt_share_token}`
        : "",
      utr: opts.utr ?? ""
    };
    return {
      fields,
      locale,
      row: x,
      state,
      tenantPhone: x.occupant_phone_e164,
      ownerPhone: x.whatsapp_phone_e164 ?? x.operator_phone,
      verified: x.tenant_user_id !== null,
      payLink,
      payLinkExpired,
      templates: {
        reminder: x.msg_reminder,
        overdue: x.msg_overdue,
        tenant_paid: x.msg_tenant_paid,
        receipt_share: x.msg_receipt_share
      }
    };
  }

  private render(
    key: PgRentTemplateKey,
    template: string | null,
    locale: "en" | "hi",
    fields: PgRentMergeFields,
    recipient: string | null
  ): PgRentRenderedMessage {
    const merged = mergeTemplate(template ?? DEFAULT_TEMPLATES[locale][key], fields);
    return {
      key,
      text: merged.text,
      unknown_fields: merged.unknownFields,
      truncated: merged.truncated,
      wa_me_url: recipient ? buildWaMeLink(recipient, merged.text) : null,
      recipient_e164: recipient
    };
  }

  /** Spec §12 `GET /invoices/:id/messages`. Owner → tenant messages; receipt share only when a ready receipt exists. */
  async messagesForInvoice(
    operatorId: string,
    propertyId: string,
    invoiceId: string
  ): Promise<PgRentInvoiceMessages> {
    requireDb(this.db);
    await assertManagedOwnership(this.db, operatorId, propertyId);
    const f = await this.fieldsForInvoice(this.db, invoiceId);
    if (f.row.pg_property_id !== propertyId)
      throw new NotFoundException({ code: "invoice_not_found" });
    const reminder = this.render(
      "reminder",
      f.templates.reminder,
      f.locale,
      f.fields,
      f.tenantPhone
    );
    const overdue = this.render("overdue", f.templates.overdue, f.locale, f.fields, f.tenantPhone);
    // {amount} in the receipt message is what the receipt covers, not the invoice total.
    const receipt = f.row.receipt_share_token
      ? this.render(
          "receipt_share",
          f.templates.receipt_share,
          f.locale,
          { ...f.fields, amount: formatInrGrouped(paiseToInr(f.row.receipt_amount_paise ?? 0)) },
          f.tenantPhone
        )
      : null;
    const warnings: string[] = [];
    if (f.payLinkExpired) warnings.push("pay_link_expired");
    if (!f.row.upi_vpa)
      warnings.push(
        'No UPI ID is set — {upi_id} renders as "(not set)"; tenants see bank details or a manual note instead'
      );
    for (const m of [reminder, overdue, receipt])
      for (const u of m?.unknown_fields ?? [])
        warnings.push(`Unknown merge field {${u}} is sent literally`);
    if (!f.verified)
      warnings.push(
        "This tenant's number is not linked to a Cribliv account — double-check it before the first reminder"
      );
    return {
      invoice_id: invoiceId,
      pay_link: f.payLink,
      reminder,
      overdue,
      receipt_share: receipt,
      warnings
    };
  }

  /** Live editor preview (spec §7.4). Text is validated to ≤ 600 chars; the invoice is optional (sample fields otherwise). */
  async preview(
    operatorId: string,
    propertyId: string,
    input: PgRentTemplatePreviewInput
  ): Promise<PgRentRenderedMessage> {
    requireDb(this.db);
    await assertManagedOwnership(this.db, operatorId, propertyId);
    if (input.text.length > MAX_TEMPLATE_CHARS)
      throw new BadRequestException({ code: "template_too_long" });
    if (input.invoice_id) {
      const f = await this.fieldsForInvoice(this.db, input.invoice_id);
      if (f.row.pg_property_id !== propertyId)
        throw new NotFoundException({ code: "invoice_not_found" });
      return this.render(
        input.key,
        input.text,
        f.locale,
        f.fields,
        input.key === "tenant_paid" ? f.ownerPhone : f.tenantPhone
      );
    }
    const sample: PgRentMergeFields = {
      tenant_name: "Rahul",
      owner_name: "Owner",
      property_name: "Your PG",
      room: "101",
      bed: "A",
      period: "September 2026",
      amount: "₹9,000",
      balance: "₹9,000",
      due_date: "2026-10-05",
      due_phrase: "due in 3 days",
      days_overdue: "0",
      late_fee: "₹0",
      invoice_no: "PG-INV-0001",
      pay_link: this.pay.payLinkFor("en", "sample"),
      upi_id: "owner@upi",
      receipt_link: "",
      utr: "123456789012"
    };
    return this.render(input.key, input.text, "en", sample, null);
  }

  /** Spec §7.3: every Remind tap is logged; never a broadcast. */
  async reminderOpened(
    operatorId: string,
    propertyId: string,
    invoiceId: string,
    input: { stage: PgRentReminderState; channel: "whatsapp" | "call" }
  ): Promise<void> {
    requireDb(this.db);
    await transaction(this.db, async (client) => {
      await assertManagedOwnership(client, operatorId, propertyId);
      const inv = await client.query(
        `SELECT 1 FROM pg_rent_invoices WHERE id = $1::uuid AND pg_property_id = $2::uuid`,
        [invoiceId, propertyId]
      );
      if (!inv.rowCount) throw new NotFoundException({ code: "invoice_not_found" });
      await writeRentEvent(client, {
        propertyId,
        entityType: "invoice",
        entityId: invoiceId,
        eventType: "reminder.opened",
        actor: { id: operatorId, role: "pg_operator" },
        payload: { stage: input.stage, channel: input.channel }
      });
    });
  }

  /** Spec §12 `POST /invoices/:id/pay-token`: a fresh 45-day token; the old link stops working. */
  async regeneratePayToken(
    operatorId: string,
    propertyId: string,
    invoiceId: string
  ): Promise<{ pay_link: string; expires_at: string }> {
    requireDb(this.db);
    return transaction(this.db, async (client) => {
      await assertManagedOwnership(client, operatorId, propertyId, true);
      const token = newPayToken();
      const r = await client.query<{ locale: string }>(
        `UPDATE pg_rent_invoices i SET pay_token = $3, pay_token_expires_at = $4 FROM pg_properties p JOIN users op ON op.id = p.operator_id
          WHERE i.id = $1::uuid AND i.pg_property_id = $2::uuid AND p.id = i.pg_property_id AND i.status IN ('issued','partially_paid')
          RETURNING COALESCE(op.preferred_language,'en') AS locale`,
        [invoiceId, propertyId, token.token, token.expiresAt]
      );
      if (!r.rows[0]) throw new NotFoundException({ code: "invoice_not_open" });
      await writeRentEvent(client, {
        propertyId,
        entityType: "invoice",
        entityId: invoiceId,
        eventType: "invoice.pay_token_regenerated",
        actor: { id: operatorId, role: "pg_operator" }
      });
      return {
        pay_link: this.pay.payLinkFor(r.rows[0].locale === "hi" ? "hi" : "en", token.token),
        expires_at: token.expiresAt.toISOString()
      };
    });
  }

  /** Spec §7.5: tenant → owner after an in-app claim. Scoped to the tenant's own payment. */
  async tenantPaidMessage(tenantUserId: string, paymentId: string): Promise<PgRentRenderedMessage> {
    requireDb(this.db);
    const mine = await resolveTenantAssignmentIds(this.db, tenantUserId);
    const p = await this.db.query<{
      claimed_invoice_id: string | null;
      assignment_id: string;
      reference: string | null;
      amount_paise: string;
    }>(
      `SELECT claimed_invoice_id::text, assignment_id::text, reference, amount_paise::text FROM pg_rent_payments WHERE id = $1::uuid AND assignment_id = ANY($2::uuid[])`,
      [paymentId, mine]
    );
    if (!p.rows[0]) throw new ForbiddenException({ code: "forbidden" });
    const invoiceId =
      p.rows[0].claimed_invoice_id ??
      (
        await this.db.query<{ id: string }>(
          `SELECT id::text FROM pg_rent_invoices WHERE assignment_id = $1::uuid AND status IN ('issued','partially_paid') ORDER BY due_date LIMIT 1`,
          [p.rows[0].assignment_id]
        )
      ).rows[0]?.id;
    if (!invoiceId) throw new NotFoundException({ code: "invoice_not_found" });
    const f = await this.fieldsForInvoice(this.db, invoiceId, { utr: p.rows[0].reference ?? "" });
    const fields = { ...f.fields, amount: formatInrGrouped(paiseToInr(p.rows[0].amount_paise)) };
    return this.render("tenant_paid", f.templates.tenant_paid, f.locale, fields, f.ownerPhone);
  }
}
