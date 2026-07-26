import { describe, it, expect, vi, afterEach } from "vitest";
import { authConfig } from "../../auth.config";

/**
 * A failed token refresh used to be indistinguishable from a healthy session.
 *
 * `fetch` does not throw on a non-2xx response, so the `if (res.ok)` branch was
 * simply skipped and the callback returned the dead token unchanged. NextAuth
 * kept reporting "authenticated", middleware kept admitting the user, and every
 * API call 401'd — a zombie session with no route back except a manual sign-out.
 *
 * The refresh failure must now be visible on the token and on the session so the
 * app can sign the user out instead of rendering a permanently broken portal.
 */

const AN_HOUR_AGO = Date.now() - 60 * 60 * 1000;

function jwtCallback() {
  return authConfig.callbacks!.jwt! as unknown as (args: {
    token: Record<string, any>;
    user?: Record<string, unknown>;
  }) => Promise<Record<string, any>>;
}

function sessionCallback() {
  return authConfig.callbacks!.session! as unknown as (args: {
    session: Record<string, any>;
    token: Record<string, any>;
  }) => Promise<Record<string, any>>;
}

function staleAdminToken(overrides: Record<string, unknown> = {}) {
  return {
    id: "u1",
    phone: "+919999999903",
    role: "admin",
    preferredLanguage: "en",
    accessToken: "acc_dead",
    refreshToken: "ref_dead",
    tokenIssuedAt: AN_HOUR_AGO,
    ...overrides
  };
}

afterEach(() => vi.unstubAllGlobals());

describe("token refresh failure is surfaced, not swallowed", () => {
  it("flags the token when the refresh endpoint rejects the refresh token", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        status: 401,
        json: async () => ({ error: { code: "invalid_token" } })
      }))
    );

    const token = await jwtCallback()({ token: staleAdminToken() });

    expect(token.error).toBe("RefreshFailed");
  });

  it("clears a previous failure once a refresh succeeds", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          data: { access_token: "acc_fresh", refresh_token: "ref_fresh" }
        })
      }))
    );

    const token = await jwtCallback()({
      token: staleAdminToken({ error: "RefreshFailed" })
    });

    expect(token.error).toBeUndefined();
    expect(token.accessToken).toBe("acc_fresh");
    expect(token.refreshToken).toBe("ref_fresh");
  });

  it("keeps retrying after a failure so a replayed rotation can heal the session", async () => {
    // The API replays a rotated refresh token within its grace window, so the
    // next poll is exactly what recovers a rotation whose cookie was dropped.
    // That only works if tokenIssuedAt is NOT advanced on failure.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, status: 401, json: async () => ({}) }))
    );

    const token = await jwtCallback()({ token: staleAdminToken() });

    expect(token.tokenIssuedAt).toBe(AN_HOUR_AGO);
  });

  it("flags a stale token that has no refresh token to recover with", async () => {
    // Otherwise the 401 recovery path would retry forever against a token that
    // can never come back.
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const token = await jwtCallback()({ token: staleAdminToken({ refreshToken: null }) });

    expect(token.error).toBe("RefreshFailed");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not attempt a refresh for a freshly issued token", async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ data: {} }) }));
    vi.stubGlobal("fetch", fetchMock);

    const token = await jwtCallback()({
      token: staleAdminToken({ tokenIssuedAt: Date.now() })
    });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(token.error).toBeUndefined();
  });
});

describe("session exposes the refresh failure", () => {
  it("propagates the token error onto the session", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, status: 401, json: async () => ({}) }))
    );

    const session = await sessionCallback()({
      session: { user: {} },
      token: staleAdminToken({ error: "RefreshFailed" })
    });

    expect(session.error).toBe("RefreshFailed");
  });

  it("leaves a healthy session unflagged", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          data: {
            id: "u1",
            phone_e164: "+919999999903",
            role: "admin",
            preferred_language: "en",
            wallet_balance: 0
          }
        })
      }))
    );

    const session = await sessionCallback()({
      session: { user: {} },
      token: staleAdminToken({ accessToken: "acc_live" })
    });

    expect(session.error).toBeUndefined();
    expect(session.user.role).toBe("admin");
  });
});
