import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { DatabaseService } from "../../../common/database.service";
import { transaction } from "../../../common/transaction";
import { RentAllocationService } from "../services/rent-allocation.service";
import { RentInvoiceEngineService } from "../services/rent-invoice-engine.service";
import { RentPaymentService } from "../services/rent-payment.service";
import { RentReceiptService } from "../services/rent-receipt.service";
import { SYSTEM_ACTOR } from "../services/rent-guards";
import { RentSettingsService } from "../services/rent-settings.service";
import { assertRentInvariants } from "./helpers/assert-rent-invariants";
import { enableRentAsOf, RentFixtures } from "./helpers/rent-fixtures";

const HAS_DB = Boolean(process.env.DATABASE_URL);

describe.skipIf(!HAS_DB)("RentPaymentService", () => {
  let db: DatabaseService;
  let fx: RentFixtures;
  let operatorId: string;
  let tenantUserId: string;
  let settings: RentSettingsService;
  let engine: RentInvoiceEngineService;
  let payments: RentPaymentService;
  const alloc = new RentAllocationService();

  async function property(
    opts: { lateFee?: boolean; kind?: "flat" | "per_day"; autoApply?: boolean } = {}
  ) {
    const propertyId = await fx.createProperty(operatorId, { internalCode: "TST" });
    const listingId = await fx.createListingWithDetails(propertyId, operatorId);
    const roomTypeId = await fx.createRoomType(listingId, {
      rentPaise: 900000,
      depositPaise: 1800000
    });
    const roomId = await fx.createRoom(propertyId, { roomTypeId, roomNumber: "101" });
    // This suite pins "today" to September 2026 via the `today` argument passed to
    // generateInvoicesForProperty, so enabled_on must be backdated too or every deposit
    // invoice silently disappears once the real calendar passes the move-in dates below.
    // See enableRentAsOf for why enable() has no override field.
    await enableRentAsOf(db, settings, operatorId, propertyId, "2026-01-01", {
      billing_starts_on: "2026-09-01",
      due_day: 5,
      late_fee_enabled: opts.lateFee ?? false,
      late_fee_kind: opts.kind ?? "flat",
      late_fee_amount_inr: 100,
      late_fee_grace_days: 3,
      late_fee_auto_apply: opts.autoApply ?? true
    });
    return { propertyId, roomId };
  }
  async function tenant(p: { propertyId: string; roomId: string }, label: string, phone?: string) {
    const bedId = await fx.createBed(p.roomId, label);
    return fx.createAssignment(p.propertyId, bedId, {
      createdBy: operatorId,
      moveIn: "2026-09-01",
      occupantPhone: phone
    });
  }
  async function invoiceRows(assignmentId: string) {
    const r = await db.query<{
      id: string;
      kind: string;
      status: string;
      total: string;
      paid: string;
      settled_on: string | null;
    }>(
      `SELECT id::text, kind::text, status::text, total_paise::text AS total, amount_paid_paise::text AS paid, to_char(settled_on,'YYYY-MM-DD') AS settled_on
         FROM pg_rent_invoices WHERE assignment_id = $1::uuid ORDER BY kind, period_start NULLS FIRST`,
      [assignmentId]
    );
    return r.rows;
  }

  beforeAll(async () => {
    db = new DatabaseService();
    fx = new RentFixtures(db, randomUUID().replace(/-/g, ""));
    await fx.setup();
    operatorId = await fx.createUser("pg_operator");
    tenantUserId = await fx.createUser("tenant", "+917700000099");
    settings = new RentSettingsService(db);
    engine = new RentInvoiceEngineService(db, settings, alloc);
    payments = new RentPaymentService(db, settings, alloc, new RentReceiptService(db));
  });
  afterAll(async () => {
    await fx.teardown();
    await db.onModuleDestroy();
  });

  it("operator records cash: confirmed at birth, allocated FIFO (deposit first), receipt minted, idempotent", async () => {
    const p = await property();
    const a = await tenant(p, "A");
    await engine.generateInvoicesForProperty(p.propertyId, "2026-09-01"); // deposit 18000 + Sep 9000

    const key = randomUUID();
    const first = await payments.recordByOperator(
      operatorId,
      p.propertyId,
      { assignment_id: a, amount_inr: 20000, method: "cash", paid_on: "2026-09-02" },
      key
    );
    expect(first).toMatchObject({
      status: "confirmed",
      source: "operator",
      amount_inr: 20000,
      unallocated_inr: 0
    });
    expect(first.allocations.map((x) => x.amount_inr)).toEqual([18000, 2000]);
    expect(first.receipt_id).not.toBeNull();
    const receipt = await db.query<{ receipt_number: string; snapshot: Record<string, unknown> }>(
      `SELECT receipt_number, snapshot FROM pg_rent_receipts WHERE id = $1::uuid`,
      [first.receipt_id]
    );
    expect(receipt.rows[0].receipt_number).toBe("TST-0001");
    expect(receipt.rows[0].snapshot).toMatchObject({
      amount_inr: 20000,
      amount_words: expect.stringMatching(/Twenty Thousand/i),
      tenant_name: "Rent Tenant",
      room_number: "101"
    });

    const again = await payments.recordByOperator(
      operatorId,
      p.propertyId,
      { assignment_id: a, amount_inr: 20000, method: "cash", paid_on: "2026-09-02" },
      key
    );
    expect(again.id).toBe(first.id);
    expect((await invoiceRows(a)).map((i) => [i.kind, i.status])).toEqual([
      ["deposit", "paid"],
      ["rent", "partially_paid"]
    ]);
    await assertRentInvariants(db, p.propertyId);
  });

  /**
   * Allocation order is business order — the deposit line before the rent line,
   * the way operator and tenant read it off a receipt — and it is insertion
   * order, because allocateInflow writes the plan in that order.
   *
   * Both rows land in one transaction, so they share created_at (now() is the
   * transaction timestamp) and created_at alone leaves the sort tied. A partial
   * de-allocation is what makes the tie bite deterministically: it UPDATEs the
   * deposit allocation rather than deleting it, which rewrites the row at a
   * later physical position, and a tied sort hands back heap order — reversed.
   * `al.seq` (migration 0073) is the tiebreak that survives that; ctid cannot
   * be, since the UPDATE is precisely what moves it.
   */
  it("keeps a split payment's allocations in insertion order after a partial de-allocation", async () => {
    const p = await property();
    const a = await tenant(p, "E");
    await engine.generateInvoicesForProperty(p.propertyId, "2026-09-01"); // deposit 18000 + Sep 9000
    const [deposit] = await invoiceRows(a);

    const paid = await payments.recordByOperator(
      operatorId,
      p.propertyId,
      { assignment_id: a, amount_inr: 20000, method: "cash", paid_on: "2026-09-02" },
      randomUUID()
    );
    expect(paid.allocations.map((x) => x.amount_inr)).toEqual([18000, 2000]);

    await transaction(db, (c) => alloc.deallocateExcess(c, deposit.id, 500000, SYSTEM_ACTOR));

    const after = await payments.get(operatorId, p.propertyId, paid.id);
    expect(after.allocations.map((x) => x.amount_inr)).toEqual([13000, 2000]);
  });

  it("tenant claim → pending, one per invoice, owner confirms with an edited amount; reject needs a reason", async () => {
    const p = await property();
    const a = await tenant(p, "A", "+917700000099");
    await engine.generateInvoicesForProperty(p.propertyId, "2026-09-01");
    const sep = (await invoiceRows(a)).find((i) => i.kind === "rent")!.id;

    const claim = await payments.claimByTenant(tenantUserId, {
      assignment_id: a,
      invoice_id: sep,
      amount_inr: 9000,
      method: "upi",
      paid_on: "2026-09-03",
      reference: "123456789012",
      idempotency_key: randomUUID()
    });
    expect(claim).toMatchObject({
      status: "pending_confirmation",
      source: "tenant_claim",
      allocations: []
    });
    await expect(
      payments.claimByTenant(tenantUserId, {
        assignment_id: a,
        invoice_id: sep,
        amount_inr: 9000,
        method: "upi",
        paid_on: "2026-09-03",
        idempotency_key: randomUUID()
      })
    ).rejects.toMatchObject({ response: { code: "claim_pending" } });
    expect((await invoiceRows(a)).find((i) => i.id === sep)!.status).toBe("issued"); // pending allocates nothing

    const confirmed = await payments.confirm(operatorId, p.propertyId, claim.id, {
      amount_inr: 8500
    });
    expect(confirmed).toMatchObject({ status: "confirmed", amount_inr: 8500 });
    expect((await invoiceRows(a)).find((i) => i.id === sep)).toMatchObject({
      status: "partially_paid",
      paid: "850000"
    });
    const ev = await db.query<{ payload: Record<string, unknown> }>(
      `SELECT payload FROM pg_rent_events WHERE entity_id = $1::uuid AND event_type = 'payment.confirmed'`,
      [claim.id]
    );
    expect(ev.rows[0].payload).toMatchObject({ original: { amount_paise: 900000 } });
    await expect(payments.confirm(operatorId, p.propertyId, claim.id, {})).rejects.toMatchObject({
      response: { code: "payment_not_pending" }
    });

    const claim2 = await payments.claimByTenant(tenantUserId, {
      assignment_id: a,
      invoice_id: sep,
      amount_inr: 500,
      method: "upi",
      paid_on: "2026-09-04",
      idempotency_key: randomUUID()
    });
    const rejected = await payments.reject(operatorId, p.propertyId, claim2.id, "Not received");
    expect(rejected).toMatchObject({ status: "rejected", rejected_reason: "Not received" });
    await assertRentInvariants(db, p.propertyId);
  });

  it("tenant can cancel only their own pending claim", async () => {
    const p = await property();
    const a = await tenant(p, "A", "+917700000099");
    await engine.generateInvoicesForProperty(p.propertyId, "2026-09-01");
    const claim = await payments.claimByTenant(tenantUserId, {
      assignment_id: a,
      amount_inr: 100,
      method: "upi",
      paid_on: "2026-09-03",
      idempotency_key: randomUUID()
    });
    const stranger = await fx.createUser("tenant");
    await expect(payments.cancelClaim(stranger, claim.id)).rejects.toMatchObject({
      response: { code: "forbidden" }
    });
    await payments.cancelClaim(tenantUserId, claim.id);
    expect((await payments.get(operatorId, p.propertyId, claim.id)).status).toBe("rejected");
    await assertRentInvariants(db, p.propertyId);
  });

  it("reversal walks the invoice back, voids the receipt, regenerates an expired pay token; reversing a funded inflow is refused", async () => {
    const p = await property();
    const a = await tenant(p, "A");
    await engine.generateInvoicesForProperty(p.propertyId, "2026-09-01");
    const paid = await payments.recordByOperator(
      operatorId,
      p.propertyId,
      { assignment_id: a, amount_inr: 27000, method: "upi", paid_on: "2026-09-02" },
      randomUUID()
    );
    expect((await invoiceRows(a)).every((i) => i.status === "paid")).toBe(true);
    const tokenBefore = (
      await db.query<{ t: Date }>(
        `SELECT pay_token_expires_at AS t FROM pg_rent_invoices WHERE assignment_id = $1::uuid AND kind = 'rent'`,
        [a]
      )
    ).rows[0].t;
    expect(tokenBefore.getTime()).toBeLessThanOrEqual(Date.now()); // expired on paid

    const reversed = await payments.reverse(operatorId, p.propertyId, paid.id, "wrong tenant");
    expect(reversed).toMatchObject({ status: "reversed", reversed_reason: "wrong tenant" });
    expect((await invoiceRows(a)).map((i) => [i.status, i.paid, i.settled_on])).toEqual([
      ["issued", "0", null],
      ["issued", "0", null]
    ]);
    const receipt = await db.query<{ voided_at: Date | null; void_reason: string | null }>(
      `SELECT voided_at, void_reason FROM pg_rent_receipts WHERE id = $1::uuid`,
      [paid.receipt_id]
    );
    expect(receipt.rows[0].void_reason).toBe("reversed");
    const tokenAfter = (
      await db.query<{ t: Date }>(
        `SELECT pay_token_expires_at AS t FROM pg_rent_invoices WHERE assignment_id = $1::uuid AND kind = 'rent'`,
        [a]
      )
    ).rows[0].t;
    expect(tokenAfter.getTime()).toBeGreaterThan(Date.now());
    await expect(
      payments.reverse(operatorId, p.propertyId, paid.id, "again")
    ).rejects.toMatchObject({ response: { code: "payment_not_confirmed" } });

    // credit → refund → the inflow that funded it cannot be reversed first
    const credit = await payments.recordByOperator(
      operatorId,
      p.propertyId,
      { assignment_id: a, amount_inr: 30000, method: "cash", paid_on: "2026-09-03" },
      randomUUID()
    );
    expect(credit.unallocated_inr).toBe(3000);
    const refund = await payments.recordRefund(
      operatorId,
      p.propertyId,
      {
        assignment_id: a,
        amount_inr: 3000,
        method: "cash",
        paid_on: "2026-09-04",
        reason: "overpaid"
      },
      randomUUID()
    );
    expect(refund).toMatchObject({ direction: "outflow", status: "confirmed", receipt_id: null });
    await expect(
      payments.recordRefund(
        operatorId,
        p.propertyId,
        { assignment_id: a, amount_inr: 1, method: "cash", paid_on: "2026-09-04", reason: "x" },
        randomUUID()
      )
    ).rejects.toMatchObject({ response: { code: "refund_exceeds_credit" } });
    await expect(payments.reverse(operatorId, p.propertyId, credit.id, "x")).rejects.toMatchObject({
      response: { code: "reverse_outflow_first" }
    });
    await payments.reverse(operatorId, p.propertyId, refund.id, "returned by mistake");
    expect((await payments.get(operatorId, p.propertyId, credit.id)).unallocated_inr).toBe(3000);
    await assertRentInvariants(db, p.propertyId);
  });

  it("per_day fee is re-evaluated as of paid_on: a cash payment inside grace recorded late removes the fee", async () => {
    const p = await property({ lateFee: true, kind: "per_day" });
    const a = await tenant(p, "A");
    await engine.generateInvoicesForProperty(p.propertyId, "2026-09-01");
    const sep = (await invoiceRows(a)).find((i) => i.kind === "rent")!.id;
    // simulate the sweep having applied a 5-day fee (Task 6 owns the sweep; here we write the line directly)
    await db.query(
      `INSERT INTO pg_rent_invoice_lines (invoice_id, kind, label, amount_paise, source) VALUES ($1::uuid, 'late_fee', 'Late fee', 50000, 'system')`,
      [sep]
    );
    await db.query(
      `UPDATE pg_rent_invoices SET total_paise = 950000, late_fee_computed_at = now() WHERE id = $1::uuid`,
      [sep]
    );

    const paid = await payments.recordByOperator(
      operatorId,
      p.propertyId,
      { assignment_id: a, amount_inr: 27000, method: "cash", paid_on: "2026-09-07" },
      randomUUID()
    );
    const row = (await invoiceRows(a)).find((i) => i.id === sep)!;
    expect(row).toMatchObject({ status: "paid", total: "900000" }); // fee removed (paid_within_grace: Sep 7 ≤ Sep 5 + 3)
    expect(paid.unallocated_inr).toBe(0);
    const ev = await db.query<{ payload: Record<string, unknown> }>(
      `SELECT payload FROM pg_rent_events WHERE entity_id = $1::uuid AND event_type = 'late_fee.removed'`,
      [sep]
    );
    expect(ev.rows[0].payload).toMatchObject({ reason: "paid_within_grace" });
    await assertRentInvariants(db, p.propertyId);
  });

  it("a fee removal that alone closes the balance still stamps settled_on (carried requirement: settledOn on every path to paid)", async () => {
    const p = await property({ lateFee: true, kind: "per_day" });
    const a = await tenant(p, "A");
    await engine.generateInvoicesForProperty(p.propertyId, "2026-09-01");
    const sep = (await invoiceRows(a)).find((i) => i.kind === "rent")!.id;

    // Pay the deposit + rent in full, on time — both invoices settle normally.
    await payments.recordByOperator(
      operatorId,
      p.propertyId,
      { assignment_id: a, amount_inr: 27000, method: "cash", paid_on: "2026-09-02" },
      randomUUID()
    );
    expect((await invoiceRows(a)).find((i) => i.id === sep)).toMatchObject({
      status: "paid",
      settled_on: "2026-09-02"
    });

    // Simulate a sweep re-opening the already-settled rent invoice with a late fee
    // (a later Task 6 concern) — the invoice falls back open by exactly the fee.
    await db.query(
      `INSERT INTO pg_rent_invoice_lines (invoice_id, kind, label, amount_paise, source) VALUES ($1::uuid, 'late_fee', 'Late fee', 50000, 'system')`,
      [sep]
    );
    await db.query(
      `UPDATE pg_rent_invoices SET total_paise = 950000, status = 'partially_paid', settled_on = NULL, late_fee_computed_at = now() WHERE id = $1::uuid`,
      [sep]
    );

    // A second payment for exactly the fee, recorded within grace: finalizeConfirmed's
    // step 2 removes the fee before step 3 ever allocates against this invoice (its
    // balance is already 0 by the time allocateInflow re-queries open invoices), so
    // the ONLY write that can close the balance is applyFeeDecision's own
    // recomputeInvoice call — which must still receive this payment's paid_on.
    const second = await payments.recordByOperator(
      operatorId,
      p.propertyId,
      { assignment_id: a, amount_inr: 500, method: "cash", paid_on: "2026-09-07" },
      randomUUID()
    );
    expect(second.allocations).toEqual([]); // the invoice closed before step 3 could allocate into it
    expect(second.unallocated_inr).toBe(500); // so the money becomes credit instead
    expect((await invoiceRows(a)).find((i) => i.id === sep)).toMatchObject({
      status: "paid",
      total: "900000",
      paid: "900000",
      settled_on: "2026-09-07"
    });
    await assertRentInvariants(db, p.propertyId);
  });

  it("per_day fee shrinks (never stays frozen) when recomputed as of an earlier paid_on than the sweep's asOf", async () => {
    const p = await property({ lateFee: true, kind: "per_day" });
    const a = await tenant(p, "A");
    await engine.generateInvoicesForProperty(p.propertyId, "2026-09-01");
    const sep = (await invoiceRows(a)).find((i) => i.kind === "rent")!.id;
    // Simulate the sweep having applied a 12-day fee on 2026-09-20 (₹100/day × 12).
    await db.query(
      `INSERT INTO pg_rent_invoice_lines (invoice_id, kind, label, amount_paise, source) VALUES ($1::uuid, 'late_fee', 'Late fee', 120000, 'system')`,
      [sep]
    );
    await db.query(
      `UPDATE pg_rent_invoices SET total_paise = 1020000, late_fee_computed_at = now() WHERE id = $1::uuid`,
      [sep]
    );

    // The tenant's cash was actually handed over Sep 10 (due Sep 5, grace ends Sep
    // 8) — 2 days late, not 12. `frozen` must not gate per_day the way it gates
    // flat/percent/override: finalizeConfirmed has to shrink the fee to the
    // as-of-paid_on amount (₹100 × 2 = ₹200), never leave the sweep's 12-day
    // snapshot (₹1200) charged.
    const paid = await payments.recordByOperator(
      operatorId,
      p.propertyId,
      { assignment_id: a, amount_inr: 27200, method: "cash", paid_on: "2026-09-10" },
      randomUUID()
    );
    expect(paid.unallocated_inr).toBe(0);
    expect((await invoiceRows(a)).find((i) => i.id === sep)).toMatchObject({
      status: "paid",
      total: "920000", // 900000 rent + 20000 (₹200) as-of fee, not 1020000
      paid: "920000",
      settled_on: "2026-09-10"
    });
    const ev = await db.query<{ payload: Record<string, unknown> }>(
      `SELECT payload FROM pg_rent_events WHERE entity_id = $1::uuid AND event_type = 'late_fee.updated'`,
      [sep]
    );
    expect(ev.rows[0].payload).toMatchObject({ from_paise: 120000, to_paise: 20000 });
    await assertRentInvariants(db, p.propertyId);
  });

  it("a stale suggestion (auto-apply off) is left alone by finalizeConfirmed, never materialised into a charge", async () => {
    const p = await property({ lateFee: true, kind: "flat", autoApply: false });
    const a = await tenant(p, "A");
    await engine.generateInvoicesForProperty(p.propertyId, "2026-09-01");
    const sep = (await invoiceRows(a)).find((i) => i.kind === "rent")!.id;
    // A prior sweep run (Task 6) suggested ₹70 without applying it (auto-apply is
    // off) — no line, no late_fee_computed_at, just the suggestion column.
    await db.query(
      `UPDATE pg_rent_invoices SET suggested_late_fee_paise = 7000 WHERE id = $1::uuid`,
      [sep]
    );

    // The flat policy now computes ₹100 (different from the stale ₹70 suggestion),
    // which would read as computeLateFee's "update" action — but there is still no
    // real line and no operator/auto-apply approval, so finalizeConfirmed must not
    // charge anything: it should settle both invoices in full, not leave the rent
    // invoice partially_paid with a phantom ₹100 fee line it just invented.
    const paid = await payments.recordByOperator(
      operatorId,
      p.propertyId,
      { assignment_id: a, amount_inr: 27000, method: "cash", paid_on: "2026-09-10" },
      randomUUID()
    );
    expect(paid.unallocated_inr).toBe(0);
    expect((await invoiceRows(a)).find((i) => i.id === sep)).toMatchObject({
      status: "paid",
      total: "900000", // unchanged — no late_fee line was ever created
      paid: "900000"
    });
    const ev = await db.query<{ id: string }>(
      `SELECT id::text FROM pg_rent_events WHERE entity_id = $1::uuid AND event_type LIKE 'late_fee.%'`,
      [sep]
    );
    expect(ev.rows).toEqual([]); // the suggestion was never touched, no charge was created
    await assertRentInvariants(db, p.propertyId);
  });

  it("manual re-allocation voids and re-mints the receipt", async () => {
    const p = await property();
    const a = await tenant(p, "A");
    await engine.generateInvoicesForProperty(p.propertyId, "2026-09-01");
    const rows = await invoiceRows(a);
    const dep = rows.find((i) => i.kind === "deposit")!.id;
    const sep = rows.find((i) => i.kind === "rent")!.id;
    const paid = await payments.recordByOperator(
      operatorId,
      p.propertyId,
      { assignment_id: a, amount_inr: 9000, method: "upi", paid_on: "2026-09-02" },
      randomUUID()
    );
    expect(paid.allocations[0].invoice_id).toBe(dep); // FIFO put it on the deposit
    const moved = await payments.reallocate(operatorId, p.propertyId, paid.id, [
      { invoice_id: sep, amount_inr: 9000 }
    ]);
    expect(moved.allocations).toHaveLength(1);
    expect(moved.allocations[0].invoice_id).toBe(sep);
    expect(moved.receipt_id).not.toBe(paid.receipt_id);
    const receipts = await db.query<{
      receipt_number: string;
      void_reason: string | null;
      superseded_by: string | null;
    }>(
      `SELECT receipt_number, void_reason, superseded_by::text FROM pg_rent_receipts WHERE payment_id = $1::uuid ORDER BY created_at`,
      [paid.id]
    );
    expect(receipts.rows).toEqual([
      { receipt_number: "TST-0001", void_reason: "reallocated", superseded_by: moved.receipt_id },
      { receipt_number: "TST-0002", void_reason: null, superseded_by: null }
    ]);
    await assertRentInvariants(db, p.propertyId);
  });

  it("reallocate expires the pay token on an invoice it closes and refreshes the token on one it reopens", async () => {
    const p = await property();
    const a = await tenant(p, "A");
    await engine.generateInvoicesForProperty(p.propertyId, "2026-09-01");
    const rows = await invoiceRows(a);
    const dep = rows.find((i) => i.kind === "deposit")!.id;
    const sep = rows.find((i) => i.kind === "rent")!.id;
    async function tokenState(ids: string[]) {
      const r = await db.query<{ id: string; status: string; expired: boolean }>(
        `SELECT id::text, status::text, (pay_token_expires_at <= now()) AS expired FROM pg_rent_invoices WHERE id = ANY($1::uuid[])`,
        [ids]
      );
      return Object.fromEntries(
        r.rows.map((x) => [x.id, { status: x.status, expired: x.expired }])
      );
    }

    // Fully pay the deposit only (explicit target) — it closes and its pay
    // token expires; rent is untouched, still issued with a live token.
    const paid = await payments.recordByOperator(
      operatorId,
      p.propertyId,
      {
        assignment_id: a,
        amount_inr: 18000,
        method: "upi",
        paid_on: "2026-09-02",
        allocations: [{ invoice_id: dep, amount_inr: 18000 }]
      },
      randomUUID()
    );
    expect(paid.allocations).toHaveLength(1);
    expect(paid.allocations[0]).toMatchObject({ invoice_id: dep, amount_inr: 18000 });
    const before = await tokenState([dep, sep]);
    expect(before[dep]).toEqual({ status: "paid", expired: true });
    expect(before[sep]).toEqual({ status: "issued", expired: false });

    // Split the same money 9000/9000 across both invoices: rent (full balance)
    // now closes, deposit (half its balance) reopens.
    const moved = await payments.reallocate(operatorId, p.propertyId, paid.id, [
      { invoice_id: sep, amount_inr: 9000 },
      { invoice_id: dep, amount_inr: 9000 }
    ]);
    expect(moved.allocations.find((x) => x.invoice_id === sep)?.amount_inr).toBe(9000);
    expect(moved.allocations.find((x) => x.invoice_id === dep)?.amount_inr).toBe(9000);
    const after = await tokenState([dep, sep]);
    // rent closed by the reallocation → its (previously live) token must expire
    expect(after[sep]).toEqual({ status: "paid", expired: true });
    // deposit reopened by the reallocation → its (previously expired) token must refresh
    expect(after[dep]).toEqual({ status: "partially_paid", expired: false });
    await assertRentInvariants(db, p.propertyId);
  });
});
