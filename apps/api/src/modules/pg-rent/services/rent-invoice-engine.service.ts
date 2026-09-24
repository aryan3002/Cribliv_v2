import { ConflictException, Inject, Injectable } from "@nestjs/common";
import type { PoolClient } from "pg";
import type {
  PgRentEnablePreview,
  PgRentGenerateResult,
  PgRentPreviewSkipReason,
  PgRentPreviewTenant,
  PgRentRentSource
} from "@cribliv/shared-types";

import { DatabaseService } from "../../../common/database.service";
import { compareIsoDates, todayIst } from "../../../common/date";
import { transaction } from "../../../common/transaction";
import { toIsoDate } from "../dto/common";
import { paiseToInr } from "../dto/money";
import type { RentSettingsRow } from "../dto/settings.dto";
import { addDays, dayOf, firstOfMonth } from "../pure/rent-dates";
import { roundToRupee } from "../pure/rent-money";
import {
  firstGeneratedPeriod,
  naturalDueDate,
  nextPeriod,
  periodLabel,
  type DueSpec,
  type Period,
  type PeriodSpec
} from "../pure/rent-period";
import { prorate } from "../pure/rent-proration";
import { billingWindow, cutToWindow, type BillingWindow } from "../pure/rent-window";
import { RentAllocationService } from "./rent-allocation.service";
import { writeRentEvent } from "./rent-events";
import { requireDb, SYSTEM_ACTOR, type Queryable, type RentActor } from "./rent-guards";
import { newPayToken, nextInvoiceNumber } from "./rent-numbering";
import { RentSettingsService } from "./rent-settings.service";

export type EngineSettings = Pick<
  RentSettingsRow,
  | "cycle_mode"
  | "billing_timing"
  | "due_day"
  | "proration_mode"
  | "prorate_move_out"
  | "invoice_lead_days"
  | "billing_starts_on"
  | "enabled_on"
  | "default_line_items"
  | "receipt_prefix"
>;

interface AssignmentCtx {
  id: string;
  status:
    | "active"
    | "notice_served"
    | "move_out_requested"
    | "move_out_pending_confirmation"
    | "moved_out";
  occupant_name: string;
  move_in_date: string | null;
  notice_end_date: string | null;
  move_out_date: string | null;
  rent_due_day: number | null;
  default_item_overrides: { exclude?: string[] };
  monthly_rent_paise: string | null;
  security_deposit_paise: string | null;
  bed_id: string;
  bed_label: string;
  room_id: string;
  room_number: string;
  room_type_rent: string | null;
  room_type_deposit: string | null;
  listing_rent: string | null;
  listing_deposit: string | null;
}

export interface RentPlan {
  kind: "rent";
  period: Period;
  cut: boolean;
  dueDate: string;
  amountPaise: number;
  factor: number | null;
  draft: boolean;
  rentSource: PgRentRentSource;
  rentPaise: number | null;
  spec: PeriodSpec;
}

export interface DepositPlan {
  kind: "deposit";
  dueDate: string;
  amountPaise: number;
}

const ASSIGNMENT_SQL = `
  SELECT a.id::text, a.status::text, a.occupant_name,
         to_char(a.move_in_date, 'YYYY-MM-DD') AS move_in_date,
         to_char(a.notice_end_date, 'YYYY-MM-DD') AS notice_end_date,
         to_char(a.move_out_date, 'YYYY-MM-DD') AS move_out_date,
         a.rent_due_day, a.default_item_overrides, a.monthly_rent_paise::text, a.security_deposit_paise::text,
         b.id::text AS bed_id, b.bed_label, r.id::text AS room_id, r.room_number,
         rt.monthly_rent_paise::text AS room_type_rent, rt.security_deposit_paise::text AS room_type_deposit,
         ld.starting_rent_paise::text AS listing_rent, ld.security_deposit_paise::text AS listing_deposit
    FROM pg_bed_assignments a
    JOIN pg_beds b ON b.id = a.bed_id
    JOIN pg_rooms r ON r.id = b.room_id
    LEFT JOIN pg_room_types rt ON rt.id = r.room_type_id
    -- Prefer the room type's own listing (matches pg-residence.service.ts's tenant-facing
    -- deposit resolution, which is always rt.listing_id): a property can carry several
    -- pg_listings rows, and an older one's pg_details deposit must not surface here when
    -- the occupied room type belongs to a different, newer listing. Falls back to the
    -- property's earliest listing only when the room has no room type at all.
    LEFT JOIN LATERAL (
      SELECT pl.starting_rent_paise, d.security_deposit_paise
        FROM pg_listings pl
        LEFT JOIN pg_details d ON d.listing_id = pl.id
       WHERE pl.pg_property_id = a.pg_property_id
       ORDER BY (pl.id = rt.listing_id) DESC NULLS LAST, pl.created_at ASC
       LIMIT 1
    ) ld ON true
   WHERE a.pg_property_id = $1::uuid
     AND a.status NOT IN ('reserved', 'cancelled')`;

