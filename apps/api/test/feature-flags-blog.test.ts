import { describe, it, expect, afterEach } from "vitest";
import { defaultFeatureFlags, readFeatureFlags } from "../src/config/feature-flags";

describe("FF_SEO_BLOG", () => {
  const OLD = process.env.FF_SEO_BLOG;

  afterEach(() => {
    if (OLD === undefined) delete process.env.FF_SEO_BLOG;
    else process.env.FF_SEO_BLOG = OLD;
  });

  it("defaults off", () => {
    expect(defaultFeatureFlags.ff_seo_blog).toBe(false);
    delete process.env.FF_SEO_BLOG;
    expect(readFeatureFlags().ff_seo_blog).toBe(false);
  });

  it("reads FF_SEO_BLOG=true", () => {
    process.env.FF_SEO_BLOG = "true";
    expect(readFeatureFlags().ff_seo_blog).toBe(true);
  });
});
