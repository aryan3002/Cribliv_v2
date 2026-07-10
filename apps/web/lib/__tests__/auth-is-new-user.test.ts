import { describe, it, expect, vi, afterEach } from "vitest";
import { authConfig } from "../../auth.config";

const VERIFY_PAYLOAD = {
  data: {
    access_token: "acc_test",
    refresh_token: "ref_test",
    is_new_user: true,
    user: { id: "u1", phone_e164: "+919999999902", role: "tenant", preferred_language: "en" }
  }
};

afterEach(() => vi.unstubAllGlobals());

describe("is_new_user threading", () => {
  it("authorize() returns isNewUser from the verify response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, json: async () => VERIFY_PAYLOAD }))
    );
    const provider = authConfig.providers[0] as unknown as {
      authorize?: (c: unknown) => Promise<Record<string, unknown> | null>;
      options?: { authorize: (c: unknown) => Promise<Record<string, unknown> | null> };
    };
    const authorize = provider.options?.authorize ?? provider.authorize;
    const user = await authorize!({
      challengeId: "ch1",
      otpCode: "123456",
      phone: "+919999999902"
    });
    expect(user?.isNewUser).toBe(true);
  });

  it("jwt callback persists isNewUser on first sign-in", async () => {
    const jwt = authConfig.callbacks!.jwt! as unknown as (args: {
      token: Record<string, unknown>;
      user?: Record<string, unknown>;
    }) => Promise<Record<string, unknown>>;
    const token = await jwt({
      token: {},
      user: {
        id: "u1",
        phone: "+919999999902",
        role: "tenant",
        preferredLanguage: "en",
        accessToken: "acc_test",
        refreshToken: null,
        tokenIssuedAt: Date.now(),
        isNewUser: true
      }
    });
    expect(token.isNewUser).toBe(true);
  });
});
