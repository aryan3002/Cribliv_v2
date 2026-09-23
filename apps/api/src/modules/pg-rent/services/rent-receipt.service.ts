import { randomBytes } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import type { PoolClient } from "pg";

import { DatabaseService } from "../../../common/database.service";
import { numberToIndianWords } from "../../rent-agreement/format/words.format";
import { paiseToInr } from "../dto/money";
import { periodLabel } from "../pure/rent-period";
import { writeRentEvent } from "./rent-events";
import type { RentActor } from "./rent-guards";

export interface ReceiptSnapshot {
  receipt_number: string;
  issued_on: string;
  property_name: string;
  business_name: string | null;
  address: string | null;
  footer: string | null;
  logo_path: string | null;
  tenant_name: string;
  room_number: string;
  bed_label: string;
  amount_inr: number;
  amount_words: string;
  method: string;
  reference: string | null;
  paid_on: string;
  covers: Array<{
    invoice_number: string;
    period_label: string;
    allocated_inr: number;
    remaining_inr: number;
  }>;
  credit_inr: number;
}

@Injectable()
export class RentReceiptService {
  constructor(@Inject(DatabaseService) private readonly db: DatabaseService) {}

  /** Spec §6.7. Called inside finalizeConfirmed's transaction for receipt-earning sources. */
  async mint(client: PoolClient, paymentId: string, actor: RentActor): Promise<string> {
    const p = await client.query<{
      pg_property_id: string;
      assignment_id: string;
      amount_paise: string;
      method: string;
      reference: string | null;
      paid_on: string;
      occupant_name: string;
      room_number: string;
      bed_label: string;
      property_name: string;
      receipt_prefix: string;
      receipt_business_name: string | null;
      receipt_address: string | null;
      receipt_footer: string | null;
      receipt_logo_path: string | null;
      cycle_mode: "calendar_month" | "anniversary";
    }>(
      `SELECT p.pg_property_id::text, p.assignment_id::text, p.amount_paise::text, p.method::text, p.reference, to_char(p.paid_on,'YYYY-MM-DD') AS paid_on,
              a.occupant_name, r.room_number, b.bed_label, pr.display_name AS property_name,
              s.receipt_prefix, s.receipt_business_name, s.receipt_address, s.receipt_footer, s.receipt_logo_path, s.cycle_mode::text
         FROM pg_rent_payments p
         JOIN pg_bed_assignments a ON a.id = p.assignment_id
         JOIN pg_beds b ON b.id = a.bed_id
         JOIN pg_rooms r ON r.id = b.room_id
         JOIN pg_properties pr ON pr.id = p.pg_property_id
         JOIN pg_rent_settings s ON s.pg_property_id = p.pg_property_id
        WHERE p.id = $1::uuid`,
      [paymentId]
    );
    const x = p.rows[0];
    const covers = await client.query<{
      invoice_number: string;
      period_start: string | null;
      period_end: string | null;
      kind: string;
      allocated: string;
      remaining: string;
    }>(
      `SELECT i.invoice_number, to_char(i.period_start,'YYYY-MM-DD') AS period_start, to_char(i.period_end,'YYYY-MM-DD') AS period_end, i.kind::text,
              al.amount_paise::text AS allocated, (i.total_paise - i.amount_paid_paise)::text AS remaining
         FROM pg_rent_payment_allocations al JOIN pg_rent_invoices i ON i.id = al.invoice_id
        WHERE al.payment_id = $1::uuid ORDER BY i.due_date`,
      [paymentId]
    );
    const allocated = covers.rows.reduce((s, c) => s + Number(c.allocated), 0);
    const seq = await client.query<{ seq: number }>(
      `UPDATE pg_rent_counters SET next_receipt_seq = next_receipt_seq + 1 WHERE pg_property_id = $1::uuid RETURNING next_receipt_seq - 1 AS seq`,
      [x.pg_property_id]
    );
    const number = `${x.receipt_prefix}-${String(seq.rows[0].seq).padStart(4, "0")}`;
    const amountInr = paiseToInr(x.amount_paise);
    const snapshot: ReceiptSnapshot = {
      receipt_number: number,
      issued_on: x.paid_on,
      property_name: x.property_name,
      business_name: x.receipt_business_name,
      address: x.receipt_address,
      footer: x.receipt_footer,
      logo_path: x.receipt_logo_path,
      tenant_name: x.occupant_name,
      room_number: x.room_number,
      bed_label: x.bed_label,
      amount_inr: amountInr,
      amount_words: numberToIndianWords(amountInr),
      method: x.method,
      reference: x.reference,
      paid_on: x.paid_on,
      covers: covers.rows.map((c) => ({
        invoice_number: c.invoice_number,
        period_label:
          c.period_start && c.period_end
            ? periodLabel(
                { start: c.period_start, end: c.period_end },
                { cycleMode: x.cycle_mode, anchorDay: 1 }
              )
            : c.kind === "deposit"
              ? "Security deposit"
              : c.kind,
        allocated_inr: paiseToInr(c.allocated),
        remaining_inr: paiseToInr(c.remaining)
      })),
      credit_inr: paiseToInr(Number(x.amount_paise) - allocated)
    };
    const inserted = await client.query<{ id: string }>(
      `INSERT INTO pg_rent_receipts (pg_property_id, payment_id, assignment_id, receipt_number, amount_paise, snapshot, share_token, share_token_expires_at)
       VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5, $6::jsonb, $7, now() + interval '30 days') RETURNING id::text`,
      [
        x.pg_property_id,
        paymentId,
        x.assignment_id,
        number,
        x.amount_paise,
        JSON.stringify(snapshot),
        randomBytes(32).toString("base64url")
      ]
    );
    await writeRentEvent(client, {
      propertyId: x.pg_property_id,
      entityType: "receipt",
      entityId: inserted.rows[0].id,
      eventType: "receipt.generated",
      actor,
      payload: { receipt_number: number, payment_id: paymentId }
    });
    return inserted.rows[0].id;
  }

