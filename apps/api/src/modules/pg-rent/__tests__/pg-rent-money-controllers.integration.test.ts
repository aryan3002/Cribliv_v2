import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";

import { AppModule } from "../../../app.module";
import { AuthGuard } from "../../../common/auth.guard";
import { DatabaseService } from "../../../common/database.service";
import type { Role } from "../../../common/types";
import { paiseToInr } from "../dto/money";
import { RentAllocationService } from "../services/rent-allocation.service";
import { assertRentInvariants } from "./helpers/assert-rent-invariants";
import { RentFixtures } from "./helpers/rent-fixtures";

const HAS_DB = Boolean(process.env.DATABASE_URL);

describe.skipIf(!HAS_DB)("pg-rent money controllers", () => {
  let app: INestApplication;
  let db: DatabaseService;
  let fx: RentFixtures;
  let operatorId: string;
  let tenantUserId: string;
  let propertyId: string;
  let assignmentId: string;
  let leavingAssignmentId: string; // For settlement/deposit-release test
  const alloc = new RentAllocationService();
  const prevFlag = process.env.FF_PG_RENT_COLLECTION;

  const as = (identity: string) => ({ "x-test-identity": identity });

  beforeAll(async () => {
    process.env.FF_PG_RENT_COLLECTION = "true";
    db = new DatabaseService();
    fx = new RentFixtures(db, randomUUID().replace(/-/g, ""));
    await fx.setup();
    operatorId = await fx.createUser("pg_operator");
    tenantUserId = await fx.createUser("tenant", "+917700000055");
    propertyId = await fx.createProperty(operatorId, { internalCode: "SUN" });
    const listingId = await fx.createListingWithDetails(propertyId, operatorId, { rentDueDay: 5 });
    const roomTypeId = await fx.createRoomType(listingId, {
      rentPaise: 900000, // ₹9000
      depositPaise: 1800000 // ₹18000
    });
    const roomId = await fx.createRoom(propertyId, { roomTypeId, roomNumber: "101" });
    const bedId = await fx.createBed(roomId, "A");
    assignmentId = await fx.createAssignment(propertyId, bedId, {
      createdBy: operatorId,
      moveIn: "2026-09-01",
      occupantPhone: "+917700000055",
      occupantName: "Rahul"
    });

    // Create a second bed/assignment for the settlement test (will move out and settle)
    const bed2Id = await fx.createBed(roomId, "B");
    leavingAssignmentId = await fx.createAssignment(propertyId, bed2Id, {
      createdBy: operatorId,
      moveIn: "2026-09-01",
      occupantPhone: "+919999999910",
      occupantName: "Priya"
    });

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideGuard(AuthGuard)
      .useValue({
        canActivate: (ctx: {
          switchToHttp: () => {
            getRequest: () => { headers: Record<string, string | undefined>; user?: unknown };
          };
        }) => {
          const req = ctx.switchToHttp().getRequest();
          const identities: Record<string, { id: string; role: Role }> = {
            operator: { id: operatorId, role: "pg_operator" },
            tenant: { id: tenantUserId, role: "tenant" },
            stranger: { id: randomUUID(), role: "tenant" },
            other: { id: randomUUID(), role: "pg_operator" }
          };
          const identity = identities[req.headers["x-test-identity"] ?? ""];
          if (!identity) return false;
          req.user = identity;
          return true;
        }
      })
      .compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix("v1");
    await app.init();

    // Enable rent collection
    await request(app.getHttpServer())
      .post(`/v1/pg-operator/properties/${propertyId}/rent/enable`)
      .set(as("operator"))
      .send({ billing_starts_on: "2026-09-01", upi_vpa: "sun@okaxis", upi_payee_name: "Sun" });

    // Generate invoices
    await request(app.getHttpServer())
      .post(`/v1/pg-operator/properties/${propertyId}/rent/generate-now`)
      .set(as("operator"))
      .send({});
  }, 30_000);

  afterAll(async () => {
    if (prevFlag === undefined) delete process.env.FF_PG_RENT_COLLECTION;
    else process.env.FF_PG_RENT_COLLECTION = prevFlag;
    if (app) await app.close();
    for (const id of fx.propertyIds) await assertRentInvariants(db, id);
    await fx.teardown();
    await db.onModuleDestroy();
  });

  const base = () => `/v1/pg-operator/properties/${propertyId}/rent`;

  it("records, lists, confirms a tenant claim, rejects, reverses, refunds — all in rupees, with idempotency", async () => {
    const key = randomUUID();
    const rec = () =>
      request(app.getHttpServer())
        .post(`${base()}/payments`)
        .set(as("operator"))
        .set("idempotency-key", key)
        .send({
          assignment_id: assignmentId,
          amount_inr: 18000,
          method: "cash",
          paid_on: "2026-09-02"
        });
    const first = await rec();
    expect(first.status).toBe(201);
    const second = await rec();
    expect(second.body.data.id).toBe(first.body.data.id);
    expect(JSON.stringify(first.body)).not.toMatch(/_paise|pay_token|share_token/);
    expect(
      (
        await request(app.getHttpServer()).post(`${base()}/payments`).set(as("operator")).send({
          assignment_id: assignmentId,
          amount_inr: 1,
          method: "cash",
          paid_on: "2026-09-02"
        })
      ).status
    ).toBe(400); // missing header

    const claim = await request(app.getHttpServer())
      .post(`/v1/tenant/pg-rent/claims`)
      .set(as("tenant"))
      .send({
        assignment_id: assignmentId,
        amount_inr: 9000,
        method: "upi",
        paid_on: "2026-09-03",
        idempotency_key: randomUUID()
      });
    expect(claim.status).toBe(201);
    expect(claim.body.data.status).toBe("pending_confirmation");
    const list = await request(app.getHttpServer())
      .get(`${base()}/payments?status=pending_confirmation`)
      .set(as("operator"));
    expect(list.body.data.map((p: { id: string }) => p.id)).toContain(claim.body.data.id);
    const confirmed = await request(app.getHttpServer())
      .post(`${base()}/payments/${claim.body.data.id}/confirm`)
      .set(as("operator"))
      .send({ amount_inr: 8500 });
    expect(confirmed.status).toBe(201);
    expect(confirmed.body.data).toMatchObject({ status: "confirmed", amount_inr: 8500 });
    expect(
      (
        await request(app.getHttpServer())
          .post(`${base()}/payments/${claim.body.data.id}/reject`)
          .set(as("operator"))
          .send({ reason: "late" })
      ).status
    ).toBe(409);
    expect(
      (
        await request(app.getHttpServer())
          .post(`${base()}/payments/${claim.body.data.id}/reject`)
          .set(as("operator"))
          .send({})
      ).status
    ).toBe(400);

    const reversed = await request(app.getHttpServer())
      .post(`${base()}/payments/${first.body.data.id}/reverse`)
      .set(as("operator"))
      .send({ reason: "wrong tenant" });
    expect(reversed.body.data.status).toBe("reversed");

    // Refund exceeding available credit should fail with refund_exceeds_credit.
    // The reversal above does not necessarily zero the assignment's unallocated
    // credit (it only removes `first`'s own contribution), so read the real
    // figure — the same query fundOutflow itself sums — rather than assuming
    // a hardcoded amount exceeds it.
    const creditPaise = await alloc.unallocatedCredit(db, assignmentId);
    const refundBad = await request(app.getHttpServer())
      .post(`${base()}/refunds`)
      .set(as("operator"))
      .set("idempotency-key", randomUUID())
      .send({
        assignment_id: assignmentId,
        amount_inr: paiseToInr(creditPaise) + 100,
        method: "cash",
        paid_on: "2026-09-05",
        reason: "x"
      });
    expect(refundBad.status).toBe(400);
    expect(refundBad.body.error?.code ?? refundBad.body.code).toBe("refund_exceeds_credit");

    expect(
      (await request(app.getHttpServer()).get(`${base()}/payments`).set(as("other"))).status
    ).toBe(403);
    await assertRentInvariants(db, propertyId);
  }, 60000);

  it("invoice actions and settlement routes are wired", async () => {
    const inv = (
      await request(app.getHttpServer()).get(`${base()}/invoices?kind=rent`).set(as("operator"))
    ).body.data[0];
    const added = await request(app.getHttpServer())
      .post(`${base()}/invoices/${inv.id}/lines`)
      .set(as("operator"))
      .send({ kind: "electricity", label: "Electricity", amount_inr: 896 });
    expect(added.status).toBe(201);
    expect(added.body.data.total_inr).toBe(inv.total_inr + 896);
    const lineId = added.body.data.lines.find((l: { kind: string }) => l.kind === "electricity").id;
    expect(
      (
        await request(app.getHttpServer())
          .delete(`${base()}/invoices/${inv.id}/lines/${lineId}`)
          .set(as("operator"))
      ).status
    ).toBe(200);
    expect(
      (
        await request(app.getHttpServer())
          .post(`${base()}/invoices/${inv.id}/extend-due`)
          .set(as("operator"))
          .send({ due_date: "2099-01-01" })
      ).body.data.due_date
    ).toBe("2099-01-01");
    expect(
      (
        await request(app.getHttpServer())
          .post(`${base()}/invoices/${inv.id}/late-fee/apply`)
          .set(as("operator"))
          .send({ amount_inr: 300 })
      ).body.data.total_inr
    ).toBe(inv.total_inr + 300);
    expect(
      (
        await request(app.getHttpServer())
          .post(`${base()}/late-fees/waive-all`)
          .set(as("operator"))
          .send({ reason: "ok" })
      ).body.data
    ).toEqual({ waived: 1 });
    const manual = await request(app.getHttpServer())
      .post(`${base()}/invoices`)
      .set(as("operator"))
      .set("idempotency-key", randomUUID())
      .send({
        source: "manual",
        assignment_id: assignmentId,
        kind: "adhoc",
        due_date: "2026-09-20",
        lines: [{ kind: "other", label: "Key", amount_inr: 200 }]
      });
    expect(manual.status).toBe(201);
    expect(manual.body.data.kind).toBe("adhoc");
    const st = await request(app.getHttpServer())
      .get(`${base()}/tenants/${assignmentId}/settlement`)
      .set(as("operator"));
    expect(st.status).toBe(200);
    expect(st.body.data.status).toBe("not_leaving");
    expect(
      (
        await request(app.getHttpServer())
          .post(`${base()}/tenants/${assignmentId}/settle`)
          .set(as("operator"))
          .set("idempotency-key", randomUUID())
          .send({ deductions: [] })
      ).status
    ).toBe(409);
    await assertRentInvariants(db, propertyId);
  });

  it("backfill payment and deposit release create no pg_rent_receipts row", async () => {
    // Test backfill payment: create a backfill invoice with payment
    const backfill = await request(app.getHttpServer())
      .post(`${base()}/invoices`)
      .set(as("operator"))
      .set("idempotency-key", randomUUID())
      .send({
        source: "backfill",
        assignment_id: assignmentId,
        kind: "rent",
        period_start: "2026-08-01",
        period_end: "2026-08-31",
        due_date: "2026-09-10",
        lines: [{ kind: "rent", label: "August Rent", amount_inr: 9000 }],
        payment: {
          amount_inr: 9000,
          method: "cash",
          paid_on: "2026-09-05",
          reference: "backfill payment"
        }
      });
    expect(backfill.status).toBe(201);

    // Assert no pg_rent_receipts for the backfill payment specifically — not just
    // "none created on this assignment in the last minute", which would also count
    // (and be satisfied by) the legitimate operator/tenant-claim receipts minted
    // earlier in this file's first test. Scope to the backfill payment's own id,
    // found via its distinguishing (claimed_invoice_id, source) pair.
    const backfillPayment = await db.query<{ id: string }>(
      `SELECT id::text FROM pg_rent_payments WHERE claimed_invoice_id = $1::uuid AND source = 'backfill'`,
      [backfill.body.data.id]
    );
    expect(backfillPayment.rows.length).toBe(1);
    const backfillReceiptCount = await db.query<{ count: string }>(
      `SELECT COUNT(*) as count FROM pg_rent_receipts WHERE payment_id = $1::uuid`,
      [backfillPayment.rows[0].id]
    );
    expect(Number(backfillReceiptCount.rows[0]?.count ?? 0)).toBe(0);

    // Test deposit release: move-out settlement with deposit refund.
    // settle() only calls releaseDeposit() when depositHeld > 0
    // (rent-settlement.service.ts:406) — leavingAssignmentId was never issued a
    // deposit invoice by the engine (its move-in of 2026-09-01 predates
    // pg_rent_settings.enabled_on, which planDeposit requires; see
    // rent-settlement.integration.test.ts's `leavingTenant()` fixture for the same
    // constraint), so a paid deposit has to be backfilled here or settle() would
    // take the applyUnallocatedCredit branch instead and never exercise the
    // deposit-release path this test is about.
    const depositBackfill = await request(app.getHttpServer())
      .post(`${base()}/invoices`)
      .set(as("operator"))
      .set("idempotency-key", randomUUID())
      .send({
        source: "backfill",
        assignment_id: leavingAssignmentId,
        kind: "deposit",
        due_date: "2026-09-01",
        lines: [{ kind: "deposit", label: "Security Deposit", amount_inr: 18000 }],
        payment: {
          amount_inr: 18000,
          method: "cash",
          paid_on: "2026-09-01",
          reference: "deposit backfill"
        }
      });
    expect(depositBackfill.status).toBe(201);

    // Now mark the leaving assignment as moved out
    await db.query(
      `UPDATE pg_bed_assignments SET status = 'moved_out', move_out_date = $1::date WHERE id = $2::uuid`,
      ["2026-09-15", leavingAssignmentId]
    );

    // Get settlement statement
    const settleBase = `/v1/pg-operator/properties/${propertyId}/rent/tenants/${leavingAssignmentId}`;
    const settlement = await request(app.getHttpServer())
      .get(`${settleBase}/settlement`)
      .set(as("operator"));
    expect(settlement.status).toBe(200);
    // "can_settle" is not a member of PgRentSettlementStatus
    // ("not_leaving" | "leaving" | "settled" | "nothing_to_settle",
    // packages/shared-types/src/pg-rent.ts:454) — a moved-out, not-yet-settled
    // assignment reports "leaving" (rent-settlement.service.ts:147).
    expect(settlement.body.data.status).toBe("leaving");

    // Execute settlement (should release deposit)
    const settled = await request(app.getHttpServer())
      .post(`${settleBase}/settle`)
      .set(as("operator"))
      .set("idempotency-key", randomUUID())
      .send({ deductions: [], return_now: null });
    expect(settled.status).toBe(201);

    // Assert no pg_rent_receipts for the deposit-release payment specifically, scoped
    // to its own id (same rationale as the backfill assertion above). Deposit-release
    // payments carry no claimed_invoice_id, so source alone identifies it on this
    // (single-use) assignment.
    const releasePayment = await db.query<{ id: string }>(
      `SELECT id::text FROM pg_rent_payments WHERE assignment_id = $1::uuid AND source = 'deposit_release'`,
      [leavingAssignmentId]
    );
    expect(releasePayment.rows.length).toBe(1);
    const releaseReceiptCount = await db.query<{ count: string }>(
      `SELECT COUNT(*) as count FROM pg_rent_receipts WHERE payment_id = $1::uuid`,
      [releasePayment.rows[0].id]
    );
    expect(Number(releaseReceiptCount.rows[0]?.count ?? 0)).toBe(0);
    await assertRentInvariants(db, propertyId);
  });

  it("tenant routes are scoped to the tenant's own assignments", async () => {
    const stranger = await fx.createUser("tenant");
    const res = await request(app.getHttpServer())
      .post(`/v1/tenant/pg-rent/claims`)
      .set(as("stranger"))
      .send({
        assignment_id: assignmentId,
        amount_inr: 10,
        method: "upi",
        paid_on: "2026-09-03",
        idempotency_key: randomUUID()
      });
    expect(res.status).toBe(403);
    expect(stranger).toBeTruthy();
  });
});
