import { describe, it, expect, afterEach } from "vitest";
import { readFeatureFlags, defaultFeatureFlags } from "../feature-flags";

describe("ff_admin_lead_center", () => {
  afterEach(() => {
    delete process.env.FF_ADMIN_LEAD_CENTER;
  });

  it("defaults to false", () => {
    expect(defaultFeatureFlags.ff_admin_lead_center).toBe(false);
    expect(readFeatureFlags().ff_admin_lead_center).toBe(false);
  });

  it("is enabled when FF_ADMIN_LEAD_CENTER=true", () => {
    process.env.FF_ADMIN_LEAD_CENTER = "true";
    expect(readFeatureFlags().ff_admin_lead_center).toBe(true);
  });
});
