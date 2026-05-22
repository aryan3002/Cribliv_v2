import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock @azure/storage-blob
vi.mock("@azure/storage-blob", () => {
  const mockBlockBlobClient = {
    upload: vi.fn().mockResolvedValue({ _response: { status: 201 } }),
    downloadToBuffer: vi.fn().mockResolvedValue(Buffer.from("STORED-PDF"))
  };
  const mockContainerClient = {
    createIfNotExists: vi.fn().mockResolvedValue({}),
    getBlockBlobClient: vi.fn().mockReturnValue(mockBlockBlobClient)
  };
  const mockBlobServiceClient = {
    getContainerClient: vi.fn().mockReturnValue(mockContainerClient)
  };
  return {
    BlobServiceClient: {
      fromConnectionString: vi.fn().mockReturnValue(mockBlobServiceClient)
    },
    StorageSharedKeyCredential: vi.fn()
  };
});

import { AzurePdfStorage } from "../../pdf/azure-pdf-storage";
import { BlobServiceClient } from "@azure/storage-blob";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getInnerMocks() {
  const blobServiceClient = (BlobServiceClient.fromConnectionString as ReturnType<typeof vi.fn>)
    .mock.results[0]?.value;
  const containerClient = blobServiceClient?.getContainerClient.mock.results[0]?.value;
  const blockBlobClient = containerClient?.getBlockBlobClient.mock.results[0]?.value;
  return { blobServiceClient, containerClient, blockBlobClient };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
});

