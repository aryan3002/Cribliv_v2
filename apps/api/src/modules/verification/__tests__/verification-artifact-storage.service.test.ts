import "reflect-metadata";
import { BadRequestException } from "@nestjs/common";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppStateService } from "../../../common/app-state.service";
import type { DatabaseService } from "../../../common/database.service";
import { VerificationArtifactStorageService } from "../verification-artifact-storage.service";
import { VerificationService } from "../verification.service";

const azureMocks = vi.hoisted(() => {
  const uploadData = vi.fn().mockResolvedValue(undefined);
  const createIfNotExists = vi.fn().mockResolvedValue(undefined);
  const getBlockBlobClient = vi.fn(() => ({ uploadData }));
  const getContainerClient = vi.fn(() => ({
    createIfNotExists,
    getBlockBlobClient
  }));
  const BlobServiceClient = vi.fn(() => ({ getContainerClient }));
  const StorageSharedKeyCredential = vi.fn();

  return {
    BlobServiceClient,
    StorageSharedKeyCredential,
    createIfNotExists,
    getBlockBlobClient,
    getContainerClient,
    uploadData
  };
});

vi.mock("@azure/storage-blob", () => ({
  BlobServiceClient: azureMocks.BlobServiceClient,
  StorageSharedKeyCredential: azureMocks.StorageSharedKeyCredential
}));

function createDbStub(enabled: boolean, ownsListing = true) {
  return {
    isEnabled: vi.fn(() => enabled),
    query: vi.fn(async () => ({
      rowCount: ownsListing ? 1 : 0,
      rows: ownsListing ? [{ id: "listing-db-1" }] : []
    }))
  } as unknown as DatabaseService & {
    isEnabled: ReturnType<typeof vi.fn>;
    query: ReturnType<typeof vi.fn>;
  };
}

function ownerFixture() {
  const state = new AppStateService();
  const owner = state.usersByPhone.get("+919999999901");
  const otherOwner = state.usersByPhone.get("+919999999904");
  if (!owner || !otherOwner) {
    throw new Error("Seeded owners missing");
  }

  const listing = [...state.listings.values()].find((item) => item.ownerUserId === owner.id);
  if (!listing) {
    throw new Error("Seeded owner listing missing");
  }

  return { state, owner, otherOwner, listing };
}

const validArtifacts = {
  jpeg: Buffer.from([0xff, 0xd8, 0xff, 0x00]),
  png: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]),
  webp: Buffer.from("RIFF\x00\x00\x00\x00WEBP", "binary"),
  pdf: Buffer.from("%PDF-1.7\n"),
  mp4: Buffer.concat([Buffer.from([0x00, 0x00, 0x00, 0x14]), Buffer.from("ftypisom")]),
  quicktime: Buffer.concat([Buffer.from([0x00, 0x00, 0x00, 0x14]), Buffer.from("ftypqt  ")]),
  webm: Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x00])
};

function multerFile(input: {
  content: Buffer;
  contentType: string;
  originalName?: string;
}): Express.Multer.File {
  return {
    fieldname: "file",
    originalname: input.originalName ?? "artifact.bin",
    encoding: "7bit",
    mimetype: input.contentType,
    size: input.content.length,
    buffer: input.content,
    destination: "",
    filename: "",
    path: "",
    stream: undefined as never
  };
}