/** Per run, per assignment: catch-up bound so one stuck property cannot monopolise a sweep. */
const MAX_INVOICES_PER_ASSIGNMENT_PER_RUN = 24;

@Injectable()
export class RentInvoiceEngineService {
  constructor(
    @Inject(DatabaseService) private readonly db: DatabaseService,
    @Inject(RentSettingsService) private readonly settings: RentSettingsService,
    @Inject(RentAllocationService) private readonly allocation: RentAllocationService
  ) {}

  // ── public ────────────────────────────────────────────────────────────────

  /** Spec §5.1. Idempotent; every invoice is its own transaction. */
  async generateInvoicesForProperty(
    propertyId: string,
    today: string,
    actor: RentActor = SYSTEM_ACTOR,
    opts: { assignmentId?: string; force?: boolean } = {}
  ): Promise<PgRentGenerateResult> {
    requireDb(this.db);
    const result: PgRentGenerateResult = {
      invoices_created: 0,
      drafts_created: 0,
      deposits_created: 0,
      skipped: []
    };
    const settings = await this.settings.getRow(this.db, propertyId);
    if (!settings || (settings.paused_at && !opts.force)) return result;

    const assignments = await this.loadAssignments(this.db, propertyId, opts.assignmentId);
    for (const a of assignments) {
      if (a.move_in_date === null) {
        result.skipped.push({ assignment_id: a.id, reason: "no_move_in" });
        continue;
      }
      // deposit first: booking credit lands on it before the first rent period (§6.12)
      const deposit = await transaction(this.db, (client) =>
        this.issueDepositIfDue(client, propertyId, a.id, settings, today, actor)
      );
      if (deposit) result.deposits_created += 1;

      for (let i = 0; i < MAX_INVOICES_PER_ASSIGNMENT_PER_RUN; i += 1) {
        const outcome = await transaction(this.db, (client) =>
          this.issueNextRentIfDue(client, propertyId, a.id, settings, today, actor)
        );
        if (outcome === "none") break;
        if (outcome === "no_rent") {
          result.skipped.push({ assignment_id: a.id, reason: "no_rent" });
          break;
        }
        if (outcome === "draft") result.drafts_created += 1;
        else result.invoices_created += 1;
      }
    }
    return result;
  }

  /** Spec §5.3 "Enable / resume preview": what the next run would issue, without writing. */
  async previewForProperty(
    propertyId: string,
    settings: EngineSettings,
    today: string
  ): Promise<PgRentEnablePreview> {
    requireDb(this.db);
    const assignments = await this.loadAssignments(this.db, propertyId);
    const tenants: PgRentPreviewTenant[] = [];
    const counts = { invoices: 0, drafts: 0, deposits: 0, no_rent: 0, no_move_in: 0 };
    for (const a of assignments) {
      const base = {
        assignment_id: a.id,
        occupant_name: a.occupant_name,
        room_number: a.room_number,
        bed_label: a.bed_label
      };
      const depositPlan = await this.planDeposit(this.db, a, settings, today);
      const depositPaise = this.resolveDeposit(a);
      if (a.move_in_date === null) {
        counts.no_move_in += 1;
        tenants.push({
          ...base,
          first_period: null,
          skip_reason: "no_move_in",
          deposit_inr: depositPaise === null ? null : paiseToInr(depositPaise),
          deposit_will_invoice: false
        });
        continue;
      }
      const plan = await this.planNextRent(this.db, a, settings, today, { ignoreLeadTime: true });
      let skip: PgRentPreviewSkipReason | null = null;
      if (plan === "no_rent") {
        skip = "no_rent";
        counts.no_rent += 1;
      } else if (plan === null) skip = "nothing_in_window";
      else if (plan.draft) counts.drafts += 1;
      else counts.invoices += 1;
      if (depositPlan) counts.deposits += 1;
      tenants.push({
        ...base,
        first_period:
          plan === null || plan === "no_rent"
            ? null
            : {
                period_start: plan.period.start,
                period_end: plan.period.end,
                due_date: plan.dueDate,
                amount_inr: paiseToInr(plan.amountPaise),
                prorated: plan.factor !== null,
                draft: plan.draft
              },
        skip_reason: skip,
        deposit_inr: depositPaise === null ? null : paiseToInr(depositPaise),
        deposit_will_invoice: depositPlan !== null
      });
    }
    return { billing_starts_on: toIsoDate(settings.billing_starts_on) as string, tenants, counts };
  }

