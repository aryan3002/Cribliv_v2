import { resolve } from "node:path";

import { config } from "dotenv";
import { Test } from "@nestjs/testing";
import { ValidationPipe, type INestApplication } from "@nestjs/common";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";

// Load the repo-root .env so DATABASE_URL is present — DatabaseService.isEnabled()
// gates purely on that, so the module boots with the DB-backed repositories +
// RentAgreementDbAnalyticsService.
config({ path: resolve(__dirname, "../../../../../../../.env") });

const HAS_DB = Boolean(process.env.DATABASE_URL);

const VALID_STEP1 = {
  owner: {
    full_name: "Analytics Owner",
    father_name: "Owner Senior",
    age: 40,
    phone: "+919876500011",
    permanent_address: "12 MG Road, Bangalore"
  },
  tenant: {
    full_name: "Analytics Tenant",
    father_name: "Tenant Senior",
    age: 30,
    phone: "+919876500012",
    permanent_address: "34 Park Street, Mumbai"
  }
};

async function poll<T>(fn: () => Promise<T>, ok: (v: T) => boolean, tries = 20): Promise<T> {
  let last = await fn();
  for (let i = 0; i < tries && !ok(last); i++) {
    await new Promise((r) => setTimeout(r, 100));
    last = await fn();
  }
  return last;
}

describe.skipIf(!HAS_DB)("rent-agreement analytics (integration)", () => {
  let app: INestApplication;
  let userId: string;
  let draftId: string;
  const TEST_PHONE = "+919000000091";

  beforeAll(async () => {
    process.env.RENT_AGREEMENT_IP_SALT = process.env.RENT_AGREEMENT_IP_SALT ?? "analytics-salt";
    process.env.RENT_AGREEMENT_PAN_KEY =
      process.env.RENT_AGREEMENT_PAN_KEY ?? Buffer.alloc(32, 9).toString("base64");
    process.env.FF_RENT_AGREEMENT_ADMIN_ENABLED = "true";

    const { DatabaseService } = await import("../../../../common/database.service");
    const seedDb = new DatabaseService();
    const user = await seedDb.query<{ id: string }>(
      `INSERT INTO users (phone_e164, role, preferred_language)
       VALUES ($1, 'admin', 'en')
       ON CONFLICT (phone_e164) DO UPDATE SET role = 'admin'
       RETURNING id::text`,
      [TEST_PHONE]
    );
    userId = user.rows[0].id;
    await seedDb.onModuleDestroy();

    const { RentAgreementModule } = await import("../../rent-agreement.module");
    const { AdminModule } = await import("../../../admin/admin.module");
    const { AuthGuard } = await import("../../../../common/auth.guard");
    const { RolesGuard } = await import("../../../../common/roles.guard");

    const moduleRef = await Test.createTestingModule({
      imports: [RentAgreementModule, AdminModule]
    })
      .overrideGuard(AuthGuard)
      .useValue({
        canActivate: (ctx: { switchToHttp: () => { getRequest: () => { user: unknown } } }) => {
          ctx.switchToHttp().getRequest().user = { id: userId, role: "admin" };
          return true;
        }
      })
      .overrideGuard(RolesGuard)
      .useValue({ canActivate: () => true })
      .compile();

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    app.setGlobalPrefix("v1");
    await app.init();
  }, 30_000);

  afterAll(async () => {
    if (app) {
      const { DatabaseService } = await import("../../../../common/database.service");
      const cleanupDb = new DatabaseService();
      if (userId) {
        await cleanupDb.query(`DELETE FROM rent_agreement_event_log WHERE user_id = $1`, [userId]);
        await cleanupDb.query(`DELETE FROM rent_agreements WHERE user_id = $1`, [userId]);
        await cleanupDb.query(`DELETE FROM users WHERE id = $1`, [userId]);
      }
      await cleanupDb.onModuleDestroy();
      await app.close();
    }
  }, 20_000);

  it("GET /rent-agreement/my writes a ra.session_started event row", async () => {
    await request(app.getHttpServer()).get("/v1/rent-agreement/my").expect(200);

    const { DatabaseService } = await import("../../../../common/database.service");
    const db = new DatabaseService();
    const rows = await poll(
      () =>
        db.query<{ n: number }>(
          `SELECT count(*)::int AS n FROM rent_agreement_event_log
           WHERE user_id = $1 AND event_name = 'ra.session_started'`,
          [userId]
        ),
      (r) => Number(r.rows[0]?.n ?? 0) > 0
    );
    await db.onModuleDestroy();
    expect(Number(rows.rows[0].n)).toBeGreaterThan(0);
  });

  it("advancing a draft writes 'advanced' and 'blocked' step-audit rows", async () => {
    const created = await request(app.getHttpServer())
      .post("/v1/rent-agreement/draft")
      .set("idempotency-key", "analytics-draft-1")
      .send({ plan_id: "basic", locale: "en" })
      .expect(201);
    draftId = created.body.data.id as string;

    // Valid advance on step 1 -> 'advanced' audit row.
    await request(app.getHttpServer())
      .post(`/v1/rent-agreement/${draftId}/step/1/advance`)
      .send(VALID_STEP1)
      .expect(201);

    // Invalid advance on step 2 -> 'blocked' audit row (validation failure).
    await request(app.getHttpServer())
      .post(`/v1/rent-agreement/${draftId}/step/2/advance`)
      .send({ full_address: "" })
      .expect((res) => {
        if (res.status < 400) throw new Error(`expected a 4xx, got ${res.status}`);
      });

    const { DatabaseService } = await import("../../../../common/database.service");
    const db = new DatabaseService();
    const rows = await poll(
      () =>
        db.query<{ outcome: string }>(
          `SELECT outcome FROM rent_agreement_step_audit WHERE agreement_id = $1`,
          [draftId]
        ),
      (r) => {
        const outcomes = r.rows.map((x) => x.outcome);
        return outcomes.includes("advanced") && outcomes.includes("blocked");
      }
    );
    await db.onModuleDestroy();
    const outcomes = rows.rows.map((r) => r.outcome);
    expect(outcomes).toContain("advanced");
    expect(outcomes).toContain("blocked");
  });

  it("GET /admin/rent-agreements/summary reflects the created draft", async () => {
    const res = await request(app.getHttpServer())
      .get("/v1/admin/rent-agreements/summary")
      .expect(200);
    expect(res.body.data).not.toBeNull();
    expect(res.body.data.drafts_started).toBeGreaterThan(0);
  });

  it("GET /admin/rent-agreements/funnel reports step 1 activity", async () => {
    const res = await request(app.getHttpServer())
      .get("/v1/admin/rent-agreements/funnel")
      .expect(200);
    expect(res.body.data).toHaveLength(7);
    const step1 = res.body.data[0];
    expect(step1.label).toBe("Step 1: Parties");
    expect(step1.agreements_reached).toBeGreaterThan(0);
  });
});
