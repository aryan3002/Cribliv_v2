import { resolve } from "node:path";
import { randomBytes } from "node:crypto";

import { config } from "dotenv";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { authenticator } from "otplib";

import { AdminTotpService } from "../admin-totp.service";
import { AppStateService } from "../../../../common/app-state.service";
import { DatabaseService } from "../../../../common/database.service";
import { AuthService } from "../../auth.service";
import { D7OtpClient } from "../../d7-otp.client";

// Loads the repo-root .env so DATABASE_URL is available when running the suite
// directly (vitest does not load it otherwise). Mirrors the rent-agreement
// db-*.int.test.ts convention.
config({ path: resolve(__dirname, "../../../../../../../.env") });

// These tests exercise the DB code path of AdminTotpService (the SQL the
// in-memory unit tests never touch): encrypted secret round-trip, the atomic
// lockout UPDATE, replay-step persistence, and the session-minting transaction.
// They require a migrated Postgres (users + sessions + admin_totp). Skipped
// automatically (CI, or local without a DB) when DATABASE_URL is unset. Run with:
//   DATABASE_URL=postgresql://postgres:postgres@localhost:5432/cribliv_v2 \
//     pnpm --filter @cribliv/api test -- admin-totp.db.int
const HAS_DB = Boolean(process.env.DATABASE_URL);

// Asserts on the `code` NestJS puts on `error.response` for
// UnauthorizedException({ code, message }).
async function expectRejectCode(promise: Promise<unknown>, code: string) {
  await expect(promise).rejects.toMatchObject({ response: { code } });
}

describe.skipIf(!HAS_DB)("AdminTotpService (DB integration)", () => {
  const TEST_PHONE = "+919000000056";
  let db: DatabaseService;
  let svc: AdminTotpService;
  let adminId: string;

  beforeAll(async () => {
    // A fixed-per-run key so encrypt/decrypt round-trips within the suite.
    process.env.ADMIN_TOTP_ENC_KEY = randomBytes(32).toString("base64");

    db = new DatabaseService(); // isEnabled() === true because DATABASE_URL is set
    const appState = new AppStateService();
    const authService = new AuthService(appState, db, new D7OtpClient());
    svc = new AdminTotpService(appState, db, authService);

    const user = await db.query<{ id: string }>(
      `INSERT INTO users (phone_e164, role, preferred_language)
       VALUES ($1, 'admin', 'en')
       ON CONFLICT (phone_e164) DO UPDATE SET role = 'admin'
       RETURNING id::text`,
      [TEST_PHONE]
    );
    adminId = user.rows[0].id;
  });

  beforeEach(async () => {
    // Each test starts from a clean enrollment state for the test admin.
    await db.query(`DELETE FROM admin_totp WHERE user_id = $1::uuid`, [adminId]);
    await db.query(`DELETE FROM sessions WHERE user_id = $1::uuid`, [adminId]);
  });

  afterAll(async () => {
    if (adminId) {
      await db.query(`DELETE FROM sessions WHERE user_id = $1::uuid`, [adminId]);
      await db.query(`DELETE FROM admin_totp WHERE user_id = $1::uuid`, [adminId]);
      await db.query(`DELETE FROM users WHERE id = $1::uuid`, [adminId]);
    }
    await db.onModuleDestroy();
  });

  /** enrollStart + enrollVerify against the DB; returns the plaintext secret. */
  async function enroll(): Promise<string> {
    await svc.enrollStart(adminId);
    const record = await svc.getSecretRecord(adminId);
    if (!record) throw new Error("enrollStart did not persist a record");
    await svc.enrollVerify(adminId, authenticator.generate(record.secret));
    return record.secret;
  }

  it("enrollStart stores the secret ENCRYPTED and getSecretRecord decrypts it back", async () => {
    await svc.enrollStart(adminId);

    const raw = await db.query<{ secret_encrypted: Buffer; status: string }>(
      `SELECT secret_encrypted, status FROM admin_totp WHERE user_id = $1::uuid`,
      [adminId]
    );
    expect(raw.rowCount).toBe(1);
    expect(raw.rows[0].status).toBe("pending");

    const record = await svc.getSecretRecord(adminId);
    expect(record).not.toBeNull();
    expect(record!.status).toBe("pending");
    expect(record!.secret.length).toBeGreaterThan(10);
    // The stored bytes are ciphertext — they must not contain the plaintext secret.
    expect(raw.rows[0].secret_encrypted.toString("utf8")).not.toContain(record!.secret);

    await svc.enrollVerify(adminId, authenticator.generate(record!.secret));
    expect(await svc.status(adminId)).toEqual({ enrolled: true });
  });

  it("verifyLogin issues a real session row for an enrolled admin", async () => {
    const secret = await enroll();

    const out = await svc.verifyLogin(TEST_PHONE, authenticator.generate(secret));
    expect(out.access_token).toMatch(/^acc_/);
    expect(out.refresh_token).toMatch(/^ref_/);
    expect(out.user.role).toBe("admin");
    expect(out.user.phone_e164).toBe(TEST_PHONE);

    const sessions = await db.query<{ c: number }>(
      `SELECT count(*)::int AS c FROM sessions WHERE user_id = $1::uuid`,
      [adminId]
    );
    expect(sessions.rows[0].c).toBeGreaterThan(0);
  });

  it("atomic lockout: 5 wrong codes lock the account in the DB; a valid code is then rejected", async () => {
    const secret = await enroll();

    for (let i = 0; i < 5; i += 1) {
      await expectRejectCode(svc.verifyLogin(TEST_PHONE, "000000"), "invalid_totp");
    }

    const row = await db.query<{ failed_attempts: number; locked_until: Date | null }>(
      `SELECT failed_attempts, locked_until FROM admin_totp WHERE user_id = $1::uuid`,
      [adminId]
    );
    expect(row.rows[0].failed_attempts).toBeGreaterThanOrEqual(5);
    expect(row.rows[0].locked_until).not.toBeNull();

    // Even a valid code is rejected while locked, with the same generic code.
    await expectRejectCode(
      svc.verifyLogin(TEST_PHONE, authenticator.generate(secret)),
      "invalid_totp"
    );
  });

  it("replay: a consumed code cannot be reused (last_used_step persisted)", async () => {
    const secret = await enroll();
    const code = authenticator.generate(secret);

    await svc.verifyLogin(TEST_PHONE, code); // consumes the step

    await expectRejectCode(svc.verifyLogin(TEST_PHONE, code), "invalid_totp");

    const row = await db.query<{ last_used_step: string | null }>(
      `SELECT last_used_step FROM admin_totp WHERE user_id = $1::uuid`,
      [adminId]
    );
    expect(row.rows[0].last_used_step).not.toBeNull();
  });

  it("reset deletes the enrollment row", async () => {
    await enroll();
    await svc.reset(adminId);

    expect(await svc.status(adminId)).toEqual({ enrolled: false });
    const row = await db.query<{ c: number }>(
      `SELECT count(*)::int AS c FROM admin_totp WHERE user_id = $1::uuid`,
      [adminId]
    );
    expect(row.rows[0].c).toBe(0);
  });
});
