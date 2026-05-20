import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock the Azure SDK surface we touch.
vi.mock("@azure/storage-blob", () => {
  return {
    StorageSharedKeyCredential: vi.fn().mockImplementation((account: string, key: string) => ({
      accountName: account,
      _key: key
    })),
    BlobSASPermissions: {
      parse: vi.fn().mockReturnValue({ toString: () => "r" })
    },
    SASProtocol: { Https: "https" },
    generateBlobSASQueryParameters: vi.fn().mockReturnValue({
      toString: () => "sv=2024-11-04&se=fake&sig=fake"
    })
  };
});

import { BlobSASPermissions, generateBlobSASQueryParameters } from "@azure/storage-blob";
import { AzureSasIssuer } from "../../downloads/azure-sas-issuer";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("AzureSasIssuer", () => {
  it("returns a https URL pointing at the configured account + container + blob path", async () => {
    const issuer = new AzureSasIssuer({
      accountName: "criblivstg",
      accountKey: Buffer.from("fake-key").toString("base64"),
      containerName: "rent-agreements"
    });
    const result = await issuer.issue({
      blobPath: "2026/05/abc.pdf",
      ttlSeconds: 3600,
      now: new Date("2026-05-19T10:00:00.000Z")
    });
    expect(result.sasUrl).toBe(
      "https://criblivstg.blob.core.windows.net/rent-agreements/2026/05/abc.pdf?sv=2024-11-04&se=fake&sig=fake"
    );
  });

  it("sets expiresAt = now + ttlSeconds", async () => {
    const issuer = new AzureSasIssuer({
      accountName: "criblivstg",
      accountKey: Buffer.from("fake-key").toString("base64"),
      containerName: "rent-agreements"
    });
    const result = await issuer.issue({
      blobPath: "x.pdf",
      ttlSeconds: 1800,
      now: new Date("2026-05-19T10:00:00.000Z")
    });
    expect(result.expiresAt.toISOString()).toBe("2026-05-19T10:30:00.000Z");
  });

  it("requests read-only permissions per [[PDF-Pipeline]] §183", async () => {
    const issuer = new AzureSasIssuer({
      accountName: "criblivstg",
      accountKey: Buffer.from("fake-key").toString("base64"),
      containerName: "rent-agreements"
    });
    await issuer.issue({
      blobPath: "x.pdf",
      ttlSeconds: 60,
      now: new Date("2026-05-19T10:00:00.000Z")
    });
    expect(BlobSASPermissions.parse).toHaveBeenCalledWith("r");
  });

  it("calls generateBlobSASQueryParameters with the resolved container + blob + expiry", async () => {
    const issuer = new AzureSasIssuer({
      accountName: "criblivstg",
      accountKey: Buffer.from("fake-key").toString("base64"),
      containerName: "rent-agreements"
    });
    const now = new Date("2026-05-19T10:00:00.000Z");
    await issuer.issue({ blobPath: "2026/05/abc.pdf", ttlSeconds: 3600, now });

    expect(generateBlobSASQueryParameters).toHaveBeenCalledTimes(1);
    const call = vi.mocked(generateBlobSASQueryParameters).mock.calls[0];
    const opts = call[0] as unknown as Record<string, unknown>;
    expect(opts.containerName).toBe("rent-agreements");
    expect(opts.blobName).toBe("2026/05/abc.pdf");
    expect(opts.protocol).toBe("https");
    expect((opts.expiresOn as Date).toISOString()).toBe("2026-05-19T11:00:00.000Z");
  });

  it("throws if accountKey is not valid base64-decoded bytes", async () => {
    expect(
      () =>
        new AzureSasIssuer({
          accountName: "criblivstg",
          accountKey: "",
          containerName: "rent-agreements"
        })
    ).toThrow(/account key/i);
  });

  it("propagates errors from generateBlobSASQueryParameters", async () => {
    vi.mocked(generateBlobSASQueryParameters).mockImplementationOnce(() => {
      throw new Error("azure SDK failure");
    });
    const issuer = new AzureSasIssuer({
      accountName: "criblivstg",
      accountKey: Buffer.from("fake-key").toString("base64"),
      containerName: "rent-agreements"
    });
    await expect(
      issuer.issue({
        blobPath: "x.pdf",
        ttlSeconds: 60,
        now: new Date("2026-05-19T10:00:00.000Z")
      })
    ).rejects.toThrow("azure SDK failure");
  });
});
