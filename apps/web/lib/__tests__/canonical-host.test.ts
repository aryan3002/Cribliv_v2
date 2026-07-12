import { describe, it, expect } from "vitest";
import { isCanonicalHost } from "../canonical-host";

describe("isCanonicalHost", () => {
  it("treats the production apex and www as canonical (indexable)", () => {
    expect(isCanonicalHost("cribliv.com")).toBe(true);
    expect(isCanonicalHost("www.cribliv.com")).toBe(true);
  });

  it("ignores a port and is case-insensitive", () => {
    expect(isCanonicalHost("CRIBLIV.COM")).toBe(true);
    expect(isCanonicalHost("cribliv.com:443")).toBe(true);
  });

  it("treats the Vercel deploy + previews as NON-canonical (must be noindexed)", () => {
    expect(isCanonicalHost("cribliv-v2-web.vercel.app")).toBe(false);
    expect(isCanonicalHost("cribliv-v2-web-git-feat-x.vercel.app")).toBe(false);
    expect(isCanonicalHost("localhost:3000")).toBe(false);
  });

  it("does not treat a look-alike domain as canonical", () => {
    expect(isCanonicalHost("cribliv.com.evil.com")).toBe(false);
    expect(isCanonicalHost("notcribliv.com")).toBe(false);
    expect(isCanonicalHost("")).toBe(false);
    expect(isCanonicalHost(null)).toBe(false);
    expect(isCanonicalHost(undefined)).toBe(false);
  });
});