describe("AzurePdfStorage", () => {
  describe("upload", () => {
    it("uploads to blob path <yyyy>/<mm>/<agreementId>.pdf in the configured container", async () => {
      const storage = new AzurePdfStorage({
        connectionString:
          "DefaultEndpointsProtocol=https;AccountName=test;AccountKey=dGVzdA==;EndpointSuffix=core.windows.net",
        containerName: "rent-agreements",
        clock: () => new Date("2026-06-15T10:00:00Z")
      });

      const buffer = Buffer.from("PDF-CONTENT");
      const result = await storage.upload(buffer, "agr-1234-5678", "en");

      expect(result.blobPath).toBe("2026/06/agr-1234-5678.pdf");
    });

    it("calls BlobServiceClient.fromConnectionString with the provided connection string", async () => {
      const connStr = "DefaultEndpointsProtocol=https;AccountName=test;AccountKey=dGVzdA==";
      const storage = new AzurePdfStorage({
        connectionString: connStr,
        containerName: "rent-agreements",
        clock: () => new Date("2026-01-01T00:00:00Z")
      });

      await storage.upload(Buffer.from("data"), "id-1", "en");
      expect(BlobServiceClient.fromConnectionString).toHaveBeenCalledWith(connStr);
    });

    it("uses the configured container name", async () => {
      const storage = new AzurePdfStorage({
        connectionString: "DefaultEndpointsProtocol=https;AccountName=test;AccountKey=dGVzdA==",
        containerName: "my-custom-container",
        clock: () => new Date("2026-03-01T00:00:00Z")
      });

      await storage.upload(Buffer.from("data"), "id-2", "en");
      const { blobServiceClient } = getInnerMocks();
      expect(blobServiceClient.getContainerClient).toHaveBeenCalledWith("my-custom-container");
    });

    it("sets content-type to application/pdf", async () => {
      const storage = new AzurePdfStorage({
        connectionString: "DefaultEndpointsProtocol=https;AccountName=test;AccountKey=dGVzdA==",
        containerName: "rent-agreements",
        clock: () => new Date("2026-01-01T00:00:00Z")
      });

      await storage.upload(Buffer.from("data"), "id-3", "en");
      const { blockBlobClient } = getInnerMocks();

      expect(blockBlobClient.upload).toHaveBeenCalledWith(
        expect.anything(),
        expect.any(Number),
        expect.objectContaining({
          blobHTTPHeaders: expect.objectContaining({
            blobContentType: "application/pdf",
            blobContentDisposition: "attachment"
          })
        })
      );
    });

    it("passes the buffer and its length to blockBlobClient.upload", async () => {
      const storage = new AzurePdfStorage({
        connectionString: "DefaultEndpointsProtocol=https;AccountName=test;AccountKey=dGVzdA==",
        containerName: "rent-agreements",
        clock: () => new Date("2026-01-01T00:00:00Z")
      });

      const buf = Buffer.from("some-pdf-content");
      await storage.upload(buf, "id-4", "en");
      const { blockBlobClient } = getInnerMocks();

      expect(blockBlobClient.upload).toHaveBeenCalledWith(buf, buf.length, expect.any(Object));
    });

    it("uses clock to derive blob path year/month", async () => {
      const storage = new AzurePdfStorage({
        connectionString: "DefaultEndpointsProtocol=https;AccountName=test;AccountKey=dGVzdA==",
        containerName: "rent-agreements",
        clock: () => new Date("2027-12-25T23:59:59Z")
      });

      const result = await storage.upload(Buffer.from("x"), "agr-xmas", "en");
      expect(result.blobPath).toBe("2027/12/agr-xmas.pdf");
    });

    it("pads single-digit months with leading zero", async () => {
      const storage = new AzurePdfStorage({
        connectionString: "DefaultEndpointsProtocol=https;AccountName=test;AccountKey=dGVzdA==",
        containerName: "rent-agreements",
        clock: () => new Date("2026-01-05T00:00:00Z")
      });

      const result = await storage.upload(Buffer.from("x"), "agr-jan", "en");
      expect(result.blobPath).toBe("2026/01/agr-jan.pdf");
    });

    it("propagates Azure upload errors", async () => {
      // Reset and set up a failing mock
      vi.mocked(BlobServiceClient.fromConnectionString).mockReturnValueOnce({
        getContainerClient: vi.fn().mockReturnValue({
          createIfNotExists: vi.fn().mockResolvedValue({}),
          getBlockBlobClient: vi.fn().mockReturnValue({
            upload: vi.fn().mockRejectedValueOnce(new Error("Azure 500"))
          })
        })
      } as any);

      const storage = new AzurePdfStorage({
        connectionString: "DefaultEndpointsProtocol=https;AccountName=test;AccountKey=dGVzdA==",
        containerName: "rent-agreements",
        clock: () => new Date("2026-01-01T00:00:00Z")
      });

      await expect(storage.upload(Buffer.from("x"), "id-fail", "en")).rejects.toThrow("Azure 500");
    });
  });

  describe("implements PdfStoragePort", () => {
    it("returns { blobPath } matching the convention", async () => {
      const storage = new AzurePdfStorage({
        connectionString: "DefaultEndpointsProtocol=https;AccountName=test;AccountKey=dGVzdA==",
        containerName: "rent-agreements",
        clock: () => new Date("2026-05-18T12:00:00Z")
      });

      const result = await storage.upload(Buffer.from("pdf"), "agreement-abc", "en");
      expect(result).toHaveProperty("blobPath");
      expect(typeof result.blobPath).toBe("string");
      expect(result.blobPath).toMatch(/^\d{4}\/\d{2}\/.+\.pdf$/);
    });
  });

  describe("upload creates the container if absent", () => {
    it("calls containerClient.createIfNotExists before uploading", async () => {
      const storage = new AzurePdfStorage({
        connectionString: "DefaultEndpointsProtocol=https;AccountName=test;AccountKey=dGVzdA==",
        containerName: "rent-agreements",
        clock: () => new Date("2026-01-01T00:00:00Z")
      });
      await storage.upload(Buffer.from("data"), "id-create", "en");
      const { containerClient } = getInnerMocks();
      expect(containerClient.createIfNotExists).toHaveBeenCalled();
    });
  });

  describe("download", () => {
    it("returns the buffer from downloadToBuffer", async () => {
      const storage = new AzurePdfStorage({
        connectionString: "DefaultEndpointsProtocol=https;AccountName=test;AccountKey=dGVzdA==",
        containerName: "rent-agreements"
      });
      const bytes = await storage.download("2026/05/agr-1.pdf");
      expect(bytes?.toString()).toBe("STORED-PDF");
    });

    it("returns null on a 404 RestError", async () => {
      vi.mocked(BlobServiceClient.fromConnectionString).mockReturnValueOnce({
        getContainerClient: vi.fn().mockReturnValue({
          getBlockBlobClient: vi.fn().mockReturnValue({
            downloadToBuffer: vi.fn().mockRejectedValueOnce({ statusCode: 404 })
          })
        })
      } as any);
      const storage = new AzurePdfStorage({
        connectionString: "DefaultEndpointsProtocol=https;AccountName=test;AccountKey=dGVzdA==",
        containerName: "rent-agreements"
      });
      expect(await storage.download("missing.pdf")).toBeNull();
    });
  });
});