  /**
   * Spec §5.8. Called after pg-operations commits an assignment transition.
   * Data-driven: no settings row → nothing. Best-effort: never throws to the caller.
   * Runs generation for that assignment so cut/final periods exist, then — when
   * prorate_move_out is on — writes or clears a final-period re-proration suggestion.
   */
  async onAssignmentEvent(event: {
    type: string;
    propertyId: string;
    assignmentId: string;
  }): Promise<void> {
    if (!this.db.isEnabled()) return;
    try {
      const settings = await this.settings.getRow(this.db, event.propertyId);
      if (!settings) return;
      await this.generateInvoicesForProperty(event.propertyId, todayIst(), SYSTEM_ACTOR, {
        assignmentId: event.assignmentId
      });
      if (!settings.prorate_move_out) return;
      const leaving = [
        "notice_served",
        "operator_move_out_requested",
        "tenant_move_out_requested",
        "move_out_confirmed",
        "operator_direct_move_out"
      ].includes(event.type);
      const staying = ["move_out_cancelled", "notice_cancelled"].includes(event.type);
      if (leaving) {
        await transaction(this.db, (client) =>
          this.suggestReprorate(client, event.propertyId, event.assignmentId, settings)
        );
      } else if (staying) {
        await transaction(this.db, (client) =>
          this.suggestRestore(client, event.propertyId, event.assignmentId)
        );
      }
    } catch (error) {
      console.error(
        JSON.stringify({
          job: "pg_rent_assignment_hook",
          type: event.type,
          assignment_id: event.assignmentId,
          error: error instanceof Error ? error.message : String(error)
        })
      );
    }
  }

  /** Spec §5.8: a suggestion on every issued/paid rent invoice whose period straddles the leave date. Never edits a bill. */
  private async suggestReprorate(
    client: PoolClient,
    propertyId: string,
    assignmentId: string,
    settings: RentSettingsRow
  ): Promise<void> {
    // Fix 4 (final fix wave, completed): this transaction's writeRentEvent
    // call below takes an implicit FK `FOR KEY SHARE` on pg_properties
    // (pg_rent_events.pg_property_id references it) after this method's own
    // `pg_rent_invoices FOR UPDATE` — the same reverse-order shape
    // issueNextRentIfDue/issueDepositIfDue guard against. Share (not
    // update) so concurrent engine transactions across different
    // assignments don't serialise on the property themselves.
    await client.query(`SELECT 1 FROM pg_properties WHERE id = $1::uuid FOR KEY SHARE`, [
      propertyId
    ]);
    const rows = await this.loadAssignments(client, propertyId, assignmentId);
    const a = rows[0];
    if (!a || !a.move_in_date) return;
    const window = billingWindow(a);
    if (!window?.end) return;
    const leaveOn = window.end;
    if (compareIsoDates(leaveOn, a.move_in_date) < 0) return; // "check the notice date" — refused as a suggestion
    const { spec } = this.specFor(a, settings);
    const invoices = await client.query<{
      id: string;
      period_start: string;
      period_end: string;
      rent_line: string;
      rent_snapshot_paise: string | null;
    }>(
      `SELECT i.id::text, to_char(i.period_start,'YYYY-MM-DD') AS period_start, to_char(i.period_end,'YYYY-MM-DD') AS period_end, i.rent_snapshot_paise::text,
              (SELECT l.amount_paise::text FROM pg_rent_invoice_lines l WHERE l.invoice_id = i.id AND l.kind = 'rent') AS rent_line
         FROM pg_rent_invoices i
        WHERE i.assignment_id = $1::uuid AND i.kind = 'rent' AND i.status IN ('issued','partially_paid','paid')
          AND i.period_start <= $2::date AND i.period_end > $2::date AND i.reprorate_suggestion IS NULL FOR UPDATE`,
      [assignmentId, leaveOn]
    );
    for (const inv of invoices.rows) {
      if (compareIsoDates(leaveOn, inv.period_start) < 0) continue;
      const rent =
        inv.rent_snapshot_paise === null ? Number(inv.rent_line) : Number(inv.rent_snapshot_paise);
      const { amountPaise } = prorate(
        rent,
        { start: inv.period_start, end: leaveOn },
        spec,
        settings.proration_mode
      );
      const suggestion = {
        leave_on: leaveOn,
        from_paise: Number(inv.rent_line),
        to_paise: amountPaise,
        mode: "reprorate" as const
      };
      await client.query(
        `UPDATE pg_rent_invoices SET reprorate_suggestion = $2::jsonb WHERE id = $1::uuid`,
        [inv.id, JSON.stringify(suggestion)]
      );
      await writeRentEvent(client, {
        propertyId,
        entityType: "invoice",
        entityId: inv.id,
        eventType: "invoice.final_reprorate_suggested",
        actor: SYSTEM_ACTOR,
        payload: suggestion
      });
    }
  }

