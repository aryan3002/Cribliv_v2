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
      device_fingerprint: "lead-access-test"
    })
    .expect(201);
  return verifyRes.body.data as { access_token: string; user: { id: string } };
}

describe.runIf(!!TEST_DB)("lead access lifecycle (DB)", () => {
  let app: INestApplication;
  let db: Client;
  const phones = [randPhone(), randPhone(), randPhone(), randPhone()];
  const [ownerPhone, tenantA, tenantB, tenantC] = phones;
  let listingId: string;
  let ownerToken: string;

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
       VALUES ($1::uuid, 'flat_house', 'Lead Access Test Flat', 12000, 'active', '+919777777777')
       RETURNING id::text`,
      [owner.user.id]
    );
    listingId = listing.rows[0].id;
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

  it("first 2 leads are free with full tenant phone; 3rd is locked and masked", async () => {
    await requestCallback(tenantA, "la-1");
    await requestCallback(tenantB, "la-2");
    await requestCallback(tenantC, "la-3");

    const res = await http(app)
      .get("/v1/owner/leads")
      .set("Authorization", `Bearer ${ownerToken}`)
      .expect(200);

    const items = res.body.data.items as Array<Record<string, unknown>>;
    expect(items.length).toBe(3);
    // newest first: tenantC's lead is items[0]
    const free = items.filter((l) => l.access_state === "free");
    const locked = items.filter((l) => l.access_state === "locked");
    expect(free.length).toBe(2);
    expect(locked.length).toBe(1);
    for (const lead of free) {
      expect(lead.tenant_phone).toMatch(/^\+91/);
    }
    expect(locked[0].tenant_phone).toBeNull();
    expect(locked[0].tenant_phone_masked).toMatch(/X/);
    const deadline = new Date(String(locked[0].call_deadline_at)).getTime();
    expect(deadline).toBeGreaterThan(Date.now() + 23 * 60 * 60 * 1000);
  }, 60_000);
});
