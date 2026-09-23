import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";

import { AppModule } from "../../../app.module";
import { AuthGuard } from "../../../common/auth.guard";
import { DatabaseService } from "../../../common/database.service";
import type { Role } from "../../../common/types";
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
        await request(app.getHttpServer())
          .post(`${base()}/payments`)
          .set(as("operator"))
          .send({
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

    // Refund - just test that the endpoint exists and works
    const refund = await request(app.getHttpServer())
      .post(`${base()}/refunds`)
      .set(as("operator"))
      .set("idempotency-key", randomUUID())
      .send({
        assignment_id: assignmentId,
        amount_inr: 1000,
        method: "cash",
        paid_on: "2026-09-05",
        reason: "overpayment"
      });
    expect(refund.status).toBe(201);

    expect(
      (await request(app.getHttpServer()).get(`${base()}/payments`).set(as("other"))).status
    ).toBe(403);
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