  /** Spec §5.8: an unactioned suggestion disappears; an applied re-proration gets a Restore prompt. */
  private async suggestRestore(
    client: PoolClient,
    propertyId: string,
    assignmentId: string
  ): Promise<void> {
    // Fix 4 (final fix wave, completed): same lock, same reason as
    // suggestReprorate above — this transaction's writeRentEvent call below
    // takes an implicit FK `FOR KEY SHARE` on pg_properties after this
    // method's own `pg_rent_invoices FOR UPDATE OF i`, reversing the
    // documented order without this lock taken first.
    await client.query(`SELECT 1 FROM pg_properties WHERE id = $1::uuid FOR KEY SHARE`, [
      propertyId
    ]);
    await client.query(
      `UPDATE pg_rent_invoices SET reprorate_suggestion = NULL WHERE assignment_id = $1::uuid AND reprorate_suggestion->>'mode' = 'reprorate'`,
      [assignmentId]
    );
    const applied = await client.query<{
      id: string;
      amount_paise: string;
      meta: { reprorated: { original_paise: number; original_end: string; leave_on: string } };
    }>(
      `SELECT i.id::text, l.amount_paise::text, l.meta FROM pg_rent_invoices i JOIN pg_rent_invoice_lines l ON l.invoice_id = i.id AND l.kind = 'rent'
        WHERE i.assignment_id = $1::uuid AND i.status <> 'cancelled' AND l.meta ? 'reprorated' AND i.reprorate_suggestion IS NULL FOR UPDATE OF i`,
      [assignmentId]
    );
    for (const inv of applied.rows) {
      const r = inv.meta.reprorated;
      const suggestion = {
        leave_on: r.original_end,
        from_paise: Number(inv.amount_paise),
        to_paise: r.original_paise,
        mode: "restore" as const
      };
      await client.query(
        `UPDATE pg_rent_invoices SET reprorate_suggestion = $2::jsonb WHERE id = $1::uuid`,
        [inv.id, JSON.stringify(suggestion)]
      );
      await writeRentEvent(client, {
        propertyId,
        entityType: "invoice",
        entityId: inv.id,
        eventType: "invoice.restore_suggested",
        actor: SYSTEM_ACTOR,
        payload: suggestion
      });
    }
  }

  // ── planning (no writes) ──────────────────────────────────────────────────

  private specFor(a: AssignmentCtx, settings: EngineSettings): { spec: PeriodSpec; due: DueSpec } {
    const anchorDay = a.rent_due_day ?? (a.move_in_date ? dayOf(a.move_in_date) : 1);
    return {
      spec: { cycleMode: settings.cycle_mode, anchorDay },
      due: { timing: settings.billing_timing, dueDay: a.rent_due_day ?? settings.due_day }
    };
  }

  private resolveRent(a: AssignmentCtx): { paise: number | null; source: PgRentRentSource } {
    if (a.monthly_rent_paise !== null)
      return { paise: roundToRupee(Number(a.monthly_rent_paise)), source: "assignment" };
    if (a.room_type_rent !== null)
      return { paise: roundToRupee(Number(a.room_type_rent)), source: "room_type" };
    if (a.listing_rent !== null)
      return { paise: roundToRupee(Number(a.listing_rent)), source: "listing" };
    return { paise: null, source: "none" };
  }

