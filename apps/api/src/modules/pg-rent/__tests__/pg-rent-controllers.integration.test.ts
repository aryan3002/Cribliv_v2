import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";

import { AppModule } from "../../../app.module";
import { AuthGuard } from "../../../common/auth.guard";
import { DatabaseService } from "../../../common/database.service";
import type { Role } from "../../../common/types";
import { assertRentInvariants } from "./helpers/assert-rent-invariants";
import { RentFixtures } from "./helpers/rent-fixtures";

const HAS_DB = Boolean(process.env.DATABASE_URL);

describe.skipIf(!HAS_DB)("pg-rent controllers", () => {
  let app: INestApplication;
  let db: DatabaseService;
  let fx: RentFixtures;
  let operatorId: string;
  let otherOperatorId: string;
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
    otherOperatorId = await fx.createUser("pg_operator");
    propertyId = await fx.createProperty(operatorId, { internalCode: "SUN" });
    const listingId = await fx.createListingWithDetails(propertyId, operatorId, { rentDueDay: 5 });
    const roomTypeId = await fx.createRoomType(listingId, { rentPaise: 900000 });
    const roomId = await fx.createRoom(propertyId, { roomTypeId, roomNumber: "101" });
    const bedId = await fx.createBed(roomId, "A");
    assignmentId = await fx.createAssignment(propertyId, bedId, {
      createdBy: operatorId,
      moveIn: "2026-08-12",
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
            other: { id: otherOperatorId, role: "pg_operator" }
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

  it("previews before enabling, then enables and generates in one call", async () => {
    const preview = await request(app.getHttpServer())
      .get(`${base()}/enable/preview?billing_starts_on=2026-09-17`)
      .set(as("operator"));
    expect(preview.status).toBe(200);
    expect(preview.body.data.tenants[0]).toMatchObject({
      occupant_name: "Rahul",
      first_period: { period_start: "2026-10-01", due_date: "2026-10-05", amount_inr: 9000 }
    });
    expect(JSON.stringify(preview.body)).not.toMatch(/_paise/);

    const enabled = await request(app.getHttpServer())
      .post(`${base()}/enable`)
      .set(as("operator"))
      .send({ billing_starts_on: "2026-09-01", upi_vpa: "sun@okaxis", upi_payee_name: "Sun" });
    expect(enabled.status).toBe(201);
    expect(enabled.body.data.settings).toMatchObject({
      receipt_prefix: "SUN",
      due_day: 5,
      billing_starts_on: "2026-09-01"
    });
    expect(enabled.body.data.generated.invoices_created).toBeGreaterThanOrEqual(1);
  });

  it("preview falls back to the stored billing_starts_on as a plain ISO date", async () => {
    const preview = await request(app.getHttpServer())
      .get(`${base()}/enable/preview`)
      .set(as("operator"));
    expect(preview.status).toBe(200);
    expect(preview.body.data.billing_starts_on).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(preview.body.data.billing_starts_on).toBe("2026-09-01");
  });

  it("lists and reads invoices in rupees with lines; 403 for another operator; 404 for a foreign id", async () => {
    const list = await request(app.getHttpServer())
      .get(`${base()}/invoices?kind=rent`)
      .set(as("operator"));
    expect(list.status).toBe(200);
    expect(list.body.data.length).toBeGreaterThanOrEqual(1);
    const inv = list.body.data[0];
    expect(inv).toMatchObject({
      occupant_name: "Rahul",
      room_number: "101",
      bed_label: "A",
      total_inr: 9000,
      balance_inr: 9000,
      status: "issued"
    });
    expect(inv.lines[0]).toMatchObject({ kind: "rent", amount_inr: 9000 });
    expect(JSON.stringify(list.body)).not.toMatch(/_paise|pay_token"/);

    const one = await request(app.getHttpServer())
      .get(`${base()}/invoices/${inv.id}`)
      .set(as("operator"));
    expect(one.status).toBe(200);
    expect(one.body.data.invoice_number).toMatch(/^SUN-INV-\d{4}$/);

    const ev = await request(app.getHttpServer())
      .get(`${base()}/invoices/${inv.id}/events`)
      .set(as("operator"));
    expect(ev.body.data.map((e: { event_type: string }) => e.event_type)).toContain(
      "invoice.issued"
    );
    expect(JSON.stringify(ev.body)).not.toMatch(/_paise/);
    expect(JSON.stringify(ev.body)).toMatch(/total_inr/);

    expect(
      (await request(app.getHttpServer()).get(`${base()}/invoices`).set(as("other"))).status
    ).toBe(403);
    expect(
      (
        await request(app.getHttpServer())
          .get(`${base()}/invoices/${randomUUID()}`)
          .set(as("operator"))
      ).status
    ).toBe(404);
  });

  it("patches settings with the token, pauses, previews resume, resumes", async () => {
    const current = (
      await request(app.getHttpServer()).get(`${base()}/settings`).set(as("operator"))
    ).body.data;
    const patched = await request(app.getHttpServer())
      .patch(`${base()}/settings`)
      .set(as("operator"))
      .send({ updated_at: current.updated_at, due_day: 10 });
    expect(patched.status).toBe(200);
    expect(patched.body.data.due_day).toBe(10);
    const stale = await request(app.getHttpServer())
      .patch(`${base()}/settings`)
      .set(as("operator"))
      .send({ updated_at: current.updated_at, due_day: 11 });
    expect(stale.status).toBe(409);
    const bad = await request(app.getHttpServer())
      .patch(`${base()}/settings`)
      .set(as("operator"))
      .send({ updated_at: patched.body.data.updated_at, due_day: 40 });
    expect(bad.status).toBe(400);

    expect(
      (await request(app.getHttpServer()).post(`${base()}/pause`).set(as("operator"))).body.data
        .pause_reason
    ).toBe("owner");
    const rp = await request(app.getHttpServer())
      .get(`${base()}/resume/preview?billing_starts_on=2026-11-10`)
      .set(as("operator"));
    expect(rp.status).toBe(200);
    expect(rp.body.data.billing_starts_on).toBe("2026-11-10");
    const resumed = await request(app.getHttpServer())
      .post(`${base()}/resume`)
      .set(as("operator"))
      .send({ billing_starts_on: "2026-11-10" });
    expect(resumed.status).toBe(201);
    expect(resumed.body.data.settings.paused_at).toBeNull();
  });

  it("generate-now is rate-limited per property", async () => {
    const first = await request(app.getHttpServer())
      .post(`${base()}/generate-now`)
      .set(as("operator"));
    expect(first.status).toBe(201);
    const second = await request(app.getHttpServer())
      .post(`${base()}/generate-now`)
      .set(as("operator"));
    expect(second.status).toBe(429);
  });

  it("updates tenant overrides, including move-in date only while null, and rent from next cycle", async () => {
    const res = await request(app.getHttpServer())
      .patch(`${base()}/tenants/${assignmentId}`)
      .set(as("operator"))
      .send({
        rent_due_day: 3,
        late_fee_exempt: true,
        default_item_excludes: ["wifi"],
        monthly_rent_inr: 9500
      });
    expect(res.status).toBe(200);
    const row = (
      await db.query(
        `SELECT rent_due_day, late_fee_exempt, default_item_overrides, monthly_rent_paise::text FROM pg_bed_assignments WHERE id = $1::uuid`,
        [assignmentId]
      )
    ).rows[0];
    expect(row).toEqual({
      rent_due_day: 3,
      late_fee_exempt: true,
      default_item_overrides: { exclude: ["wifi"] },
      monthly_rent_paise: "950000"
    });

    const conflict = await request(app.getHttpServer())
      .patch(`${base()}/tenants/${assignmentId}`)
      .set(as("operator"))
      .send({ move_in_date: "2026-08-01" });
    expect(conflict.status).toBe(409);
    const events = await db.query<{ event_type: string }>(
      `SELECT event_type FROM pg_rent_events WHERE entity_id = $1::uuid ORDER BY id`,
      [assignmentId]
    );
    expect(events.rows.map((e) => e.event_type)).toEqual([
      "rent.changed",
      "assignment.override_updated"
    ]);
  });

  it("404s every route when the flag is off", async () => {
    process.env.FF_PG_RENT_COLLECTION = "false";
    const res = await request(app.getHttpServer()).get(`${base()}/settings`).set(as("operator"));
    expect(res.status).toBe(404);
    process.env.FF_PG_RENT_COLLECTION = "true";
  });
});