describe("VerificationArtifactStorageService", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
    delete process.env.AZURE_STORAGE_CONNECTION_STRING;
    delete process.env.AZURE_STORAGE_ACCOUNT_NAME;
    delete process.env.AZURE_STORAGE_ACCOUNT_KEY;
    delete process.env.AZURE_STORAGE_CONTAINER_VERIFICATION_ARTIFACTS;
    azureMocks.BlobServiceClient.mockClear();
    azureMocks.StorageSharedKeyCredential.mockClear();
    azureMocks.createIfNotExists.mockClear();
    azureMocks.getBlockBlobClient.mockClear();
    azureMocks.getContainerClient.mockClear();
    azureMocks.uploadData.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("rejects an owner who does not own the listing in database mode", async () => {
    const { state, owner } = ownerFixture();
    const db = createDbStub(true, false);
    const service = new VerificationArtifactStorageService(state, db);

    await expect(
      service.createTarget({
        ownerId: owner.id,
        listingId: "00000000-0000-4000-8000-000000000001",
        kind: "video_liveness",
        contentType: "video/mp4",
        sizeBytes: 1024,
        fileName: "walkthrough.mp4"
      })
    ).rejects.toMatchObject({
      response: { code: "not_found" }
    });

    expect(db.query).toHaveBeenCalledWith(expect.stringContaining("FROM listings"), [
      "00000000-0000-4000-8000-000000000001",
      owner.id
    ]);
  });

  it("rejects an owner who does not own the listing in in-memory mode", async () => {
    const { state, otherOwner, listing } = ownerFixture();
    const service = new VerificationArtifactStorageService(state, createDbStub(false));

    await expect(
      service.createTarget({
        ownerId: otherOwner.id,
        listingId: listing.id,
        kind: "video_liveness",
        contentType: "video/mp4",
        sizeBytes: 1024,
        fileName: "walkthrough.mp4"
      })
    ).rejects.toMatchObject({
      response: { code: "not_found" }
    });
  });

  it("accepts mp4/webm/quicktime video up to 50 MB", async () => {
    const { state, owner, listing } = ownerFixture();
    const service = new VerificationArtifactStorageService(state, createDbStub(false));

    for (const contentType of ["video/mp4", "video/webm", "video/quicktime"]) {
      const target = await service.createTarget({
        ownerId: owner.id,
        listingId: listing.id,
        kind: "video_liveness",
        contentType,
        sizeBytes: 50 * 1024 * 1024,
        fileName: `owner walkthrough.${contentType.split("/")[1]}`
      });

      expect(target.uploadToken).toMatch(/^[0-9a-f-]{36}$/i);
      expect(target.uploadUrl).toBe("/owner/verification/artifacts/upload");
      expect(target.blobPath).toContain(`${listing.id}/verification/video_liveness/`);
      expect(target.expiresAt).toBe("2026-01-01T00:15:00.000Z");
    }
  });

  it("accepts PDF/JPEG/PNG/WebP electricity evidence up to 15 MB", async () => {
    const { state, owner, listing } = ownerFixture();
    const service = new VerificationArtifactStorageService(state, createDbStub(false));

    for (const contentType of ["application/pdf", "image/jpeg", "image/png", "image/webp"]) {
      const target = await service.createTarget({
        ownerId: owner.id,
        listingId: listing.id,
        kind: "electricity_bill",
        contentType,
        sizeBytes: 15 * 1024 * 1024,
        fileName: "latest bill"
      });

      expect(target.uploadUrl).toBe("/owner/verification/artifacts/upload");
      expect(target.blobPath).toContain(`${listing.id}/verification/electricity_bill/latest_bill-`);
    }
  });

  it("rejects a mismatched content type or declared size", async () => {
    const { state, owner, listing } = ownerFixture();
    const service = new VerificationArtifactStorageService(state, createDbStub(false));

    await expect(
      service.createTarget({
        ownerId: owner.id,
        listingId: listing.id,
        kind: "video_liveness",
        contentType: "application/pdf",
        sizeBytes: 1024,
        fileName: "not-video.pdf"
      })
    ).rejects.toMatchObject({
      response: { code: "invalid_content_type" }
    });

    await expect(
      service.createTarget({
        ownerId: owner.id,
        listingId: listing.id,
        kind: "electricity_bill",
        contentType: "application/pdf",
        sizeBytes: 15 * 1024 * 1024 + 1,
        fileName: "too-large.pdf"
      })
    ).rejects.toMatchObject({
      response: { code: "invalid_file_size" }
    });

    const target = await service.createTarget({
      ownerId: owner.id,
      listingId: listing.id,
      kind: "video_liveness",
      contentType: "video/mp4",
      sizeBytes: validArtifacts.mp4.length,
      fileName: "walkthrough.mp4"
    });

    await expect(
      service.upload({
        ownerId: owner.id,
        uploadToken: target.uploadToken,
        file: multerFile({
          content: validArtifacts.webm,
          contentType: "video/webm",
          originalName: "walkthrough.webm"
        })
      })
    ).rejects.toMatchObject({
      response: { code: "invalid_content_type" }
    });

    await expect(
      service.upload({
        ownerId: owner.id,
        uploadToken: target.uploadToken,
        file: multerFile({
          content: Buffer.concat([validArtifacts.mp4, Buffer.from("extra")]),
          contentType: "video/mp4",
          originalName: "walkthrough.mp4"
        })
      })
    ).rejects.toMatchObject({
      response: { code: "invalid_file_size" }
    });
  });

  it("rejects expired and cross-owner upload tokens", async () => {
    const { state, owner, otherOwner, listing } = ownerFixture();
    const service = new VerificationArtifactStorageService(state, createDbStub(false));

    const crossOwner = await service.createTarget({
      ownerId: owner.id,
      listingId: listing.id,
      kind: "video_liveness",
      contentType: "video/mp4",
      sizeBytes: validArtifacts.mp4.length,
      fileName: "walkthrough.mp4"
    });

    await expect(
      service.upload({
        ownerId: otherOwner.id,
        uploadToken: crossOwner.uploadToken,
        file: multerFile({ content: validArtifacts.mp4, contentType: "video/mp4" })
      })
    ).rejects.toMatchObject({
      response: { code: "forbidden" }
    });

    const expired = await service.createTarget({
      ownerId: owner.id,
      listingId: listing.id,
      kind: "video_liveness",
      contentType: "video/mp4",
      sizeBytes: validArtifacts.mp4.length,
      fileName: "walkthrough.mp4"
    });

    vi.setSystemTime(new Date("2026-01-01T00:15:01.000Z"));

    await expect(
      service.upload({
        ownerId: owner.id,
        uploadToken: expired.uploadToken,
        file: multerFile({ content: validArtifacts.mp4, contentType: "video/mp4" })
      })
    ).rejects.toMatchObject({
      response: { code: "upload_token_expired" }
    });
  });

  it("requires upload before completion", async () => {
    const { state, owner, listing } = ownerFixture();
    const service = new VerificationArtifactStorageService(state, createDbStub(false));

    const target = await service.createTarget({
      ownerId: owner.id,
      listingId: listing.id,
      kind: "electricity_bill",
      contentType: "application/pdf",
      sizeBytes: validArtifacts.pdf.length,
      fileName: "bill.pdf"
    });

    await expect(
      service.complete({
        ownerId: owner.id,
        listingId: listing.id,
        uploadToken: target.uploadToken,
        blobPath: target.blobPath
      })
    ).rejects.toMatchObject({
      response: { code: "artifact_not_uploaded" }
    });
  });

  it("requires a completed listing-scoped artifact before verification submission", async () => {
    const { state, owner, listing } = ownerFixture();
    const service = new VerificationArtifactStorageService(state, createDbStub(false));

    const target = await service.createTarget({
      ownerId: owner.id,
      listingId: listing.id,
      kind: "video_liveness",
      contentType: "video/mp4",
      sizeBytes: validArtifacts.mp4.length,
      fileName: "walkthrough.mp4"
    });

    await expect(
      service.assertCompletedArtifact({
        ownerId: owner.id,
        listingId: listing.id,
        kind: "video_liveness",
        blobPath: target.blobPath
      })
    ).rejects.toMatchObject({
      response: { code: "artifact_not_completed" }
    });

    await service.upload({
      ownerId: owner.id,
      uploadToken: target.uploadToken,
      file: multerFile({ content: validArtifacts.mp4, contentType: "video/mp4" })
    });
    await service.complete({
      ownerId: owner.id,
      listingId: listing.id,
      uploadToken: target.uploadToken,
      blobPath: target.blobPath
    });

    await expect(
      service.assertCompletedArtifact({
        ownerId: owner.id,
        listingId: listing.id,
        kind: "video_liveness",
        blobPath: target.blobPath
      })
    ).resolves.toBeUndefined();

    const otherListing = [...state.listings.values()].find(
      (item) => item.ownerUserId === owner.id && item.id !== listing.id
    );
    if (!otherListing) {
      throw new Error("Second owner listing missing");
    }

    await expect(
      service.assertCompletedArtifact({
        ownerId: owner.id,
        listingId: otherListing.id,
        kind: "video_liveness",
        blobPath: target.blobPath
      })
    ).rejects.toMatchObject({
      response: { code: "invalid_blob_path" }
    });
  });

  it("rejects a second upload before completion and after completion", async () => {
    const { state, owner, listing } = ownerFixture();
    const service = new VerificationArtifactStorageService(state, createDbStub(false));
    const target = await service.createTarget({
      ownerId: owner.id,
      listingId: listing.id,
      kind: "video_liveness",
      contentType: "video/mp4",
      sizeBytes: validArtifacts.mp4.length,
      fileName: "walkthrough.mp4"
    });

    await service.upload({
      ownerId: owner.id,
      uploadToken: target.uploadToken,
      file: multerFile({ content: validArtifacts.mp4, contentType: "video/mp4" })
    });

    await expect(
      service.upload({
        ownerId: owner.id,
        uploadToken: target.uploadToken,
        file: multerFile({ content: validArtifacts.mp4, contentType: "video/mp4" })
      })
    ).rejects.toMatchObject({
      response: { code: "artifact_already_uploaded" }
    });

    await service.complete({
      ownerId: owner.id,
      listingId: listing.id,
      uploadToken: target.uploadToken,
      blobPath: target.blobPath
    });

    await expect(
      service.upload({
        ownerId: owner.id,
        uploadToken: target.uploadToken,
        file: multerFile({ content: validArtifacts.mp4, contentType: "video/mp4" })
      })
    ).rejects.toMatchObject({
      response: { code: "upload_token_consumed" }
    });
  });

  it("rejects repeated complete for a consumed token", async () => {
    const { state, owner, listing } = ownerFixture();
    const service = new VerificationArtifactStorageService(state, createDbStub(false));
    const target = await service.createTarget({
      ownerId: owner.id,
      listingId: listing.id,
      kind: "electricity_bill",
      contentType: "application/pdf",
      sizeBytes: validArtifacts.pdf.length,
      fileName: "bill.pdf"
    });

    await service.upload({
      ownerId: owner.id,
      uploadToken: target.uploadToken,
      file: multerFile({ content: validArtifacts.pdf, contentType: "application/pdf" })
    });
    await service.complete({
      ownerId: owner.id,
      listingId: listing.id,
      uploadToken: target.uploadToken,
      blobPath: target.blobPath
    });

    await expect(
      service.complete({
        ownerId: owner.id,
        listingId: listing.id,
        uploadToken: target.uploadToken,
        blobPath: target.blobPath
      })
    ).rejects.toMatchObject({
      response: { code: "upload_token_consumed" }
    });
  });

  it("rejects spoofed buffers whose signatures do not match the declared content type", async () => {
    const { state, owner, listing } = ownerFixture();
    const service = new VerificationArtifactStorageService(state, createDbStub(false));
    const target = await service.createTarget({
      ownerId: owner.id,
      listingId: listing.id,
      kind: "electricity_bill",
      contentType: "image/png",
      sizeBytes: validArtifacts.pdf.length,
      fileName: "bill.png"
    });

    await expect(
      service.upload({
        ownerId: owner.id,
        uploadToken: target.uploadToken,
        file: multerFile({ content: validArtifacts.pdf, contentType: "image/png" })
      })
    ).rejects.toMatchObject({
      response: { code: "invalid_file_signature" }
    });

    expect((service as unknown as { localBytes: Map<string, unknown> }).localBytes.size).toBe(0);
  });

  it("rechecks in-memory listing ownership on upload and complete", async () => {
    const { state, owner, otherOwner, listing } = ownerFixture();
    const service = new VerificationArtifactStorageService(state, createDbStub(false));
    const uploadTarget = await service.createTarget({
      ownerId: owner.id,
      listingId: listing.id,
      kind: "video_liveness",
      contentType: "video/mp4",
      sizeBytes: validArtifacts.mp4.length,
      fileName: "walkthrough.mp4"
    });

    listing.ownerUserId = otherOwner.id;
    await expect(
      service.upload({
        ownerId: owner.id,
        uploadToken: uploadTarget.uploadToken,
        file: multerFile({ content: validArtifacts.mp4, contentType: "video/mp4" })
      })
    ).rejects.toMatchObject({
      response: { code: "not_found" }
    });

    listing.ownerUserId = owner.id;
    const completeTarget = await service.createTarget({
      ownerId: owner.id,
      listingId: listing.id,
      kind: "video_liveness",
      contentType: "video/mp4",
      sizeBytes: validArtifacts.mp4.length,
      fileName: "walkthrough.mp4"
    });
    await service.upload({
      ownerId: owner.id,
      uploadToken: completeTarget.uploadToken,
      file: multerFile({ content: validArtifacts.mp4, contentType: "video/mp4" })
    });

    state.listings.delete(listing.id);
    await expect(
      service.complete({
        ownerId: owner.id,
        listingId: listing.id,
        uploadToken: completeTarget.uploadToken,
        blobPath: completeTarget.blobPath
      })
    ).rejects.toMatchObject({
      response: { code: "not_found" }
    });
  });

  it("rechecks database listing ownership on upload and complete and supports a DB happy flow", async () => {
    const { state, owner } = ownerFixture();
    const db = createDbStub(true);
    const service = new VerificationArtifactStorageService(state, db);
    const listingId = "00000000-0000-4000-8000-000000000001";
    const target = await service.createTarget({
      ownerId: owner.id,
      listingId,
      kind: "video_liveness",
      contentType: "video/mp4",
      sizeBytes: validArtifacts.mp4.length,
      fileName: "walkthrough.mp4"
    });

    await service.upload({
      ownerId: owner.id,
      uploadToken: target.uploadToken,
      file: multerFile({ content: validArtifacts.mp4, contentType: "video/mp4" })
    });
    await service.complete({
      ownerId: owner.id,
      listingId,
      uploadToken: target.uploadToken,
      blobPath: target.blobPath
    });
    await expect(
      service.assertCompletedArtifact({
        ownerId: owner.id,
        listingId,
        kind: "video_liveness",
        blobPath: target.blobPath
      })
    ).resolves.toBeUndefined();
    expect(db.query).toHaveBeenCalledTimes(4);

    const revokedDb = createDbStub(true);
    revokedDb.query
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: listingId }] })
      .mockResolvedValueOnce({ rowCount: 0, rows: [] });
    const revokedService = new VerificationArtifactStorageService(state, revokedDb);
    const revokedTarget = await revokedService.createTarget({
      ownerId: owner.id,
      listingId,
      kind: "video_liveness",
      contentType: "video/mp4",
      sizeBytes: validArtifacts.mp4.length,
      fileName: "walkthrough.mp4"
    });

    await expect(
      revokedService.upload({
        ownerId: owner.id,
        uploadToken: revokedTarget.uploadToken,
        file: multerFile({ content: validArtifacts.mp4, contentType: "video/mp4" })
      })
    ).rejects.toMatchObject({
      response: { code: "not_found" }
    });

    const removedBeforeCompleteDb = createDbStub(true);
    removedBeforeCompleteDb.query
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: listingId }] })
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: listingId }] })
      .mockResolvedValueOnce({ rowCount: 0, rows: [] });
    const removedBeforeCompleteService = new VerificationArtifactStorageService(
      state,
      removedBeforeCompleteDb
    );
    const removedBeforeCompleteTarget = await removedBeforeCompleteService.createTarget({
      ownerId: owner.id,
      listingId,
      kind: "video_liveness",
      contentType: "video/mp4",
      sizeBytes: validArtifacts.mp4.length,
      fileName: "walkthrough.mp4"
    });
    await removedBeforeCompleteService.upload({
      ownerId: owner.id,
      uploadToken: removedBeforeCompleteTarget.uploadToken,
      file: multerFile({ content: validArtifacts.mp4, contentType: "video/mp4" })
    });

    await expect(
      removedBeforeCompleteService.complete({
        ownerId: owner.id,
        listingId,
        uploadToken: removedBeforeCompleteTarget.uploadToken,
        blobPath: removedBeforeCompleteTarget.blobPath
      })
    ).rejects.toMatchObject({
      response: { code: "not_found" }
    });
  });

  it("releases local buffers on completion and sweeps expired uncompleted bytes and completed records", async () => {
    const { state, owner, listing } = ownerFixture();
    const service = new VerificationArtifactStorageService(state, createDbStub(false));
    const completedTarget = await service.createTarget({
      ownerId: owner.id,
      listingId: listing.id,
      kind: "video_liveness",
      contentType: "video/mp4",
      sizeBytes: validArtifacts.mp4.length,
      fileName: "walkthrough.mp4"
    });

    await service.upload({
      ownerId: owner.id,
      uploadToken: completedTarget.uploadToken,
      file: multerFile({ content: validArtifacts.mp4, contentType: "video/mp4" })
    });
    expect((service as unknown as { localBytes: Map<string, unknown> }).localBytes.size).toBe(1);
    await service.complete({
      ownerId: owner.id,
      listingId: listing.id,
      uploadToken: completedTarget.uploadToken,
      blobPath: completedTarget.blobPath
    });
    expect((service as unknown as { localBytes: Map<string, unknown> }).localBytes.size).toBe(0);

    const staleTarget = await service.createTarget({
      ownerId: owner.id,
      listingId: listing.id,
      kind: "electricity_bill",
      contentType: "application/pdf",
      sizeBytes: validArtifacts.pdf.length,
      fileName: "bill.pdf"
    });
    await service.upload({
      ownerId: owner.id,
      uploadToken: staleTarget.uploadToken,
      file: multerFile({ content: validArtifacts.pdf, contentType: "application/pdf" })
    });
    expect((service as unknown as { localBytes: Map<string, unknown> }).localBytes.size).toBe(1);

    vi.setSystemTime(new Date("2026-01-01T00:15:01.000Z"));

    await expect(
      service.assertCompletedArtifact({
        ownerId: owner.id,
        listingId: listing.id,
        kind: "video_liveness",
        blobPath: completedTarget.blobPath
      })
    ).rejects.toMatchObject({
      response: { code: "artifact_not_completed" }
    });
    expect((service as unknown as { localBytes: Map<string, unknown> }).localBytes.size).toBe(0);
    expect((service as unknown as { targets: Map<string, unknown> }).targets.size).toBe(0);
  });

  it("creates Azure containers before uploading bytes with the expected content type", async () => {
    process.env.AZURE_STORAGE_ACCOUNT_NAME = "acct";
    process.env.AZURE_STORAGE_ACCOUNT_KEY = "key";
    process.env.AZURE_STORAGE_CONTAINER_VERIFICATION_ARTIFACTS = "verify-artifacts";
    const { state, owner, listing } = ownerFixture();
    const service = new VerificationArtifactStorageService(state, createDbStub(false));
    const target = await service.createTarget({
      ownerId: owner.id,
      listingId: listing.id,
      kind: "electricity_bill",
      contentType: "application/pdf",
      sizeBytes: validArtifacts.pdf.length,
      fileName: "bill.pdf"
    });

    await service.upload({
      ownerId: owner.id,
      uploadToken: target.uploadToken,
      file: multerFile({ content: validArtifacts.pdf, contentType: "application/pdf" })
    });

    expect(azureMocks.getContainerClient).toHaveBeenCalledWith("verify-artifacts");
    expect(azureMocks.createIfNotExists).toHaveBeenCalledTimes(1);
    expect(azureMocks.getBlockBlobClient).toHaveBeenCalledWith(target.blobPath);
    expect(azureMocks.uploadData).toHaveBeenCalledWith(validArtifacts.pdf, {
      blobHTTPHeaders: { blobContentType: "application/pdf" }
    });
    expect((service as unknown as { localBytes: Map<string, unknown> }).localBytes.size).toBe(0);
  });
});

