import "reflect-metadata";
import { INestApplication, ValidationPipe } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { Client } from "pg";
import { AppModule } from "../src/app.module";

const TEST_DB = process.env.TEST_DATABASE_URL;

function randPhone() {
  return `+9197${String(Math.floor(Math.random() * 1e8)).padStart(8, "0")}`;
}

function http(app: INestApplication) {
  return request(app.getHttpAdapter().getInstance());
}

async function loginWithOtp(app: INestApplication, phone: string) {
  const sendRes = await http(app)
    .post("/v1/auth/otp/send")
    .send({ phone_e164: phone, purpose: "login" })
    .expect(201);
  const verifyRes = await http(app)
    .post("/v1/auth/otp/verify")
    .send({
      challenge_id: sendRes.body.data.challenge_id,
      otp_code: sendRes.body.data.dev_otp,
      device_fingerprint: "admin-rescue-queue-test"
    })
    .expect(201);
  return verifyRes.body.data as { access_token: string; user: { id: string } };
}

describe.runIf(!!TEST_DB)("admin rescue queue (DB)", () => {
  let app: INestApplication;
  let db: Client;
  const phones = [randPhone(), randPhone(), randPhone(), randPhone(), randPhone()];
  const [ownerPhone, tenant1, tenant2, tenant3, adminPhone] = phones;
  let listingId: string;
  let ownerToken: string;
  let adminToken: string;
  let freeLeadId: string;
  let lockedLeadId: string;

  beforeAll(async () => {
    process.env.DATABASE_URL = TEST_DB;
    process.env.OTP_PROVIDER = "mock";
    process.env.FF_CALLBACK_LEADS = "true";
    process.env.FF_LEAD_MANAGEMENT_ENABLED = "true";
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix("v1");
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();

    db = new Client({ connectionString: TEST_DB! });
    await db.connect();

    const owner = await loginWithOtp(app, ownerPhone);
    await db.query(`UPDATE users SET role = 'owner' WHERE phone_e164 = $1`, [ownerPhone]);
    ownerToken = (await loginWithOtp(app, ownerPhone)).access_token;

    const listing = await db.query<{ id: string }>(
      `INSERT INTO listings (owner_user_id, listing_type, title_en, monthly_rent, status, contact_phone_encrypted)
       VALUES ($1::uuid, 'flat_house', 'Rescue Queue Test Flat', 12000, 'active', '+919777777778')
       RETURNING id::text`,
      [owner.user.id]
    );
    listingId = listing.rows[0].id;

    async function requestCallback(phone: string, key: string) {
      const tenant = await loginWithOtp(app, phone);
      await http(app)
        .post("/v1/tenant/contact-unlocks")
        .set("Authorization", `Bearer ${tenant.access_token}`)
        .set("Idempotency-Key", key)
        .send({ listing_id: listingId })
        .expect(201);
      // lead creation is fire-and-forget; give it a beat
      await new Promise((r) => setTimeout(r, 300));
    }

    // First 2 tenants land free leads (first-2-free-per-owner); the 3rd
    // lands a locked lead.
    await requestCallback(tenant1, "arq-1");
    await requestCallback(tenant2, "arq-2");
    await requestCallback(tenant3, "arq-3");

    const leadsResult = await db.query<{ id: string; access_state: string }>(
      `SELECT id::text, access_state FROM leads WHERE listing_id = $1 ORDER BY created_at ASC`,
      [listingId]
    );
    const rows = leadsResult.rows;
    freeLeadId = rows[0].id;
    lockedLeadId = rows[2].id;

    await loginWithOtp(app, adminPhone);
    await db.query(`UPDATE users SET role = 'admin' WHERE phone_e164 = $1`, [adminPhone]);
    adminToken = (await loginWithOtp(app, adminPhone)).access_token;
  }, 60_000);

  afterAll(async () => {
    await db.query(
      `DELETE FROM contact_events WHERE contact_unlock_id IN
         (SELECT id FROM contact_unlocks WHERE listing_id = $1::uuid)`,
      [listingId]
    );
    await db.query(
      `DELETE FROM lead_events WHERE lead_id IN (SELECT id FROM leads WHERE listing_id = $1::uuid)`,
      [listingId]
    );
    await db.query(`DELETE FROM leads WHERE listing_id = $1::uuid`, [listingId]);
    await db.query(`DELETE FROM contact_unlocks WHERE listing_id = $1::uuid`, [listingId]);
    await db.query(
      `DELETE FROM wallet_transactions WHERE wallet_user_id IN
         (SELECT id FROM users WHERE phone_e164 = ANY($1))`,
      [phones]
    );
    await db.query(
      `DELETE FROM wallets WHERE user_id IN (SELECT id FROM users WHERE phone_e164 = ANY($1))`,
      [phones]
    );
    await db.query(`DELETE FROM listings WHERE id = $1::uuid`, [listingId]);
    await db.query(
      `DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE phone_e164 = ANY($1))`,
      [phones]
    );
    await db.query(`DELETE FROM otp_challenges WHERE phone_e164 = ANY($1)`, [phones]);
    await db.query(`DELETE FROM users WHERE phone_e164 = ANY($1)`, [phones]);
    await db.end();
    await app.close();
    delete process.env.DATABASE_URL;
    delete process.env.FF_CALLBACK_LEADS;
    delete process.env.FF_LEAD_MANAGEMENT_ENABLED;
  }, 60_000);

  it("lists uncalled leads inside the 6h window, with full contact info", async () => {
    // Push the locked lead into the rescue window:
    await db.query(
      `UPDATE leads SET call_deadline_at = now() + interval '5 hours' WHERE id = $1::uuid`,
      [lockedLeadId]
    );
    // Keep a free lead outside the window:
    await db.query(
      `UPDATE leads SET call_deadline_at = now() + interval '20 hours' WHERE id = $1::uuid`,
      [freeLeadId]
    );

    const res = await http(app)
      .get("/v1/admin/leads/rescue-queue")
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(200);
    const ids = res.body.data.items.map((i: { lead_id: string }) => i.lead_id);
    expect(ids).toContain(lockedLeadId);
    expect(ids).not.toContain(freeLeadId);
    const item = res.body.data.items.find((i: { lead_id: string }) => i.lead_id === lockedLeadId);
    expect(item.tenant_phone).toMatch(/^\+91/);
    expect(item.owner_phone).toMatch(/^\+91/);
  });

  it("team-called claims the call and stops the refund clock", async () => {
    const res = await http(app)
      .post(`/v1/admin/leads/${lockedLeadId}/team-called`)
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(201);
    expect(res.body.data.called_by).toBe("team");

    const lead = await db.query(
      `SELECT called_by, contact_unlock_id FROM leads WHERE id = $1::uuid`,
      [lockedLeadId]
    );
    expect(lead.rows[0].called_by).toBe("team");
    const unlock = await db.query(
      `SELECT owner_response_status FROM contact_unlocks WHERE id = $1::uuid`,
      [lead.rows[0].contact_unlock_id]
    );
    expect(unlock.rows[0].owner_response_status).toBe("responded");

    // second team-called on the same lead → 409
    await http(app)
      .post(`/v1/admin/leads/${lockedLeadId}/team-called`)
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(409);
  });

  it("403s non-admin users", async () => {
    await http(app)
      .get("/v1/admin/leads/rescue-queue")
      .set("Authorization", `Bearer ${ownerToken}`)
      .expect(403);
  });
});
