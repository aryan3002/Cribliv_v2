import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import * as QRCode from "qrcode";
import type {
  PgRentBankDetails,
  PgRentPayInstruction,
  PgRentPublicPayPage
} from "@cribliv/shared-types";

import { DatabaseService } from "../../../common/database.service";
import { paiseToInr } from "../dto/money";
import type { RentSettingsRow } from "../dto/settings.dto";
import { periodLabel } from "../pure/rent-period";
import { DEFAULT_TEMPLATES, formatInrGrouped, mergeTemplate } from "../pure/rent-template";
import { buildUpiUri, waDigits } from "../pure/rent-upi";
import { requireDb } from "./rent-guards";

/** Apex site origin (never www); the same fallback modules/openapi/openapi.document.ts:11 uses. */
export const SITE_URL = () =>
  (process.env.NEXT_PUBLIC_SITE_URL || "https://cribliv.com").replace(/\/$/, "");

@Injectable()
export class RentPayInstructionService {
  constructor(@Inject(DatabaseService) private readonly db: DatabaseService) {}

  payLinkFor(locale: "en" | "hi", token: string): string {
    return `${SITE_URL()}/${locale}/pay/${token}`;
  }

  /** Spec §6.1 PayInstruction. UPI first, bank second, manual when no payee (fresh enable / after transfer). */
  async buildPayInstruction(i: {
    settings: Pick<RentSettingsRow, "upi_vpa" | "upi_payee_name" | "bank_details">;
    amountInr: number | null;
    note: string;
    tr: string;
  }): Promise<PgRentPayInstruction> {
    const bank = (i.settings.bank_details as PgRentBankDetails | null) ?? null;
    if (i.settings.upi_vpa) {
      const upi_uri = buildUpiUri({
        vpa: i.settings.upi_vpa,
        payeeName: i.settings.upi_payee_name ?? "",
        amountInr: i.amountInr,
        note: i.note,
        tr: i.tr
      });
      const qr_svg = await QRCode.toString(upi_uri, {
        type: "svg",
        margin: 1,
        errorCorrectionLevel: "M"
      });
      return {
        mode: "upi_intent",
        upi_uri,
        qr_svg,
        payee_name: i.settings.upi_payee_name ?? "",
        vpa: i.settings.upi_vpa,
        bank
      };
    }
    if (bank) return { mode: "bank_details", bank };
    return { mode: "manual" };
  }

  /** Spec §7.7. Reads settings live; first name only; never the tenant phone. */
  async publicPayPage(token: string): Promise<PgRentPublicPayPage> {
    requireDb(this.db);
    const r = await this.db.query<{
      id: string;
      invoice_number: string;
      kind: string;
      status: string;
      period_start: string | null;
      period_end: string | null;
      due_date: string;
      total_paise: string;
      amount_paid_paise: string;
      expired: boolean;
      occupant_name: string;
      room_number: string;
      bed_label: string;
      property_name: string;
      upi_vpa: string | null;
      upi_payee_name: string | null;
      bank_details: PgRentBankDetails | null;
      whatsapp_phone_e164: string | null;
      operator_phone: string;
      operator_name: string | null;
      cycle_mode: "calendar_month" | "anniversary";
      msg_tenant_paid: string | null;
      locale: string;
    }>(
      `SELECT i.id::text, i.invoice_number, i.kind::text, i.status::text, to_char(i.period_start,'YYYY-MM-DD') AS period_start, to_char(i.period_end,'YYYY-MM-DD') AS period_end,
              to_char(i.due_date,'YYYY-MM-DD') AS due_date, i.total_paise::text, i.amount_paid_paise::text, (i.pay_token_expires_at <= now()) AS expired,
              a.occupant_name, i.room_number, i.bed_label, p.display_name AS property_name,
              s.upi_vpa, s.upi_payee_name, s.bank_details, s.whatsapp_phone_e164, op.phone_e164 AS operator_phone, op.full_name AS operator_name,
              s.cycle_mode::text, s.msg_tenant_paid, COALESCE(op.preferred_language, 'en') AS locale
         FROM pg_rent_invoices i
         JOIN pg_bed_assignments a ON a.id = i.assignment_id
         JOIN pg_properties p ON p.id = i.pg_property_id
         JOIN users op ON op.id = p.operator_id
         JOIN pg_rent_settings s ON s.pg_property_id = i.pg_property_id
        WHERE i.pay_token = $1 AND i.status <> 'draft'`,
      [token]
    );
    const x = r.rows[0];
    if (!x) throw new NotFoundException({ code: "pay_link_not_found" });
    const balance = paiseToInr(Number(x.total_paise) - Number(x.amount_paid_paise));
    const period =
      x.period_start && x.period_end
        ? periodLabel(
            { start: x.period_start, end: x.period_end },
            { cycleMode: x.cycle_mode, anchorDay: 1 }
          )
        : x.kind === "deposit"
          ? "Security deposit"
          : x.invoice_number;
    const state: PgRentPublicPayPage["state"] =
      x.status === "paid"
        ? "paid"
        : x.status === "cancelled" || x.expired // cancel() expires the token too
          ? "expired"
          : "payable";
    const firstName = x.occupant_name.trim().split(/\s+/)[0] ?? "";
    const ownerPhone = x.whatsapp_phone_e164 ?? x.operator_phone;
    const locale = x.locale === "hi" ? "hi" : "en";
    const notify = mergeTemplate(x.msg_tenant_paid ?? DEFAULT_TEMPLATES[locale].tenant_paid, {
      tenant_name: firstName,
      owner_name: x.operator_name ?? "",
      property_name: x.property_name,
      room: x.room_number,
      bed: x.bed_label,
      period,
      amount: formatInrGrouped(balance),
      balance: formatInrGrouped(balance),
      due_date: x.due_date,
      due_phrase: "",
      days_overdue: "",
      late_fee: "",
      invoice_no: x.invoice_number,
      pay_link: "",
      upi_id: x.upi_vpa ?? "",
      receipt_link: "",
      utr: ""
    }).text;
    return {
      state,
      property_name: x.property_name,
      tenant_first_name: firstName,
      period_label: period,
      room_number: x.room_number,
      bed_label: x.bed_label,
      invoice_number: x.invoice_number,
      balance_inr: balance,
      total_inr: paiseToInr(x.total_paise),
      due_date: x.due_date,
      instruction:
        state === "payable"
          ? await this.buildPayInstruction({
              settings: x,
              amountInr: balance,
              note: `${period} Room ${x.room_number}`,
              tr: x.invoice_number
            })
          : null,
      instruction_open_amount:
        state === "payable"
          ? await this.buildPayInstruction({
              settings: x,
              amountInr: null,
              note: `${period} Room ${x.room_number}`,
              tr: x.invoice_number
            })
          : null,
      owner_wa_digits: ownerPhone ? waDigits(ownerPhone) : null,
      notify_text: state === "payable" ? notify : null
    };
  }
}
