import { Inject, Injectable } from "@nestjs/common";
import type {
  PgRentAttentionRow,
  PgRentFormerTenantRow,
  PgRentLeavingRow,
  PgRentMonthSummary,
  PgRentPortfolioRow,
  PgRentQueue,
  PgRentQueueClaimRow,
  PgRentQueueInvoiceRow
} from "@cribliv/shared-types";

import { DatabaseService } from "../../../common/database.service";
import { todayIst } from "../../../common/date";
import { paiseToInr } from "../dto/money";
import { toIsoTs } from "../dto/common";
import { daysInclusive, firstOfMonth } from "../pure/rent-dates";
import { periodLabel } from "../pure/rent-period";
import { reminderState } from "../pure/rent-reminder-state";
import { assertManagedOwnership, requireDb, type Queryable } from "./rent-guards";
import { RentSettlementService } from "./rent-settlement.service";

@Injectable()
export class RentQueueService {
  constructor(
    @Inject(DatabaseService) private readonly db: DatabaseService,
    @Inject(RentSettlementService) private readonly settlement: RentSettlementService
  ) {}

  async queue(operatorId: string, propertyId: string, today = todayIst()): Promise<PgRentQueue> {
    requireDb(this.db);
    await assertManagedOwnership(this.db, operatorId, propertyId);
    const [awaiting, attention, leaving, invoices, former] = await Promise.all([
      this.claims(this.db, propertyId, today),
      this.attention(this.db, propertyId, today),
      this.leaving(operatorId, propertyId, today),
      this.openInvoices(this.db, propertyId, today),
      this.formerTenants(this.db, propertyId)
    ]);
    return {
      as_of: today,
      awaiting_confirmation: awaiting,
      needs_attention: attention,
      leaving,
      overdue: invoices.filter((r) => r.state === "overdue").sort((a, b) => b.urgency - a.urgency),
      due_today: invoices.filter((r) => r.state === "due_today"),
      due_soon: invoices.filter((r) => r.state === "due_soon"),
      former_tenants: former
    };
  }

  private async claims(
    q: Queryable,
    propertyId: string,
    today: string
  ): Promise<PgRentQueueClaimRow[]> {
    const r = await q.query<{
      payment_id: string;
      assignment_id: string;
      occupant_name: string;
      room_number: string;
      bed_label: string;
      amount_paise: string;
      method: PgRentQueueClaimRow["method"];
      paid_on: string;
      reference: string | null;
      proof_count: number;
      claimed_invoice_id: string | null;
      claimed_invoice_number: string | null;
      created_at: Date;
    }>(
      `SELECT p.id::text AS payment_id, p.assignment_id::text, a.occupant_name, r.room_number, b.bed_label, p.amount_paise::text, p.method::text,
              to_char(p.paid_on,'YYYY-MM-DD') AS paid_on, p.reference, jsonb_array_length(p.proof_paths) AS proof_count,
              p.claimed_invoice_id::text, i.invoice_number AS claimed_invoice_number, p.created_at
         FROM pg_rent_payments p
         JOIN pg_bed_assignments a ON a.id = p.assignment_id JOIN pg_beds b ON b.id = a.bed_id JOIN pg_rooms r ON r.id = b.room_id
         LEFT JOIN pg_rent_invoices i ON i.id = p.claimed_invoice_id
        WHERE p.pg_property_id = $1::uuid AND p.status = 'pending_confirmation' ORDER BY p.created_at`,
      [propertyId]
    );
    return r.rows.map((x) => ({
      payment_id: x.payment_id,
      assignment_id: x.assignment_id,
      occupant_name: x.occupant_name,
      room_number: x.room_number,
      bed_label: x.bed_label,
      amount_inr: paiseToInr(x.amount_paise),
      method: x.method,
      paid_on: x.paid_on,
      reference: x.reference,
      proof_count: Number(x.proof_count),
      claimed_invoice_id: x.claimed_invoice_id,
      claimed_invoice_number: x.claimed_invoice_number,
      waiting_since: toIsoTs(x.created_at) as string,
      waiting_days: daysInclusive(todayIst(x.created_at), today) - 1
    }));
  }

