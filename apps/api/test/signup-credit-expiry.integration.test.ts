import "reflect-metadata";
import { INestApplication, ValidationPipe } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { createHmac, randomUUID } from "crypto";
import { Pool } from "pg";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { refundUnlock } from "../src/modules/contacts/refund-unlock";
import { canonicalPayload } from "../src/modules/payments/payments.util";
import { runSignupCreditExpirySweepDb } from "../src/worker/signup-credit-sweep";

const TEST_DB = process.env.TEST_DATABASE_URL;
const DAY_MS = 24 * 60 * 60 * 1000;
const SIGNUP_REWARD_MS = 90 * DAY_MS;
const WEBHOOK_SECRET = "signup-credit-expiry-webhook-secret";

interface OtpVerifyData {
  access_token: string;
  user: {
    id: string;
    role: string;
  };
  is_new_user: boolean;
  signup_reward?: {
    credits_granted: number;
    expires_at: string | null;
  };
}

interface PurchaseIntent {
  order_id: string;
  credits_to_grant: number;
}

function randomPhone(prefix: "92" | "93" | "94" | "95" | "96" | "97" | "98" | "99") {
  return `+91${prefix}${String(Math.floor(Math.random() * 1e8)).padStart(8, "0")}`;
}

function http(app: INestApplication) {
  return request(app.getHttpAdapter().getInstance());
}

function captureEnvironment<const K extends readonly string[]>(
  keys: K
): Record<K[number], string | undefined> {
  return Object.fromEntries(keys.map((key) => [key, process.env[key]])) as Record<
    K[number],
    string | undefined
  >;
}

