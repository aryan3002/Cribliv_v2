import "reflect-metadata";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
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
// Mint a real bearer token via the OTP flow (OTP_PROVIDER=mock returns dev_otp).
async function loginWithOtp(app: INestApplication, phone: string) {
  const send = await http(app)
    .post("/v1/auth/otp/send")
    .send({ phone_e164: phone, purpose: "login" })
    .expect(201);
  const verify = await http(app)
    .post("/v1/auth/otp/verify")
    .send({
      challenge_id: send.body.data.challenge_id,
      otp_code: send.body.data.dev_otp,
      device_fingerprint: "lead-center-test"
    })
    .expect(201);
  return verify.body.data as { access_token: string; user: { id: string } };
}

describe.runIf(!!TEST_DB)("Admin Lead Center controller (DB)", () => {
  let app: INestApplication;
  let db: Client;
  const adminPhone = randPhone();
  const tenantAuthPhone = randPhone();
  const ownerPhone = randPhone();
  const seekerPhone = randPhone();
  const allPhones = [adminPhone, tenantAuthPhone, ownerPhone, seekerPhone];
  let adminToken: string;
  let tenantToken: string;
  let ownerId: string;
  let listingId: string;

  beforeAll(async () => {
    process.env.DATABASE_URL = TEST_DB;
    process.env.OTP_PROVIDER = "mock";
    process.env.FF_ADMIN_LEAD_CENTER = "true";
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix("v1");
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();

    db = new Client({ connectionString: TEST_DB! });
    await db.connect();

    // Admin token: sign up, promote to admin, re-login so the token carries the role.
    await loginWithOtp(app, adminPhone);
    await db.query(`UPDATE users SET role = 'admin' WHERE phone_e164 = $1`, [adminPhone]);
    adminToken = (await loginWithOtp(app, adminPhone)).access_token;

    // A non-admin (tenant) token for the 403 check.
    tenantToken = (await loginWithOtp(app, tenantAuthPhone)).access_token;

    // Owner + seeker as plain rows (no tokens needed) + a listing + an uncalled lead.
    const owner = await db.query<{ id: string }>(
      `INSERT INTO users (phone_e164, role, full_name) VALUES ($1, 'owner', 'LC Owner') RETURNING id::text`,
      [ownerPhone]
    );
    ownerId = owner.rows[0].id;
    const seeker = await db.query<{ id: string }>(
      `INSERT INTO users (phone_e164, role, full_name) VALUES ($1, 'tenant', 'LC Seeker') RETURNING id::text`,
      [seekerPhone]
    );
    const seekerId = seeker.rows[0].id;
    const listing = await db.query<{ id: string }>(
      `INSERT INTO listings (owner_user_id, listing_type, title_en, monthly_rent, status, city_slug)
       VALUES ($1::uuid, 'flat_house', 'LC Flat', 9000, 'active', 'mumbai') RETURNING id::text`,
      [ownerId]
    );
    listingId = listing.rows[0].id;
    await db.query(
      `INSERT INTO leads (listing_id, owner_user_id, tenant_user_id, status, access_state, call_deadline_at)
       VALUES ($1::uuid, $2::uuid, $3::uuid, 'new', 'locked', now() + interval '4 hours')`,
      [listingId, ownerId, seekerId]
    );
  }, 60_000);

  afterAll(async () => {
    await db.query(`DELETE FROM leads WHERE listing_id = $1::uuid`, [listingId]);
    await db.query(`DELETE FROM listings WHERE id = $1::uuid`, [listingId]);
    await db.query(
      `DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE phone_e164 = ANY($1))`,
      [allPhones]
    );
    await db.query(`DELETE FROM otp_challenges WHERE phone_e164 = ANY($1)`, [allPhones]);
    await db.query(
      `DELETE FROM wallet_transactions WHERE wallet_user_id IN (SELECT id FROM users WHERE phone_e164 = ANY($1))`,
      [allPhones]
    );
    await db.query(
      `DELETE FROM wallets WHERE user_id IN (SELECT id FROM users WHERE phone_e164 = ANY($1))`,
      [allPhones]
    );
    await db.query(`DELETE FROM users WHERE phone_e164 = ANY($1)`, [allPhones]);
    await db.end();
    await app.close();
    delete process.env.FF_ADMIN_LEAD_CENTER;
  }, 60_000);

  it("GET /admin/leads/board returns rows + counters for an admin", async () => {
    const res = await http(app)
      .get("/v1/admin/leads/board?filter=needs_call")
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(200);
    expect(Array.isArray(res.body.data.rows)).toBe(true);
    expect(res.body.data.counters).toHaveProperty("uncalled");
    const row = res.body.data.rows.find((r: any) => r.owner.user_id === ownerId);
    expect(row).toBeTruthy();
    expect(row.seeker.phone_e164).toMatch(/^\+9197/); // admin sees the full seeker number
    expect(row.owner.phone_masked).toMatch(/X/);
  });

  it("rejects an unauthenticated request with 401", async () => {
    await http(app).get("/v1/admin/leads/board").expect(401);
  });

  it("rejects a non-admin token with 403", async () => {
    await http(app)
      .get("/v1/admin/leads/board")
      .set("Authorization", `Bearer ${tenantToken}`)
      .expect(403);
  });
});
