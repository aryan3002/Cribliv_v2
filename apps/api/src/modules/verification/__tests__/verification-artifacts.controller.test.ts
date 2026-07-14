import "reflect-metadata";
import { INestApplication } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppStateService } from "../../../common/app-state.service";
import { AuthGuard } from "../../../common/auth.guard";
import { DatabaseService } from "../../../common/database.service";
import { RolesGuard } from "../../../common/roles.guard";
import { VerificationArtifactStorageService } from "../verification-artifact-storage.service";
import { VerificationController } from "../verification.controller";
import { VerificationService } from "../verification.service";

describe("Verification artifact controller", () => {
  let app: INestApplication;
  let appState: AppStateService;
  let artifacts: {
    createTarget: ReturnType<typeof vi.fn>;
    upload: ReturnType<typeof vi.fn>;
    complete: ReturnType<typeof vi.fn>;
  };
  let ownerToken: string;
  let tenantToken: string;
  let ownerId: string;
  let listingId: string;

  beforeEach(async () => {
    appState = new AppStateService();
    const owner = appState.usersByPhone.get("+919999999901");
    const tenant = appState.usersByPhone.get("+919999999902");
    if (!owner || !tenant) {
      throw new Error("Seeded users missing");
    }
    ownerId = owner.id;
    ownerToken = appState.createSession(owner.id).accessToken;
    tenantToken = appState.createSession(tenant.id).accessToken;
    const listing = [...appState.listings.values()].find((item) => item.ownerUserId === ownerId);
    if (!listing) {
      throw new Error("Seeded owner listing missing");
    }
    listingId = listing.id;

    artifacts = {
      createTarget: vi.fn().mockResolvedValue({
        uploadToken: "upload-token-1",
        uploadUrl: "/owner/verification/artifacts/upload",
        blobPath: `${listingId}/verification/video_liveness/clip.mp4`,
        expiresAt: "2026-01-01T00:15:00.000Z"
      }),
      upload: vi.fn().mockResolvedValue({
        blobPath: `${listingId}/verification/video_liveness/clip.mp4`
      }),
      complete: vi.fn().mockResolvedValue({
        blobPath: `${listingId}/verification/video_liveness/clip.mp4`
      })
    };

    const moduleRef = await Test.createTestingModule({
      controllers: [VerificationController],
      providers: [
        AuthGuard,
        RolesGuard,
        Reflector,
        { provide: AppStateService, useValue: appState },
        {
          provide: DatabaseService,
          useValue: { isEnabled: () => false, query: vi.fn() }
        },
        {
          provide: VerificationService,
          useValue: {
            submitVideo: vi.fn(),
            submitElectricity: vi.fn(),
            status: vi.fn()
          }
        },
        { provide: VerificationArtifactStorageService, useValue: artifacts }
      ]
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterEach(async () => {
    await app.close();
    vi.restoreAllMocks();
  });

  function http() {
    return request(app.getHttpServer());
  }

  it("keeps auth and owner role guards on artifact routes", async () => {
    await http()
      .post("/owner/verification/artifacts/presign")
      .send({
        listing_id: listingId,
        kind: "video_liveness",
        content_type: "video/mp4",
        size_bytes: 4,
        file_name: "clip.mp4"
      })
      .expect(401);

    await http()
      .post("/owner/verification/artifacts/presign")
      .set("Authorization", `Bearer ${tenantToken}`)
      .send({
        listing_id: listingId,
        kind: "video_liveness",
        content_type: "video/mp4",
        size_bytes: 4,
        file_name: "clip.mp4"
      })
      .expect(403);
  });

  it("maps presign request fields to the artifact service", async () => {
    const response = await http()
      .post("/owner/verification/artifacts/presign")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({
        listing_id: listingId,
        kind: "video_liveness",
        content_type: "video/mp4",
        size_bytes: 4,
        file_name: "clip.mp4"
      })
      .expect(201);

    expect(artifacts.createTarget).toHaveBeenCalledWith({
      ownerId,
      listingId,
      kind: "video_liveness",
      contentType: "video/mp4",
      sizeBytes: 4,
      fileName: "clip.mp4"
    });
    expect(response.body.data).toEqual({
      upload_token: "upload-token-1",
      upload_url: "/owner/verification/artifacts/upload",
      blob_path: `${listingId}/verification/video_liveness/clip.mp4`,
      expires_at: "2026-01-01T00:15:00.000Z"
    });
  });

  it("requires upload_token and file for multipart upload", async () => {
    await http()
      .post("/owner/verification/artifacts/upload")
      .set("Authorization", `Bearer ${ownerToken}`)
      .attach("file", Buffer.from("data"), {
        filename: "clip.mp4",
        contentType: "video/mp4"
      })
      .expect(400);

    await http()
      .post("/owner/verification/artifacts/upload")
      .set("Authorization", `Bearer ${ownerToken}`)
      .field("upload_token", "upload-token-1")
      .expect(400);
  });

  it("maps multipart upload_token and file to the artifact service", async () => {
    const response = await http()
      .post("/owner/verification/artifacts/upload")
      .set("Authorization", `Bearer ${ownerToken}`)
      .field("upload_token", "upload-token-1")
      .attach("file", Buffer.from("data"), {
        filename: "clip.mp4",
        contentType: "video/mp4"
      })
      .expect(201);

    expect(artifacts.upload).toHaveBeenCalledWith({
      ownerId,
      uploadToken: "upload-token-1",
      file: expect.objectContaining({
        fieldname: "file",
        originalname: "clip.mp4",
        mimetype: "video/mp4",
        size: 4
      })
    });
    expect(response.body.data).toEqual({
      blob_path: `${listingId}/verification/video_liveness/clip.mp4`
    });
  });

  it("maps complete request fields to the artifact service", async () => {
    const response = await http()
      .post("/owner/verification/artifacts/complete")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({
        listing_id: listingId,
        upload_token: "upload-token-1",
        blob_path: `${listingId}/verification/video_liveness/clip.mp4`
      })
      .expect(201);

    expect(artifacts.complete).toHaveBeenCalledWith({
      ownerId,
      listingId,
      uploadToken: "upload-token-1",
      blobPath: `${listingId}/verification/video_liveness/clip.mp4`
    });
    expect(response.body.data).toEqual({
      blob_path: `${listingId}/verification/video_liveness/clip.mp4`
    });
  });
});
