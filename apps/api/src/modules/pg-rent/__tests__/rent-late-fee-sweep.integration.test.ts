import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { DatabaseService } from "../../../common/database.service";
import { runPgRentLateFeeSweep } from "../../../worker/pg-rent-sweeps";
import { RentAllocationService } from "../services/rent-allocation.service";
import { RentInvoiceEngineService } from "../services/rent-invoice-engine.service";
import { RentInvoiceService } from "../services/rent-invoice.service";
import { RentPaymentService } from "../services/rent-payment.service";
import { RentReceiptService } from "../services/rent-receipt.service";
import { RentSettingsService } from "../services/rent-settings.service";
import { InMemoryPdfStorage } from "../../rent-agreement/pdf/in-memory-pdf-storage";
import { DevApiSasIssuer } from "../../rent-agreement/downloads/dev-api-sas-issuer";
import { assertRentInvariants } from "./helpers/assert-rent-invariants";
import { RentFixtures } from "./helpers/rent-fixtures";

const HAS_DB = Boolean(process.env.DATABASE_URL);

describe.skipIf(!HAS_DB)("runPgRentLateFeeSweep", () => {
  let db: DatabaseService;
  let fx: RentFixtures;
  let operatorId: string;
  let settings: RentSettingsService;
  let engine: RentInvoiceEngineService;
  let payments: RentPaymentService;
  let invoices: RentInvoiceService;

  async function property(
    extra: Record<string, unknown>,
    roomOpts: { depositPaise?: number } = {}
  ) {
    const propertyId = await fx.createProperty(operatorId);
    const listingId = await fx.createListingWithDetails(propertyId, operatorId);
    const roomTypeId = await fx.createRoomType(listingId, {
      rentPaise: 900000,
      depositPaise: roomOpts.depositPaise ?? null
    });
    const roomId = await fx.createRoom(propertyId, { roomTypeId });
    await settings.enable(operatorId, propertyId, {
      billing_starts_on: "2026-09-01",
      due_day: 5,
      late_fee_enabled: true,
      late_fee_grace_days: 3,
      ...extra
    });
    // Test-fixture-only fix (same pattern as rent-payment.integration.test.ts's
    // property() helper): enable() always stamps enabled_on = todayIst(), the
    // real wall clock — no field in PgRentEnableInput can override it. This
    // whole file pretends "today" is September–December 2026 via runPgRentLateFeeSweep's
    // own `today` argument, but planDeposit() only issues a deposit invoice
    // when move_in_date >= enabled_on, so on any real run date after
    // 2026-09-01 the fixed "2026-09-01" move-in date below would silently
    // suppress every deposit invoice.
    await db.query(
      `UPDATE pg_rent_settings SET enabled_on = '2026-01-01' WHERE pg_property_id = $1::uuid`,
      [propertyId]
    );
    const bedId = await fx.createBed(roomId, "A");
    const a = await fx.createAssignment(propertyId, bedId, {
      createdBy: operatorId,
      moveIn: "2026-09-01"
    });
    await engine.generateInvoicesForProperty(propertyId, "2026-09-01");
    const sep = (
      await db.query<{ id: string }>(
        `SELECT id::text FROM pg_rent_invoices WHERE assignment_id = $1::uuid AND kind = 'rent'`,
        [a]
      )
    ).rows[0].id;
    return { propertyId, a, sep };
  }
  async function fee(invoiceId: string) {
    const r = await db.query<{
      fee: string | null;
      suggested: string | null;
      total: string;
      status: string;
    }>(
      `SELECT (SELECT amount_paise::text FROM pg_rent_invoice_lines WHERE invoice_id = i.id AND kind = 'late_fee') AS fee, i.suggested_late_fee_paise::text AS suggested, i.total_paise::text AS total, i.status::text
         FROM pg_rent_invoices i WHERE i.id = $1::uuid`,
      [invoiceId]
    );
    return r.rows[0];
  }

  beforeAll(async () => {
    db = new DatabaseService();
    fx = new RentFixtures(db, randomUUID().replace(/-/g, ""));
    await fx.setup();
    operatorId = await fx.createUser("pg_operator");
    settings = new RentSettingsService(db);
    const alloc = new RentAllocationService();
    engine = new RentInvoiceEngineService(db, settings, alloc);
    payments = new RentPaymentService(
      db,
      settings,
      alloc,
      new RentReceiptService(
        db,
        { render: async () => Buffer.from("%PDF") },
        new InMemoryPdfStorage(),
        new DevApiSasIssuer()
      )
    );
    invoices = new RentInvoiceService(db, alloc, payments, engine);
  });
  afterAll(async () => {
    for (const id of fx.propertyIds) await assertRentInvariants(db, id);
    await fx.teardown();
    await db.onModuleDestroy();
  });

  it("suggests when auto_apply is off, applies when on, and never touches ineligible or exempt invoices", async () => {
    const off = await property({
      late_fee_auto_apply: false,
      late_fee_kind: "flat",
      late_fee_amount_inr: 300
    });
    const on = await property({
      late_fee_auto_apply: true,
      late_fee_kind: "flat",
      late_fee_amount_inr: 300
    });
    const exempt = await property({
      late_fee_auto_apply: true,
      late_fee_kind: "flat",
      late_fee_amount_inr: 300
    });
    await db.query(`UPDATE pg_bed_assignments SET late_fee_exempt = true WHERE id = $1::uuid`, [
      exempt.a
    ]);

    expect(await runPgRentLateFeeSweep(db, "2026-09-08")).toMatchObject({
      applied: 0,
      suggested: 0
    }); // inside grace
    const r = await runPgRentLateFeeSweep(db, "2026-09-09");
    expect(r.suggested).toBeGreaterThanOrEqual(1);
    expect(r.applied).toBeGreaterThanOrEqual(1);
    expect(await fee(off.sep)).toMatchObject({ fee: null, suggested: "30000", total: "900000" });
    expect(await fee(on.sep)).toMatchObject({
      fee: "30000",
      suggested: null,
      total: "930000",
      status: "issued"
    });
    expect(await fee(exempt.sep)).toMatchObject({ fee: null, suggested: null });
    // idempotent
    await runPgRentLateFeeSweep(db, "2026-09-09");
    expect(await fee(on.sep)).toMatchObject({ fee: "30000", total: "930000" });
    for (const p of [off, on, exempt]) await assertRentInvariants(db, p.propertyId);
  });

  it("per_day grows daily, caps, freezes once only the fee is left, skips pending claims", async () => {
    const p = await property({
      late_fee_auto_apply: true,
      late_fee_kind: "per_day",
      late_fee_amount_inr: 50,
      late_fee_cap_inr: 500
    });
    await runPgRentLateFeeSweep(db, "2026-09-10");
    expect(await fee(p.sep)).toMatchObject({ fee: "10000" });
    await runPgRentLateFeeSweep(db, "2026-09-12");
    expect(await fee(p.sep)).toMatchObject({ fee: "20000" });
    await runPgRentLateFeeSweep(db, "2026-12-01");
    expect(await fee(p.sep)).toMatchObject({ fee: "50000", total: "950000" });

    // pending claim pauses it
    const tenant = await fx.createUser("tenant", "+917700000077");
    await db.query(`UPDATE pg_bed_assignments SET tenant_user_id = $2::uuid WHERE id = $1::uuid`, [
      p.a,
      tenant
    ]);
    await payments.claimByTenant(tenant, {
      assignment_id: p.a,
      invoice_id: p.sep,
      amount_inr: 9500,
      method: "upi",
      // Brief's literal test used "2026-12-02" here, which is in the future
      // relative to this sandbox's real system clock (2026-09-23) and trips
      // RentPaymentService.assertPaidOn's "paid_on_in_future" guard — a
      // production check that must not be weakened. The claim's own paid_on
      // value is never asserted on in this test (only its
      // status='pending_confirmation' matters for the sweep's WHERE-clause
      // exclusion), so any valid past-or-present date preserves the intent.
      paid_on: "2026-09-16",
      idempotency_key: randomUUID()
    });
    const before = await fee(p.sep);
    await runPgRentLateFeeSweep(db, "2026-12-20");
    expect(await fee(p.sep)).toEqual(before);

    // rent paid, only the fee left → frozen (no growth even without a cap)
    const p2 = await property({
      late_fee_auto_apply: true,
      late_fee_kind: "per_day",
      late_fee_amount_inr: 50
    });
    await runPgRentLateFeeSweep(db, "2026-09-12"); // fee 20000
    await payments.recordByOperator(
      operatorId,
      p2.propertyId,
      { assignment_id: p2.a, amount_inr: 9000, method: "cash", paid_on: "2026-09-12" },
      randomUUID()
    );
    expect(await fee(p2.sep)).toMatchObject({ fee: "20000", status: "partially_paid" });
    await runPgRentLateFeeSweep(db, "2026-12-01");
    expect(await fee(p2.sep)).toMatchObject({ fee: "20000", total: "920000" });
    await assertRentInvariants(db, p.propertyId);
    await assertRentInvariants(db, p2.propertyId);
  });

  it("does not sweep backfill, deposit, adhoc or paused properties, and honours late_fee_enabled=false", async () => {
    const p = await property({ late_fee_enabled: false });

    // Important 6 (fix round 1): the title promised four more exclusions
    // than late_fee_enabled=false alone verifies. Build each fixture for
    // real and prove the sweep leaves it untouched.
    const on = await property(
      {
        late_fee_auto_apply: true,
        late_fee_kind: "flat",
        late_fee_amount_inr: 300
      },
      { depositPaise: 1800000 } // property()'s default room type has no deposit; set one so generateInvoicesForProperty below actually issues a deposit invoice to test against
    );

    // deposit: property()'s own generateInvoicesForProperty already issued
    // one (kind='deposit') alongside the first rent invoice — excluded by
    // the candidate query's `i.kind = 'rent'` filter.
    const depositId = (
      await db.query<{ id: string }>(
        `SELECT id::text FROM pg_rent_invoices WHERE assignment_id = $1::uuid AND kind = 'deposit'`,
        [on.a]
      )
    ).rows[0].id;

    // adhoc: kind != 'rent' (same filter), and createManual hardcodes
    // eligible: false besides.
    const adhoc = await invoices.createManual(operatorId, on.propertyId, {
      assignment_id: on.a,
      kind: "adhoc",
      due_date: "2026-08-01",
      lines: [{ kind: "other", label: "One-off charge", amount_inr: 500 }]
    });

    // backfill, kind 'rent': the one case where source — not kind or the
    // eligible flag — is the only thing standing between this invoice and
    // an automated fee (Important 5). Prove the exclusion survives an
    // operator later flipping eligibility back on: setEligibility only
    // refuses non-'rent' invoices, so this is the fixture that actually
    // exercises `AND i.source <> 'backfill'`.
    const backfill = await invoices.createBackfill(operatorId, on.propertyId, {
      assignment_id: on.a,
      kind: "rent",
      period_start: "2026-07-01",
      period_end: "2026-07-31",
      due_date: "2026-08-01",
      lines: [{ kind: "rent", label: "Backfilled rent", amount_inr: 9000 }]
    });
    await invoices.setEligibility(operatorId, on.propertyId, backfill.id, true);

    // paused: its own property, otherwise identical to `on`, so pausing it
    // doesn't also mask `on`'s own eligible invoice below.
    const paused = await property({
      late_fee_auto_apply: true,
      late_fee_kind: "flat",
      late_fee_amount_inr: 300
    });
    await settings.pause(operatorId, paused.propertyId);

    await runPgRentLateFeeSweep(db, "2026-12-01");
    expect(await fee(p.sep)).toMatchObject({ fee: null, suggested: null }); // late_fee_enabled=false
    expect(await fee(depositId)).toMatchObject({ fee: null, suggested: null });
    expect(await fee(adhoc.id)).toMatchObject({ fee: null, suggested: null });
    expect(await fee(backfill.id)).toMatchObject({ fee: null, suggested: null });
    expect(await fee(paused.sep)).toMatchObject({ fee: null, suggested: null });
    // Control: `on`'s own rent invoice — same property, same due date as
    // the excluded fixtures above — DOES get a fee, proving the sweep ran
    // and genuinely skipped the others rather than never reaching them.
    expect(await fee(on.sep)).toMatchObject({ fee: "30000" });
    await assertRentInvariants(db, on.propertyId);
    await assertRentInvariants(db, paused.propertyId);
  });

  // Correction 3: "Fees are never recomputed upward by a payment" (spec line 390)
  // is self-satisfying only while the sweep is current. This proves the
  // corollary end-to-end: when the sweep has lagged behind a confirmed
  // payment's paid_on, finalizeConfirmed's own as-of-paid_on recompute must
  // never raise the existing fee line — and once the sweep catches up, the
  // pure chargeablePaise<=0 freeze rule (not a payment) is what governs the
  // fee going forward, never a payment-driven raise.
  it("never lets a lagging sweep's fee be raised by a payment's as-of-paid_on recompute", async () => {
    const p = await property({
      late_fee_auto_apply: true,
      late_fee_kind: "per_day",
      late_fee_amount_inr: 50
    });
    // Sweep runs once, early (simulating a lag before the next hourly run):
    // due+grace = 2026-09-08, so 2026-09-10 is 2 days late.
    await runPgRentLateFeeSweep(db, "2026-09-10");
    expect(await fee(p.sep)).toMatchObject({ fee: "10000" });

    // A payment is now confirmed with paid_on well past the sweep's last run
    // (5 more days late), covering rent only. finalizeConfirmed re-evaluates
    // the fee as of paid_on — which would compute a HIGHER fee (7 days) than
    // the stale line (2 days) — but must never write that raise.
    await payments.recordByOperator(
      operatorId,
      p.propertyId,
      { assignment_id: p.a, amount_inr: 9000, method: "cash", paid_on: "2026-09-15" },
      randomUUID()
    );
    expect(await fee(p.sep)).toMatchObject({ fee: "10000", status: "partially_paid" });

    // The sweep catching up afterward must not retroactively apply the
    // higher as-of-paid_on figure either: with rent now fully paid, only the
    // fee itself remains outstanding, so chargeablePaise <= 0 freezes it at
    // its current value rather than growing it further.
    await runPgRentLateFeeSweep(db, "2026-09-15");
    expect(await fee(p.sep)).toMatchObject({ fee: "10000", total: "910000" });
    await assertRentInvariants(db, p.propertyId);
  });

  // Fix 2 (final fix wave): a suggest-mode (auto_apply off) property whose fee
  // grows daily used to have its day-2-onward re-suggestions written by a raw
  // UPDATE that returned before ever calling applyFeeDecision/writeRentEvent —
  // invariant 8 ("every mutation writes an event in the same transaction")
  // silently broken on the everyday suggest-mode path. No test asserted sweep
  // events at all before this fix; this proves a second run with a changed
  // fee amount writes its own late_fee.suggested event, not just the first.
  it("re-suggestion on a later sweep run writes its own late_fee.suggested event (invariant 8)", async () => {
    const p = await property({
      late_fee_auto_apply: false,
      late_fee_kind: "per_day",
      late_fee_amount_inr: 50
    });
    await runPgRentLateFeeSweep(db, "2026-09-10"); // 2 days late -> suggest 10000
    expect(await fee(p.sep)).toMatchObject({ fee: null, suggested: "10000" });
    const r2 = await runPgRentLateFeeSweep(db, "2026-09-12"); // 4 days late -> re-suggest 20000 (action: "update")
    expect(await fee(p.sep)).toMatchObject({ fee: null, suggested: "20000" });
    expect(r2.suggested).toBeGreaterThanOrEqual(1);
    expect(r2.updated).toBe(0);

    const events = await db.query<{ payload: { paise: number } }>(
      `SELECT payload FROM pg_rent_events WHERE entity_id = $1::uuid AND event_type = 'late_fee.suggested' ORDER BY id`,
      [p.sep]
    );
    expect(events.rows.length).toBeGreaterThanOrEqual(2);
    expect(events.rows[0].payload).toMatchObject({ paise: 10000 });
    expect(events.rows[events.rows.length - 1].payload).toMatchObject({ paise: 20000 });
    await assertRentInvariants(db, p.propertyId);
  });
});
