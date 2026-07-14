import { afterEach, describe, expect, it } from "vitest";
import { readFeatureFlags, defaultFeatureFlags } from "../feature-flags";

describe("ff_admin_totp", () => {
  afterEach(() => {
    delete process.env.FF_ADMIN_TOTP;
  });

  it("defaults to false", () => {
    expect(defaultFeatureFlags.ff_admin_totp).toBe(false);
    expect(readFeatureFlags().ff_admin_totp).toBe(false);
  });

  it("is true when FF_ADMIN_TOTP=true", () => {
    process.env.FF_ADMIN_TOTP = "true";
    expect(readFeatureFlags().ff_admin_totp).toBe(true);
  });
});
