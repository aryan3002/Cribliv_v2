import { afterEach, describe, expect, it } from "vitest";
import { defaultFeatureFlags, readFeatureFlags } from "../feature-flags";

const ORIGINAL_ENV = process.env.FF_PROGRAMMATIC_SEO_CITIES_ENABLED;

describe("programmatic SEO city feature flag", () => {
  afterEach(() => {
    if (ORIGINAL_ENV == null) {
      delete process.env.FF_PROGRAMMATIC_SEO_CITIES_ENABLED;
    } else {
      process.env.FF_PROGRAMMATIC_SEO_CITIES_ENABLED = ORIGINAL_ENV;
    }
  });

  it("ships enabled by default", () => {
    expect(defaultFeatureFlags.ff_programmatic_seo_cities_enabled).toBe(true);
  });

  it("reads enabled when the env var is unset", () => {
    delete process.env.FF_PROGRAMMATIC_SEO_CITIES_ENABLED;

    expect(readFeatureFlags().ff_programmatic_seo_cities_enabled).toBe(true);
  });

  it("can be disabled by env", () => {
    process.env.FF_PROGRAMMATIC_SEO_CITIES_ENABLED = "off";

    expect(readFeatureFlags().ff_programmatic_seo_cities_enabled).toBe(false);
  });
});
