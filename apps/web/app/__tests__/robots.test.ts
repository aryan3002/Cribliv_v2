import { describe, it, expect, vi, beforeEach } from "vitest";

let __host: string | null = "cribliv.com";
vi.mock("next/headers", () => ({
  headers: () => ({ get: (k: string) => (k.toLowerCase() === "host" ? __host : null) })
}));

import { GET } from "../robots.txt/route";

beforeEach(() => {
  __host = "cribliv.com";
});

describe("robots.txt host-awareness", () => {
  it("blocks all crawling on the *.vercel.app deploy", async () => {
    __host = "cribliv-v2-web.vercel.app";
    const res = GET();
    const body = await res.text();
    expect(body).toContain("Disallow: /\n");
    expect(body).not.toContain("Allow: /");
    expect(body).not.toContain("Sitemap");
    expect(res.headers.get("X-Robots-Tag")).toBe("noindex");
  });

  it("serves the normal allow + sitemap robots on cribliv.com", async () => {
    __host = "cribliv.com";
    const res = GET();
    const body = await res.text();
    expect(body).toContain("Allow: /");
    expect(body).toContain("Sitemap:");
    expect(res.headers.get("X-Robots-Tag")).toBeNull();
  });
});