describe("VerificationService artifact guard", () => {
  const previousFlag = process.env.FF_REAL_VERIFICATION_PROVIDER;

  afterEach(() => {
    process.env.FF_REAL_VERIFICATION_PROVIDER = previousFlag;
    vi.restoreAllMocks();
  });

  it("validates video artifacts before provider execution", async () => {
    process.env.FF_REAL_VERIFICATION_PROVIDER = "true";
    const { state, owner, listing } = ownerFixture();
    const artifacts = {
      assertCompletedArtifact: vi
        .fn()
        .mockRejectedValue(
          new BadRequestException({ code: "artifact_not_completed", message: "Incomplete" })
        )
    };
    const livenessProvider = { evaluate: vi.fn() };
    const electricityProvider = { evaluate: vi.fn() };
    const service = new VerificationService(
      state,
      createDbStub(false),
      livenessProvider as never,
      electricityProvider as never,
      artifacts as never
    );

    await expect(
      service.submitVideo(owner.id, {
        listing_id: listing.id,
        artifact_blob_path: `${listing.id}/verification/video_liveness/missing.mp4`
      })
    ).rejects.toMatchObject({
      response: { code: "artifact_not_completed" }
    });

    expect(artifacts.assertCompletedArtifact).toHaveBeenCalledWith({
      ownerId: owner.id,
      listingId: listing.id,
      kind: "video_liveness",
      blobPath: `${listing.id}/verification/video_liveness/missing.mp4`
    });
    expect(livenessProvider.evaluate).not.toHaveBeenCalled();
  });

  it("validates electricity bill artifacts only when a bill path is supplied", async () => {
    process.env.FF_REAL_VERIFICATION_PROVIDER = "false";
    const { state, owner, listing } = ownerFixture();
    const artifacts = { assertCompletedArtifact: vi.fn() };
    const service = new VerificationService(
      state,
      createDbStub(false),
      { evaluate: vi.fn() } as never,
      { evaluate: vi.fn() } as never,
      artifacts as never
    );

    await service.submitElectricity(owner.id, {
      listing_id: listing.id,
      consumer_id: "CONS-1234",
      address_text: `Sector 52 ${listing.city}`
    });

    expect(artifacts.assertCompletedArtifact).not.toHaveBeenCalled();

    await service.submitElectricity(owner.id, {
      listing_id: listing.id,
      consumer_id: "CONS-1234",
      address_text: `Sector 52 ${listing.city}`,
      bill_artifact_blob_path: `${listing.id}/verification/electricity_bill/bill.pdf`
    });

    expect(artifacts.assertCompletedArtifact).toHaveBeenCalledWith({
      ownerId: owner.id,
      listingId: listing.id,
      kind: "electricity_bill",
      blobPath: `${listing.id}/verification/electricity_bill/bill.pdf`
    });
  });
});
