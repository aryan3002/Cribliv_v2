import { describe, it, expect, afterEach } from "vitest";
import { defaultFeatureFlags, readFeatureFlags } from "../src/config/feature-flags";

describe("ff_callback_leads", () => {
  afterEach(() => {
    delete process.env.FF_CALLBACK_LEADS;
  });

  it("defaults OFF", () => {
    delete process.env.FF_CALLBACK_LEADS;
    expect(defaultFeatureFlags.ff_callback_leads).toBe(false);
    expect(readFeatureFlags().ff_callback_leads).toBe(false);
  });

  it("turns on via FF_CALLBACK_LEADS=true", () => {
    process.env.FF_CALLBACK_LEADS = "true";
    expect(readFeatureFlags().ff_callback_leads).toBe(true);
  });
});
