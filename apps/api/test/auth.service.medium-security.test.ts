import { describe, expect, it } from "vitest";
import { AppStateService } from "../src/common/app-state.service";
import { AuthService, timingSafeOtpEqual } from "../src/modules/auth/auth.service";

function makeDbForRefresh(role: "admin" | "tenant") {
  const insertDurations: string[] = [];
  const client = {
    query: async (sql: string, params: unknown[] = []) => {
      if (sql === "BEGIN" || sql === "COMMIT" || sql === "ROLLBACK")
        return { rowCount: 0, rows: [] };
      if (/UPDATE sessions SET revoked_at/i.test(sql)) return { rowCount: 1, rows: [] };
      if (/INSERT INTO sessions\(user_id, refresh_token_hash, expires_at\)/i.test(sql)) {
        insertDurations.push(String(params[2]));
        return { rowCount: 1, rows: [{ id: "11111111-1111-4111-8111-111111111111" }] };
      }
      return { rowCount: 0, rows: [] };
    },
    release: () => undefined
  };

  const database = {
    isEnabled: () => true,
    query: async (sql: string) => {
      if (/FROM sessions s/i.test(sql)) {
        return {
          rowCount: 1,
          rows: [
            {
              session_id: "sess-1",
              user_id: "22222222-2222-4222-8222-222222222222",
              role
            }
          ]
        };
      }
      return { rowCount: 0, rows: [] };
    },
    getClient: async () => client
  };

  return { database, insertDurations };
}

describe("AuthService medium security fixes", () => {
  it("uses timing-safe OTP compare helper", () => {
    expect(timingSafeOtpEqual("123456", "123456")).toBe(true);
    expect(timingSafeOtpEqual("123456", "123457")).toBe(false);
    expect(timingSafeOtpEqual("123456", "1234567")).toBe(false);
  });

  it("refresh issues short session duration for admin", async () => {
    const { database, insertDurations } = makeDbForRefresh("admin");
    const svc = new AuthService(new AppStateService(), database as never, {} as never);
    await svc.refreshToken("ref_testtoken");
    expect(insertDurations).toContain("4 hours");
  });

  it("refresh keeps long session duration for non-admin", async () => {
    const { database, insertDurations } = makeDbForRefresh("tenant");
    const svc = new AuthService(new AppStateService(), database as never, {} as never);
    await svc.refreshToken("ref_testtoken");
    expect(insertDurations).toContain("30 days");
  });
});
