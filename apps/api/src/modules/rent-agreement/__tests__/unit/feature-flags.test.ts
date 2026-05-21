import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { defaultFeatureFlags, readFeatureFlags } from "../../../../config/feature-flags";

const FLAG_ENV_VARS = ["FF_RENT_AGREEMENT_ENABLED", "FF_RENT_AGREEMENT_ADMIN_ENABLED"] as const;

function clearEnv(): void {
  for (const name of FLAG_ENV_VARS) {
    delete process.env[name];
  }
}

describe("rent-agreement feature flags", () => {
  beforeEach(clearEnv);
  afterEach(clearEnv);

  it("declares ff_rent_agreement_enabled with default OFF", () => {
    expect(defaultFeatureFlags.ff_rent_agreement_enabled).toBe(false);
    expect(readFeatureFlags().ff_rent_agreement_enabled).toBe(false);
  });

  it("declares ff_rent_agreement_admin_enabled with default OFF", () => {
    expect(defaultFeatureFlags.ff_rent_agreement_admin_enabled).toBe(false);
    expect(readFeatureFlags().ff_rent_agreement_admin_enabled).toBe(false);
  });

  it("turns ff_rent_agreement_enabled on when FF_RENT_AGREEMENT_ENABLED=true", () => {
    process.env.FF_RENT_AGREEMENT_ENABLED = "true";
    expect(readFeatureFlags().ff_rent_agreement_enabled).toBe(true);
  });

  it("turns ff_rent_agreement_admin_enabled on when FF_RENT_AGREEMENT_ADMIN_ENABLED=1", () => {
    process.env.FF_RENT_AGREEMENT_ADMIN_ENABLED = "1";
    expect(readFeatureFlags().ff_rent_agreement_admin_enabled).toBe(true);
  });

  it("falls back to default when env value is unrecognised", () => {
    process.env.FF_RENT_AGREEMENT_ENABLED = "maybe";
    expect(readFeatureFlags().ff_rent_agreement_enabled).toBe(
      defaultFeatureFlags.ff_rent_agreement_enabled
    );
  });
});