  /**
   * Spec §2 deposit chain: assignment → room type (0065) → listing details.
   *
   * NULL means "unset, ask the next link". A non-NULL value is a decision and
   * ends the walk, so an explicit 0 means this tenant pays no deposit and must
   * not inherit the room-type default (spec decision 2026-09-23) — the previous
   * fall-through silently billed a deposit the operator had waived.
   *
   * Rounded before the >0 test, so a sub-50-paise source resolves to no deposit
   * rather than persisting a zero-value line.
   */
  private resolveDeposit(a: AssignmentCtx): number | null {
    for (const v of [a.security_deposit_paise, a.room_type_deposit, a.listing_deposit]) {
      if (v === null) continue;
      const rounded = roundToRupee(Number(v));
      return rounded > 0 ? rounded : null;
    }
    return null;
  }

  private async lastRentPeriodEnd(q: Queryable, assignmentId: string): Promise<string | null> {
    const r = await q.query<{ last_end: string | null }>(
      `SELECT to_char(MAX(period_end), 'YYYY-MM-DD') AS last_end
         FROM pg_rent_invoices WHERE assignment_id = $1::uuid AND kind = 'rent' AND status <> 'cancelled'`,
      [assignmentId]
    );
    return r.rows[0]?.last_end ?? null;
  }

  /** null = nothing to create (window ended / not yet time); "no_rent" = surfaced to the owner. */
  private async planNextRent(
    q: Queryable,
    a: AssignmentCtx,
    settings: EngineSettings,
    today: string,
    opts: { ignoreLeadTime?: boolean } = {}
  ): Promise<RentPlan | "no_rent" | null> {
    const window = billingWindow(a);
    if (!window) return null;
    if (a.status === "moved_out" && window.end === null) return null; // moved out without a date: never bill
    const { spec, due } = this.specFor(a, settings);
    const lastEnd = await this.lastRentPeriodEnd(q, a.id);
    const candidate = lastEnd
      ? nextPeriod(lastEnd, spec)
      : firstGeneratedPeriod(
          a.move_in_date as string,
          toIsoDate(settings.billing_starts_on) as string,
          spec,
          due
        );
    if (!candidate) return null;
    const placed = cutToWindow(candidate, window);
    if (!placed) return null;
    const period = placed.cut && settings.prorate_move_out ? placed.period : candidate;
    const cut = placed.cut && settings.prorate_move_out;

    const natural = naturalDueDate(period, spec, due);
    const windowEnded = window.end !== null && compareIsoDates(window.end, today) <= 0;
    const dueDate =
      a.status === "moved_out" ? today : compareIsoDates(natural, today) < 0 ? today : natural;
    const createFrom = addDays(dueDate, -settings.invoice_lead_days);
    // The preview wants the first period even when it is not yet time to issue it.
    if (!opts.ignoreLeadTime && !windowEnded && compareIsoDates(today, createFrom) < 0) return null;

    const rent = this.resolveRent(a);
    if (rent.paise === null) return "no_rent";
    const { amountPaise, factor } = prorate(rent.paise, period, spec, settings.proration_mode);
    return {
      kind: "rent",
      period,
      cut,
      dueDate,
      amountPaise,
      factor,
      spec,
      draft: rent.source === "listing" || rent.source === "none",
      rentSource: rent.source,
      rentPaise: rent.paise
    };
  }

  private async planDeposit(
    q: Queryable,
    a: AssignmentCtx,
    settings: EngineSettings,
    today: string
  ): Promise<DepositPlan | null> {
    if (a.move_in_date === null) return null;
    if (compareIsoDates(a.move_in_date, toIsoDate(settings.enabled_on) as string) < 0) return null;
    const amount = this.resolveDeposit(a);
    if (amount === null) return null;
    const exists = await q.query(
      `SELECT 1 FROM pg_rent_invoices WHERE assignment_id = $1::uuid AND kind = 'deposit' AND status <> 'cancelled'`,
      [a.id]
    );
    if (exists.rowCount) return null;
    return {
      kind: "deposit",
      dueDate: compareIsoDates(a.move_in_date, today) < 0 ? today : a.move_in_date,
      amountPaise: amount
    };
  }

  // ── writing ───────────────────────────────────────────────────────────────

