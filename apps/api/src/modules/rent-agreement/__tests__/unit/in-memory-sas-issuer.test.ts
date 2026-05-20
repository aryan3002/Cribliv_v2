import { describe, expect, it } from "vitest";
import { InMemorySasIssuer } from "../../downloads/in-memory-sas-issuer";

describe("InMemorySasIssuer", () => {
  it("returns a stub:// URL containing the blob path and a token", async () => {
    const issuer = new InMemorySasIssuer();
    const now = new Date("2026-05-19T10:00:00.000Z");
    const result = await issuer.issue({ blobPath: "2026/05/abc.pdf", ttlSeconds: 3600, now });
    expect(result.sasUrl).toMatch(/^stub:\/\//);
    expect(result.sasUrl).toContain("2026/05/abc.pdf");
    expect(result.sasUrl).toMatch(/token=[a-f0-9-]+/);
  });

  it("sets expiresAt = now + ttlSeconds", async () => {
    const issuer = new InMemorySasIssuer();
    const now = new Date("2026-05-19T10:00:00.000Z");
    const result = await issuer.issue({ blobPath: "x.pdf", ttlSeconds: 3600, now });
    expect(result.expiresAt.toISOString()).toBe("2026-05-19T11:00:00.000Z");
  });

  it("issues distinct tokens for repeated calls (no replay)", async () => {
    const issuer = new InMemorySasIssuer();
    const now = new Date("2026-05-19T10:00:00.000Z");
    const a = await issuer.issue({ blobPath: "x.pdf", ttlSeconds: 60, now });
    const b = await issuer.issue({ blobPath: "x.pdf", ttlSeconds: 60, now });
    expect(a.sasUrl).not.toBe(b.sasUrl);
  });
});
