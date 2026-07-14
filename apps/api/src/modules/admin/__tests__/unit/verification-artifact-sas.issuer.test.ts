import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { VerificationArtifactSasIssuer } from "../../verification-artifact-sas.issuer";

const ENV_KEYS = [
  "AZURE_STORAGE_ACCOUNT_NAME",
  "AZURE_STORAGE_ACCOUNT_KEY",
  "AZURE_STORAGE_CONTAINER_VERIFICATION_ARTIFACTS"
];

describe("VerificationArtifactSasIssuer", () => {
  const saved: Record<string, string | undefined> = {};
  beforeEach(() => {
    for (const k of ENV_KEYS) saved[k] = process.env[k];
  });
  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  it("returns a read-only https SAS url scoped to the container + blob", () => {
    process.env.AZURE_STORAGE_ACCOUNT_NAME = "acct";
    process.env.AZURE_STORAGE_ACCOUNT_KEY = "dGVzdGtleQ=="; // valid base64
    process.env.AZURE_STORAGE_CONTAINER_VERIFICATION_ARTIFACTS = "verification-artifacts";
    const issuer = new VerificationArtifactSasIssuer();
    const out = issuer.issue("listing-1/verification/video_liveness/clip-9.mp4", 600);
    expect(out).not.toBeNull();
    expect(out!.url).toContain(
      "https://acct.blob.core.windows.net/verification-artifacts/listing-1/verification/video_liveness/clip-9.mp4?"
    );
    expect(out!.url).toContain("sig=");
    expect(out!.url).toContain("sp=r"); // read-only permission
    expect(typeof out!.expiresAt).toBe("string");
  });

  it("returns null when storage credentials are absent", () => {
    delete process.env.AZURE_STORAGE_ACCOUNT_NAME;
    delete process.env.AZURE_STORAGE_ACCOUNT_KEY;
    const issuer = new VerificationArtifactSasIssuer();
    expect(issuer.issue("x/y.mp4")).toBeNull();
  });
});