  private async loadAssignments(
    q: Queryable,
    propertyId: string,
    assignmentId?: string
  ): Promise<AssignmentCtx[]> {
    const r = await q.query<AssignmentCtx>(
      `${ASSIGNMENT_SQL}${assignmentId ? " AND a.id = $2::uuid" : ""} ORDER BY r.room_number, b.bed_label`,
      assignmentId ? [propertyId, assignmentId] : [propertyId]
    );
    return r.rows;
  }

  private async lockAssignment(
    client: PoolClient,
    propertyId: string,
    assignmentId: string
  ): Promise<AssignmentCtx | null> {
    await client.query(`SELECT id FROM pg_bed_assignments WHERE id = $1::uuid FOR UPDATE`, [
      assignmentId
    ]);
    const rows = await this.loadAssignments(client, propertyId, assignmentId);
    return rows[0] ?? null;
  }

  private async issueNextRentIfDue(
    client: PoolClient,
    propertyId: string,
    assignmentId: string,
    settings: EngineSettings,
    today: string,
    actor: RentActor
  ): Promise<"issued" | "draft" | "no_rent" | "none"> {
    // Fix 4 (final fix wave): restore the documented lock order
    // (rent-payment.service.ts's header: pg_properties → pg_rent_counters →
    // pg_rent_invoices → pg_rent_payments). Every operator-facing
    // transaction takes `assertManagedOwnership(..., true)` — a `FOR UPDATE`
    // on pg_properties — as its FIRST statement before ever touching an
    // invoice. This method's INSERT into pg_rent_invoices takes an implicit
    // FK `FOR KEY SHARE` on its parent pg_properties row; without taking
    // that lock first ourselves, this transaction's effective order is
    // pg_bed_assignments → pg_rent_counters → pg_rent_invoices → properties,
    // the exact reverse of every operator path, and deadlocks against it
    // (40P01) under concurrent load. Share (not update) so concurrent engine
    // transactions across different assignments don't serialise on the
    // property themselves — mirrors pg-rent-sweeps.ts's runPgRentLateFeeSweep.
    await client.query(`SELECT 1 FROM pg_properties WHERE id = $1::uuid FOR KEY SHARE`, [
      propertyId
    ]);
    const a = await this.lockAssignment(client, propertyId, assignmentId);
    if (!a || a.move_in_date === null) return "none";
    const plan = await this.planNextRent(client, a, settings, today);
    if (plan === null) return "none";
    if (plan === "no_rent") return "no_rent";

    const overlap = await client.query(
      `SELECT 1 FROM pg_rent_invoices
        WHERE assignment_id = $1::uuid AND kind = 'rent' AND status <> 'cancelled'
          AND daterange(period_start, period_end, '[]') && daterange($2::date, $3::date, '[]')`,
      [assignmentId, plan.period.start, plan.period.end]
    );
    if (overlap.rowCount) throw new ConflictException({ code: "period_overlap" });

    const lines: Array<{
      kind: string;
      label: string;
      amount: number;
      source: string;
      meta: Record<string, unknown>;
    }> = [
      {
        kind: "rent",
        label: `Rent · ${periodLabel(plan.period, plan.spec)}`,
        amount: plan.amountPaise,
        source: "system",
        meta: plan.factor === null ? {} : { proration_factor: plan.factor }
      }
    ];
    const excludes = new Set(a.default_item_overrides?.exclude ?? []);
    for (const item of settings.default_line_items) {
      if (excludes.has(item.key)) continue;
      lines.push({
        kind: item.kind,
        label: item.label,
        amount: Number(item.amount_paise),
        source: "default_item",
        meta: { key: item.key }
      });
    }
    const total = lines.reduce((sum, l) => sum + l.amount, 0);
    const number = await nextInvoiceNumber(client, propertyId, settings.receipt_prefix);
    const token = plan.draft ? null : newPayToken();

    const inserted = await client.query<{ id: string }>(
      `INSERT INTO pg_rent_invoices
         (pg_property_id, assignment_id, bed_id, room_id, room_number, bed_label, kind, invoice_number,
          period_start, period_end, billing_month, due_date, status, source, total_paise,
          rent_snapshot_paise, rent_source, proration_factor, pay_token, pay_token_expires_at, issued_at, created_by)
       VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5, $6, 'rent', $7,
               $8::date, $9::date, $10::date, $11::date, $12::pg_rent_invoice_status, 'auto', $13,
               $14, $15::pg_rent_rent_source, $16, $17, $18, CASE WHEN $12 = 'issued' THEN now() ELSE NULL END, $19::uuid)
       RETURNING id::text`,
      [
        propertyId,
        assignmentId,
        a.bed_id,
        a.room_id,
        a.room_number,
        a.bed_label,
        number,
        plan.period.start,
        plan.period.end,
        firstOfMonth(plan.period.start),
        plan.dueDate,
        plan.draft ? "draft" : "issued",
        total,
        plan.rentPaise,
        plan.rentSource,
        plan.factor,
        token?.token ?? null,
        token?.expiresAt ?? null,
        actor.id
      ]
    );
    const invoiceId = inserted.rows[0].id;
    for (const [index, line] of lines.entries()) {
      await client.query(
        `INSERT INTO pg_rent_invoice_lines (invoice_id, kind, label, amount_paise, meta, source, sort_order, created_by)
         VALUES ($1::uuid, $2::pg_rent_line_kind, $3, $4, $5::jsonb, $6::pg_rent_line_source, $7, $8::uuid)`,
        [
          invoiceId,
          line.kind,
          line.label,
          line.amount,
          JSON.stringify(line.meta),
          line.source,
          index,
          actor.id
        ]
      );
    }
    await writeRentEvent(client, {
      propertyId,
      entityType: "invoice",
      entityId: invoiceId,
      eventType: plan.draft ? "invoice.draft_created" : "invoice.issued",
      actor,
      payload: {
        kind: "rent",
        period_start: plan.period.start,
        period_end: plan.period.end,
        cut: plan.cut,
        due_date: plan.dueDate,
        total_paise: total,
        rent_source: plan.rentSource
      }
    });
    if (!plan.draft) await this.allocation.applyUnallocatedCredit(client, invoiceId, actor);
    return plan.draft ? "draft" : "issued";
  }

