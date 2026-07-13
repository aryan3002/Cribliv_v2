import "reflect-metadata";
import { INestApplication, ValidationPipe } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { Pool } from "pg";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { runSignupCreditExpirySweepDb } from "../src/worker/signup-credit-sweep";

const TEST_DB = process.env.TEST_DATABASE_URL;
const DAY_MS = 24 * 60 * 60 * 1000;
const SIGNUP_REWARD_MS = 90 * DAY_MS;

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

function randomPhone(prefix: "94" | "95" | "96" | "97" | "98" | "99") {
  return `+91${prefix}${String(Math.floor(Math.random() * 1e8)).padStart(8, "0")}`;
}

function http(app: INestApplication) {
  return request(app.getHttpAdapter().getInstance());
}

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

describe.runIf(!!TEST_DB)("signup credit expiry APIs (DB)", () => {
  let app: INestApplication;
  let pool: Pool;
  const previousSignupCredits = process.env.SIGNUP_FREE_CREDITS;
  const signupPhone = randomPhone("94");
  const walletPhone = randomPhone("95");
  const mePhone = randomPhone("96");
  const sweepPhoneOne = randomPhone("97");
  const sweepPhoneTwo = randomPhone("98");
  const futurePhone = randomPhone("99");
  const phones = [signupPhone, walletPhone, mePhone, sweepPhoneOne, sweepPhoneTwo, futurePhone];

  beforeAll(async () => {
    process.env.DATABASE_URL = TEST_DB;
    process.env.OTP_PROVIDER = "mock";
    process.env.SIGNUP_FREE_CREDITS = "10";
    process.env.FF_WHATSAPP_NOTIFICATIONS = "false";

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix("v1");
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();

    pool = new Pool({ connectionString: TEST_DB! });
  }, 60_000);

  afterAll(async () => {
    await pool.query(
      `DELETE FROM sessions
       WHERE user_id IN (SELECT id FROM users WHERE phone_e164 = ANY($1))`,
      [phones]
    );
    await pool.query(
      `DELETE FROM wallet_transactions
       WHERE wallet_user_id IN (SELECT id FROM users WHERE phone_e164 = ANY($1))`,
      [phones]
    );
    await pool.query(
      `DELETE FROM wallets
       WHERE user_id IN (SELECT id FROM users WHERE phone_e164 = ANY($1))`,
      [phones]
    );
    await pool.query(`DELETE FROM otp_challenges WHERE phone_e164 = ANY($1)`, [phones]);
    await pool.query(`DELETE FROM users WHERE phone_e164 = ANY($1)`, [phones]);
    await pool.end();
    await app.close();

    delete process.env.DATABASE_URL;
    delete process.env.FF_WHATSAPP_NOTIFICATIONS;
    if (previousSignupCredits === undefined) {
      delete process.env.SIGNUP_FREE_CREDITS;
    } else {
      process.env.SIGNUP_FREE_CREDITS = previousSignupCredits;
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

  it("lazily expires promotional credits before GET /wallet and exposes promo fields", async () => {
    const signup = await loginWithOtp(app, walletPhone);
    const expiry = new Date(Date.now() - DAY_MS);

    await pool.query(
      `UPDATE wallets
       SET balance_credits = 17,
           promotional_credits_remaining = 10,
           promotional_credits_expires_at = $2::timestamptz
       WHERE user_id = $1::uuid`,
      [signup.user.id, expiry.toISOString()]
    );
    await pool.query(
      `INSERT INTO wallet_transactions(
         wallet_user_id, txn_type, credits_delta, reference_type, reference_id, metadata
       )
       VALUES
         ($1::uuid, 'purchase_pack', 5, 'user', $1::uuid, '{}'::jsonb),
         ($1::uuid, 'refund_no_response', 2, 'user', $1::uuid, '{}'::jsonb)`,
      [signup.user.id]
    );

    const wallet = await http(app)
      .get("/v1/wallet")
      .set("Authorization", `Bearer ${signup.access_token}`)
      .expect(200);

    expect(wallet.body.data).toEqual({
      balance_credits: 7,
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
      credits_delta: -10,
      metadata: {
        expired_credits: 10
      }
    });
    expect(new Date(expiryTransactions.rows[0].metadata.expires_at).getTime()).toBe(
      expiry.getTime()
    );
  });

  it("lazily expires before GET /auth/me while preserving permanent credits", async () => {
    const signup = await loginWithOtp(app, mePhone);
    const expiry = new Date(Date.now() - 2 * DAY_MS);

    await pool.query(
      `UPDATE wallets
       SET balance_credits = 13,
           promotional_credits_remaining = 10,
           promotional_credits_expires_at = $2::timestamptz
       WHERE user_id = $1::uuid`,
      [signup.user.id, expiry.toISOString()]
    );
    await pool.query(
      `INSERT INTO wallet_transactions(
         wallet_user_id, txn_type, credits_delta, reference_type, reference_id, metadata
       )
       VALUES ($1::uuid, 'purchase_pack', 3, 'user', $1::uuid, '{}'::jsonb)`,
      [signup.user.id]
    );

    const me = await http(app)
      .get("/v1/auth/me")
      .set("Authorization", `Bearer ${signup.access_token}`)
      .expect(200);

    expect(me.body.data).toMatchObject({
      id: signup.user.id,
      wallet_balance: 3,
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
      balance_credits: 3,
      promotional_credits_remaining: 0
    });
  });

  it("sweeps due wallets in one idempotent pass and records expiry metadata", async () => {
    const seeded = await pool.query<{ id: string; phone_e164: string }>(
      `INSERT INTO users(phone_e164, role)
       VALUES
         ($1, 'tenant'),
         ($2, 'tenant'),
         ($3, 'tenant')
       RETURNING id::text, phone_e164`,
      [sweepPhoneOne, sweepPhoneTwo, futurePhone]
    );
    const byPhone = new Map(seeded.rows.map((row) => [row.phone_e164, row.id]));
    const dueOneId = byPhone.get(sweepPhoneOne)!;
    const dueTwoId = byPhone.get(sweepPhoneTwo)!;
    const futureId = byPhone.get(futurePhone)!;

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
         ($3::uuid, 3, 3, 3, now() + interval '1 day')`,
      [dueOneId, dueTwoId, futureId]
    );

    const first = await runSignupCreditExpirySweepDb(pool);
    const second = await runSignupCreditExpirySweepDb(pool);

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
      [[dueOneId, dueTwoId, futureId]]
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
      [[dueOneId, dueTwoId, futureId]]
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
