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
      device_fingerprint: "lead-unlock-test"
    })
    .expect(201);
  return verifyRes.body.data as { access_token: string; user: { id: string } };
}

describe.runIf(!!TEST_DB)("owner lead unlock (DB)", () => {
  let app: INestApplication;
  let db: Client;
  const phones = [randPhone(), randPhone(), randPhone(), randPhone(), randPhone(), randPhone()];
  const [ownerPhone, tenant1, tenant2, tenant3, tenant4, tenant5] = phones;
  let listingId: string;
  let ownerToken: string;
  let freeLeadId: string;
  let lockedLeadId: string;
  let expiredLeadId: string;
  let otherLockedLeadId: string;

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
       VALUES ($1::uuid, 'flat_house', 'Lead Unlock Test Flat', 12000, 'active', '+919777777778')
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

    // First 2 tenants land free leads (first-2-free-per-owner); the rest
    // land locked leads.
    await requestCallback(tenant1, "lu-t1");
    await requestCallback(tenant2, "lu-t2");
    await requestCallback(tenant3, "lu-t3");
    await requestCallback(tenant4, "lu-t4");
    await requestCallback(tenant5, "lu-t5");

    const leadsResult = await db.query<{ id: string; access_state: string }>(
      `SELECT id::text, access_state FROM leads WHERE listing_id = $1 ORDER BY created_at ASC`,
      [listingId]
    );
    const rows = leadsResult.rows;
    freeLeadId = rows[0].id;
    lockedLeadId = rows[2].id;
    expiredLeadId = rows[3].id;
    otherLockedLeadId = rows[4].id;
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

  it("402s when the owner wallet is empty", async () => {
    // New users get a 10-credit signup grant, so the owner's
    // wallet isn't actually empty yet — zero it out to exercise this path.
    await db.query(
      `UPDATE wallets SET balance_credits = 0
       WHERE user_id = (SELECT id FROM users WHERE phone_e164 = $1)`,
      [ownerPhone]
    );
    await http(app)
      .post(`/v1/owner/leads/${lockedLeadId}/unlock`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .set("Idempotency-Key", "lu-nofunds")
      .expect(402);
  });

  it("debits 1 owner credit and expires due signup credits on exact paid replay", async () => {
    await db.query(
      `INSERT INTO wallets (
         user_id, balance_credits, free_credits_granted,
         promotional_credits_remaining, promotional_credits_expires_at
       )
       VALUES ((SELECT id FROM users WHERE phone_e164 = $1), 3, 0, 0, NULL)
       ON CONFLICT (user_id) DO UPDATE
       SET balance_credits = 3,
           promotional_credits_remaining = 0,
           promotional_credits_expires_at = NULL`,
      [ownerPhone]
    );
    const first = await http(app)
      .post(`/v1/owner/leads/${lockedLeadId}/unlock`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .set("Idempotency-Key", "lu-1")
      .expect(201);
    expect(first.body.data.access_state).toBe("unlocked");
    expect(first.body.data.tenant_phone).toMatch(/^\+91/);
    expect(first.body.data.credits_remaining).toBe(2);

    await db.query(
      `UPDATE wallets
       SET promotional_credits_remaining = 2,
           promotional_credits_expires_at = now() - interval '1 hour'
       WHERE user_id = (SELECT id FROM users WHERE phone_e164 = $1)`,
      [ownerPhone]
    );

    const replay = await http(app)
      .post(`/v1/owner/leads/${lockedLeadId}/unlock`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .set("Idempotency-Key", "lu-1")
      .expect(201);
    expect(replay.body.data.credits_remaining).toBe(0);

    const txns = await db.query(
      `SELECT count(*)::int AS n FROM wallet_transactions
       WHERE txn_type = 'debit_lead_unlock'
         AND wallet_user_id = (SELECT id FROM users WHERE phone_e164 = $1)`,
      [ownerPhone]
    );
    expect(txns.rows[0].n).toBe(1);

    const expired = await db.query(
      `SELECT balance_credits, promotional_credits_remaining,
              count(wt.id)::int AS expiry_txns
       FROM wallets w
       LEFT JOIN wallet_transactions wt
         ON wt.wallet_user_id = w.user_id
        AND wt.txn_type = 'expire_signup'
       WHERE w.user_id = (SELECT id FROM users WHERE phone_e164 = $1)
       GROUP BY w.balance_credits, w.promotional_credits_remaining`,
      [ownerPhone]
    );
    expect(expired.rows[0]).toMatchObject({
      balance_credits: 0,
      promotional_credits_remaining: 0,
      expiry_txns: 1
    });
  });

  it("returns an already-paid unlocked lead when a remounted client sends a fresh key", async () => {
    const res = await http(app)
      .post(`/v1/owner/leads/${lockedLeadId}/unlock`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .set("Idempotency-Key", "lu-foreign")
      .expect(201);
    expect(res.body.data).toMatchObject({
      lead_id: lockedLeadId,
      access_state: "unlocked",
      credits_remaining: 0
    });
    expect(res.body.data.tenant_phone).toMatch(/^\+91/);
  });

  it("commits due signup expiry before returning 402 for an unaffordable lead", async () => {
    await db.query(
      `UPDATE wallets
       SET balance_credits = 1,
           promotional_credits_remaining = 1,
           promotional_credits_expires_at = now() - interval '1 hour'
       WHERE user_id = (SELECT id FROM users WHERE phone_e164 = $1)`,
      [ownerPhone]
    );

    await http(app)
      .post(`/v1/owner/leads/${otherLockedLeadId}/unlock`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .set("Idempotency-Key", "lu-expired-insufficient")
      .expect(402);

    const wallet = await db.query(
      `SELECT balance_credits, promotional_credits_remaining
       FROM wallets
       WHERE user_id = (SELECT id FROM users WHERE phone_e164 = $1)`,
      [ownerPhone]
    );
    expect(wallet.rows[0]).toMatchObject({
      balance_credits: 0,
      promotional_credits_remaining: 0
    });
  });

  it("409s when the idempotency key was used for a different lead - no free reveal", async () => {
    // ownerToken already has credits from the earlier seeding
    const res = await http(app)
      .post(`/v1/owner/leads/${otherLockedLeadId}/unlock`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .set("Idempotency-Key", "lu-1") // the SAME key that unlocked lockedLeadId earlier
      .expect(409);
    expect(JSON.stringify(res.body)).toContain("duplicate_unlock");
    expect(JSON.stringify(res.body)).not.toContain("+91"); // no phone leaked
    const state = await db.query(`SELECT access_state FROM leads WHERE id = $1::uuid`, [
      otherLockedLeadId
    ]);
    expect(state.rows[0].access_state).toBe("locked");
  });

  it("free leads expire due signup credits without debiting", async () => {
    const debitCountBefore = await db.query(
      `SELECT count(*)::int AS n FROM wallet_transactions
       WHERE txn_type = 'debit_lead_unlock'
         AND wallet_user_id = (SELECT id FROM users WHERE phone_e164 = $1)`,
      [ownerPhone]
    );
    await db.query(
      `UPDATE wallets
       SET balance_credits = 2,
           promotional_credits_remaining = 2,
           promotional_credits_expires_at = now() - interval '1 hour'
       WHERE user_id = (SELECT id FROM users WHERE phone_e164 = $1)`,
      [ownerPhone]
    );

    const res = await http(app)
      .post(`/v1/owner/leads/${freeLeadId}/unlock`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .set("Idempotency-Key", "lu-free")
      .expect(201);
    expect(res.body.data.tenant_phone).toMatch(/^\+91/);
    expect(res.body.data.credits_remaining).toBe(0);

    const debitCountAfter = await db.query(
      `SELECT count(*)::int AS n FROM wallet_transactions
       WHERE txn_type = 'debit_lead_unlock'
         AND wallet_user_id = (SELECT id FROM users WHERE phone_e164 = $1)`,
      [ownerPhone]
    );
    expect(debitCountAfter.rows[0].n).toBe(debitCountBefore.rows[0].n);
  });

  it("410s on an expired lead", async () => {
    // force a fresh locked lead past its deadline
    await db.query(
      `UPDATE leads SET call_deadline_at = now() - interval '1 hour'
       WHERE id = $1::uuid AND access_state = 'locked'`,
      [expiredLeadId]
    );
    await http(app)
      .post(`/v1/owner/leads/${expiredLeadId}/unlock`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .set("Idempotency-Key", "lu-exp")
      .expect(410);
  });
});
