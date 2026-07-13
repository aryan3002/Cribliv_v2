import "reflect-metadata";
import { BadRequestException } from "@nestjs/common";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppStateService } from "../../../common/app-state.service";
import type { DatabaseService } from "../../../common/database.service";
import { VerificationArtifactStorageService } from "../verification-artifact-storage.service";
import { VerificationService } from "../verification.service";

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
      sizeBytes: 4,
      fileName: "walkthrough.mp4"
    });

    await expect(
      service.upload({
        ownerId: owner.id,
        uploadToken: target.uploadToken,
        file: multerFile({
          content: Buffer.from("data"),
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
          content: Buffer.from("longer"),
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
      sizeBytes: 4,
      fileName: "walkthrough.mp4"
    });

    await expect(
      service.upload({
        ownerId: otherOwner.id,
        uploadToken: crossOwner.uploadToken,
        file: multerFile({ content: Buffer.from("data"), contentType: "video/mp4" })
      })
    ).rejects.toMatchObject({
      response: { code: "forbidden" }
    });

    const expired = await service.createTarget({
      ownerId: owner.id,
      listingId: listing.id,
      kind: "video_liveness",
      contentType: "video/mp4",
      sizeBytes: 4,
      fileName: "walkthrough.mp4"
    });

    vi.setSystemTime(new Date("2026-01-01T00:15:01.000Z"));

    await expect(
      service.upload({
        ownerId: owner.id,
        uploadToken: expired.uploadToken,
        file: multerFile({ content: Buffer.from("data"), contentType: "video/mp4" })
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
      sizeBytes: 4,
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
      sizeBytes: 4,
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
      file: multerFile({ content: Buffer.from("data"), contentType: "video/mp4" })
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
