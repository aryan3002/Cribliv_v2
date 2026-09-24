import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";

import { AppModule } from "../../../app.module";
import { AuthGuard } from "../../../common/auth.guard";
import { DatabaseService } from "../../../common/database.service";
import type { Role } from "../../../common/types";
import { PG_RENT_RECEIPT_RENDERER } from "../services/rent-receipt.service";
import { assertRentInvariants } from "./helpers/assert-rent-invariants";
import { RentFixtures } from "./helpers/rent-fixtures";

const HAS_DB = Boolean(process.env.DATABASE_URL);

describe.skipIf(!HAS_DB)("pg-rent read controllers", () => {
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
    tenantUserId = await fx.createUser("tenant");
    const phone = (
      await db.query<{ p: string }>(`SELECT phone_e164 AS p FROM users WHERE id = $1::uuid`, [
        tenantUserId
      ])
    ).rows[0].p;
    propertyId = await fx.createProperty(operatorId, { internalCode: "RDC" });
    const listingId = await fx.createListingWithDetails(propertyId, operatorId);
    const roomTypeId = await fx.createRoomType(listingId, { rentPaise: 900000 });
    const roomId = await fx.createRoom(propertyId, { roomTypeId, roomNumber: "101" });
    const bedId = await fx.createBed(roomId, "A");
    assignmentId = await fx.createAssignment(propertyId, bedId, {
      createdBy: operatorId,
      moveIn: "2026-09-01",
      occupantPhone: phone,
      occupantName: "Rahul Verma"
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
            other: { id: randomUUID(), role: "pg_operator" }
          };
          const identity = identities[req.headers["x-test-identity"] ?? ""];
          if (!identity) return false;
          req.user = identity;
          return true;
        }
      })
      .overrideProvider(PG_RENT_RECEIPT_RENDERER)
      .useValue({ render: async () => Buffer.from("%PDF") })
      .compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix("v1");
    await app.init();
    await request(app.getHttpServer())
      .post(`/v1/pg-operator/properties/${propertyId}/rent/enable`)
      .set(as("operator"))
      .send({ billing_starts_on: "2026-09-01", upi_vpa: "sun@okaxis", upi_payee_name: "Sun" });
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

  it("operator reads: queue, summary, messages, preview, reminder-opened, pay-token, portfolio", async () => {
    const q = await request(app.getHttpServer()).get(`${base()}/queue`).set(as("operator"));
    expect(q.status).toBe(200);
    expect(q.body.data).toHaveProperty("overdue");
    expect(q.body.data).toHaveProperty("needs_attention");
    const s = await request(app.getHttpServer())
      .get(`${base()}/summary?month=2026-09-01`)
      .set(as("operator"));
    expect(s.status).toBe(200);
    expect(s.body.data.month).toBe("2026-09-01");
    const inv = (
      await request(app.getHttpServer()).get(`${base()}/invoices?kind=rent`).set(as("operator"))
    ).body.data[0];
    const m = await request(app.getHttpServer())
      .get(`${base()}/invoices/${inv.id}/messages`)
      .set(as("operator"));
    expect(m.status).toBe(200);
    expect(m.body.data.reminder.wa_me_url).toMatch(/^https:\/\/wa\.me\//);
    expect(JSON.stringify(m.body)).toMatch(/\/pay\//); // the one place the token may appear
    const pv = await request(app.getHttpServer())
      .post(`${base()}/messages/preview`)
      .set(as("operator"))
      .send({ key: "reminder", text: "{tenant_name} {nope}", invoice_id: inv.id });
    expect(pv.body.data.unknown_fields).toEqual(["nope"]);
    expect(
      (
        await request(app.getHttpServer())
          .post(`${base()}/messages/preview`)
          .set(as("operator"))
          .send({ key: "reminder", text: "x".repeat(601) })
      ).status
    ).toBe(400);
    expect(
      (
        await request(app.getHttpServer())
          .post(`${base()}/invoices/${inv.id}/reminder-opened`)
          .set(as("operator"))
          .send({ stage: "overdue", channel: "whatsapp" })
      ).status
    ).toBe(201);
    expect(
      (
        await request(app.getHttpServer())
          .post(`${base()}/invoices/${inv.id}/reminder-opened`)
          .set(as("operator"))
          .send({ stage: "later", channel: "fax" })
      ).status
    ).toBe(400);
    const tok = await request(app.getHttpServer())
      .post(`${base()}/invoices/${inv.id}/pay-token`)
      .set(as("operator"));
    expect(tok.body.data.pay_link).toMatch(/\/pay\//);
    const pf = await request(app.getHttpServer())
      .get(`/v1/pg-operator/rent/portfolio`)
      .set(as("operator"));
    expect(pf.status).toBe(200);
    expect(pf.body.data.some((r: { property_id: string }) => r.property_id === propertyId)).toBe(
      true
    );
    expect(
      (await request(app.getHttpServer()).get(`${base()}/queue`).set(as("other"))).status
    ).toBe(403);
  });

  it("tenant reads: summary, history, invoice, dispute; tenant cannot read operator routes", async () => {
    const s = await request(app.getHttpServer())
      .get(`/v1/tenant/pg-rent/summary`)
      .set(as("tenant"));
    expect(s.status).toBe(200);
    expect(s.body.data.residences).toHaveLength(1);
    const res = s.body.data.residences[0];
    expect(JSON.stringify(s.body)).not.toMatch(
      /internal_note|_paise|share_token"|rent_source|rent_snapshot|suggested_late_fee|reprorate_suggestion/
    );
    const h = await request(app.getHttpServer())
      .get(`/v1/tenant/pg-rent/history?assignment=${res.assignment_id}`)
      .set(as("tenant"));
    expect(h.status).toBe(200);
    expect(h.body.data.invoices.length).toBeGreaterThan(0);
    expect(JSON.stringify(h.body)).not.toMatch(
      /internal_note|_paise|share_token"|rent_source|rent_snapshot|suggested_late_fee|reprorate_suggestion/
    );
    expect(
      (await request(app.getHttpServer()).get(`/v1/tenant/pg-rent/history`).set(as("tenant")))
        .status
    ).toBe(400);
    const one = await request(app.getHttpServer())
      .get(`/v1/tenant/pg-rent/invoices/${h.body.data.invoices[0].id}`)
      .set(as("tenant"));
    expect(one.status).toBe(200);
    expect(one.body.data).toHaveProperty("changes");
    expect(
      (
        await request(app.getHttpServer())
          .post(`/v1/tenant/pg-rent/identity-dispute`)
          .set(as("tenant"))
          .send({ assignment_id: res.assignment_id })
      ).status
    ).toBe(201);
    expect(
      (
        await request(app.getHttpServer())
          .post(`${base()}/tenants/${res.assignment_id}/identity-dispute/resolve`)
          .set(as("operator"))
      ).status
    ).toBe(201);
    expect(
      (await request(app.getHttpServer()).get(`${base()}/queue`).set(as("tenant"))).status
    ).toBe(403);
  });

  it("public pay page and receipt share work without auth and hide everything but the minimum", async () => {
    const token = (
      await db.query<{ t: string }>(
        `SELECT pay_token AS t FROM pg_rent_invoices WHERE assignment_id = $1::uuid AND kind = 'rent' ORDER BY period_start LIMIT 1`,
        [assignmentId]
      )
    ).rows[0].t;
    const page = await request(app.getHttpServer()).get(`/v1/public/pg-rent/pay/${token}`);
    expect(page.status).toBe(200);
    expect(page.headers["cache-control"]).toContain("no-store");
    expect(page.body.data).toMatchObject({
      state: "payable",
      tenant_first_name: expect.any(String)
    });
    expect(JSON.stringify(page.body)).not.toMatch(/phone|occupant_phone|internal_note|_paise/);
    expect(
      (await request(app.getHttpServer()).get(`/v1/public/pg-rent/pay/not-a-token`)).status
    ).toBe(404);

    // receipt share: mint a receipt via a recorded payment, force it ready, then follow the redirect
    const paid = await request(app.getHttpServer())
      .post(`${base()}/payments`)
      .set(as("operator"))
      .set("idempotency-key", randomUUID())
      .send({
        assignment_id: assignmentId,
        amount_inr: 100,
        method: "cash",
        paid_on: "2026-09-02"
      });
    await db.query(
      `UPDATE pg_rent_receipts SET pdf_status = 'ready', pdf_path = 'x/y.pdf' WHERE id = $1::uuid`,
      [paid.body.data.receipt_id]
    );
    const share = (
      await db.query<{ t: string }>(
        `SELECT share_token AS t FROM pg_rent_receipts WHERE id = $1::uuid`,
        [paid.body.data.receipt_id]
      )
    ).rows[0].t;
    const rs = await request(app.getHttpServer()).get(`/v1/public/pg-rent/receipts/${share}`);
    expect(rs.status).toBe(302);
    expect(rs.headers.location).toBeTruthy();
    expect(
      (await request(app.getHttpServer()).get(`/v1/public/pg-rent/receipts/nope`)).status
    ).toBe(404);
  });

  it("everything 404s when the flag is off, including public routes", async () => {
    process.env.FF_PG_RENT_COLLECTION = "false";
    expect((await request(app.getHttpServer()).get(`/v1/public/pg-rent/pay/whatever`)).status).toBe(
      404
    );
    expect(
      (await request(app.getHttpServer()).get(`/v1/tenant/pg-rent/summary`).set(as("tenant")))
        .status
    ).toBe(404);
    process.env.FF_PG_RENT_COLLECTION = "true";
  });
});
