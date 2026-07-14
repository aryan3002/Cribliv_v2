import { afterEach, describe, expect, it } from "vitest";
import { signupFreeCredits, signupReward } from "../signup-credits";

const KEY = "SIGNUP_FREE_CREDITS";
const original = process.env[KEY];

afterEach(() => {
  if (original === undefined) delete process.env[KEY];
  else process.env[KEY] = original;
});

describe("signupFreeCredits", () => {
  it("defaults to 10 when the env var is unset", () => {
    delete process.env[KEY];
    expect(signupFreeCredits()).toBe(10);
  });

  it("honors a valid integer override", () => {
    process.env[KEY] = "5";
    expect(signupFreeCredits()).toBe(5);
  });

  it("allows 0 (disables the free grant)", () => {
    process.env[KEY] = "0";
    expect(signupFreeCredits()).toBe(0);
  });

  it("falls back to 10 for an empty / whitespace value", () => {
    process.env[KEY] = "   ";
    expect(signupFreeCredits()).toBe(10);
  });

  it("falls back to 10 for non-integer or negative values", () => {
    process.env[KEY] = "abc";
    expect(signupFreeCredits()).toBe(10);
    process.env[KEY] = "-3";
    expect(signupFreeCredits()).toBe(10);
    process.env[KEY] = "2.5";
    expect(signupFreeCredits()).toBe(10);
  });
});

describe("signupReward", () => {
  it("returns a 10-credit reward expiring exactly 90 days later", () => {
    delete process.env[KEY];
    const now = new Date("2026-07-13T08:30:00.000Z");
    expect(signupReward(now)).toEqual({
      credits: 10,
      expiresAt: new Date("2026-10-11T08:30:00.000Z")
    });
  });

  it("returns no expiry when the grant is disabled", () => {
    process.env[KEY] = "0";
    expect(signupReward(new Date("2026-07-13T08:30:00.000Z"))).toEqual({
      credits: 0,
      expiresAt: null
    });
  });
});