  private async issueDepositIfDue(
    client: PoolClient,
    propertyId: string,
    assignmentId: string,
    settings: EngineSettings,
    today: string,
    actor: RentActor
  ): Promise<boolean> {
    // Fix 4 (final fix wave): same lock, same reason — see
    // issueNextRentIfDue's comment above. This method has the identical
    // shape (lockAssignment → nextInvoiceNumber → INSERT pg_rent_invoices)
    // and is the other per-invoice transaction generateInvoicesForProperty
    // drives, so it deadlocks against operator traffic the same way without
    // this lock.
    await client.query(`SELECT 1 FROM pg_properties WHERE id = $1::uuid FOR KEY SHARE`, [
      propertyId
    ]);
    const a = await this.lockAssignment(client, propertyId, assignmentId);
    if (!a) return false;
    const plan = await this.planDeposit(client, a, settings, today);
    if (!plan) return false;
    const number = await nextInvoiceNumber(client, propertyId, settings.receipt_prefix);
    const token = newPayToken();
    const inserted = await client.query<{ id: string }>(
      `INSERT INTO pg_rent_invoices
         (pg_property_id, assignment_id, bed_id, room_id, room_number, bed_label, kind, invoice_number,
          billing_month, due_date, status, source, total_paise, late_fee_eligible, pay_token, pay_token_expires_at, issued_at, created_by)
       VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5, $6, 'deposit', $7,
               $8::date, $9::date, 'issued', 'auto', $10, false, $11, $12, now(), $13::uuid)
       RETURNING id::text`,
      [
        propertyId,
        assignmentId,
        a.bed_id,
        a.room_id,
        a.room_number,
        a.bed_label,
        number,
        firstOfMonth(plan.dueDate),
        plan.dueDate,
        plan.amountPaise,
        token.token,
        token.expiresAt,
        actor.id
      ]
    );
    const invoiceId = inserted.rows[0].id;
    await client.query(
      `INSERT INTO pg_rent_invoice_lines (invoice_id, kind, label, amount_paise, source, sort_order, created_by)
       VALUES ($1::uuid, 'deposit', 'Security deposit', $2, 'system', 0, $3::uuid)`,
      [invoiceId, plan.amountPaise, actor.id]
    );
    await writeRentEvent(client, {
      propertyId,
      entityType: "invoice",
      entityId: invoiceId,
      eventType: "invoice.issued",
      actor,
      payload: { kind: "deposit", due_date: plan.dueDate, total_paise: plan.amountPaise }
    });
    await this.allocation.applyUnallocatedCredit(client, invoiceId, actor);
    return true;
  }
}
