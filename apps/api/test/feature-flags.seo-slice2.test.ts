import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { defaultFeatureFlags, readFeatureFlags } from "../src/config/feature-flags";

describe("FF_SEO_INDEXING / FF_SEO_GSC", () => {
  const keys = ["FF_SEO_INDEXING", "FF_SEO_GSC"] as const;
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const k of keys) saved[k] = process.env[k];
  });

  afterEach(() => {
    for (const k of keys) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  it("default OFF for both flags", () => {
    expect(defaultFeatureFlags.ff_seo_indexing).toBe(false);
    expect(defaultFeatureFlags.ff_seo_gsc).toBe(false);
    delete process.env.FF_SEO_INDEXING;
    delete process.env.FF_SEO_GSC;
    const flags = readFeatureFlags();
    expect(flags.ff_seo_indexing).toBe(false);
    expect(flags.ff_seo_gsc).toBe(false);
  });

  it("flips on via env var", () => {
    process.env.FF_SEO_INDEXING = "true";
    process.env.FF_SEO_GSC = "1";
    const flags = readFeatureFlags();
    expect(flags.ff_seo_indexing).toBe(true);
    expect(flags.ff_seo_gsc).toBe(true);
  });

  it("treats 'false'/'0'/'off' as off even if set", () => {
    process.env.FF_SEO_INDEXING = "false";
    process.env.FF_SEO_GSC = "off";
    const flags = readFeatureFlags();
    expect(flags.ff_seo_indexing).toBe(false);
    expect(flags.ff_seo_gsc).toBe(false);
  });
});
