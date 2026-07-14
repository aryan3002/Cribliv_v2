import { describe, expect, it, vi } from "vitest";
import { signInWithCsrfRetry } from "../sign-in-retry";

describe("signInWithCsrfRetry", () => {
  it("retries once when Auth.js reports the transient MissingCSRF race", async () => {
    const signIn = vi
      .fn()
      .mockResolvedValueOnce({ error: "MissingCSRF" })
      .mockResolvedValueOnce({ error: null, ok: true });
    const delay = vi.fn().mockResolvedValue(undefined);

    const result = await signInWithCsrfRetry(signIn, { challengeId: "ch1" }, delay);

    expect(signIn).toHaveBeenCalledTimes(2);
    expect(signIn).toHaveBeenNthCalledWith(1, "credentials", {
      redirect: false,
      challengeId: "ch1"
    });
    expect(delay).toHaveBeenCalledOnce();
    expect(result).toMatchObject({ error: null, ok: true });
  });

  it("does not retry non-CSRF authentication failures", async () => {
    const signIn = vi.fn().mockResolvedValue({ error: "CredentialsSignin" });
    const delay = vi.fn().mockResolvedValue(undefined);

    const result = await signInWithCsrfRetry(signIn, { challengeId: "ch1" }, delay);

    expect(signIn).toHaveBeenCalledOnce();
    expect(delay).not.toHaveBeenCalled();
    expect(result).toEqual({ error: "CredentialsSignin" });
  });
});
