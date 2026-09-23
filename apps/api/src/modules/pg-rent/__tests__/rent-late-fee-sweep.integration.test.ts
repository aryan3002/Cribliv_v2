import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { DatabaseService } from "../../../common/database.service";
import { runPgRentLateFeeSweep } from "../../../worker/pg-rent-sweeps";
import { RentAllocationService } from "../services/rent-allocation.service";
import { RentInvoiceEngineService } from "../services/rent-invoice-engine.service";
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

  async function property(extra: Record<string, unknown>) {
    const propertyId = await fx.createProperty(operatorId);
    const listingId = await fx.createListingWithDetails(propertyId, operatorId);
    const roomTypeId = await fx.createRoomType(listingId, { rentPaise: 900000 });
    const roomId = await fx.createRoom(propertyId, { roomTypeId });
    await settings.enable(operatorId, propertyId, {
      billing_starts_on: "2026-09-01",
      due_day: 5,
      late_fee_enabled: true,
      late_fee_grace_days: 3,
      ...extra
    });
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
  });
  afterAll(async () => {
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
    await runPgRentLateFeeSweep(db, "2026-12-01");
    expect(await fee(p.sep)).toMatchObject({ fee: null, suggested: null });
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
});