  private async attention(
    q: Queryable,
    propertyId: string,
    today: string
  ): Promise<PgRentAttentionRow[]> {
    const r = await q.query<{
      kind: PgRentAttentionRow["kind"];
      assignment_id: string;
      occupant_name: string;
      room_number: string;
      bed_label: string;
      invoice_id: string | null;
      amount_paise: string | null;
      secondary_paise: string | null;
      date: string | null;
      days: number | null;
    }>(
      `WITH base AS (
         SELECT a.id, a.status::text, a.occupant_name, r.room_number, b.bed_label, a.move_in_date, a.notice_end_date
           FROM pg_bed_assignments a JOIN pg_beds b ON b.id = a.bed_id JOIN pg_rooms r ON r.id = b.room_id
          WHERE a.pg_property_id = $1::uuid
       )
       SELECT 'draft_invoice' AS kind, i.assignment_id::text, x.occupant_name, x.room_number, x.bed_label, i.id::text AS invoice_id,
              i.total_paise::text AS amount_paise, NULL AS secondary_paise, to_char(i.due_date,'YYYY-MM-DD') AS date, NULL::int AS days
         FROM pg_rent_invoices i JOIN base x ON x.id = i.assignment_id WHERE i.pg_property_id = $1::uuid AND i.status = 'draft'
       UNION ALL
       SELECT 'set_move_in_date', x.id::text, x.occupant_name, x.room_number, x.bed_label, NULL, NULL, NULL, NULL, NULL
         FROM base x WHERE x.status NOT IN ('reserved','cancelled','moved_out') AND x.move_in_date IS NULL
       UNION ALL
       SELECT 'notice_ended', x.id::text, x.occupant_name, x.room_number, x.bed_label, NULL, NULL, NULL, to_char(x.notice_end_date,'YYYY-MM-DD'), ($2::date - x.notice_end_date)::int
         FROM base x WHERE x.status IN ('notice_served','move_out_requested','move_out_pending_confirmation') AND x.notice_end_date < $2::date
       UNION ALL
       SELECT CASE WHEN i.reprorate_suggestion->>'mode' = 'restore' THEN 'restore_suggested' ELSE 'reprorate_suggested' END, i.assignment_id::text, x.occupant_name, x.room_number, x.bed_label, i.id::text,
              (i.reprorate_suggestion->>'from_paise'), (i.reprorate_suggestion->>'to_paise'), i.reprorate_suggestion->>'leave_on', NULL
         FROM pg_rent_invoices i JOIN base x ON x.id = i.assignment_id WHERE i.pg_property_id = $1::uuid AND i.reprorate_suggestion IS NOT NULL AND i.status <> 'cancelled'
       UNION ALL
       SELECT 'booking_held', x.id::text, x.occupant_name, x.room_number, x.bed_label, NULL, c.credit::text, NULL, NULL, NULL
         FROM base x JOIN LATERAL (
           SELECT SUM(p.amount_paise - COALESCE(al.s, 0)) AS credit FROM pg_rent_payments p
             LEFT JOIN (SELECT payment_id, SUM(amount_paise) AS s FROM pg_rent_payment_allocations GROUP BY payment_id) al ON al.payment_id = p.id
            WHERE p.assignment_id = x.id AND p.direction = 'inflow' AND p.status = 'confirmed'
         ) c ON true
        WHERE x.status IN ('reserved','cancelled') AND c.credit > 0
       UNION ALL
       SELECT 'identity_disputed', x.id::text, x.occupant_name, x.room_number, x.bed_label, NULL, NULL, NULL, NULL, NULL
         FROM base x WHERE (
           SELECT e.payload->>'flag' FROM pg_rent_events e WHERE e.entity_type = 'assignment' AND e.entity_id = x.id
              AND e.payload->>'flag' IN ('identity_disputed','identity_dispute_cleared') ORDER BY e.id DESC LIMIT 1
         ) = 'identity_disputed'`,
      [propertyId, today]
    );
    return r.rows.map((x) => ({
      kind: x.kind,
      assignment_id: x.assignment_id,
      occupant_name: x.occupant_name,
      room_number: x.room_number,
      bed_label: x.bed_label,
      invoice_id: x.invoice_id,
      amount_inr: x.amount_paise === null ? null : paiseToInr(x.amount_paise),
      secondary_inr: x.secondary_paise === null ? null : paiseToInr(x.secondary_paise),
      date: x.date,
      days: x.days === null ? null : Number(x.days)
    }));
  }

