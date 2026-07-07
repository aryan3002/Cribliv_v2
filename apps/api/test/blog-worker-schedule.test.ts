import { afterEach, describe, expect, it } from "vitest";
import { blogFlagEnabled } from "../src/worker/blog-worker";

describe("blogFlagEnabled", () => {
  const old = process.env.FF_SEO_BLOG;

  afterEach(() => {
    if (old === undefined) delete process.env.FF_SEO_BLOG;
    else process.env.FF_SEO_BLOG = old;
  });

  it("is false by default", () => {
    delete process.env.FF_SEO_BLOG;
    expect(blogFlagEnabled()).toBe(false);
  });

  it("is true when FF_SEO_BLOG=true", () => {
    process.env.FF_SEO_BLOG = "true";
    expect(blogFlagEnabled()).toBe(true);
  });
});
