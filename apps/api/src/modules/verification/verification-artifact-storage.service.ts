import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException
} from "@nestjs/common";
import { BlobServiceClient, StorageSharedKeyCredential } from "@azure/storage-blob";
import { randomUUID } from "crypto";
import { AppStateService } from "../../common/app-state.service";
import { DatabaseService } from "../../common/database.service";
import type {} from "multer";

export type VerificationArtifactKind = "video_liveness" | "electricity_bill";

export interface VerificationArtifactTarget {
  uploadToken: string;
  uploadUrl: string;
  blobPath: string;
  expiresAt: string;
}

export const VIDEO_MAX_BYTES = 50 * 1024 * 1024;
export const BILL_MAX_BYTES = 15 * 1024 * 1024;
export const TARGET_TTL_MS = 15 * 60 * 1000;

type PendingArtifact = {
  ownerId: string;
  listingId: string;
  kind: VerificationArtifactKind;
  contentType: string;
  sizeBytes: number;
  blobPath: string;
  expiresAtMs: number;
  uploadedAtMs?: number;
  completedAtMs?: number;
};

type StoredArtifactBytes = {
  buffer: Buffer;
  contentType: string;
  sizeBytes: number;
};

const ALLOWED_CONTENT_TYPES: Record<VerificationArtifactKind, Set<string>> = {
  video_liveness: new Set(["video/mp4", "video/webm", "video/quicktime"]),
  electricity_bill: new Set(["application/pdf", "image/jpeg", "image/png", "image/webp"])
};

function stripTrailingSlash(value: string) {
  return value.replace(/\/+$/, "");
}

function parseConnectionString(raw: string | undefined) {
  const input = (raw ?? "").trim();
  if (!input) {
    return {
      accountName: "",
      accountKey: "",
      blobEndpoint: ""
    };
  }

  const values = new Map<string, string>();
  for (const part of input.split(";")) {
    const entry = part.trim();
    if (!entry.includes("=")) continue;
    const [key, ...rest] = entry.split("=");
    values.set(key.toLowerCase(), rest.join("="));
  }

  return {
    accountName: (values.get("accountname") ?? "").trim(),
    accountKey: (values.get("accountkey") ?? "").trim(),
    blobEndpoint: stripTrailingSlash((values.get("blobendpoint") ?? "").trim())
  };
}

function normalizeContentType(contentType: string) {
  return contentType.split(";")[0].trim().toLowerCase();
}

function normalizeBlobPath(blobPath: string) {
  return blobPath.trim().replace(/^\/+/, "");
}

function inferExtension(contentType: string) {
  const normalized = normalizeContentType(contentType);
  if (normalized === "video/mp4") return ".mp4";
  if (normalized === "video/webm") return ".webm";
  if (normalized === "video/quicktime") return ".mov";
  if (normalized === "application/pdf") return ".pdf";
  if (normalized === "image/jpeg") return ".jpg";
  if (normalized === "image/png") return ".png";
  if (normalized === "image/webp") return ".webp";
  return ".bin";
}

function safeBaseName(fileName: string, kind: VerificationArtifactKind) {
  const withoutExtension = (fileName || kind).replace(/\.[a-z0-9]+$/i, "");
  const safe = withoutExtension
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80);
  return safe || "artifact";
}

@Injectable()
export class VerificationArtifactStorageService {
  private readonly uploadUrl = "/owner/verification/artifacts/upload";
  private readonly targets = new Map<string, PendingArtifact>();
  private readonly localBytes = new Map<string, StoredArtifactBytes>();
  private readonly completedKeys = new Set<string>();
  private readonly containerName =
    process.env.AZURE_STORAGE_CONTAINER_VERIFICATION_ARTIFACTS?.trim() || "verification-artifacts";
  private readonly blobServiceClient: BlobServiceClient | null;

