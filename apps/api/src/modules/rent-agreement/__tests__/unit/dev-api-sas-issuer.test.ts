import { describe, expect, it } from "vitest";

import { DevApiSasIssuer } from "../../downloads/dev-api-sas-issuer";

describe("DevApiSasIssuer", () => {
  it("returns a sasUrl pointing at the dev pdf-bytes endpoint with the blob path encoded", async () => {
    const issuer = new DevApiSasIssuer({ baseUrl: "http://localhost:4000" });
    const result = await issuer.issue({
      blobPath: "2026/05/abc-123.pdf",
      ttlSeconds: 3600,
      now: new Date("2026-05-17T12:00:00Z")
    });
    expect(result.sasUrl).toBe(
      "http://localhost:4000/v1/rent-agreement/_dev/pdf-bytes/2026%2F05%2Fabc-123.pdf"
    );
  });

  it("computes expiresAt as now + ttlSeconds", async () => {
    const issuer = new DevApiSasIssuer({ baseUrl: "http://localhost:4000" });
    const result = await issuer.issue({
      blobPath: "x/y.pdf",
      ttlSeconds: 60,
      now: new Date("2026-05-17T12:00:00Z")
    });
    expect(result.expiresAt.toISOString()).toBe("2026-05-17T12:01:00.000Z");
  });

  it("defaults baseUrl to empty (relative URL) when not supplied", async () => {
    const issuer = new DevApiSasIssuer();
    const result = await issuer.issue({
      blobPath: "a/b.pdf",
      ttlSeconds: 60,
      now: new Date()
    });
    expect(result.sasUrl.startsWith("/v1/rent-agreement/_dev/pdf-bytes/")).toBe(true);
  });
});
