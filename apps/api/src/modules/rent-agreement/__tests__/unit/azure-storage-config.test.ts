import { describe, expect, it } from "vitest";

import { buildAzureConnectionString, readAzureStorageConfig } from "../../pdf/azure-storage-config";

describe("buildAzureConnectionString", () => {
  it("produces a standard Azure Blob connection string", () => {
    expect(buildAzureConnectionString("acct", "key123")).toBe(
      "DefaultEndpointsProtocol=https;AccountName=acct;AccountKey=key123;EndpointSuffix=core.windows.net"
    );
  });
});

describe("readAzureStorageConfig", () => {
  it("reports present when both name and key are set", () => {
    const cfg = readAzureStorageConfig({
      AZURE_STORAGE_ACCOUNT_NAME: "acct",
      AZURE_STORAGE_ACCOUNT_KEY: "secret"
    });
    expect(cfg.present).toBe(true);
    expect(cfg.accountName).toBe("acct");
    expect(cfg.accountKey).toBe("secret");
  });

  it("defaults the container name to rent-agreements", () => {
    const cfg = readAzureStorageConfig({
      AZURE_STORAGE_ACCOUNT_NAME: "acct",
      AZURE_STORAGE_ACCOUNT_KEY: "secret"
    });
    expect(cfg.containerName).toBe("rent-agreements");
  });

  it("honours RENT_AGREEMENT_AZURE_CONTAINER override", () => {
    const cfg = readAzureStorageConfig({
      AZURE_STORAGE_ACCOUNT_NAME: "acct",
      AZURE_STORAGE_ACCOUNT_KEY: "secret",
      RENT_AGREEMENT_AZURE_CONTAINER: "custom-box"
    });
    expect(cfg.containerName).toBe("custom-box");
  });

  it("reports not present when the key is missing", () => {
    expect(readAzureStorageConfig({ AZURE_STORAGE_ACCOUNT_NAME: "acct" }).present).toBe(false);
  });

  it("reports not present when the name is missing", () => {
    expect(readAzureStorageConfig({ AZURE_STORAGE_ACCOUNT_KEY: "secret" }).present).toBe(false);
  });

  it("treats blank strings as not present", () => {
    expect(
      readAzureStorageConfig({
        AZURE_STORAGE_ACCOUNT_NAME: "   ",
        AZURE_STORAGE_ACCOUNT_KEY: ""
      }).present
    ).toBe(false);
  });
});
