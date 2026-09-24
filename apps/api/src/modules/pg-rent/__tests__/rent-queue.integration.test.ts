import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { DatabaseService } from "../../../common/database.service";
import { DevApiSasIssuer } from "../../rent-agreement/downloads/dev-api-sas-issuer";
import { InMemoryPdfStorage } from "../../rent-agreement/pdf/in-memory-pdf-storage";
import { RentAllocationService } from "../services/rent-allocation.service";
import { RentInvoiceEngineService } from "../services/rent-invoice-engine.service";
import { RentInvoiceService } from "../services/rent-invoice.service";
import { RentPaymentService } from "../services/rent-payment.service";
import { RentQueueService } from "../services/rent-queue.service";
import { RentReceiptService } from "../services/rent-receipt.service";
import { RentSettlementService } from "../services/rent-settlement.service";
import { RentSettingsService } from "../services/rent-settings.service";
import { RentFixtures } from "./helpers/rent-fixtures";

const HAS_DB = Boolean(process.env.DATABASE_URL);

describe.skipIf(!HAS_DB)("RentQueueService", () => {
  let db: DatabaseService;
  let fx: RentFixtures;
  let operatorId: string;
  let tenantUserId: string;
  let propertyId: string;
  let roomId: string;
  let settings: RentSettingsService;
  let engine: RentInvoiceEngineService;
  let payments: RentPaymentService;
  let queue: RentQueueService;
  const A: Record<string, string> = {};
  let bInv: string;

  async function tenant(label: string, opts: Record<string, unknown> = {}) {
    const bedId = await fx.createBed(roomId, label);
    A[label] = await fx.createAssignment(propertyId, bedId, {
      createdBy: operatorId,
      moveIn: "2026-09-01",
      occupantName: `Tenant ${label}`,
      ...opts
    });
    return A[label];
  }

  beforeAll(async () => {
    db = new DatabaseService();
    fx = new RentFixtures(db, randomUUID().replace(/-/g, ""));
    await fx.setup();
    operatorId = await fx.createUser("pg_operator");
    tenantUserId = await fx.createUser("tenant", "+917700000033");
    propertyId = await fx.createProperty(operatorId, { internalCode: "QUE" });
    const listingId = await fx.createListingWithDetails(propertyId, operatorId);
    const roomTypeId = await fx.createRoomType(listingId, {
      rentPaise: 900000,
      depositPaise: 1800000
    });
    roomId = await fx.createRoom(propertyId, { roomTypeId, roomNumber: "301" });
    settings = new RentSettingsService(db);
    await settings.enable(operatorId, propertyId, {
      billing_starts_on: "2026-09-01",
      due_day: 5,
      late_fee_enabled: true,
      late_fee_grace_days: 7,
      prorate_move_out: true
    });
    const alloc = new RentAllocationService();
    const receipts = new RentReceiptService(
      db,
      { render: async () => Buffer.from("%PDF") },
      new InMemoryPdfStorage(),
      new DevApiSasIssuer()
    );
    engine = new RentInvoiceEngineService(db, settings, alloc);
    payments = new RentPaymentService(db, settings, alloc, receipts);
    const invoices = new RentInvoiceService(db, alloc, payments, engine);
    const settlement = new RentSettlementService(db, alloc, payments, invoices, engine);
    queue = new RentQueueService(db, settlement);

    // No deposits: enabled_on is the real date, after these 2026-09-01 move-ins. A: overdue. B: claim on Sep. C: no move-in. D: draft (bare room → listing rent). E: notice (Oct re-prorate suggestion). F: former tenant. G: paid.
    await tenant("A");
    await tenant("B", { tenantUserId, occupantPhone: "+917700000033" });
    await tenant("C", { moveIn: null });
    await tenant("G");
    const bareRoom = await fx.createRoom(propertyId, { roomTypeId: null, roomNumber: "302" });
    const bedD = await fx.createBed(bareRoom, "A");
    A.D = await fx.createAssignment(propertyId, bedD, {
      createdBy: operatorId,
      moveIn: "2026-09-01",
      occupantName: "Tenant D"
    });
    await tenant("E"); // before the first run, so E's full October exists when notice is served
    await engine.generateInvoicesForProperty(propertyId, "2026-09-30"); // Sep (due 09-30: natural 09-05 is past) + Oct (due 10-05) for A/B/E/G; drafts for D
    bInv = (
      await db.query<{ id: string }>(
        `SELECT id::text FROM pg_rent_invoices WHERE assignment_id = $1::uuid AND kind = 'rent' ORDER BY period_start LIMIT 1`,
        [A.B]
      )
    ).rows[0].id;
    await payments.claimByTenant(tenantUserId, {
      assignment_id: A.B,
      invoice_id: bInv,
      amount_inr: 9000,
      method: "upi",
      paid_on: "2026-09-04",
      idempotency_key: randomUUID()
    });
    await payments.recordByOperator(
      operatorId,
      propertyId,
      { assignment_id: A.G, amount_inr: 36000, method: "cash", paid_on: "2026-09-02" },
      randomUUID()
    );
    await db.query(
      `UPDATE pg_bed_assignments SET status = 'notice_served', notice_end_date = '2026-10-15' WHERE id = $1::uuid`,
      [A.E]
    );
    await engine.onAssignmentEvent({ type: "notice_served", propertyId, assignmentId: A.E });
    await tenant("F");
    await db.query(
      `UPDATE pg_bed_assignments SET status = 'moved_out', move_out_date = '2026-09-20' WHERE id = $1::uuid`,
      [A.F]
    );
    await engine.generateInvoicesForProperty(propertyId, "2026-10-10");
  });
  afterAll(async () => {
    await fx.teardown();
    await db.onModuleDestroy();
  });

  it("builds every section as of Oct 10", async () => {
    const q = await queue.queue(operatorId, propertyId, "2026-10-10");
    expect(q.as_of).toBe("2026-10-10");
    expect(q.awaiting_confirmation).toHaveLength(1);
    expect(q.awaiting_confirmation[0]).toMatchObject({
      assignment_id: A.B,
      amount_inr: 9000,
      waiting_days: expect.any(Number)
    });
    expect(q.needs_attention.map((r) => [r.kind, r.assignment_id])).toEqual(
      expect.arrayContaining([
        ["draft_invoice", A.D],
        ["set_move_in_date", A.C],
        ["reprorate_suggested", A.E]
      ])
    );
    expect(q.leaving.map((r) => r.assignment_id)).toContain(A.E);
    const overdueIds = q.overdue.map((r) => r.assignment_id);
    expect(overdueIds).toContain(A.A);
    expect(q.overdue.map((r) => r.invoice_id)).not.toContain(bInv); // pending claim → that invoice leaves the reminder sections
    expect(overdueIds).not.toContain(A.G); // paid
    const a = q.overdue.filter((r) => r.assignment_id === A.A);
    expect(a.map((r) => r.in_grace)).toEqual(expect.arrayContaining([true, false])); // Sep due 09-30 (10 days, past grace 7); Oct due 10-05 (5 days, in grace)
    expect(q.overdue.every((r, i, arr) => i === 0 || arr[i - 1].urgency >= r.urgency)).toBe(true);
    expect(q.former_tenants.map((r) => r.assignment_id)).toContain(A.F);
    expect(q.former_tenants.find((r) => r.assignment_id === A.F)!.balance_inr).toBeGreaterThan(0);
    expect(JSON.stringify(q)).not.toMatch(/_paise/);
  });

  it("month summary uses the billing lens for rent + adhoc only", async () => {
    const s = await queue.monthSummary(operatorId, propertyId, "2026-09-01", "2026-10-10");
    // September rent for A, B, E, G (9000 each) + F's prorated Sep 1–20 → expected; G paid 9000 of it; deposits excluded
    expect(s.expected_inr).toBe(9000 * 4 + 6000);
    expect(s.collected_inr).toBe(9000);
    expect(s.outstanding_inr).toBe(s.expected_inr - 9000);
    expect(s.overdue_inr).toBe(s.outstanding_inr - 6000); // F's cut September is due 2026-10-10 (moved_out → due on the run day), not yet overdue
    expect(s.awaiting_count).toBe(1);
    expect(s.awaiting_inr).toBe(9000);
    expect(s.collection_rate).toBeCloseTo(9000 / s.expected_inr, 4);
  });

  it("portfolio lists every managed property, enabled or not", async () => {
    const bare = await fx.createProperty(operatorId, { displayName: "No rent yet" });
    const rows = await queue.portfolio(operatorId, "2026-10-10");
    const mine = rows.find((r) => r.property_id === propertyId)!;
    expect(mine).toMatchObject({ enabled: true, paused: false });
    expect(mine.summary?.expected_inr).toBeGreaterThan(0);
    expect(mine.queue_counts).toMatchObject({ awaiting: 1 });
    expect(rows.find((r) => r.property_id === bare)).toMatchObject({
      enabled: false,
      summary: null,
      queue_counts: null
    });
  });
});
