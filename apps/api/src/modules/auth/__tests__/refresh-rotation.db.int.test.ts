import { resolve } from "node:path";

import { config } from "dotenv";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { AppStateService } from "../../../common/app-state.service";
import { DatabaseService } from "../../../common/database.service";
import { AuthService } from "../auth.service";
import { D7OtpClient } from "../d7-otp.client";

config({ path: resolve(__dirname, "../../../../../../.env") });

// Exercises the real rotation SQL against a migrated Postgres — the unit tests
// use a hand-rolled fake, so this is what actually proves migration 0068 and the
// rotate/replay queries work. Skipped when DATABASE_URL is unset. Run with:
//   DATABASE_URL=postgresql://postgres:postgres@localhost:5432/cribliv_v2 \
//     pnpm --filter @cribliv/api test -- refresh-rotation.db.int
const HAS_DB = Boolean(process.env.DATABASE_URL);

describe.skipIf(!HAS_DB)("refresh token rotation (DB integration)", () => {
  const TEST_PHONE = "+919000000077";
  let db: DatabaseService;
  let svc: AuthService;
  let adminId: string;

  async function mintSession() {
    const client = await db.getClient();
    try {
      await client.query("BEGIN");
      const tokens = await svc.issueSessionTokens(client, adminId, "admin");
      await client.query("COMMIT");
      return tokens;
    } finally {
      client.release();
    }
  }

  /** Mirrors the AuthGuard predicate — is this access token still accepted? */
  async function accessTokenIsLive(accessToken: string) {
    const res = await db.query(
      `SELECT 1 FROM sessions
       WHERE id = $1::uuid AND revoked_at IS NULL AND expires_at > now()`,
      [accessToken.replace(/^acc_/, "")]
    );
    return res.rowCount === 1;
  }

  beforeAll(async () => {
    db = new DatabaseService();
    svc = new AuthService(new AppStateService(), db, new D7OtpClient());

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
    await db.query(`DELETE FROM sessions WHERE user_id = $1::uuid`, [adminId]);
  });

  afterAll(async () => {
    if (adminId) {
      await db.query(`DELETE FROM sessions WHERE user_id = $1::uuid`, [adminId]);
      await db.query(`DELETE FROM users WHERE id = $1::uuid`, [adminId]);
    }
    await db.onModuleDestroy?.();
  });

  it("rotates a live refresh token and records the successor", async () => {
    const initial = await mintSession();
    const rotated = await svc.refreshToken(initial.refresh_token);

    expect(rotated.access_token).not.toBe(initial.access_token);

    const predecessor = await db.query<{ rotated_to_session_id: string | null }>(
      `SELECT rotated_to_session_id::text FROM sessions WHERE id = $1::uuid`,
      [initial.access_token.replace(/^acc_/, "")]
    );
    expect(predecessor.rows[0].rotated_to_session_id).toBe(
      rotated.access_token.replace(/^acc_/, "")
    );
  });

  it("replays the same successor when the old refresh token is presented again", async () => {
    // This is the dropped-cookie case: next-auth's RSC auth() rotated but never
    // persisted the result, so the browser retries with the token it still has.
    const initial = await mintSession();
    const first = await svc.refreshToken(initial.refresh_token);
    const second = await svc.refreshToken(initial.refresh_token);

    expect(second.access_token).toBe(first.access_token);
    expect(second.refresh_token).toBe(first.refresh_token);
    await expect(accessTokenIsLive(second.access_token)).resolves.toBe(true);
  });

  it("keeps admins on a 4 hour session across a replay", async () => {
    const initial = await mintSession();
    const rotated = await svc.refreshToken(initial.refresh_token);
    await svc.refreshToken(initial.refresh_token);

    const res = await db.query<{ hours: string }>(
      `SELECT EXTRACT(EPOCH FROM (expires_at - now())) / 3600 AS hours
       FROM sessions WHERE id = $1::uuid`,
      [rotated.access_token.replace(/^acc_/, "")]
    );
    expect(Number(res.rows[0].hours)).toBeGreaterThan(3.9);
    expect(Number(res.rows[0].hours)).toBeLessThanOrEqual(4);
  });

  it("stops replaying once the grace window has passed", async () => {
    const initial = await mintSession();
    await svc.refreshToken(initial.refresh_token);

    // Age the revocation past the 5-minute reuse window.
    await db.query(
      `UPDATE sessions SET revoked_at = now() - interval '10 minutes'
       WHERE id = $1::uuid`,
      [initial.access_token.replace(/^acc_/, "")]
    );

    await expect(svc.refreshToken(initial.refresh_token)).rejects.toMatchObject({
      response: { code: "invalid_token" }
    });
  });

  it("revokes the predecessor's access token immediately", async () => {
    const initial = await mintSession();
    await svc.refreshToken(initial.refresh_token);

    // Replay hands back the successor, but the old access token itself must not
    // keep working — that would defeat rotation entirely.
    await expect(accessTokenIsLive(initial.access_token)).resolves.toBe(false);
  });

  it("rejects a refresh token that was never issued", async () => {
    await expect(
      svc.refreshToken("ref_00000000-0000-4000-8000-000000000000")
    ).rejects.toMatchObject({ response: { code: "invalid_token" } });
  });

  it("rejects a refresh token whose session has expired", async () => {
    const initial = await mintSession();
    await db.query(
      `UPDATE sessions SET expires_at = now() - interval '1 minute' WHERE id = $1::uuid`,
      [initial.access_token.replace(/^acc_/, "")]
    );

    await expect(svc.refreshToken(initial.refresh_token)).rejects.toMatchObject({
      response: { code: "invalid_token" }
    });
  });
});