  private async leaving(
    operatorId: string,
    propertyId: string,
    today: string
  ): Promise<PgRentLeavingRow[]> {
    const r = await this.db.query<{
      id: string;
      occupant_name: string;
      room_number: string;
      bed_label: string;
      leave_on: string | null;
    }>(
      `SELECT a.id::text, a.occupant_name, r.room_number, b.bed_label, to_char(COALESCE(a.move_out_date, a.notice_end_date),'YYYY-MM-DD') AS leave_on
         FROM pg_bed_assignments a JOIN pg_beds b ON b.id = a.bed_id JOIN pg_rooms r ON r.id = b.room_id
        WHERE a.pg_property_id = $1::uuid AND (
          a.status IN ('notice_served','move_out_requested','move_out_pending_confirmation')
          OR (a.status = 'moved_out' AND a.move_out_date >= $2::date - 30)
        ) ORDER BY leave_on NULLS LAST`,
      [propertyId, today]
    );
    const out: PgRentLeavingRow[] = [];
    for (const x of r.rows) {
      const st = await this.settlement.statement(operatorId, propertyId, x.id);
      if (st.status === "nothing_to_settle") continue;
      if (st.status === "settled" && st.to_return_inr === 0) continue;
      out.push({
        assignment_id: x.id,
        occupant_name: x.occupant_name,
        room_number: x.room_number,
        bed_label: x.bed_label,
        status: st.status,
        leave_on: x.leave_on,
        deposit_held_inr: st.deposit_held_inr,
        to_return_inr: st.to_return_inr,
        open_dues_inr: st.open_dues_inr
      });
    }
    return out;
  }

