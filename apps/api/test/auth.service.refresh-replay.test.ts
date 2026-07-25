import { describe, expect, it } from "vitest";
import { AppStateService } from "../src/common/app-state.service";
import { AuthService } from "../src/modules/auth/auth.service";

/**
 * Regression cover for the admin-portal lockout.
 *
 * next-auth v5's React Server Component `auth()` branch runs the jwt callback
 * (which rotates the refresh token) but never forwards the resulting
 * Set-Cookie header. The API therefore revoked the live session row while the
 * browser kept holding the old, now-dead tokens — every subsequent admin call
 * 401'd, permanently.
 *
 * The fix is a reuse grace window: a refresh token that has already been
 * rotated replays the SAME successor tokens for a short period, so a rotation
 * whose response was dropped on the floor heals on the next poll instead of
 * bricking the session.
 */

const GRACE_MS = 5 * 60 * 1000;
const USER_ID = "22222222-2222-4222-8222-222222222222";

interface FakeRow {
  id: string;
  user_id: string;
  role: string;
  refresh_token_hash: string;
  expires_at: number;
  revoked_at: number | null;
  rotated_to_session_id: string | null;
}

/**
 * Minimal stand-in for the `sessions` table. Models only the columns the
 * refresh path reads/writes, but models them statefully so a genuine
 * rotate-then-replay sequence is exercised rather than stubbed.
 */
function makeFakeDb(role: "admin" | "tenant", seedToken: string) {
  const rows = new Map<string, FakeRow>();
  let nextId = 1;
  const newId = () => `0000000${nextId++}-1111-4111-8111-111111111111`;

  const seedId = newId();
  rows.set(seedId, {
    id: seedId,
    user_id: USER_ID,
    role,
    refresh_token_hash: seedToken,
    expires_at: Date.now() + 60 * 60 * 1000,
    revoked_at: null,
    rotated_to_session_id: null
  });

  const byRefresh = (hash: string) => [...rows.values()].find((r) => r.refresh_token_hash === hash);
  const isLive = (r: FakeRow) => r.revoked_at === null && r.expires_at > Date.now();

  const client = {
    query: async (sql: string, params: unknown[] = []) => {
      if (sql === "BEGIN" || sql === "COMMIT" || sql === "ROLLBACK")
        return { rowCount: 0, rows: [] };

      // Revokes the predecessor and links it to its successor in one statement.
      if (/UPDATE sessions/i.test(sql) && /revoked_at/i.test(sql)) {
        const target = byRefresh(String(params[0]));
        if (!target) return { rowCount: 0, rows: [] };
        target.revoked_at = Date.now();
        if (params[1]) target.rotated_to_session_id = String(params[1]);
        return { rowCount: 1, rows: [] };
      }

      if (/INSERT INTO sessions/i.test(sql)) {
        const id = newId();
        rows.set(id, {
          id,
          user_id: String(params[0]),
          role,
          refresh_token_hash: String(params[1]),
          expires_at: Date.now() + 60 * 60 * 1000,
          revoked_at: null,
          rotated_to_session_id: null
        });
        return { rowCount: 1, rows: [{ id }] };
      }

      return { rowCount: 0, rows: [] };
    },
    release: () => undefined
  };

  const database = {
    isEnabled: () => true,
    query: async (sql: string, params: unknown[] = []) => {
      // Successor lookup during a replay.
      if (/FROM sessions/i.test(sql) && /s\.id = \$1/i.test(sql)) {
        const row = rows.get(String(params[0]));
        if (!row || !isLive(row)) return { rowCount: 0, rows: [] };
        return {
          rowCount: 1,
          rows: [{ session_id: row.id, refresh_token_hash: row.refresh_token_hash }]
        };
      }

      // Primary lookup by refresh token.
      if (/FROM sessions/i.test(sql)) {
        const row = byRefresh(String(params[0]));
        if (!row) return { rowCount: 0, rows: [] };
        return {
          rowCount: 1,
          rows: [
            {
              session_id: row.id,
              user_id: row.user_id,
              role: row.role,
              is_live: isLive(row),
              rotated_to: row.rotated_to_session_id,
              within_grace: row.revoked_at !== null && row.revoked_at > Date.now() - GRACE_MS
            }
          ]
        };
      }

      return { rowCount: 0, rows: [] };
    },
    getClient: async () => client
  };

  return { database, rows, byRefresh };
}

function makeService(database: unknown) {
  return new AuthService(new AppStateService(), database as never, {} as never);
}

describe("refresh token rotation — reuse grace window", () => {
  it("replays the same successor tokens when the same refresh token is presented twice", async () => {
    const { database } = makeFakeDb("admin", "tok-1");
    const svc = makeService(database);

    // First call rotates normally (this is the RSC auth() call whose
    // Set-Cookie next-auth throws away).
    const first = await svc.refreshToken("ref_tok-1");
    // Second call is the browser retrying with the token it still holds.
    const second = await svc.refreshToken("ref_tok-1");

    expect(second.access_token).toBe(first.access_token);
    expect(second.refresh_token).toBe(first.refresh_token);
  });

  it("keeps the replayed access token usable rather than revoking it", async () => {
    const { database, byRefresh } = makeFakeDb("admin", "tok-1");
    const svc = makeService(database);

    const first = await svc.refreshToken("ref_tok-1");
    await svc.refreshToken("ref_tok-1");

    const successor = byRefresh(first.refresh_token.replace(/^ref_/, ""));
    expect(successor).toBeDefined();
    expect(successor!.revoked_at).toBeNull();
  });

  it("rejects a rotated refresh token once the grace window has passed", async () => {
    const { database, byRefresh } = makeFakeDb("admin", "tok-1");
    const svc = makeService(database);

    await svc.refreshToken("ref_tok-1");

    // Age the revocation past the grace window.
    const original = byRefresh("tok-1")!;
    original.revoked_at = Date.now() - (GRACE_MS + 60_000);

    await expect(svc.refreshToken("ref_tok-1")).rejects.toMatchObject({
      status: 401
    });
  });

  it("still rejects a refresh token that was never issued", async () => {
    const { database } = makeFakeDb("admin", "tok-1");
    const svc = makeService(database);

    await expect(svc.refreshToken("ref_never-issued")).rejects.toMatchObject({
      status: 401
    });
  });
});

describe("refresh token rotation — in-memory fallback", () => {
  it("replays the same successor tokens for a repeated refresh", () => {
    const appState = new AppStateService();
    const session = appState.createSession(USER_ID);

    const first = appState.rotateSession(session.refreshToken);
    const second = appState.rotateSession(session.refreshToken);

    expect(first).not.toBeNull();
    expect(second).toEqual(first);
  });

  it("keeps the replayed session live rather than deleting it", () => {
    const appState = new AppStateService();
    const session = appState.createSession(USER_ID);

    const rotated = appState.rotateSession(session.refreshToken)!;
    appState.rotateSession(session.refreshToken);

    const live = appState.getSessionByRefreshToken(rotated.refreshToken);
    expect(live?.accessToken).toBe(rotated.accessToken);
    expect(live?.userId).toBe(USER_ID);
  });
});
