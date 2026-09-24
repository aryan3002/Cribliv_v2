import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { DatabaseService } from "../../../common/database.service";
import { DevApiSasIssuer } from "../../rent-agreement/downloads/dev-api-sas-issuer";
import { InMemoryPdfStorage } from "../../rent-agreement/pdf/in-memory-pdf-storage";
import { RentAllocationService } from "../services/rent-allocation.service";
import { RentInvoiceEngineService } from "../services/rent-invoice-engine.service";
import { RentInvoiceService } from "../services/rent-invoice.service";
import { RentPayInstructionService } from "../services/rent-pay-instruction.service";
import { RentPaymentService } from "../services/rent-payment.service";
import { RentReceiptService } from "../services/rent-receipt.service";
import { RentSettlementService } from "../services/rent-settlement.service";
import { RentSettingsService } from "../services/rent-settings.service";
import { RentTenantService } from "../services/rent-tenant.service";
import { RentFixtures, enableRentAsOf } from "./helpers/rent-fixtures";

const HAS_DB = Boolean(process.env.DATABASE_URL);

describe.skipIf(!HAS_DB)("RentTenantService", () => {
  let db: DatabaseService;
  let fx: RentFixtures;
  let operatorId: string;
  let parentUserId: string;
  let settings: RentSettingsService;
  let engine: RentInvoiceEngineService;
  let payments: RentPaymentService;
  let tenants: RentTenantService;

  async function property(
    name: string,
    enable = true,
    extraSettings: Partial<Parameters<typeof enableRentAsOf>[5]> = {}
  ) {
    const propertyId = await fx.createProperty(operatorId, { displayName: name });
    const listingId = await fx.createListingWithDetails(propertyId, operatorId);
    const roomTypeId = await fx.createRoomType(listingId, {
      rentPaise: 900000,
      depositPaise: 1800000
    });
    const roomId = await fx.createRoom(propertyId, { roomTypeId });
    if (enable)
      await enableRentAsOf(db, settings, operatorId, propertyId, "2026-09-01", {
        billing_starts_on: "2026-09-01",
        due_day: 5,
        upi_vpa: "own@okaxis",
        upi_payee_name: "Owner",
        ...extraSettings
      });
    return { propertyId, roomId };
  }

  beforeAll(async () => {
    db = new DatabaseService();
    fx = new RentFixtures(db, randomUUID().replace(/-/g, ""));
    await fx.setup();
    operatorId = await fx.createUser("pg_operator", "+917700000044");
    parentUserId = await fx.createUser("tenant", "+917700000066"); // one phone, two beds (spec §19 #14)
    settings = new RentSettingsService(db);
    const alloc = new RentAllocationService();
    const receipts = new RentReceiptService(
      db,
      { render: async () => Buffer.from("%PDF") },
      new InMemoryPdfStorage(),
      new DevApiSasIssuer({ baseUrl: "http://api.test" })
    );
    engine = new RentInvoiceEngineService(db, settings, alloc);
    payments = new RentPaymentService(db, settings, alloc, receipts);
    const invoices = new RentInvoiceService(db, alloc, payments, engine);
    const settlement = new RentSettlementService(db, alloc, payments, invoices, engine);
    const pay = new RentPayInstructionService(db);
    tenants = new RentTenantService(db, alloc, pay, settlement);
  });
  afterAll(async () => {
    await fx.teardown();
    await db.onModuleDestroy();
  });

  it("returns every residence the phone matches without auto-linking, with a hero per residence", async () => {
    const p1 = await property("PG One");
    const p2 = await property("PG Two");
    const p3 = await property("No rent", false);
    const bed1 = await fx.createBed(p1.roomId, "A");
    const bed2 = await fx.createBed(p2.roomId, "A");
    const bed3 = await fx.createBed(p3.roomId, "A");
    const a1 = await fx.createAssignment(p1.propertyId, bed1, {
      createdBy: operatorId,
      moveIn: "2026-09-01",
      occupantPhone: "+917700000066",
      tenantUserId: parentUserId,
      occupantName: "Kid One"
    });
    const a2 = await fx.createAssignment(p2.propertyId, bed2, {
      createdBy: operatorId,
      moveIn: "2026-09-01",
      occupantPhone: "+917700000066",
      occupantName: "Kid Two"
    }); // unlinked, phone-matched
    await fx.createAssignment(p3.propertyId, bed3, {
      createdBy: operatorId,
      moveIn: "2026-09-01",
      occupantPhone: "+917700000066",
      occupantName: "Kid Three"
    });
    for (const run of ["2026-09-01", "2026-10-01"]) {
      await engine.generateInvoicesForProperty(p1.propertyId, run);
      await engine.generateInvoicesForProperty(p2.propertyId, run);
    }
    await payments.recordByOperator(
      operatorId,
      p2.propertyId,
      { assignment_id: a2, amount_inr: 36000, method: "cash", paid_on: "2026-09-20" },
      randomUUID()
    );

    const s = await tenants.summary(parentUserId, "2026-10-10");
    expect(s.residences.map((r) => r.property_name).sort()).toEqual([
      "No rent",
      "PG One",
      "PG Two"
    ]);
    const one = s.residences.find((r) => r.assignment_id === a1)!;
    expect(one.hero.state).toBe("overdue");
    expect(one.hero.invoice).toMatchObject({ kind: "deposit", balance_inr: 18000 }); // oldest due first (deposit due Sep 1)
    expect(one.hero.more_open_count).toBe(2); // Sep + Oct rent
    expect(one.hero.invoice!.pay_link).toMatch(/\/pay\//);
    expect(one.hero.invoice!.instruction?.mode).toBe("upi_intent");
    expect(one.payee).toEqual({ name: "Owner", vpa: "own@okaxis", bank: null });
    expect(one.owner_wa_digits).toBe("917700000044");
    expect(JSON.stringify(one)).not.toMatch(
      /internal_note|rent_source|suggested_late_fee|reprorate_suggestion|_paise/
    );
    const two = s.residences.find((r) => r.assignment_id === a2)!;
    expect(two.hero.state).toBe("paid");
    expect(two.hero.last_receipt).not.toBeNull();
    expect(two.deposit).toMatchObject({ held_inr: 18000, uncollected_inr: 0 });
    const three = s.residences.find((r) => r.property_name === "No rent")!;
    expect(three).toMatchObject({ enabled: false, hero: { state: "not_enabled" } });
    const linked = await db.query<{ t: string | null }>(
      `SELECT tenant_user_id::text AS t FROM pg_bed_assignments WHERE id = $1::uuid`,
      [a2]
    );
    expect(linked.rows[0].t).toBeNull(); // reads never auto-link
  });

  it("awaiting beats due; history lists invoices, payments and receipts; a foreign invoice is 404", async () => {
    const p = await property("PG Claim");
    const bed = await fx.createBed(p.roomId, "A");
    const a = await fx.createAssignment(p.propertyId, bed, {
      createdBy: operatorId,
      moveIn: "2026-09-01",
      occupantPhone: "+917700000066"
    }); // phone-matched: the parent's one linked active bed is a1 (uq_pg_active_assignment_per_tenant)
    await engine.generateInvoicesForProperty(p.propertyId, "2026-09-01");
    const sep = (
      await db.query<{ id: string }>(
        `SELECT id::text FROM pg_rent_invoices WHERE assignment_id = $1::uuid AND kind = 'rent'`,
        [a]
      )
    ).rows[0].id;
    await payments.claimByTenant(parentUserId, {
      assignment_id: a,
      invoice_id: sep,
      amount_inr: 9000,
      method: "upi",
      paid_on: "2026-09-03",
      idempotency_key: randomUUID()
    });
    const s = await tenants.summary(parentUserId, "2026-09-04");
    const res = s.residences.find((r) => r.assignment_id === a)!;
    expect(res.hero.state).toBe("awaiting");
    expect(res.hero.pending_claim?.amount_inr).toBe(9000);

    const h = await tenants.history(parentUserId, a);
    expect(h.invoices.map((i) => i.kind).sort()).toEqual(["deposit", "rent"]);
    expect(h.payments).toHaveLength(1);
    const inv = await tenants.invoice(parentUserId, sep);
    expect(inv.changes.map((c) => c.event_type)).toContain("invoice.issued");
    const other = await fx.createUser("tenant");
    await expect(tenants.invoice(other, sep)).rejects.toMatchObject({
      response: { code: "invoice_not_found" }
    });
    await expect(tenants.history(other, a)).rejects.toMatchObject({
      response: { code: "forbidden" }
    });
  });

  it("identity dispute flags the assignment until the operator resolves it", async () => {
    const p = await property("PG Dispute");
    const bed = await fx.createBed(p.roomId, "A");
    const a = await fx.createAssignment(p.propertyId, bed, {
      createdBy: operatorId,
      moveIn: "2026-09-01",
      occupantPhone: "+917700000066"
    }); // phone-matched: the parent's one linked active bed is a1 (uq_pg_active_assignment_per_tenant)
    const r = await tenants.identityDispute(parentUserId, a);
    expect(r.wa_me_url).toMatch(/^https:\/\/wa\.me\/917700000044\?text=/);
    expect(
      (await tenants.summary(parentUserId)).residences.find((x) => x.assignment_id === a)!
        .identity_disputed
    ).toBe(true);
    await tenants.resolveDispute(operatorId, p.propertyId, a);
    expect(
      (await tenants.summary(parentUserId)).residences.find((x) => x.assignment_id === a)!
        .identity_disputed
    ).toBe(false);
    const flags = await db.query<{ f: string }>(
      `SELECT payload->>'flag' AS f FROM pg_rent_events WHERE entity_id = $1::uuid ORDER BY id`,
      [a]
    );
    expect(flags.rows.map((x) => x.f)).toEqual(["identity_disputed", "identity_dispute_cleared"]);
  });

  it("a leaving residence's settlement hides the owner-only suggestion and maintenance prefill from the tenant", async () => {
    const p = await property("PG Leaving", true, { prorate_move_out: true });
    const bed = await fx.createBed(p.roomId, "A");
    const a = await fx.createAssignment(p.propertyId, bed, {
      createdBy: operatorId,
      moveIn: "2026-09-01",
      occupantPhone: "+917700000066"
    }); // phone-matched: the parent's one linked active bed is a1 (uq_pg_active_assignment_per_tenant)
    await engine.generateInvoicesForProperty(p.propertyId, "2026-09-01"); // deposit + Sep rent (period 09-01..10-01)
    await db.query(
      `INSERT INTO pg_maintenance_requests
         (pg_property_id, assignment_id, created_by_user_id, category, description, chargeable_damage, resolution_cost_paise)
       VALUES ($1::uuid, $2::uuid, $3::uuid, 'damage', 'Broken window', true, 500000)`,
      [p.propertyId, a, operatorId]
    );
    // notice_end_date sits inside the already-issued Sep rent period, so the engine's
    // suggestReprorate (triggered by the notice_served event below) has an invoice to
    // suggest against. Today is 2026-09-24 IST (see env-rules); onAssignmentEvent's own
    // invoice generation runs off the real wall clock, and Sep 24 is still within the
    // already-generated Sep period, so this stays deterministic without pinning "today".
    await db.query(
      `UPDATE pg_bed_assignments SET status = 'notice_served', notice_end_date = '2026-09-20' WHERE id = $1::uuid`,
      [a]
    );
    await engine.onAssignmentEvent({
      type: "notice_served",
      propertyId: p.propertyId,
      assignmentId: a
    });

    const s = await tenants.summary(parentUserId, "2026-09-24");
    const res = s.residences.find((r) => r.assignment_id === a)!;
    expect(res.hero.state).toBe("leaving");
    expect(res.hero.settlement).not.toBeNull();
    expect(res.hero.settlement!.pending_suggestion).toBeNull();
    expect(res.hero.settlement!.maintenance_prefills).toEqual([]);
    expect(JSON.stringify(res)).not.toMatch(
      /internal_note|rent_source|suggested_late_fee|reprorate_suggestion|_paise/
    );
    // pending_suggestion/maintenance_prefills are nulled/emptied in place, not omitted, so
    // their keys are still present (with null / [] values) — assert the values above
    // instead of a key-absence regex; "reprorate" itself must not leak (e.g. inside a
    // non-nulled suggestion payload).
    expect(JSON.stringify(res)).not.toMatch(/reprorate/);
  });
});