  private async openInvoices(
    q: Queryable,
    propertyId: string,
    today: string
  ): Promise<PgRentQueueInvoiceRow[]> {
    const r = await q.query<{
      invoice_id: string;
      invoice_number: string;
      assignment_id: string;
      occupant_name: string;
      verified: boolean;
      room_number: string;
      bed_label: string;
      kind: PgRentQueueInvoiceRow["kind"];
      period_start: string | null;
      period_end: string | null;
      due_date: string;
      total_paise: string;
      amount_paid_paise: string;
      fee_line: string | null;
      suggested: string | null;
      last_reminded_at: Date | null;
      last_channel: string | null;
      offsets: number[];
      grace: number;
      cycle_mode: "calendar_month" | "anniversary";
    }>(
      `SELECT i.id::text AS invoice_id, i.invoice_number, i.assignment_id::text, a.occupant_name, (a.tenant_user_id IS NOT NULL) AS verified, i.room_number, i.bed_label, i.kind::text,
              to_char(i.period_start,'YYYY-MM-DD') AS period_start, to_char(i.period_end,'YYYY-MM-DD') AS period_end, to_char(i.due_date,'YYYY-MM-DD') AS due_date,
              i.total_paise::text, i.amount_paid_paise::text,
              (SELECT l.amount_paise::text FROM pg_rent_invoice_lines l WHERE l.invoice_id = i.id AND l.kind = 'late_fee') AS fee_line, i.suggested_late_fee_paise::text AS suggested,
              e.created_at AS last_reminded_at, e.payload->>'channel' AS last_channel, s.reminder_offsets_days AS offsets, s.late_fee_grace_days AS grace, s.cycle_mode::text
         FROM pg_rent_invoices i
         JOIN pg_bed_assignments a ON a.id = i.assignment_id
         JOIN pg_rent_settings s ON s.pg_property_id = i.pg_property_id
         LEFT JOIN LATERAL (SELECT created_at, payload FROM pg_rent_events WHERE entity_type = 'invoice' AND entity_id = i.id AND event_type = 'reminder.opened' ORDER BY id DESC LIMIT 1) e ON true
        WHERE i.pg_property_id = $1::uuid AND i.status IN ('issued','partially_paid') AND a.status <> 'moved_out'
          AND NOT EXISTS (SELECT 1 FROM pg_rent_payments p WHERE p.claimed_invoice_id = i.id AND p.status = 'pending_confirmation')
        ORDER BY i.due_date`,
      [propertyId]
    );
    return r.rows.map((x) => {
      const st = reminderState({
        dueDate: x.due_date,
        today,
        offsets: x.offsets,
        graceDays: x.grace
      });
      const balance = paiseToInr(Number(x.total_paise) - Number(x.amount_paid_paise));
      return {
        invoice_id: x.invoice_id,
        invoice_number: x.invoice_number,
        assignment_id: x.assignment_id,
        occupant_name: x.occupant_name,
        occupant_phone_verified: x.verified,
        room_number: x.room_number,
        bed_label: x.bed_label,
        kind: x.kind,
        period_label:
          x.period_start && x.period_end
            ? periodLabel(
                { start: x.period_start, end: x.period_end },
                { cycleMode: x.cycle_mode, anchorDay: 1 }
              )
            : x.kind === "deposit"
              ? "Security deposit"
              : x.invoice_number,
        due_date: x.due_date,
        balance_inr: balance,
        total_inr: paiseToInr(x.total_paise),
        state: st.state,
        in_grace: st.inGrace,
        days_overdue: st.daysOverdue,
        applied_fee_inr: x.fee_line === null ? null : paiseToInr(x.fee_line),
        suggested_fee_inr: x.suggested === null ? null : paiseToInr(x.suggested),
        last_reminded_at: toIsoTs(x.last_reminded_at),
        last_reminded_channel: (x.last_channel as "whatsapp" | "call" | null) ?? null,
        urgency: balance * Math.max(1, st.daysOverdue)
      };
    });
  }

  private async formerTenants(q: Queryable, propertyId: string): Promise<PgRentFormerTenantRow[]> {
    const r = await q.query<{
      id: string;
      occupant_name: string;
      room_number: string;
      bed_label: string;
      moved_out_on: string;
      balance: string;
      invoice_ids: string[];
    }>(
      `SELECT a.id::text, a.occupant_name, r.room_number, b.bed_label, to_char(a.move_out_date,'YYYY-MM-DD') AS moved_out_on,
              SUM(i.total_paise - i.amount_paid_paise)::text AS balance, array_agg(i.id::text ORDER BY i.due_date) AS invoice_ids
         FROM pg_bed_assignments a JOIN pg_beds b ON b.id = a.bed_id JOIN pg_rooms r ON r.id = b.room_id
         JOIN pg_rent_invoices i ON i.assignment_id = a.id AND i.status IN ('issued','partially_paid')
        WHERE a.pg_property_id = $1::uuid AND a.status = 'moved_out'
        GROUP BY a.id, a.occupant_name, r.room_number, b.bed_label, a.move_out_date HAVING SUM(i.total_paise - i.amount_paid_paise) > 0
        ORDER BY a.move_out_date DESC`,
      [propertyId]
    );
    return r.rows.map((x) => ({
      assignment_id: x.id,
      occupant_name: x.occupant_name,
      room_number: x.room_number,
      bed_label: x.bed_label,
      moved_out_on: x.moved_out_on,
      balance_inr: paiseToInr(x.balance),
      invoice_ids: x.invoice_ids
    }));
  }