  constructor(
    @Inject(AppStateService) private readonly state: AppStateService,
    @Inject(DatabaseService) private readonly database: DatabaseService
  ) {
    const parsedConnString = parseConnectionString(process.env.AZURE_STORAGE_CONNECTION_STRING);
    const accountName =
      process.env.AZURE_STORAGE_ACCOUNT_NAME?.trim() || parsedConnString.accountName;
    const accountKey = process.env.AZURE_STORAGE_ACCOUNT_KEY?.trim() || parsedConnString.accountKey;

    if (!accountName || !accountKey) {
      this.blobServiceClient = null;
      return;
    }

    const endpoint = stripTrailingSlash(
      process.env.AZURE_STORAGE_BLOB_ENDPOINT?.trim() ||
        parsedConnString.blobEndpoint ||
        `https://${accountName}.blob.core.windows.net`
    );
    const credential = new StorageSharedKeyCredential(accountName, accountKey);
    this.blobServiceClient = new BlobServiceClient(endpoint, credential, {
      retryOptions: {
        maxTries: 5,
        retryDelayInMs: 300,
        maxRetryDelayInMs: 4000,
        tryTimeoutInMs: 15_000
      }
    });
  }

  async createTarget(input: {
    ownerId: string;
    listingId: string;
    kind: VerificationArtifactKind;
    contentType: string;
    sizeBytes: number;
    fileName: string;
  }): Promise<VerificationArtifactTarget> {
    this.assertKind(input.kind);
    await this.assertListingOwner(input.ownerId, input.listingId);
    const contentType = this.validateContentType(input.kind, input.contentType);
    const sizeBytes = this.validateSize(input.kind, input.sizeBytes);
    const uploadToken = randomUUID();
    const expiresAtMs = Date.now() + TARGET_TTL_MS;
    const blobPath = this.buildBlobPath(input.listingId, input.kind, input.fileName, contentType);

    this.targets.set(uploadToken, {
      ownerId: input.ownerId,
      listingId: input.listingId,
      kind: input.kind,
      contentType,
      sizeBytes,
      blobPath,
      expiresAtMs
    });

    return {
      uploadToken,
      uploadUrl: this.uploadUrl,
      blobPath,
      expiresAt: new Date(expiresAtMs).toISOString()
    };
  }

  async upload(input: {
    ownerId: string;
    uploadToken: string;
    file: Express.Multer.File;
  }): Promise<{ blobPath: string }> {
    const target = this.getUsableTarget(input.uploadToken, input.ownerId);
    if (!input.file) {
      throw new BadRequestException({ code: "file_required", message: "file is required" });
    }

    const fileContentType = normalizeContentType(input.file.mimetype || "");
    if (fileContentType !== target.contentType) {
      throw new BadRequestException({
        code: "invalid_content_type",
        message: "Uploaded artifact content type does not match the presigned target"
      });
    }

    const buffer = input.file.buffer;
    if (!Buffer.isBuffer(buffer) || buffer.length <= 0) {
      throw new BadRequestException({
        code: "file_required",
        message: "file is required"
      });
    }

    const fileSize = Number(input.file.size ?? buffer.length);
    if (fileSize !== target.sizeBytes || buffer.length !== target.sizeBytes) {
      throw new BadRequestException({
        code: "invalid_file_size",
        message: "Uploaded artifact size does not match the presigned target"
      });
    }

    await this.storeBytes(target, buffer);
    target.uploadedAtMs = Date.now();
    return { blobPath: target.blobPath };
  }

  async complete(input: {
    ownerId: string;
    listingId: string;
    uploadToken: string;
    blobPath: string;
  }): Promise<{ blobPath: string }> {
    const target = this.getUsableTarget(input.uploadToken, input.ownerId);
    const blobPath = normalizeBlobPath(input.blobPath);
    this.assertListingScopedBlobPath(input.listingId, target.kind, blobPath);

    if (target.listingId !== input.listingId || target.blobPath !== blobPath) {
      throw new BadRequestException({
        code: "invalid_blob_path",
        message: "blob_path does not match this upload token"
      });
    }

    if (!target.uploadedAtMs) {
      throw new BadRequestException({
        code: "artifact_not_uploaded",
        message: "Artifact must be uploaded before completion"
      });
    }

    target.completedAtMs = Date.now();
    this.completedKeys.add(
      this.completedKey(input.ownerId, input.listingId, target.kind, blobPath)
    );
    return { blobPath };
  }

  async assertCompletedArtifact(input: {
    ownerId: string;
    listingId: string;
    kind: VerificationArtifactKind;
    blobPath: string;
  }): Promise<void> {
    this.assertKind(input.kind);
    await this.assertListingOwner(input.ownerId, input.listingId);
    const blobPath = normalizeBlobPath(input.blobPath);
    this.assertListingScopedBlobPath(input.listingId, input.kind, blobPath);

    if (
      !this.completedKeys.has(
        this.completedKey(input.ownerId, input.listingId, input.kind, blobPath)
      )
    ) {
      throw new BadRequestException({
        code: "artifact_not_completed",
        message: "Verification artifact has not been completed"
      });
    }
  }

