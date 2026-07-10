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
      device_fingerprint: "lead-call-click-test"
    })
    .expect(201);
  return verifyRes.body.data as { access_token: string; user: { id: string } };
}

describe.runIf(!!TEST_DB)("lead call-click (DB)", () => {
  let app: INestApplication;
  let db: Client;
  const phones = [randPhone(), randPhone(), randPhone(), randPhone()];
  const [ownerPhone, tenant1, tenant2, tenant3] = phones;
  let listingId: string;
  let ownerToken: string;
  let freeLeadId: string;
  let secondFreeLeadId: string;
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
       VALUES ($1::uuid, 'flat_house', 'Call Click Test Flat', 12000, 'active', '+919777777779')
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
    await requestCallback(tenant1, "lcc-1");
    await requestCallback(tenant2, "lcc-2");
    await requestCallback(tenant3, "lcc-3");

    const leadsResult = await db.query<{ id: string; access_state: string }>(
      `SELECT id::text, access_state FROM leads WHERE listing_id = $1 ORDER BY created_at ASC`,
      [listingId]
    );
    const rows = leadsResult.rows;
    freeLeadId = rows[0].id;
    secondFreeLeadId = rows[1].id;
    lockedLeadId = rows[2].id;
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

  it("records called_at and marks the linked unlock responded", async () => {
    const res = await http(app)
      .post(`/v1/owner/leads/${freeLeadId}/call-click`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .expect(201);
    expect(res.body.data.tel).toMatch(/^tel:\+91/);
    expect(res.body.data.called_at).toBeTruthy();

    const lead = await db.query(
      `SELECT called_at, called_by, contact_unlock_id FROM leads WHERE id = $1::uuid`,
      [freeLeadId]
    );
    expect(lead.rows[0].called_by).toBe("owner");
    const unlock = await db.query(
      `SELECT owner_response_status FROM contact_unlocks WHERE id = $1::uuid`,
      [lead.rows[0].contact_unlock_id]
    );
    expect(unlock.rows[0].owner_response_status).toBe("responded");
  });

  it("is idempotent — second click keeps the first called_at", async () => {
    const first = await db.query(`SELECT called_at FROM leads WHERE id = $1::uuid`, [freeLeadId]);
    await http(app)
      .post(`/v1/owner/leads/${freeLeadId}/call-click`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .expect(201);
    const second = await db.query(`SELECT called_at FROM leads WHERE id = $1::uuid`, [freeLeadId]);
    expect(String(second.rows[0].called_at)).toBe(String(first.rows[0].called_at));
  });

  it("409s on a locked lead", async () => {
    await http(app)
      .post(`/v1/owner/leads/${lockedLeadId}/call-click`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .expect(409);
  });

  it("legacy /owner/contact-unlocks/:id/responded also stamps the linked lead as called", async () => {
    const before = await db.query<{ contact_unlock_id: string; called_at: string | null }>(
      `SELECT contact_unlock_id::text, called_at::text FROM leads WHERE id = $1::uuid`,
      [secondFreeLeadId]
    );
    const contactUnlockId = before.rows[0].contact_unlock_id;
    expect(before.rows[0].called_at).toBeNull();

    await http(app)
      .post(`/v1/owner/contact-unlocks/${contactUnlockId}/responded`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ channel: "call" })
      .expect(201);

    const after = await db.query<{ called_at: string | null; called_by: string | null }>(
      `SELECT called_at::text, called_by FROM leads WHERE id = $1::uuid`,
      [secondFreeLeadId]
    );
    expect(after.rows[0].called_at).not.toBeNull();
    expect(after.rows[0].called_by).toBe("owner");
  });
});