  /** Spec §10.2 billing lens for one month: rent + adhoc invoices by billing_month, excluding draft/cancelled. */
  async monthSummary(
    operatorId: string,
    propertyId: string,
    month: string,
    today = todayIst()
  ): Promise<PgRentMonthSummary> {
    requireDb(this.db);
    await assertManagedOwnership(this.db, operatorId, propertyId);
    return this.summaryFor(this.db, propertyId, firstOfMonth(month), today);
  }

  private async summaryFor(
    q: Queryable,
    propertyId: string,
    month: string,
    today: string
  ): Promise<PgRentMonthSummary> {
    const r = await q.query<{
      expected: string;
      collected: string;
      overdue: string;
      overdue_tenants: string;
      awaiting: string;
      awaiting_count: string;
    }>(
      `SELECT COALESCE(SUM(i.total_paise),0)::text AS expected, COALESCE(SUM(i.amount_paid_paise),0)::text AS collected,
              COALESCE(SUM(CASE WHEN i.due_date < $3::date THEN i.total_paise - i.amount_paid_paise ELSE 0 END),0)::text AS overdue,
              COUNT(DISTINCT CASE WHEN i.due_date < $3::date AND i.total_paise > i.amount_paid_paise THEN i.assignment_id END)::text AS overdue_tenants,
              (SELECT COALESCE(SUM(p.amount_paise),0) FROM pg_rent_payments p WHERE p.pg_property_id = $1::uuid AND p.status = 'pending_confirmation')::text AS awaiting,
              (SELECT COUNT(*) FROM pg_rent_payments p WHERE p.pg_property_id = $1::uuid AND p.status = 'pending_confirmation')::text AS awaiting_count
         FROM pg_rent_invoices i
        WHERE i.pg_property_id = $1::uuid AND i.billing_month = $2::date AND i.kind IN ('rent','adhoc') AND i.status NOT IN ('draft','cancelled')`,
      [propertyId, month, today]
    );
    const x = r.rows[0];
    const expected = paiseToInr(x.expected);
    const collected = paiseToInr(x.collected);
    return {
      month,
      expected_inr: expected,
      collected_inr: collected,
      outstanding_inr: expected - collected,
      overdue_inr: paiseToInr(x.overdue),
      overdue_tenants: Number(x.overdue_tenants),
      awaiting_inr: paiseToInr(x.awaiting),
      awaiting_count: Number(x.awaiting_count),
      collection_rate: expected === 0 ? 0 : collected / expected
    };
  }

  /** Spec §12 `GET /pg-operator/rent/portfolio`: one row per managed property. */
  async portfolio(operatorId: string, today = todayIst()): Promise<PgRentPortfolioRow[]> {
    requireDb(this.db);
    const props = await this.db.query<{
      id: string;
      display_name: string;
      enabled: boolean;
      paused: boolean;
    }>(
      `SELECT p.id::text, p.display_name, (s.pg_property_id IS NOT NULL) AS enabled, (s.paused_at IS NOT NULL) AS paused
         FROM pg_properties p LEFT JOIN pg_rent_settings s ON s.pg_property_id = p.id
        WHERE p.operator_id = $1::uuid AND p.manage_enabled = true ORDER BY p.display_name`,
      [operatorId]
    );
    const out: PgRentPortfolioRow[] = [];
    for (const p of props.rows) {
      if (!p.enabled) {
        out.push({
          property_id: p.id,
          display_name: p.display_name,
          enabled: false,
          paused: false,
          summary: null,
          queue_counts: null
        });
        continue;
      }
      const [summary, q] = await Promise.all([
        this.summaryFor(this.db, p.id, firstOfMonth(today), today),
        this.queue(operatorId, p.id, today)
      ]);
      out.push({
        property_id: p.id,
        display_name: p.display_name,
        enabled: true,
        paused: p.paused,
        summary,
        queue_counts: {
          awaiting: q.awaiting_confirmation.length,
          attention: q.needs_attention.length,
          overdue: q.overdue.length,
          leaving: q.leaving.length
        }
      });
    }
    return out;
  }
}
