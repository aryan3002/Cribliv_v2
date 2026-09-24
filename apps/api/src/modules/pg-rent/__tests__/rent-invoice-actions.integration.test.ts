import { randomUUID } from "node:crypto";
import type { PgRentBackfillInput, PgRentManualInvoiceInput } from "@cribliv/shared-types";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { DatabaseService } from "../../../common/database.service";
import { todayIst } from "../../../common/date";
import { InMemoryPdfStorage } from "../../rent-agreement/pdf/in-memory-pdf-storage";
import { DevApiSasIssuer } from "../../rent-agreement/downloads/dev-api-sas-issuer";
import { RentAllocationService } from "../services/rent-allocation.service";
import { RentInvoiceEngineService } from "../services/rent-invoice-engine.service";
import { RentInvoiceService } from "../services/rent-invoice.service";
import { RentPaymentService } from "../services/rent-payment.service";
import { RentReceiptService } from "../services/rent-receipt.service";
import { RentSettingsService } from "../services/rent-settings.service";
import { assertRentInvariants } from "./helpers/assert-rent-invariants";
import { RentFixtures } from "./helpers/rent-fixtures";

const HAS_DB = Boolean(process.env.DATABASE_URL);

describe.skipIf(!HAS_DB)("RentInvoiceService actions", () => {
  let db: DatabaseService;
  let fx: RentFixtures;
  let operatorId: string;
  let settings: RentSettingsService;
  let engine: RentInvoiceEngineService;
  let payments: RentPaymentService;
  let invoices: RentInvoiceService;

  async function property(extra: Record<string, unknown> = {}) {
    const propertyId = await fx.createProperty(operatorId, { internalCode: "ACT" });
    const listingId = await fx.createListingWithDetails(propertyId, operatorId);
    const roomTypeId = await fx.createRoomType(listingId, { rentPaise: 900000 });
    const roomId = await fx.createRoom(propertyId, { roomTypeId, roomNumber: "201" });
    await settings.enable(operatorId, propertyId, {
      billing_starts_on: "2026-09-01",
      due_day: 5,
      late_fee_enabled: true,
      late_fee_amount_inr: 300,
      late_fee_grace_days: 3,
      ...extra
    });
    return { propertyId, roomId };
  }
  async function tenantWithSeptember(
    p: { propertyId: string; roomId: string },
    label = "A",
    opts: Record<string, unknown> = {}
  ) {
    const bedId = await fx.createBed(p.roomId, label);
    const a = await fx.createAssignment(p.propertyId, bedId, {
      createdBy: operatorId,
      moveIn: "2026-09-01",
      ...opts
    });
    await engine.generateInvoicesForProperty(p.propertyId, "2026-09-01");
    const sep = (
      await invoices.list(operatorId, p.propertyId, { assignment_id: a, kind: "rent" })
    )[0];
    return { a, sep };
  }

  /**
   * The real default path to a Restore card: notice for 15 Sep → re-prorate September →
   * notice cancelled. onAssignmentEvent runs generation against the real clock before
   * suggestRestore, so the engine issues the 16–30 Sep gap invoice on the way (unless
   * `beforeStaying` already put a rent invoice there). Returns whatever rent invoice now
   * starts on 16 Sep.
   */
  async function leaveThenStay(
    propertyId: string,
    a: string,
    sepId: string,
    beforeStaying: () => Promise<void> = async () => undefined
  ) {
    await db.query(
      `UPDATE pg_bed_assignments SET status = 'notice_served', notice_end_date = '2026-09-15' WHERE id = $1::uuid`,
      [a]
    );
    await engine.onAssignmentEvent({ type: "notice_served", propertyId, assignmentId: a });
    await invoices.applyReprorate(operatorId, propertyId, sepId);
    await beforeStaying();
    await db.query(
      `UPDATE pg_bed_assignments SET status = 'active', notice_end_date = NULL WHERE id = $1::uuid`,
      [a]
    );
    await engine.onAssignmentEvent({ type: "notice_cancelled", propertyId, assignmentId: a });
    const sep = await invoices.get(operatorId, propertyId, sepId);
    expect(sep.reprorate_suggestion).toMatchObject({ mode: "restore" });
    return (await invoices.list(operatorId, propertyId, { assignment_id: a, kind: "rent" })).find(
      (i) => i.period_start === "2026-09-16"
    );
  }

  /** Polls until `n` backends wait (directly or transitively) on `blockerPid`'s locks. */
  async function waitForBlockedBehind(blockerPid: number, n: number): Promise<void> {
    for (let i = 0; i < 250; i += 1) {
      const rows = await db.query<{ pid: number; blockers: number[] }>(
        `SELECT pid, pg_blocking_pids(pid) AS blockers FROM pg_stat_activity
            WHERE datname = current_database() AND cardinality(pg_blocking_pids(pid)) > 0`
      );
      const behind = new Set<number>([blockerPid]);
      let grew = true;
      while (grew) {
        grew = false;
        for (const r of rows.rows) {
          if (!behind.has(r.pid) && r.blockers.some((b) => behind.has(b))) {
            behind.add(r.pid);
            grew = true;
          }
        }
      }
      if (behind.size - 1 >= n) return;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    throw new Error(`expected ${n} transactions blocked behind pid ${blockerPid}`);
  }

  beforeAll(async () => {
    db = new DatabaseService();
    fx = new RentFixtures(db, randomUUID().replace(/-/g, ""));
    await fx.setup();
    operatorId = await fx.createUser("pg_operator");
    settings = new RentSettingsService(db);
    const alloc = new RentAllocationService();
    const receipts = new RentReceiptService(
      db,
      { render: async () => Buffer.from("%PDF") },
      new InMemoryPdfStorage(),
      new DevApiSasIssuer()
    );
    engine = new RentInvoiceEngineService(db, settings, alloc);
    payments = new RentPaymentService(db, settings, alloc, receipts);
    invoices = new RentInvoiceService(db, alloc, payments, engine);
  });
  afterAll(async () => {
    for (const id of fx.propertyIds) await assertRentInvariants(db, id);
    await fx.teardown();
    await db.onModuleDestroy();
  });

  it("adds, edits and removes lines; a removal below what was paid releases the excess to credit", async () => {
    const p = await property();
    const { a, sep } = await tenantWithSeptember(p);
    let inv = await invoices.addLine(operatorId, p.propertyId, sep.id, {
      kind: "electricity",
      label: "Electricity",
      amount_inr: 896,
      meta: { units: 112, rate_inr: 8 }
    });
    expect(inv.total_inr).toBe(9896);
    const elec = inv.lines.find((l) => l.kind === "electricity")!;
    inv = await invoices.updateLine(operatorId, p.propertyId, sep.id, elec.id, { amount_inr: 900 });
    expect(inv.total_inr).toBe(9900);
    await expect(
      invoices.updateLine(
        operatorId,
        p.propertyId,
        sep.id,
        inv.lines.find((l) => l.kind === "rent")!.id,
        { amount_inr: 1 }
      )
    ).rejects.toMatchObject({ response: { code: "line_locked" } });

    await payments.recordByOperator(
      operatorId,
      p.propertyId,
      { assignment_id: a, amount_inr: 9900, method: "cash", paid_on: "2026-09-02" },
      randomUUID()
    );
    expect((await invoices.get(operatorId, p.propertyId, sep.id)).status).toBe("paid");
    inv = await invoices.removeLine(operatorId, p.propertyId, sep.id, elec.id);
    expect(inv).toMatchObject({ total_inr: 9000, amount_paid_inr: 9000, status: "paid" });
    const ev = await db.query<{ event_type: string }>(
      `SELECT event_type FROM pg_rent_events WHERE entity_id = $1::uuid ORDER BY id`,
      [sep.id]
    );
    expect(ev.rows.map((e) => e.event_type)).toEqual(
      expect.arrayContaining([
        "invoice.line_added",
        "invoice.line_updated",
        "invoice.excess_deallocated",
        "invoice.line_removed"
      ])
    );
    const credit = await new RentAllocationService().unallocatedCredit(db, a);
    expect(credit).toBe(90000);
    await assertRentInvariants(db, p.propertyId);
  });

  it("issues a draft at a typed rent with due = today, mints the token and auto-applies credit", async () => {
    const p = await property();
    const propertyNoType = await fx.createProperty(operatorId, { internalCode: "DRF" });
    await fx.createListingWithDetails(propertyNoType, operatorId, { startingRentPaise: 700000 });
    const roomId = await fx.createRoom(propertyNoType, { roomTypeId: null });
    await settings.enable(operatorId, propertyNoType, {
      billing_starts_on: "2026-09-01",
      due_day: 5
    });
    const bedId = await fx.createBed(roomId, "A");
    const a = await fx.createAssignment(propertyNoType, bedId, {
      createdBy: operatorId,
      moveIn: "2026-09-01"
    });
    await engine.generateInvoicesForProperty(propertyNoType, "2026-09-01");
    const draft = (await invoices.list(operatorId, propertyNoType, { assignment_id: a }))[0];
    expect(draft.status).toBe("draft");
    await payments.recordByOperator(
      operatorId,
      propertyNoType,
      { assignment_id: a, amount_inr: 1000, method: "cash", paid_on: "2026-09-01" },
      randomUUID()
    ); // credit (draft not allocatable)

    const issued = await invoices.issueDraft(operatorId, propertyNoType, draft.id, {
      rent_inr: 8000
    });
    expect(issued).toMatchObject({
      status: "partially_paid",
      total_inr: 8000,
      amount_paid_inr: 1000,
      due_date: todayIst()
    });
    expect(issued.lines.find((l) => l.kind === "rent")!.amount_inr).toBe(8000);
    const tok = await db.query<{ t: string | null }>(
      `SELECT pay_token AS t FROM pg_rent_invoices WHERE id = $1::uuid`,
      [draft.id]
    );
    expect(tok.rows[0].t).toHaveLength(43);
    expect(p.propertyId).toBeTruthy();
    await assertRentInvariants(db, propertyNoType);
  });

  it("applies a fee from the suggestion, waives it after the tenant paid it (credit), and extend-due removes a fee inside the new grace", async () => {
    const p = await property({ late_fee_auto_apply: false });
    const { a, sep } = await tenantWithSeptember(p);
    await db.query(
      `UPDATE pg_rent_invoices SET suggested_late_fee_paise = 30000 WHERE id = $1::uuid`,
      [sep.id]
    );
    let inv = await invoices.applyFee(operatorId, p.propertyId, sep.id);
    expect(inv).toMatchObject({ total_inr: 9300, suggested_late_fee_inr: null });
    await payments.recordByOperator(
      operatorId,
      p.propertyId,
      { assignment_id: a, amount_inr: 9300, method: "upi", paid_on: "2026-09-12" },
      randomUUID()
    );
    inv = await invoices.waiveFee(operatorId, p.propertyId, sep.id, "goodwill");
    expect(inv).toMatchObject({ total_inr: 9000, amount_paid_inr: 9000, status: "paid" });
    expect(inv.late_fee_waived_at).not.toBeNull();
    // Carried requirement 1/2 (fix round 1, Important 2): the fee removal is what closes this
    // invoice's balance to zero here (no payment settles it), so settled_on must be stamped —
    // a `paid` invoice with a NULL settled_on is a spec §4.4 violation with no invariant check
    // of its own to catch it.
    expect(inv.settled_on).not.toBeNull();
    expect(await new RentAllocationService().unallocatedCredit(db, a)).toBe(30000);

    const { sep: sep2 } = await tenantWithSeptember(p, "B");
    await invoices.applyFee(operatorId, p.propertyId, sep2.id, 500);
    expect((await invoices.get(operatorId, p.propertyId, sep2.id)).total_inr).toBe(9500);
    inv = await invoices.extendDue(operatorId, p.propertyId, sep2.id, "2099-01-01");
    expect(inv).toMatchObject({ total_inr: 9000, due_date: "2099-01-01" });
    await expect(invoices.applyFee(operatorId, p.propertyId, sep2.id, 500)).resolves.toMatchObject({
      total_inr: 9500
    });
    await expect(
      invoices.setEligibility(operatorId, p.propertyId, sep2.id, false)
    ).resolves.toMatchObject({ late_fee_eligible: false });
    await expect(invoices.applyFee(operatorId, p.propertyId, sep2.id, 1)).rejects.toMatchObject({
      response: { code: "fee_not_allowed" }
    });
    await assertRentInvariants(db, p.propertyId);
  });

  it("waives every outstanding fee in one call", async () => {
    const p = await property();
    const { sep } = await tenantWithSeptember(p, "A");
    const { sep: sep2 } = await tenantWithSeptember(p, "B");
    await invoices.applyFee(operatorId, p.propertyId, sep.id, 300);
    await invoices.applyFee(operatorId, p.propertyId, sep2.id, 300);
    expect(await invoices.waiveAllFees(operatorId, p.propertyId, "festival")).toEqual({
      waived: 2
    });
    expect(
      (await invoices.list(operatorId, p.propertyId, { kind: "rent" })).every(
        (i) => i.total_inr === 9000
      )
    ).toBe(true);
    // The brief's own literal code for this test omits this call, but "every test ends with
    // assertRentInvariants" is listed as non-negotiable — added to comply with that requirement.
    await assertRentInvariants(db, p.propertyId);
  });

  it("cancels: partially paid releases allocations; paid with money refuses; ₹0 paid cancels", async () => {
    const p = await property();
    const { a, sep } = await tenantWithSeptember(p);
    await payments.recordByOperator(
      operatorId,
      p.propertyId,
      { assignment_id: a, amount_inr: 4000, method: "cash", paid_on: "2026-09-02" },
      randomUUID()
    );
    const cancelled = await invoices.cancel(operatorId, p.propertyId, sep.id, "issued by mistake");
    expect(cancelled).toMatchObject({
      status: "cancelled",
      amount_paid_inr: 0,
      cancel_reason: "issued by mistake"
    });
    expect(await new RentAllocationService().unallocatedCredit(db, a)).toBe(400000);

    const adhoc = await invoices.createManual(operatorId, p.propertyId, {
      assignment_id: a,
      kind: "adhoc",
      due_date: "2026-09-20",
      lines: [{ kind: "other", label: "Key", amount_inr: 4000 }]
    });
    expect(adhoc).toMatchObject({ status: "paid", amount_paid_inr: 4000 }); // credit auto-applied
    await expect(invoices.cancel(operatorId, p.propertyId, adhoc.id, "x")).rejects.toMatchObject({
      response: { code: "invoice_paid" }
    });
    const zero = await invoices.createManual(operatorId, p.propertyId, {
      assignment_id: a,
      kind: "adhoc",
      due_date: "2026-09-20",
      lines: [{ kind: "discount", label: "Waived", amount_inr: 0 }]
    });
    expect(zero.status).toBe("paid");
    await expect(
      invoices.cancel(operatorId, p.propertyId, zero.id, "unneeded")
    ).resolves.toMatchObject({ status: "cancelled" });
    await assertRentInvariants(db, p.propertyId);
  });

  it("backfill: paid history has no receipt and no fees; unpaid arrears are collectible; overlapping rent periods are refused", async () => {
    const p = await property();
    const { a } = await tenantWithSeptember(p);
    const aug = await invoices.createBackfill(operatorId, p.propertyId, {
      assignment_id: a,
      kind: "rent",
      period_start: "2026-08-01",
      period_end: "2026-08-31",
      due_date: "2026-08-05",
      lines: [{ kind: "rent", label: "Rent · August 2026", amount_inr: 9000 }],
      payment: { amount_inr: 9000, method: "cash", paid_on: "2026-08-03" }
    });
    expect(aug).toMatchObject({
      source: "backfill",
      status: "paid",
      late_fee_eligible: false,
      settled_on: "2026-08-03"
    });
    // Carried requirement 3: createBackfill must leave no pg_rent_receipts row at all — the
    // slice acceptance criterion is a plain count, not just "no row joined to this invoice's
    // payment" (scoped to this test's own assignment so parallel test files can't pollute it).
    const receiptCount = await db.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM pg_rent_receipts WHERE assignment_id = $1::uuid`,
      [a]
    );
    expect(Number(receiptCount.rows[0].count)).toBe(0);
    const jul = await invoices.createBackfill(operatorId, p.propertyId, {
      assignment_id: a,
      kind: "rent",
      period_start: "2026-07-01",
      period_end: "2026-07-31",
      due_date: "2026-07-05",
      lines: [{ kind: "rent", label: "Rent · July 2026", amount_inr: 9000 }]
    });
    expect(jul.status).toBe("issued");
    await expect(
      invoices.createBackfill(operatorId, p.propertyId, {
        assignment_id: a,
        kind: "rent",
        period_start: "2026-08-15",
        period_end: "2026-09-14",
        due_date: "2026-08-20",
        lines: [{ kind: "rent", label: "x", amount_inr: 1 }]
      })
    ).rejects.toMatchObject({ response: { code: "period_overlap" } });
    const held = await invoices.createBackfill(operatorId, p.propertyId, {
      assignment_id: a,
      kind: "deposit",
      due_date: "2026-08-01",
      lines: [{ kind: "deposit", label: "Security deposit", amount_inr: 18000 }],
      payment: { amount_inr: 18000, method: "cash", paid_on: "2026-08-01" }
    });
    expect(held).toMatchObject({ kind: "deposit", status: "paid" });
    await assertRentInvariants(db, p.propertyId);
  });

  it("manual and backfill invoices store their idempotency key: a replay returns the original, a concurrent duplicate never creates a second invoice", async () => {
    const p = await property();
    const { a } = await tenantWithSeptember(p);
    const manual: PgRentManualInvoiceInput = {
      assignment_id: a,
      kind: "adhoc",
      due_date: "2026-09-20",
      lines: [{ kind: "other", label: "Key", amount_inr: 200 }]
    };
    const manualKey = randomUUID();
    const first = await invoices.createManual(operatorId, p.propertyId, manual, manualKey);
    const replay = await invoices.createManual(operatorId, p.propertyId, manual, manualKey);
    expect(replay.id).toBe(first.id);

    const backfill: PgRentBackfillInput = {
      assignment_id: a,
      kind: "rent",
      period_start: "2026-08-01",
      period_end: "2026-08-31",
      due_date: "2026-08-05",
      lines: [{ kind: "rent", label: "Rent · August 2026", amount_inr: 9000 }]
    };
    const backfillKey = randomUUID();
    const aug = await invoices.createBackfill(operatorId, p.propertyId, backfill, backfillKey);
    // Without the stored key the replay is a second insert and dies on period_overlap.
    const augReplay = await invoices.createBackfill(
      operatorId,
      p.propertyId,
      backfill,
      backfillKey
    );
    expect(augReplay.id).toBe(aug.id);

    const stored = await db.query<{ id: string; idempotency_key: string | null }>(
      `SELECT id::text, idempotency_key FROM pg_rent_invoices WHERE id = ANY($1::uuid[])`,
      [[first.id, aug.id]]
    );
    expect(Object.fromEntries(stored.rows.map((r) => [r.id, r.idempotency_key]))).toEqual({
      [first.id]: manualKey,
      [aug.id]: backfillKey
    });

    // Two genuinely concurrent first calls. A third connection holds the property row lock, so
    // both calls get past the pre-check read before either can insert; only
    // uq_pg_rent_invoice_idem (0074) then stands between them and a second invoice, and the
    // loser's 23505 maps to 409 duplicate_invoice.
    const raceKey = randomUUID();
    const blocker = await db.getClient();
    let raced: PromiseSettledResult<{ id: string }>[];
    try {
      await blocker.query("BEGIN");
      await blocker.query(`SELECT 1 FROM pg_properties WHERE id = $1::uuid FOR UPDATE`, [
        p.propertyId
      ]);
      const blockerPid = (await blocker.query<{ pid: number }>(`SELECT pg_backend_pid() AS pid`))
        .rows[0].pid;
      const racing = Promise.allSettled([
        invoices.createManual(operatorId, p.propertyId, manual, raceKey),
        invoices.createManual(operatorId, p.propertyId, manual, raceKey)
      ]);
      await waitForBlockedBehind(blockerPid, 2);
      await blocker.query("COMMIT");
      raced = await racing;
    } finally {
      blocker.release();
    }
    expect(raced.map((r) => r.status).sort()).toEqual(["fulfilled", "rejected"]);
    expect(raced.find((r) => r.status === "rejected")).toMatchObject({
      reason: { response: { code: "duplicate_invoice" } }
    });
    const count = await db.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM pg_rent_invoices WHERE pg_property_id = $1::uuid AND idempotency_key = $2`,
      [p.propertyId, raceKey]
    );
    expect(count.rows[0].n).toBe(1);
    await assertRentInvariants(db, p.propertyId);
  });

  it("re-proration: notice writes a suggestion, owner applies it (paid invoice → credit), cancelled notice offers restore, and Restore absorbs the engine's gap invoice", async () => {
    const p = await property({ prorate_move_out: true });
    const { a, sep } = await tenantWithSeptember(p);
    await payments.recordByOperator(
      operatorId,
      p.propertyId,
      { assignment_id: a, amount_inr: 9000, method: "upi", paid_on: "2026-09-02" },
      randomUUID()
    );
    await db.query(
      `UPDATE pg_bed_assignments SET status = 'notice_served', notice_end_date = '2026-09-15' WHERE id = $1::uuid`,
      [a]
    );
    await engine.onAssignmentEvent({
      type: "notice_served",
      propertyId: p.propertyId,
      assignmentId: a
    });
    let inv = await invoices.get(operatorId, p.propertyId, sep.id);
    expect(inv.reprorate_suggestion).toEqual({
      leave_on: "2026-09-15",
      from_inr: 9000,
      to_inr: 4500,
      mode: "reprorate"
    });

    inv = await invoices.applyReprorate(operatorId, p.propertyId, sep.id);
    expect(inv).toMatchObject({
      total_inr: 4500,
      amount_paid_inr: 4500,
      status: "paid",
      reprorate_suggestion: null,
      period_end: "2026-09-15"
    });
    expect(await new RentAllocationService().unallocatedCredit(db, a)).toBe(450000);

    // The real default path (no pause, no hand-written suggestion): onAssignmentEvent runs
    // generateInvoicesForProperty against the real wall clock BEFORE suggestRestore, so the
    // reopened window gets an auto "2026-09-16..30" gap invoice that FIFO-takes the ₹4,500
    // credit the re-proration released — and only then is the Restore card offered.
    await db.query(
      `UPDATE pg_bed_assignments SET status = 'active', notice_end_date = NULL WHERE id = $1::uuid`,
      [a]
    );
    await engine.onAssignmentEvent({
      type: "notice_cancelled",
      propertyId: p.propertyId,
      assignmentId: a
    });
    const gap = (
      await invoices.list(operatorId, p.propertyId, { assignment_id: a, kind: "rent" })
    ).find((i) => i.period_start === "2026-09-16");
    expect(gap).toMatchObject({
      source: "auto",
      period_end: "2026-09-30",
      total_inr: 4500,
      amount_paid_inr: 4500,
      status: "paid"
    });
    inv = await invoices.get(operatorId, p.propertyId, sep.id);
    expect(inv.reprorate_suggestion).toMatchObject({ mode: "restore", to_inr: 9000 });
    await assertRentInvariants(db, p.propertyId);

    // Owner decision 2026-09-24: Restore absorbs the gap invoice in its own transaction —
    // releases its allocations to credit, cancels it, and the credit flows back to September.
    inv = await invoices.restoreReprorate(operatorId, p.propertyId, sep.id);
    expect(inv).toMatchObject({
      total_inr: 9000,
      amount_paid_inr: 9000,
      status: "paid",
      reprorate_suggestion: null,
      period_end: "2026-09-30"
    });
    expect(await invoices.get(operatorId, p.propertyId, gap!.id)).toMatchObject({
      status: "cancelled",
      amount_paid_inr: 0,
      cancel_reason: "restore_absorbed",
      reprorate_suggestion: null
    });
    expect(await new RentAllocationService().unallocatedCredit(db, a)).toBe(0);
    const gapEvents = await db.query<{ event_type: string; payload: Record<string, unknown> }>(
      `SELECT event_type, payload FROM pg_rent_events WHERE entity_type = 'invoice' AND entity_id = $1::uuid ORDER BY id`,
      [gap!.id]
    );
    expect(gapEvents.rows.map((e) => e.event_type).slice(-2)).toEqual([
      "invoice.excess_deallocated",
      "invoice.cancelled"
    ]);
    expect(gapEvents.rows.at(-1)!.payload).toEqual({
      reason: "restore_absorbed",
      restored_invoice_id: sep.id
    });
    const restoredEvent = await db.query<{ payload: Record<string, unknown> }>(
      `SELECT payload FROM pg_rent_events WHERE entity_type = 'invoice' AND entity_id = $1::uuid AND event_type = 'invoice.line_updated' ORDER BY id DESC LIMIT 1`,
      [sep.id]
    );
    expect(restoredEvent.rows[0].payload).toMatchObject({
      reason: "reprorate_restored",
      absorbed_invoice_ids: [gap!.id]
    });
    await assertRentInvariants(db, p.propertyId);
  });

  it("restore absorbs a gap invoice the tenant paid directly: the money moves to the restored invoice, the receipt is untouched", async () => {
    const p = await property({ prorate_move_out: true });
    const { a, sep } = await tenantWithSeptember(p);
    const gap = await leaveThenStay(p.propertyId, a, sep.id);
    expect(gap).toMatchObject({ source: "auto", status: "issued", total_inr: 4500 });
    const paid = await payments.recordByOperator(
      operatorId,
      p.propertyId,
      {
        assignment_id: a,
        amount_inr: 4500,
        method: "upi",
        paid_on: "2026-09-20",
        allocations: [{ invoice_id: gap!.id, amount_inr: 4500 }]
      },
      randomUUID()
    );
    expect((await invoices.get(operatorId, p.propertyId, gap!.id)).status).toBe("paid");
    await assertRentInvariants(db, p.propertyId);

    const inv = await invoices.restoreReprorate(operatorId, p.propertyId, sep.id);
    expect(inv).toMatchObject({
      total_inr: 9000,
      amount_paid_inr: 4500,
      status: "partially_paid",
      period_end: "2026-09-30"
    });
    expect(await invoices.get(operatorId, p.propertyId, gap!.id)).toMatchObject({
      status: "cancelled",
      amount_paid_inr: 0
    });
    expect(await new RentAllocationService().unallocatedCredit(db, a)).toBe(0);
    // Spec §6.7: only a manual re-allocation voids/re-mints; a release caused by an invoice
    // mutation leaves the receipt as the record of what was received.
    const receipts = await db.query<{ voided_at: Date | null }>(
      `SELECT voided_at FROM pg_rent_receipts WHERE payment_id = $1::uuid`,
      [paid.id]
    );
    expect(receipts.rows).toEqual([{ voided_at: null }]);
    await assertRentInvariants(db, p.propertyId);
  });

  it("restore absorbs a gap invoice carrying a pending tenant claim; confirming the claim later pays the restored invoice", async () => {
    const p = await property({ prorate_move_out: true });
    const tenantUserId = await fx.createUser("tenant");
    const { a, sep } = await tenantWithSeptember(p, "A", { tenantUserId });
    const gap = await leaveThenStay(p.propertyId, a, sep.id);
    const claim = await payments.claimByTenant(tenantUserId, {
      assignment_id: a,
      invoice_id: gap!.id,
      amount_inr: 4500,
      method: "upi",
      paid_on: "2026-09-20",
      idempotency_key: randomUUID()
    });
    expect(claim.status).toBe("pending_confirmation");

    await invoices.restoreReprorate(operatorId, p.propertyId, sep.id);
    expect(await invoices.get(operatorId, p.propertyId, gap!.id)).toMatchObject({
      status: "cancelled"
    });
    await assertRentInvariants(db, p.propertyId);

    // Spec §6.10 "Claim for a cancelled invoice → FIFO/credit": the claimed target is skipped.
    await payments.confirm(operatorId, p.propertyId, claim.id, {});
    expect(await invoices.get(operatorId, p.propertyId, sep.id)).toMatchObject({
      total_inr: 9000,
      amount_paid_inr: 4500,
      status: "partially_paid"
    });
    expect(await invoices.get(operatorId, p.propertyId, gap!.id)).toMatchObject({
      status: "cancelled",
      amount_paid_inr: 0
    });
    await assertRentInvariants(db, p.propertyId);
  });

  it("restore still refuses period_overlap when the overlapping invoice is not an engine-issued gap invoice", async () => {
    const p = await property({ prorate_move_out: true });
    const { a, sep } = await tenantWithSeptember(p);
    const backfill = await leaveThenStay(p.propertyId, a, sep.id, async () => {
      await invoices.createBackfill(operatorId, p.propertyId, {
        assignment_id: a,
        kind: "rent",
        period_start: "2026-09-16",
        period_end: "2026-09-30",
        due_date: "2026-09-16",
        lines: [{ kind: "rent", label: "Rent · 16–30 Sep 2026", amount_inr: 4500 }]
      });
    });
    expect(backfill).toMatchObject({ source: "backfill", status: "issued" });
    expect(
      (await invoices.get(operatorId, p.propertyId, sep.id)).reprorate_suggestion
    ).toMatchObject({ mode: "restore" });
    await expect(invoices.restoreReprorate(operatorId, p.propertyId, sep.id)).rejects.toMatchObject(
      {
        response: { code: "period_overlap" }
      }
    );
    expect(await invoices.get(operatorId, p.propertyId, sep.id)).toMatchObject({
      total_inr: 4500,
      period_end: "2026-09-15"
    });
    expect((await invoices.get(operatorId, p.propertyId, backfill!.id)).status).toBe("issued");
    await assertRentInvariants(db, p.propertyId);
  });

  it("restore refuses restore_gap_edited while the gap invoice carries an operator line or a late fee, and absorbs it once they are gone", async () => {
    const p = await property({ prorate_move_out: true });
    const { a, sep } = await tenantWithSeptember(p);
    const gap = await leaveThenStay(p.propertyId, a, sep.id);
    expect(gap).toMatchObject({ source: "auto", status: "issued" });

    const withLine = await invoices.addLine(operatorId, p.propertyId, gap!.id, {
      kind: "electricity",
      label: "Electricity",
      amount_inr: 400
    });
    await assertRentInvariants(db, p.propertyId);
    await expect(invoices.restoreReprorate(operatorId, p.propertyId, sep.id)).rejects.toMatchObject(
      {
        response: { code: "restore_gap_edited" }
      }
    );
    expect((await invoices.get(operatorId, p.propertyId, sep.id)).period_end).toBe("2026-09-15");
    await invoices.removeLine(
      operatorId,
      p.propertyId,
      gap!.id,
      withLine.lines.find((l) => l.kind === "electricity")!.id
    );

    await invoices.applyFee(operatorId, p.propertyId, gap!.id, 300);
    await assertRentInvariants(db, p.propertyId);
    await expect(invoices.restoreReprorate(operatorId, p.propertyId, sep.id)).rejects.toMatchObject(
      {
        response: { code: "restore_gap_edited" }
      }
    );
    await invoices.waiveFee(operatorId, p.propertyId, gap!.id, "tenant is staying");
    await assertRentInvariants(db, p.propertyId);

    const inv = await invoices.restoreReprorate(operatorId, p.propertyId, sep.id);
    expect(inv).toMatchObject({
      total_inr: 9000,
      amount_paid_inr: 0,
      status: "issued",
      period_end: "2026-09-30"
    });
    expect(await invoices.get(operatorId, p.propertyId, gap!.id)).toMatchObject({
      status: "cancelled",
      cancel_reason: "restore_absorbed"
    });
    await assertRentInvariants(db, p.propertyId);
  });

  it("restore refuses invoice_cancelled on a cancelled invoice's leftover restore card and leaves the gap invoice alone", async () => {
    const p = await property({ prorate_move_out: true });
    const { a, sep } = await tenantWithSeptember(p);
    const gap = await leaveThenStay(p.propertyId, a, sep.id);
    await invoices.cancel(operatorId, p.propertyId, sep.id, "billed in error");
    // cancel() does not clear reprorate_suggestion, so the Restore card outlives the invoice.
    expect(
      (await invoices.get(operatorId, p.propertyId, sep.id)).reprorate_suggestion
    ).toMatchObject({ mode: "restore" });
    await expect(invoices.restoreReprorate(operatorId, p.propertyId, sep.id)).rejects.toMatchObject(
      {
        response: { code: "invoice_cancelled" }
      }
    );
    expect((await invoices.get(operatorId, p.propertyId, gap!.id)).status).toBe("issued");
    await assertRentInvariants(db, p.propertyId);
  });

  it("restoreReprorate succeeds and fully re-applies credit once nothing else occupies the restored period", async () => {
    const p = await property({ prorate_move_out: true });
    const { a, sep } = await tenantWithSeptember(p);
    await payments.recordByOperator(
      operatorId,
      p.propertyId,
      { assignment_id: a, amount_inr: 9000, method: "upi", paid_on: "2026-09-02" },
      randomUUID()
    );
    await db.query(
      `UPDATE pg_bed_assignments SET status = 'notice_served', notice_end_date = '2026-09-15' WHERE id = $1::uuid`,
      [a]
    );
    await engine.onAssignmentEvent({
      type: "notice_served",
      propertyId: p.propertyId,
      assignmentId: a
    });
    let inv = await invoices.applyReprorate(operatorId, p.propertyId, sep.id);
    expect(inv).toMatchObject({ total_inr: 4500, period_end: "2026-09-15" });

    // The "staying" direction is the one that reopens the billing window and would trigger the
    // real-clock gap-invoice generation this suite's dates can no longer avoid (see the test
    // above) — so this test writes the restore suggestion directly, the same technique the brief
    // itself already uses for late-fee suggestions, to isolate restoreReprorate's own mutation
    // logic (the thing this test exists to verify) from that unrelated, date-sensitive side
    // effect of onAssignmentEvent's generation step.
    await db.query(
      `UPDATE pg_rent_invoices SET reprorate_suggestion = $2::jsonb WHERE id = $1::uuid`,
      [
        sep.id,
        JSON.stringify({
          leave_on: "2026-09-30",
          from_paise: 450000,
          to_paise: 900000,
          mode: "restore"
        })
      ]
    );
    inv = await invoices.restoreReprorate(operatorId, p.propertyId, sep.id);
    expect(inv).toMatchObject({
      total_inr: 9000,
      amount_paid_inr: 9000,
      status: "paid",
      reprorate_suggestion: null,
      period_end: "2026-09-30"
    });
    expect(await new RentAllocationService().unallocatedCredit(db, a)).toBe(0);
    await assertRentInvariants(db, p.propertyId);
  });

  it("re-proration: a later, earlier notice does not overwrite the true original — restore returns to it, not the intermediate value", async () => {
    const p = await property({ prorate_move_out: true });
    const { a, sep } = await tenantWithSeptember(p);
    await payments.recordByOperator(
      operatorId,
      p.propertyId,
      { assignment_id: a, amount_inr: 9000, method: "upi", paid_on: "2026-09-02" },
      randomUUID()
    );
    await db.query(
      `UPDATE pg_bed_assignments SET status = 'notice_served', notice_end_date = '2026-09-15' WHERE id = $1::uuid`,
      [a]
    );
    await engine.onAssignmentEvent({
      type: "notice_served",
      propertyId: p.propertyId,
      assignmentId: a
    });
    let inv = await invoices.applyReprorate(operatorId, p.propertyId, sep.id);
    expect(inv).toMatchObject({ total_inr: 4500, period_end: "2026-09-15" });

    // The tenant moves the date up further — a second, earlier notice on the SAME invoice.
    // suggestReprorate's own filters (reprorate_suggestion IS NULL, period_end > leaveOn) allow
    // this: applyReprorate cleared the suggestion, and 2026-09-10 < the current period_end
    // (2026-09-15).
    await db.query(
      `UPDATE pg_bed_assignments SET notice_end_date = '2026-09-10' WHERE id = $1::uuid`,
      [a]
    );
    await engine.onAssignmentEvent({
      type: "notice_served",
      propertyId: p.propertyId,
      assignmentId: a
    });
    inv = await invoices.get(operatorId, p.propertyId, sep.id);
    expect(inv.reprorate_suggestion).toMatchObject({ leave_on: "2026-09-10", mode: "reprorate" });
    inv = await invoices.applyReprorate(operatorId, p.propertyId, sep.id);
    // 10 days of a 30-day September: 9000 * 10 / 30 = 3000 — the SECOND application, over the
    // ALREADY-reprorated 4500 line, not the original 9000 (the billed amount always updates).
    expect(inv).toMatchObject({ total_inr: 3000, period_end: "2026-09-10" });

    // Bypass onAssignmentEvent for the same real-clock reason as the test above; write the
    // restore suggestion directly.
    await db.query(
      `UPDATE pg_rent_invoices SET reprorate_suggestion = $2::jsonb WHERE id = $1::uuid`,
      [
        sep.id,
        JSON.stringify({
          leave_on: "2026-09-30",
          from_paise: 300000,
          to_paise: 900000,
          mode: "restore"
        })
      ]
    );
    inv = await invoices.restoreReprorate(operatorId, p.propertyId, sep.id);
    // Before the fix, the second applyReprorate's `meta || …` overwrote meta.reprorated.original_paise
    // with the already-shrunk 450000 (and original_end with 2026-09-15), so this would have
    // resolved to 4500/2026-09-15 instead of the true original — silent money loss for the
    // tenant. The fix (write the reprorated baseline once, on the first application only) means
    // this restores to the TRUE original: 9000, not 4500 or 3000.
    expect(inv).toMatchObject({
      total_inr: 9000,
      amount_paid_inr: 9000,
      status: "paid",
      period_end: "2026-09-30"
    });
    expect(await new RentAllocationService().unallocatedCredit(db, a)).toBe(0);
    await assertRentInvariants(db, p.propertyId);
  });

  // Carried requirement 5: Task 4's finalizeConfirmed (rent-payment.service.ts) can settle an
  // invoice to `paid` while skipping fee re-evaluation on a balance it only partially covers,
  // leaving suggested_late_fee_paise stale on an already-closed invoice. applyFee's existing
  // status guard (rent + eligible + status in {issued, partially_paid}) is the single
  // enforcement point that must refuse to materialise that stale suggestion into a line — doing
  // so would "resurrect" a settled invoice by pushing its total back above amount_paid. This
  // test simulates that stale state directly (a paid invoice carrying a leftover suggestion)
  // and asserts applyFee refuses without mutating anything.
  it("refuses to apply a stale suggested fee to an invoice that has already settled", async () => {
    const p = await property();
    const { sep } = await tenantWithSeptember(p);
    await payments.recordByOperator(
      operatorId,
      p.propertyId,
      { assignment_id: sep.assignment_id, amount_inr: 9000, method: "cash", paid_on: "2026-09-02" },
      randomUUID()
    );
    const before = await invoices.get(operatorId, p.propertyId, sep.id);
    expect(before.status).toBe("paid");
    await db.query(
      `UPDATE pg_rent_invoices SET suggested_late_fee_paise = 30000 WHERE id = $1::uuid`,
      [sep.id]
    );
    await expect(invoices.applyFee(operatorId, p.propertyId, sep.id)).rejects.toMatchObject({
      response: { code: "fee_not_allowed" }
    });
    const after = await invoices.get(operatorId, p.propertyId, sep.id);
    expect(after).toMatchObject({ status: "paid", total_inr: 9000, amount_paid_inr: 9000 });
    await assertRentInvariants(db, p.propertyId);
  });
});