  async void(
    client: PoolClient,
    receiptId: string,
    reason: string,
    actor: RentActor
  ): Promise<void> {
    const r = await client.query<{ pg_property_id: string }>(
      `UPDATE pg_rent_receipts SET voided_at = now(), void_reason = $2 WHERE id = $1::uuid AND voided_at IS NULL RETURNING pg_property_id::text`,
      [receiptId, reason]
    );
    if (!r.rows[0]) return;
    await writeRentEvent(client, {
      propertyId: r.rows[0].pg_property_id,
      entityType: "receipt",
      entityId: receiptId,
      eventType: "receipt.voided",
      actor,
      payload: { reason }
    });
  }

  /** Spec §6.7 manual re-allocation: void the live receipt, mint a new one, link them. */
  async remint(client: PoolClient, paymentId: string, actor: RentActor): Promise<string> {
    const live = await client.query<{ id: string }>(
      `SELECT id::text FROM pg_rent_receipts WHERE payment_id = $1::uuid AND voided_at IS NULL`,
      [paymentId]
    );
    if (live.rows[0]) await this.void(client, live.rows[0].id, "reallocated", actor);
    const next = await this.mint(client, paymentId, actor);
    if (live.rows[0]) {
      await client.query(
        `UPDATE pg_rent_receipts SET superseded_by = $2::uuid WHERE id = $1::uuid`,
        [live.rows[0].id, next]
      );
      const p = await client.query<{ pg_property_id: string }>(
        `SELECT pg_property_id::text FROM pg_rent_receipts WHERE id = $1::uuid`,
        [next]
      );
      await writeRentEvent(client, {
        propertyId: p.rows[0].pg_property_id,
        entityType: "receipt",
        entityId: next,
        eventType: "receipt.reminted",
        actor,
        payload: { supersedes: live.rows[0].id }
      });
    }
    return next;
  }
}
