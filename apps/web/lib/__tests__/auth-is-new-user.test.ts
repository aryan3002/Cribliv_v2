import { describe, it, expect, vi, afterEach } from "vitest";
import { authConfig } from "../../auth.config";

const VERIFY_PAYLOAD = {
  data: {
    access_token: "acc_test",
    refresh_token: "ref_test",
    is_new_user: true,
    signup_reward: {
      credits_granted: 10,
      expires_at: "2026-10-11T08:30:00.000Z"
    },
    user: { id: "u1", phone_e164: "+919999999902", role: "tenant", preferred_language: "en" }
  }
};

afterEach(() => vi.unstubAllGlobals());

function authorizeCallback() {
  const provider = authConfig.providers[0] as unknown as {
    authorize?: (c: unknown) => Promise<Record<string, unknown> | null>;
    options?: { authorize: (c: unknown) => Promise<Record<string, unknown> | null> };
  };
  return provider.options?.authorize ?? provider.authorize;
}

function jwtCallback() {
  return authConfig.callbacks!.jwt! as unknown as (args: {
    token: Record<string, unknown>;
    user?: Record<string, unknown>;
  }) => Promise<Record<string, unknown>>;
}

function sessionCallback() {
  return authConfig.callbacks!.session! as unknown as (args: {
    session: Record<string, any>;
    token: Record<string, any>;
  }) => Promise<Record<string, any>>;
}

describe("new-user reward threading", () => {
  it("authorize() maps isNewUser and signupReward from the verify response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, json: async () => VERIFY_PAYLOAD }))
    );
    const user = await authorizeCallback()!({
      challengeId: "ch1",
      otpCode: "123456",
      phone: "+919999999902"
    });
    expect(user?.isNewUser).toBe(true);
    expect(user?.signupReward).toEqual({
      creditsGranted: 10,
      expiresAt: "2026-10-11T08:30:00.000Z"
    });
  });

  it("jwt callback persists the canonical signup reward on first sign-in", async () => {
    const token = await jwtCallback()({
      token: {},
      user: {
        id: "u1",
        phone: "+919999999902",
        role: "tenant",
        preferredLanguage: "en",
        accessToken: "acc_test",
        refreshToken: null,
        tokenIssuedAt: Date.now(),
        isNewUser: true,
        signupReward: {
          creditsGranted: 10,
          expiresAt: "2026-10-11T08:30:00.000Z"
        }
      }
    });
    expect(token.isNewUser).toBe(true);
    expect(token.signupReward).toEqual({
      creditsGranted: 10,
      expiresAt: "2026-10-11T08:30:00.000Z"
    });
  });

  it("session exposes signup reward independently from current wallet balance", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          data: {
            id: "u1",
            phone_e164: "+919999999902",
            role: "tenant",
            preferred_language: "en",
            wallet_balance: 37,
            promotional_credits_remaining: 4,
            promotional_credits_expires_at: "2026-10-11T08:30:00.000Z"
          }
        })
      }))
    );

    const result = await sessionCallback()({
      session: { user: {} },
      token: {
        id: "u1",
        phone: "+919999999902",
        role: "tenant",
        preferredLanguage: "en",
        accessToken: "acc_test",
        isNewUser: true,
        signupReward: {
          creditsGranted: 10,
          expiresAt: "2026-10-11T08:30:00.000Z"
        }
      }
    });

    expect(result.walletBalance).toBe(37);
    expect(result.signupReward).toEqual({
      creditsGranted: 10,
      expiresAt: "2026-10-11T08:30:00.000Z"
    });
    expect(result.promotionalCredits).toEqual({
      remaining: 4,
      expiresAt: "2026-10-11T08:30:00.000Z"
    });
  });

  it("does not infer a signup reward from a nonzero wallet balance", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          data: {
            id: "u1",
            phone_e164: "+919999999902",
            role: "tenant",
            preferred_language: "en",
            wallet_balance: 99,
            promotional_credits_remaining: 0,
            promotional_credits_expires_at: null
          }
        })
      }))
    );

    const result = await sessionCallback()({
      session: { user: {} },
      token: {
        id: "u1",
        phone: "+919999999902",
        role: "tenant",
        preferredLanguage: "en",
        accessToken: "acc_test",
        isNewUser: true
      }
    });

    expect(result.walletBalance).toBe(99);
    expect(result.signupReward).toBeUndefined();
  });
});
