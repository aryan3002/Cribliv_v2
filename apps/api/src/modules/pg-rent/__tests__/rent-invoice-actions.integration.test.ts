import { randomUUID } from "node:crypto";
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

  it("re-proration: notice writes a suggestion, owner applies it (paid invoice → credit), cancelled notice offers restore", async () => {
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

    // Fix round 1, Critical — unpaused, real sequence (no settings.pause: a pause here would
    // switch off a whole production subsystem for the rest of the test instead of exercising it).
    // onAssignmentEvent's own generateInvoicesForProperty call runs against the REAL wall-clock
    // today (todayIst()), not this suite's fixed September 2026 fixture dates. Once the reprorate
    // above shrinks sep's period_end to 2026-09-15, reactivating the assignment re-opens its
    // billing window from that date onward, and on any real run date past the property's due day
    // the engine auto-generates and settles a "2026-09-16..30" gap invoice for the reopened
    // window before suggestRestore ever runs — this is the default production path, not a test
    // artifact. restoreReprorate must therefore refuse to push sep's period_end back to
    // 2026-09-30: doing so would create two non-cancelled rent invoices covering the same days
    // (invariant 5) and double-bill the tenant for that tail.
    await db.query(
      `UPDATE pg_bed_assignments SET status = 'active', notice_end_date = NULL WHERE id = $1::uuid`,
      [a]
    );
    await engine.onAssignmentEvent({
      type: "notice_cancelled",
      propertyId: p.propertyId,
      assignmentId: a
    });
    const gapInvoices = await invoices.list(operatorId, p.propertyId, {
      assignment_id: a,
      kind: "rent"
    });
    expect(gapInvoices.some((i) => i.id !== sep.id && i.period_start === "2026-09-16")).toBe(true);

    inv = await invoices.get(operatorId, p.propertyId, sep.id);
    expect(inv.reprorate_suggestion).toMatchObject({ mode: "restore", to_inr: 9000 });
    await expect(invoices.restoreReprorate(operatorId, p.propertyId, sep.id)).rejects.toMatchObject(
      { response: { code: "period_overlap" } }
    );
    // Refused cleanly: sep is untouched (still the reprorated 4500/paid/09-15), the suggestion
    // is still offered (nothing was cleared), and no invariant is violated because nothing
    // overlapping was ever committed.
    inv = await invoices.get(operatorId, p.propertyId, sep.id);
    expect(inv).toMatchObject({
      total_inr: 4500,
      amount_paid_inr: 4500,
      status: "paid",
      period_end: "2026-09-15"
    });
    expect(inv.reprorate_suggestion).toMatchObject({ mode: "restore", to_inr: 9000 });
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