  private validateContentType(kind: VerificationArtifactKind, contentType: string) {
    const normalized = normalizeContentType(contentType || "");
    if (!normalized || !ALLOWED_CONTENT_TYPES[kind].has(normalized)) {
      throw new BadRequestException({
        code: "invalid_content_type",
        message: "Unsupported verification artifact content_type"
      });
    }
    return normalized;
  }

  private validateSize(kind: VerificationArtifactKind, rawSizeBytes: number) {
    const sizeBytes = Number(rawSizeBytes);
    const maxBytes = kind === "video_liveness" ? VIDEO_MAX_BYTES : BILL_MAX_BYTES;
    if (!Number.isFinite(sizeBytes) || sizeBytes <= 0 || sizeBytes > maxBytes) {
      throw new BadRequestException({
        code: "invalid_file_size",
        message: `Artifact size must be between 1 byte and ${maxBytes} bytes`
      });
    }
    return Math.trunc(sizeBytes);
  }

  private assertKind(kind: VerificationArtifactKind): asserts kind is VerificationArtifactKind {
    if (kind !== "video_liveness" && kind !== "electricity_bill") {
      throw new BadRequestException({
        code: "invalid_artifact_kind",
        message: "Unsupported verification artifact kind"
      });
    }
  }

  private getUsableTarget(uploadToken: string, ownerId: string) {
    const token = String(uploadToken ?? "").trim();
    if (!token) {
      throw new BadRequestException({
        code: "upload_token_required",
        message: "upload_token is required"
      });
    }

    const target = this.targets.get(token);
    if (!target) {
      throw new BadRequestException({
        code: "upload_token_invalid",
        message: "upload_token is invalid"
      });
    }

    if (Date.now() > target.expiresAtMs) {
      this.targets.delete(token);
      throw new BadRequestException({
        code: "upload_token_expired",
        message: "upload_token has expired"
      });
    }

    if (target.ownerId !== ownerId) {
      throw new ForbiddenException({ code: "forbidden", message: "Forbidden" });
    }

    return target;
  }

  private async assertListingOwner(ownerId: string, listingId: string) {
    if (this.database.isEnabled()) {
      const result = await this.database.query<{ id: string }>(
        `
        SELECT id::text
        FROM listings
        WHERE id = $1::uuid AND owner_user_id = $2::uuid
        LIMIT 1
        `,
        [listingId, ownerId]
      );

      if (!result.rowCount) {
        throw new NotFoundException({ code: "not_found", message: "Listing not found" });
      }
      return;
    }

    const listing = this.state.listings.get(listingId);
    if (!listing || listing.ownerUserId !== ownerId) {
      throw new NotFoundException({ code: "not_found", message: "Listing not found" });
    }
  }

  private async storeBytes(target: PendingArtifact, buffer: Buffer) {
    if (this.blobServiceClient) {
      const containerClient = this.blobServiceClient.getContainerClient(this.containerName);
      const blobClient = containerClient.getBlockBlobClient(target.blobPath);
      await blobClient.uploadData(buffer, {
        blobHTTPHeaders: { blobContentType: target.contentType }
      });
      return;
    }

    this.localBytes.set(target.blobPath, {
      buffer: Buffer.from(buffer),
      contentType: target.contentType,
      sizeBytes: target.sizeBytes
    });
  }

  private assertListingScopedBlobPath(
    listingId: string,
    kind: VerificationArtifactKind,
    blobPath: string
  ) {
    if (!blobPath.startsWith(`${listingId}/verification/${kind}/`)) {
      throw new BadRequestException({
        code: "invalid_blob_path",
        message: "blob_path does not belong to this listing and artifact kind"
      });
    }
  }

  private completedKey(
    ownerId: string,
    listingId: string,
    kind: VerificationArtifactKind,
    blobPath: string
  ) {
    return JSON.stringify([ownerId, listingId, kind, blobPath]);
  }

  private buildBlobPath(
    listingId: string,
    kind: VerificationArtifactKind,
    fileName: string,
    contentType: string
  ) {
    const baseName = safeBaseName(fileName, kind);
    const extension = inferExtension(contentType);
    return `${listingId}/verification/${kind}/${baseName}-${randomUUID()}${extension}`;
  }
}
