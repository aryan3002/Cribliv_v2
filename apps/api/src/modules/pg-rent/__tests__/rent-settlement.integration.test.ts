import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { DatabaseService } from "../../../common/database.service";
import { DevApiSasIssuer } from "../../rent-agreement/downloads/dev-api-sas-issuer";
import { InMemoryPdfStorage } from "../../rent-agreement/pdf/in-memory-pdf-storage";
import { settlementNet } from "../pure/rent-settlement";
import { RentAllocationService } from "../services/rent-allocation.service";
import { RentInvoiceEngineService } from "../services/rent-invoice-engine.service";
import { RentInvoiceService } from "../services/rent-invoice.service";
import { RentPaymentService } from "../services/rent-payment.service";
import { RentReceiptService } from "../services/rent-receipt.service";
import { RentSettlementService } from "../services/rent-settlement.service";
import { RentSettingsService } from "../services/rent-settings.service";
import { assertRentInvariants } from "./helpers/assert-rent-invariants";
import { RentFixtures } from "./helpers/rent-fixtures";

const HAS_DB = Boolean(process.env.DATABASE_URL);

describe("settlementNet", () => {
  it("nets and never returns a negative to-return", () => {
    expect(
      settlementNet({ depositHeld: 1800000, credit: 0, openDues: 435500, deductions: 80000 })
    ).toEqual({ net: 1284500, toReturn: 1284500 });
    expect(settlementNet({ depositHeld: 0, credit: 0, openDues: 120000, deductions: 0 })).toEqual({
      net: -120000,
      toReturn: 0
    });
  });
});