function restoreEnvironment(snapshot: Record<string, string | undefined>) {
  for (const [key, value] of Object.entries(snapshot)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

const INTEGRATION_ENV_KEYS = [
  "DATABASE_URL",
  "OTP_PROVIDER",
  "SIGNUP_FREE_CREDITS",
  "FF_WHATSAPP_NOTIFICATIONS",
  "FF_CREDIT_PURCHASE_ENABLED",
  "PAYMENT_WEBHOOK_SECRET"
] as const;
const environmentBeforeIntegration = captureEnvironment(INTEGRATION_ENV_KEYS);

async function loginWithOtp(app: INestApplication, phone: string): Promise<OtpVerifyData> {
  const send = await http(app)
    .post("/v1/auth/otp/send")
    .send({ phone_e164: phone, purpose: "login" })
    .expect(201);

  const verify = await http(app)
    .post("/v1/auth/otp/verify")
    .send({
      challenge_id: send.body.data.challenge_id,
      otp_code: send.body.data.dev_otp,
      device_fingerprint: "signup-credit-expiry-test"
    })
    .expect(201);

  return verify.body.data as OtpVerifyData;
}

async function createPurchaseIntent(
  app: INestApplication,
  accessToken: string,
  idempotencyKey: string
): Promise<PurchaseIntent> {
  const response = await http(app)
    .post("/v1/wallet/purchase-intents")
    .set("Authorization", `Bearer ${accessToken}`)
    .set("Idempotency-Key", idempotencyKey)
    .send({ plan_id: "starter_10", provider: "razorpay" })
    .expect(201);

  return response.body.data as PurchaseIntent;
}

async function capturePurchase(app: INestApplication, purchase: PurchaseIntent, eventId: string) {
  const payload = {
    id: eventId,
    event: "payment.captured",
    payload: {
      payment: {
        entity: {
          id: `pay_${eventId}`,
          order_id: purchase.order_id
        }
      }
    }
  };
  const signature = createHmac("sha256", WEBHOOK_SECRET)
    .update(canonicalPayload(payload))
    .digest("hex");

  await http(app)
    .post("/v1/webhooks/razorpay")
    .set("x-razorpay-signature", signature)
    .send(payload)
    .expect(201);
}

async function refundSpecificUnlock(pool: Pool, unlockId: string) {
  const client = await pool.connect();
  let inTransaction = false;
  try {
    await client.query("BEGIN");
    inTransaction = true;
    const locked = await client.query(
      `SELECT id
       FROM contact_unlocks
       WHERE id = $1::uuid
       FOR UPDATE`,
      [unlockId]
    );
    expect(locked.rowCount).toBe(1);

    const result = await refundUnlock(client, unlockId, {
      txnType: "refund_no_response",
      actorRole: "system",
      expireLockedLead: true
    });
    await client.query("COMMIT");
    inTransaction = false;
    return result;
  } catch (error) {
    if (inTransaction) {
      try {
        await client.query("ROLLBACK");
      } catch {
        // Preserve the fixture failure.
      }
    }
    throw error;
  } finally {
    client.release();
  }
}

describe("signup credit expiry test environment", () => {
  it("restores set and unset variables exactly", () => {
    const keys = [
      "DATABASE_URL",
      "OTP_PROVIDER",
      "SIGNUP_FREE_CREDITS",
      "FF_WHATSAPP_NOTIFICATIONS"
    ] as const;
    const original = captureEnvironment(keys);

    try {
      process.env.DATABASE_URL = "original-database";
      delete process.env.OTP_PROVIDER;
      process.env.SIGNUP_FREE_CREDITS = "7";
      delete process.env.FF_WHATSAPP_NOTIFICATIONS;
      const snapshot = captureEnvironment(keys);

      process.env.DATABASE_URL = "mutated-database";
      process.env.OTP_PROVIDER = "mock";
      delete process.env.SIGNUP_FREE_CREDITS;
      process.env.FF_WHATSAPP_NOTIFICATIONS = "false";
      restoreEnvironment(snapshot);

      expect(process.env.DATABASE_URL).toBe("original-database");
      expect(process.env.OTP_PROVIDER).toBeUndefined();
      expect(process.env.SIGNUP_FREE_CREDITS).toBe("7");
      expect(process.env.FF_WHATSAPP_NOTIFICATIONS).toBeUndefined();
    } finally {
      restoreEnvironment(original);
    }
  });
});

describe.runIf(!!TEST_DB)("signup credit expiry APIs (DB)", () => {
  let app: INestApplication | undefined;
  let pool: Pool | undefined;
  const runId = randomUUID();
  const captureEventId = `signup-credit-capture-${runId}`;
  const signupPhone = randomPhone("94");
  const walletPhone = randomPhone("95");
  const mePhone = randomPhone("96");
  const sweepPhoneOne = randomPhone("97");
  const sweepPhoneTwo = randomPhone("98");
  const futurePhone = randomPhone("99");
  const unrelatedSweepPhone = randomPhone("92");
  const ownerPhone = randomPhone("93");
  const phones = [
    signupPhone,
    walletPhone,
    mePhone,
    sweepPhoneOne,
    sweepPhoneTwo,
    futurePhone,
    unrelatedSweepPhone,
    ownerPhone
  ];
  const listingIds: string[] = [];

  beforeAll(async () => {
    process.env.DATABASE_URL = TEST_DB;
    process.env.OTP_PROVIDER = "mock";
    process.env.SIGNUP_FREE_CREDITS = "10";
    process.env.FF_WHATSAPP_NOTIFICATIONS = "false";
    process.env.FF_CREDIT_PURCHASE_ENABLED = "true";
    process.env.PAYMENT_WEBHOOK_SECRET = WEBHOOK_SECRET;

    try {
      const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
      app = moduleRef.createNestApplication();
      app.setGlobalPrefix("v1");
      app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
      await app.init();

      pool = new Pool({ connectionString: TEST_DB! });
    } catch (setupError) {
      try {
        try {
          await pool?.end();
        } catch {
          // Preserve the setup failure.
        }
      } finally {
        try {
          await app?.close();
        } catch {
          // Preserve the setup failure.
        } finally {
          restoreEnvironment(environmentBeforeIntegration);
        }
      }
      throw setupError;
    }
  }, 60_000);

  afterAll(async () => {
    let teardownError: unknown;
    const attempt = async (operation: () => Promise<unknown>) => {
      try {
        await operation();
      } catch (error) {
        teardownError ??= error;
      }
    };

    try {
      if (pool) {
        await attempt(() =>
          pool!.query(
            `DELETE FROM outbound_events
             WHERE aggregate_id IN (
               SELECT id FROM leads WHERE listing_id = ANY($1::uuid[])
             )`,
            [listingIds]
          )
        );
        await attempt(() =>
          pool!.query(
            `DELETE FROM contact_events
             WHERE contact_unlock_id IN (
               SELECT id FROM contact_unlocks WHERE listing_id = ANY($1::uuid[])
             )`,
            [listingIds]
          )
        );
        await attempt(() =>
          pool!.query(`DELETE FROM leads WHERE listing_id = ANY($1::uuid[])`, [listingIds])
        );
        await attempt(() =>
          pool!.query(
            `UPDATE contact_unlocks
             SET refund_txn_id = NULL
             WHERE listing_id = ANY($1::uuid[])`,
            [listingIds]
          )
        );
        await attempt(() =>
          pool!.query(`DELETE FROM contact_unlocks WHERE listing_id = ANY($1::uuid[])`, [
            listingIds
          ])
        );
        await attempt(() =>
          pool!.query(
            `DELETE FROM payment_webhook_events
             WHERE provider_event_id = $2
                OR payment_order_id IN (
               SELECT id FROM payment_orders
               WHERE user_id IN (SELECT id FROM users WHERE phone_e164 = ANY($1))
             )`,
            [phones, `payment.captured:${captureEventId}`]
          )
        );
        await attempt(() =>
          pool!.query(
            `DELETE FROM payment_orders
             WHERE user_id IN (SELECT id FROM users WHERE phone_e164 = ANY($1))`,
            [phones]
          )
        );
        await attempt(() =>
          pool!.query(
            `DELETE FROM sessions
             WHERE user_id IN (SELECT id FROM users WHERE phone_e164 = ANY($1))`,
            [phones]
          )
        );
        await attempt(() =>
          pool!.query(
            `DELETE FROM wallet_transactions
             WHERE wallet_user_id IN (SELECT id FROM users WHERE phone_e164 = ANY($1))`,
            [phones]
          )
        );
        await attempt(() =>
          pool!.query(
            `DELETE FROM wallets
             WHERE user_id IN (SELECT id FROM users WHERE phone_e164 = ANY($1))`,
            [phones]
          )
        );
        await attempt(() =>
          pool!.query(`DELETE FROM listings WHERE id = ANY($1::uuid[])`, [listingIds])
        );
        await attempt(() =>
          pool!.query(`DELETE FROM otp_challenges WHERE phone_e164 = ANY($1)`, [phones])
        );
        await attempt(() => pool!.query(`DELETE FROM users WHERE phone_e164 = ANY($1)`, [phones]));
      }
    } finally {
      try {
        if (pool) {
          await attempt(() => pool!.end());
        }
      } finally {
        try {
          if (app) {
            await attempt(() => app!.close());
          }
        } finally {
          restoreEnvironment(environmentBeforeIntegration);
        }
      }
    }

    if (teardownError) {
      throw teardownError;
    }
  }, 60_000);

  it("grants fresh DB signups 10 promotional credits expiring exactly 90 days after creation", async () => {
    const signup = await loginWithOtp(app, signupPhone);

    expect(signup.is_new_user).toBe(true);
    expect(signup.signup_reward).toEqual({
      credits_granted: 10,
      expires_at: expect.any(String)
    });

    const result = await pool.query<{
      created_at: Date;
      balance_credits: number;
      free_credits_granted: number;
      promotional_credits_remaining: number;
      promotional_credits_expires_at: Date | null;
    }>(
      `SELECT
         u.created_at,
         w.balance_credits,
         w.free_credits_granted,
         w.promotional_credits_remaining,
         w.promotional_credits_expires_at
       FROM users u
       JOIN wallets w ON w.user_id = u.id
       WHERE u.id = $1::uuid`,
      [signup.user.id]
    );
    const row = result.rows[0];

    expect(row).toMatchObject({
      balance_credits: 10,
      free_credits_granted: 10,
      promotional_credits_remaining: 10
    });
    expect(row.promotional_credits_expires_at).not.toBeNull();
    expect(row.promotional_credits_expires_at!.getTime() - row.created_at.getTime()).toBe(
      SIGNUP_REWARD_MS
    );
    expect(signup.signup_reward!.expires_at).toBe(
      row.promotional_credits_expires_at!.toISOString()
    );
  });

  it("does not regrant signup credits or return signup_reward for a returning login", async () => {
    const grantCountBefore = await pool.query<{ count: number }>(
      `SELECT count(*)::int AS count
       FROM wallet_transactions
       WHERE wallet_user_id = (SELECT id FROM users WHERE phone_e164 = $1)
         AND txn_type = 'grant_signup'`,
      [signupPhone]
    );

    const returning = await loginWithOtp(app, signupPhone);

    expect(returning.is_new_user).toBe(false);
    expect(returning).not.toHaveProperty("signup_reward");

    const grantCountAfter = await pool.query<{ count: number }>(
      `SELECT count(*)::int AS count
       FROM wallet_transactions
       WHERE wallet_user_id = $1::uuid
         AND txn_type = 'grant_signup'`,
      [returning.user.id]
    );
    expect(grantCountAfter.rows[0].count).toBe(grantCountBefore.rows[0].count);
  });

  it("preserves credits added by captured purchase and refund paths after wallet expiry", async () => {
    const signup = await loginWithOtp(app, walletPhone);
    const owner = await loginWithOtp(app, ownerPhone);
    await pool.query(`UPDATE users SET role = 'owner' WHERE id = $1::uuid`, [owner.user.id]);
    const listing = await pool.query<{ id: string }>(
      `INSERT INTO listings(
         owner_user_id,
         listing_type,
         title_en,
         monthly_rent,
         status,
         contact_phone_encrypted
       )
       VALUES (
         $1::uuid,
         'flat_house',
         'Signup Credit Permanence Test',
         12000,
         'active',
         '+919400000000'
       )
       RETURNING id::text`,
      [owner.user.id]
    );
    const listingId = listing.rows[0].id;
    listingIds.push(listingId);

    const purchase = await createPurchaseIntent(
      app,
      signup.access_token,
      `signup-credit-purchase-${runId}`
    );
    expect(purchase.credits_to_grant).toBe(10);
    await capturePurchase(app, purchase, captureEventId);

    const unlock = await http(app)
      .post("/v1/tenant/contact-unlocks")
      .set("Authorization", `Bearer ${signup.access_token}`)
      .set("Idempotency-Key", `signup-credit-refund-${runId}`)
      .send({ listing_id: listingId })
      .expect(201);
    const unlockId = unlock.body.data.unlock_id as string;
    await pool.query(
      `UPDATE contact_unlocks
       SET response_deadline_at = now() - interval '1 hour'
       WHERE id = $1::uuid`,
      [unlockId]
    );
    const refund = await refundSpecificUnlock(pool, unlockId);
    expect(refund).toMatchObject({
      refunded: true,
      tenantUserId: signup.user.id,
      refundTxnId: expect.any(String)
    });

    const refundedUnlock = await pool.query<{
      unlock_status: string;
      refund_txn_id: string | null;
    }>(
      `SELECT unlock_status::text, refund_txn_id::text
       FROM contact_unlocks
       WHERE id = $1::uuid`,
      [unlockId]
    );
    expect(refundedUnlock.rows[0]).toMatchObject({
      unlock_status: "refunded",
      refund_txn_id: expect.any(String)
    });

    const expiry = new Date(Date.now() - DAY_MS);
    await pool.query(
      `UPDATE wallets
       SET promotional_credits_expires_at = $2::timestamptz
       WHERE user_id = $1::uuid`,
      [signup.user.id, expiry.toISOString()]
    );

    const permanentCredits = await pool.query<{
      txn_type: string;
      credits_delta: number;
      reference_type: string | null;
    }>(
      `SELECT txn_type::text, credits_delta, reference_type::text
       FROM wallet_transactions
       WHERE wallet_user_id = $1::uuid
         AND txn_type IN ('purchase_pack', 'refund_no_response')
       ORDER BY txn_type`,
      [signup.user.id]
    );
    expect(permanentCredits.rows).toEqual([
      {
        credits_delta: 10,
        txn_type: "purchase_pack",
        reference_type: "payment"
      },
      {
        credits_delta: 1,
        txn_type: "refund_no_response",
        reference_type: "contact_unlock"
      }
    ]);

    const wallet = await http(app)
      .get("/v1/wallet")
      .set("Authorization", `Bearer ${signup.access_token}`)
      .expect(200);

    expect(wallet.body.data).toEqual({
      balance_credits: 11,
      free_credits_granted: 10,
      promotional_credits_remaining: 0,
      promotional_credits_expires_at: expect.any(String)
    });
    expect(new Date(wallet.body.data.promotional_credits_expires_at).getTime()).toBe(
      expiry.getTime()
    );

    const expiryTransactions = await pool.query<{
      credits_delta: number;
      metadata: { expired_credits: number; expires_at: string };
    }>(
      `SELECT credits_delta, metadata
       FROM wallet_transactions
       WHERE wallet_user_id = $1::uuid AND txn_type = 'expire_signup'`,
      [signup.user.id]
    );
    expect(expiryTransactions.rows).toHaveLength(1);
    expect(expiryTransactions.rows[0]).toMatchObject({
      credits_delta: -9,
      metadata: {
        expired_credits: 9
      }
    });
    expect(new Date(expiryTransactions.rows[0].metadata.expires_at).getTime()).toBe(
      expiry.getTime()
    );
  });

  it("lazily expires before GET /auth/me and exposes promotional fields", async () => {
    const signup = await loginWithOtp(app, mePhone);
    const expiry = new Date(Date.now() - 2 * DAY_MS);

    await pool.query(
      `UPDATE wallets
       SET promotional_credits_expires_at = $2::timestamptz
       WHERE user_id = $1::uuid`,
      [signup.user.id, expiry.toISOString()]
    );

    const me = await http(app)
      .get("/v1/auth/me")
      .set("Authorization", `Bearer ${signup.access_token}`)
      .expect(200);

    expect(me.body.data).toMatchObject({
      id: signup.user.id,
      wallet_balance: 0,
      promotional_credits_remaining: 0,
      promotional_credits_expires_at: expect.any(String)
    });
    expect(new Date(me.body.data.promotional_credits_expires_at).getTime()).toBe(expiry.getTime());

    const wallet = await pool.query<{
      balance_credits: number;
      promotional_credits_remaining: number;
    }>(
      `SELECT balance_credits, promotional_credits_remaining
       FROM wallets
       WHERE user_id = $1::uuid`,
      [signup.user.id]
    );
    expect(wallet.rows[0]).toEqual({
      balance_credits: 0,
      promotional_credits_remaining: 0
    });
  });

  it("sweeps due wallets in one idempotent pass and records expiry metadata", async () => {
    const seeded = await pool.query<{ id: string; phone_e164: string }>(
      `INSERT INTO users(phone_e164, role)
       VALUES
         ($1, 'tenant'),
         ($2, 'tenant'),
         ($3, 'tenant'),
         ($4, 'tenant')
       RETURNING id::text, phone_e164`,
      [sweepPhoneOne, sweepPhoneTwo, futurePhone, unrelatedSweepPhone]
    );
    const byPhone = new Map(seeded.rows.map((row) => [row.phone_e164, row.id]));
    const dueOneId = byPhone.get(sweepPhoneOne)!;
    const dueTwoId = byPhone.get(sweepPhoneTwo)!;
    const futureId = byPhone.get(futurePhone)!;
    const unrelatedId = byPhone.get(unrelatedSweepPhone)!;
    const sweepUserIds = [dueOneId, dueTwoId, futureId];

    await pool.query(
      `INSERT INTO wallets(
         user_id,
         balance_credits,
         free_credits_granted,
         promotional_credits_remaining,
         promotional_credits_expires_at
       )
       VALUES
         ($1::uuid, 9, 4, 4, now() - interval '2 hours'),
         ($2::uuid, 8, 6, 6, now() - interval '1 hour'),
         ($3::uuid, 3, 3, 3, now() + interval '1 day'),
         ($4::uuid, 7, 2, 2, now() - interval '3 hours')`,
      [dueOneId, dueTwoId, futureId, unrelatedId]
    );

    const first = await runSignupCreditExpirySweepDb(pool, { userIds: sweepUserIds });
    const second = await runSignupCreditExpirySweepDb(pool, { userIds: sweepUserIds });

    expect(first).toEqual({
      walletsExpired: 2,
      creditsExpired: 10
    });
    expect(second).toEqual({
      walletsExpired: 0,
      creditsExpired: 0
    });

    const wallets = await pool.query<{
      user_id: string;
      balance_credits: number;
      promotional_credits_remaining: number;
    }>(
      `SELECT user_id::text, balance_credits, promotional_credits_remaining
       FROM wallets
       WHERE user_id = ANY($1::uuid[])
       ORDER BY user_id`,
      [[...sweepUserIds, unrelatedId]]
    );
    expect(
      Object.fromEntries(
        wallets.rows.map((row) => [
          row.user_id,
          {
            balance_credits: row.balance_credits,
            promotional_credits_remaining: row.promotional_credits_remaining
          }
        ])
      )
    ).toEqual({
      [dueOneId]: {
        balance_credits: 5,
        promotional_credits_remaining: 0
      },
      [dueTwoId]: {
        balance_credits: 2,
        promotional_credits_remaining: 0
      },
      [futureId]: {
        balance_credits: 3,
        promotional_credits_remaining: 3
      },
      [unrelatedId]: {
        balance_credits: 7,
        promotional_credits_remaining: 2
      }
    });

    const expiryTransactions = await pool.query<{
      wallet_user_id: string;
      credits_delta: number;
      metadata: { expired_credits: number; expires_at: string };
    }>(
      `SELECT wallet_user_id::text, credits_delta, metadata
       FROM wallet_transactions
       WHERE wallet_user_id = ANY($1::uuid[])
         AND txn_type = 'expire_signup'
       ORDER BY wallet_user_id`,
      [[...sweepUserIds, unrelatedId]]
    );
    expect(expiryTransactions.rows).toHaveLength(2);
    expect(
      expiryTransactions.rows.map((row) => ({
        wallet_user_id: row.wallet_user_id,
        credits_delta: row.credits_delta,
        expired_credits: row.metadata.expired_credits,
        expires_at: row.metadata.expires_at
      }))
    ).toEqual([
      expect.objectContaining({
        credits_delta: expect.any(Number),
        expired_credits: expect.any(Number),
        expires_at: expect.any(String)
      }),
      expect.objectContaining({
        credits_delta: expect.any(Number),
        expired_credits: expect.any(Number),
        expires_at: expect.any(String)
      })
    ]);
    expect(
      expiryTransactions.rows.map((row) => row.metadata.expired_credits).sort((a, b) => a - b)
    ).toEqual([4, 6]);
    expect(expiryTransactions.rows.map((row) => row.credits_delta).sort((a, b) => a - b)).toEqual([
      -6, -4
    ]);
  });
});

describe.runIf(!!TEST_DB)("signup credit expiry integration teardown", () => {
  it("does not leak environment changes", () => {
    expect(captureEnvironment(INTEGRATION_ENV_KEYS)).toEqual(environmentBeforeIntegration);
  });
});