describe.skipIf(!HAS_DB)("RentSettlementService", () => {
  let db: DatabaseService;
  let fx: RentFixtures;
  let operatorId: string;
  let settings: RentSettingsService;
  let engine: RentInvoiceEngineService;
  let payments: RentPaymentService;
  let invoices: RentInvoiceService;
  let settlement: RentSettlementService;

  async function leavingTenant(opts: { payDeposit?: boolean; payRent?: boolean } = {}) {
    const propertyId = await fx.createProperty(operatorId, { internalCode: "STL" });
    const listingId = await fx.createListingWithDetails(propertyId, operatorId);
    const roomTypeId = await fx.createRoomType(listingId, {
      rentPaise: 900000,
      depositPaise: 1800000
    });
    const roomId = await fx.createRoom(propertyId, { roomTypeId });
    await settings.enable(operatorId, propertyId, {
      billing_starts_on: "2026-06-01",
      due_day: 5,
      prorate_move_out: true,
      billing_timing: "arrears"
    });
    // RentSettingsService.enable() always stamps enabled_on = todayIst() (the
    // real wall clock; PgRentEnableInput has no field to override it), while
    // this whole scenario is dated June/July 2026 so every payment's paid_on
    // stays on or before the real run date. planDeposit() (rent-invoice
    // -engine.service.ts) only issues a deposit invoice when move_in_date >=
    // enabled_on, so on any real run date after 2026-06-01 the fixed move-in
    // date below would silently suppress the deposit invoice this suite
    // asserts on — a production-code gate this task does not own or touch.
    // Backdating enabled_on here is a test-fixture-only fix (same pattern as
    // rent-payment.integration.test.ts's `property()` helper).
    await db.query(
      `UPDATE pg_rent_settings SET enabled_on = '2026-01-01' WHERE pg_property_id = $1::uuid`,
      [propertyId]
    );
    const bedId = await fx.createBed(roomId, "A");
    const a = await fx.createAssignment(propertyId, bedId, {
      createdBy: operatorId,
      moveIn: "2026-06-01"
    });
    await engine.generateInvoicesForProperty(propertyId, "2026-06-30"); // deposit + June (arrears, due Jul 5)
    if (opts.payDeposit !== false)
      await payments.recordByOperator(
        operatorId,
        propertyId,
        {
          assignment_id: a,
          amount_inr: 18000,
          method: "cash",
          paid_on: "2026-06-01",
          allocations: []
        },
        randomUUID()
      );
    if (opts.payRent !== false)
      await payments.recordByOperator(
        operatorId,
        propertyId,
        { assignment_id: a, amount_inr: 9000, method: "upi", paid_on: "2026-07-03" },
        randomUUID()
      );
    await db.query(
      `UPDATE pg_bed_assignments SET status = 'moved_out', move_out_date = '2026-07-15' WHERE id = $1::uuid`,
      [a]
    );
    await engine.onAssignmentEvent({
      type: "operator_direct_move_out",
      propertyId,
      assignmentId: a
    });
    return { propertyId, a };
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
    settlement = new RentSettlementService(db, alloc, payments, invoices, engine);
  });
  afterAll(async () => {
    await fx.teardown();
    await db.onModuleDestroy();
  });

  it("statement: deposit held + credit − open dues (final cut period, deposit excluded) − deductions; settle releases the deposit, records the return, tenant sees settled", async () => {
    const { propertyId, a } = await leavingTenant();
    // `allocations: []` = no explicit targets → FIFO, so the ₹18,000 landed on the deposit invoice (due first).
    let st = await settlement.statement(operatorId, propertyId, a);
    expect(st).toMatchObject({
      status: "leaving",
      deposit_held_inr: 18000,
      credit_inr: 0,
      deposit_uncollected_inr: 0,
      pending_suggestion: null,
      settlement_invoice_id: null
    });
    expect(st.open_invoices.map((i) => i.kind)).toEqual(["rent"]); // July 1–15 cut period, generated by the hook
    expect(st.open_dues_inr).toBe(4355); // 9000 × 15/31 → ₹4,355
    expect(st).toMatchObject({ net_inr: 13645, to_return_inr: 13645 });

    st = await settlement.settle(
      operatorId,
      propertyId,
      a,
      {
        deductions: [{ kind: "cleaning", label: "Deep clean", amount_inr: 800 }],
        return_now: { amount_inr: 12845, method: "upi", paid_on: "2026-07-16", reference: "REF1" }
      },
      randomUUID()
    );
    expect(st).toMatchObject({
      status: "settled",
      deposit_held_inr: 0,
      open_dues_inr: 0,
      to_return_inr: 0,
      net_inr: 0
    });
    expect(st.settlement_invoice_id).not.toBeNull();
    const rows = await db.query<{ kind: string; status: string; total: string }>(
      `SELECT kind::text, status::text, total_paise::text AS total FROM pg_rent_invoices WHERE assignment_id = $1::uuid ORDER BY kind`,
      [a]
    );
    expect(rows.rows).toEqual(
      expect.arrayContaining([
        { kind: "deposit", status: "paid", total: "1800000" },
        { kind: "settlement", status: "paid", total: "80000" },
        { kind: "rent", status: "paid", total: "435500" }
      ])
    );
    const pays = await db.query<{
      source: string;
      direction: string;
      amount: string;
      status: string;
    }>(
      `SELECT source::text, direction::text, amount_paise::text AS amount, status::text FROM pg_rent_payments WHERE assignment_id = $1::uuid ORDER BY created_at`,
      [a]
    );
    expect(pays.rows).toEqual(
      expect.arrayContaining([
        { source: "deposit_release", direction: "inflow", amount: "1800000", status: "confirmed" },
        { source: "operator", direction: "outflow", amount: "1284500", status: "confirmed" }
      ])
    );
    // no receipt for the release; the outflow has none either
    const receipts = await db.query(
      `SELECT 1 FROM pg_rent_receipts r JOIN pg_rent_payments p ON p.id = r.payment_id WHERE p.assignment_id = $1::uuid AND (p.source IN ('deposit_release') OR p.direction = 'outflow')`,
      [a]
    );
    expect(receipts.rowCount).toBe(0);
    const ev = await db.query<{ event_type: string }>(
      `SELECT event_type FROM pg_rent_events WHERE pg_property_id = $1::uuid AND event_type IN ('settlement.created','deposit.released','refund.recorded') ORDER BY id`,
      [propertyId]
    );
    expect(ev.rows.map((e) => e.event_type)).toEqual([
      "settlement.created",
      "deposit.released",
      "refund.recorded"
    ]);
    await assertRentInvariants(db, propertyId);
  });

  it("uncollected deposit is written down; net < 0 leaves the shortfall collectible on the settlement invoice", async () => {
    const { propertyId, a } = await leavingTenant({ payDeposit: false, payRent: false });
    let st = await settlement.statement(operatorId, propertyId, a);
    expect(st).toMatchObject({
      deposit_held_inr: 0,
      deposit_uncollected_inr: 18000,
      open_dues_inr: 9000 + 4355
    });
    st = await settlement.settle(
      operatorId,
      propertyId,
      a,
      { deductions: [{ kind: "damage", label: "Broken chair", amount_inr: 1200 }] },
      randomUUID()
    );
    expect(st).toMatchObject({
      status: "settled",
      net_inr: -(9000 + 4355 + 1200),
      to_return_inr: 0
    });
    const dep = (
      await db.query<{ status: string; total: string }>(
        `SELECT status::text, total_paise::text AS total FROM pg_rent_invoices WHERE assignment_id = $1::uuid AND kind = 'deposit'`,
        [a]
      )
    ).rows[0];
    expect(dep).toEqual({ status: "paid", total: "0" }); // written down to what was paid (nothing)
    const set = (
      await db.query<{ status: string; total: string; token: string | null }>(
        `SELECT status::text, total_paise::text AS total, pay_token AS token FROM pg_rent_invoices WHERE assignment_id = $1::uuid AND kind = 'settlement'`,
        [a]
      )
    ).rows[0];
    expect(set).toMatchObject({ status: "issued", total: "120000" });
    expect(set.token).toHaveLength(43);
    await assertRentInvariants(db, propertyId);
  });

  it("blocks settle while a re-proration suggestion is pending, then re-settle updates the same settlement invoice after a reversed release", async () => {
    const propertyId = await fx.createProperty(operatorId);
    const listingId = await fx.createListingWithDetails(propertyId, operatorId);
    const roomTypeId = await fx.createRoomType(listingId, {
      rentPaise: 900000,
      depositPaise: 1800000
    });
    const roomId = await fx.createRoom(propertyId, { roomTypeId });
    await settings.enable(operatorId, propertyId, {
      billing_starts_on: "2026-06-01",
      due_day: 5,
      prorate_move_out: true
    }); // advance
    // Same test-fixture-only enabled_on backdating as leavingTenant() above —
    // planDeposit() would otherwise silently skip the deposit invoice.
    await db.query(
      `UPDATE pg_rent_settings SET enabled_on = '2026-01-01' WHERE pg_property_id = $1::uuid`,
      [propertyId]
    );
    const bedId = await fx.createBed(roomId, "A");
    const a = await fx.createAssignment(propertyId, bedId, {
      createdBy: operatorId,
      moveIn: "2026-06-01"
    });
    await engine.generateInvoicesForProperty(propertyId, "2026-06-30"); // deposit + Jun + Jul (advance, created Jun 30)
    await payments.recordByOperator(
      operatorId,
      propertyId,
      { assignment_id: a, amount_inr: 36000, method: "cash", paid_on: "2026-06-30" },
      randomUUID()
    );
    await db.query(
      `UPDATE pg_bed_assignments SET status = 'moved_out', move_out_date = '2026-07-15' WHERE id = $1::uuid`,
      [a]
    );
    await engine.onAssignmentEvent({
      type: "operator_direct_move_out",
      propertyId,
      assignmentId: a
    });

    let st = await settlement.statement(operatorId, propertyId, a);
    expect(st.pending_suggestion).toMatchObject({
      leave_on: "2026-07-15",
      from_inr: 9000,
      to_inr: 4355
    });
    await expect(
      settlement.settle(operatorId, propertyId, a, { deductions: [] }, randomUUID())
    ).rejects.toMatchObject({ response: { code: "suggestion_pending" } });
    await invoices.applyReprorate(operatorId, propertyId, st.pending_suggestion!.invoice_id);
    st = await settlement.statement(operatorId, propertyId, a);
    expect(st).toMatchObject({
      pending_suggestion: null,
      credit_inr: 4645,
      deposit_held_inr: 18000,
      open_dues_inr: 0,
      to_return_inr: 22645
    });

    st = await settlement.settle(operatorId, propertyId, a, { deductions: [] }, randomUUID());
    expect(st).toMatchObject({ status: "settled", to_return_inr: 22645 }); // nothing returned yet → still to return
    const release = (
      await db.query<{ id: string }>(
        `SELECT id::text FROM pg_rent_payments WHERE assignment_id = $1::uuid AND source = 'deposit_release'`,
        [a]
      )
    ).rows[0].id;
    await payments.reverse(operatorId, propertyId, release, "wrong deductions");
    st = await settlement.statement(operatorId, propertyId, a);
    expect(st).toMatchObject({
      status: "leaving",
      deposit_held_inr: 18000,
      settlement_invoice_id: expect.any(String)
    });
    const again = await settlement.settle(
      operatorId,
      propertyId,
      a,
      { deductions: [{ kind: "other", label: "Keys", amount_inr: 500 }] },
      randomUUID()
    );
    expect(again).toMatchObject({ status: "settled", to_return_inr: 22145 });
    const count = await db.query(
      `SELECT 1 FROM pg_rent_invoices WHERE assignment_id = $1::uuid AND kind = 'settlement' AND status <> 'cancelled'`,
      [a]
    );
    expect(count.rowCount).toBe(1);
    await assertRentInvariants(db, propertyId);
  });

  it("forfeit: a cancelled reservation's booking credit becomes an adhoc forfeit invoice paid from that credit", async () => {
    const propertyId = await fx.createProperty(operatorId);
    const roomId = await fx.createRoom(propertyId);
    await settings.enable(operatorId, propertyId, {});
    const bedId = await fx.createBed(roomId, "A", "reserved");
    const a = await fx.createAssignment(propertyId, bedId, {
      createdBy: operatorId,
      status: "reserved",
      moveIn: null
    });
    await payments.recordByOperator(
      operatorId,
      propertyId,
      { assignment_id: a, amount_inr: 2000, method: "upi", paid_on: "2026-09-01" },
      randomUUID()
    );
    await db.query(`UPDATE pg_bed_assignments SET status = 'cancelled' WHERE id = $1::uuid`, [a]);
    const inv = await settlement.forfeit(operatorId, propertyId, a, { amount_inr: 1500 });
    expect(inv).toMatchObject({ kind: "adhoc", status: "paid", total_inr: 1500 });
    expect(inv.lines[0]).toMatchObject({ kind: "forfeit", amount_inr: 1500 });
    expect(await new RentAllocationService().unallocatedCredit(db, a)).toBe(50000);
    await expect(
      settlement.forfeit(operatorId, propertyId, a, { amount_inr: 600 })
    ).rejects.toMatchObject({ response: { code: "forfeit_exceeds_credit" } });
    await assertRentInvariants(db, propertyId);
  });

  it("Important 2 (fix round 1): re-settling with a smaller deduction after the settlement invoice was paid in full releases the excess instead of throwing invariant 14", async () => {
    const { propertyId, a } = await leavingTenant({ payDeposit: false, payRent: false });
    let st = await settlement.settle(
      operatorId,
      propertyId,
      a,
      { deductions: [{ kind: "damage", label: "Broken chair", amount_inr: 1200 }] },
      randomUUID()
    );
    const settlementInvoiceId = st.settlement_invoice_id!;
    // The tenant pays the ₹1,200 settlement invoice in full via its live pay token.
    await payments.recordByOperator(
      operatorId,
      propertyId,
      {
        assignment_id: a,
        amount_inr: 1200,
        method: "upi",
        paid_on: "2026-07-20",
        allocations: [{ invoice_id: settlementInvoiceId, amount_inr: 1200 }]
      },
      randomUUID()
    );
    const before = (
      await db.query<{ status: string; total: string; paid: string }>(
        `SELECT status::text, total_paise::text AS total, amount_paid_paise::text AS paid FROM pg_rent_invoices WHERE id = $1::uuid`,
        [settlementInvoiceId]
      )
    ).rows[0];
    expect(before).toEqual({ status: "paid", total: "120000", paid: "120000" });

    // Without deallocateExcess, shrinking the total below amount_paid_paise
    // throws "invariant 14: amount_paid exceeds total" out of recomputeInvoice.
    st = await settlement.settle(
      operatorId,
      propertyId,
      a,
      { deductions: [{ kind: "damage", label: "Broken chair (revised)", amount_inr: 500 }] },
      randomUUID()
    );
    const after = (
      await db.query<{ status: string; total: string; paid: string }>(
        `SELECT status::text, total_paise::text AS total, amount_paid_paise::text AS paid FROM pg_rent_invoices WHERE id = $1::uuid`,
        [settlementInvoiceId]
      )
    ).rows[0];
    expect(after).toEqual({ status: "paid", total: "50000", paid: "50000" });
    // The released ₹700 (120000 - 50000 paise) landed back as unallocated credit.
    expect(await new RentAllocationService().unallocatedCredit(db, a)).toBe(70000);
    expect(st).toMatchObject({ status: "settled" });
    await assertRentInvariants(db, propertyId);
  });

  it("Important 3 (fix round 1): settle() replay with the same idempotency key does not duplicate ledger events when nothing was ever collected toward the deposit", async () => {
    const { propertyId, a } = await leavingTenant({ payDeposit: false, payRent: false });
    const key = randomUUID();
    const input = {
      deductions: [{ kind: "damage" as const, label: "Broken chair", amount_inr: 1200 }]
    };
    const first = await settlement.settle(operatorId, propertyId, a, input, key);

    const eventCount = async () =>
      (
        await db.query<{ c: string }>(
          `SELECT COUNT(*)::text AS c FROM pg_rent_events WHERE pg_property_id = $1::uuid
            AND event_type IN ('settlement.created','invoice.line_updated','invoice.line_added')`,
          [propertyId]
        )
      ).rows[0].c;
    const before = await eventCount();

    // Same idempotency key, same call shape — a genuine retry/replay.
    const second = await settlement.settle(operatorId, propertyId, a, input, key);
    expect(second).toEqual(first);
    expect(await eventCount()).toBe(before);
    await assertRentInvariants(db, propertyId);
  });
});
