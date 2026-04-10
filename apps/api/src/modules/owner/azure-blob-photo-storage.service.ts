import { BadRequestException, Injectable } from "@nestjs/common";
import {
  BlobSASPermissions,
  BlobServiceClient,
  SASProtocol,
  StorageSharedKeyCredential,
  generateBlobSASQueryParameters
} from "@azure/storage-blob";
import { randomUUID } from "crypto";

interface PresignPhotoInput {
  listingId: string;
  clientUploadId: string;
  contentType: string;
}

interface PresignPhotoOutput {
  uploadUrl: string;
  blobPath: string;
  expiresAt: string;
}

function parsePositiveInt(raw: string | undefined, fallback: number, min: number, max: number) {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return fallback;
  const rounded = Math.floor(parsed);
  if (rounded < min) return min;
  if (rounded > max) return max;
  return rounded;
}

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

  const entries = input.split(";").map((part) => part.trim());
  const values = new Map<string, string>();
  for (const entry of entries) {
    if (!entry.includes("=")) continue;
    const [key, ...rest] = entry.split("=");
    values.set(key.toLowerCase(), rest.join("="));
  }

  const accountName = (values.get("accountname") ?? "").trim();
  const accountKey = (values.get("accountkey") ?? "").trim();
  const blobEndpoint = stripTrailingSlash((values.get("blobendpoint") ?? "").trim());

  return {
    accountName,
    accountKey,
    blobEndpoint
  };
}

function normalizeMimeType(contentType: string) {
  return contentType.split(";")[0].trim().toLowerCase();
}

function inferFileExtension(contentType: string) {
  const mime = normalizeMimeType(contentType);
  if (mime === "image/jpeg") return "jpg";
  if (mime === "image/png") return "png";
  if (mime === "image/webp") return "webp";
  return "bin";
}

@Injectable()
export class AzureBlobPhotoStorageService {
  private readonly containerName =
    process.env.AZURE_STORAGE_CONTAINER_LISTING_PHOTOS?.trim() || "listing-photos";

  private readonly sasTtlSeconds = parsePositiveInt(
    process.env.AZURE_STORAGE_SAS_TTL_SECONDS,
    900,
    60,
    3600
  );

  private readonly maxFileSizeBytes = parsePositiveInt(
    process.env.PHOTO_MAX_FILE_SIZE_BYTES,
    10 * 1024 * 1024,
    1 * 1024 * 1024,
    25 * 1024 * 1024
  );

  private readonly allowedMimeTypes = new Set(
    (process.env.PHOTO_ALLOWED_MIME_TYPES || "image/jpeg,image/png,image/webp")
      .split(",")
      .map((value) => normalizeMimeType(value))
      .filter(Boolean)
  );

  private readonly accountName: string;
  private readonly sharedKeyCredential: StorageSharedKeyCredential | null;
  private readonly blobServiceClient: BlobServiceClient | null;

  constructor() {
    const parsedConnString = parseConnectionString(process.env.AZURE_STORAGE_CONNECTION_STRING);
    const accountName =
      process.env.AZURE_STORAGE_ACCOUNT_NAME?.trim() || parsedConnString.accountName;
    const accountKey = process.env.AZURE_STORAGE_ACCOUNT_KEY?.trim() || parsedConnString.accountKey;

    this.accountName = accountName;

    if (!accountName || !accountKey) {
      this.sharedKeyCredential = null;
      this.blobServiceClient = null;
      return;
    }

    const endpoint = stripTrailingSlash(
      process.env.AZURE_STORAGE_BLOB_ENDPOINT?.trim() ||
        parsedConnString.blobEndpoint ||
        `https://${accountName}.blob.core.windows.net`
    );

    this.sharedKeyCredential = new StorageSharedKeyCredential(accountName, accountKey);
    this.blobServiceClient = new BlobServiceClient(endpoint, this.sharedKeyCredential, {
      retryOptions: {
        maxTries: 5,
        retryDelayInMs: 300,
        maxRetryDelayInMs: 4000,
        tryTimeoutInMs: 15_000
      }
    });
  }

  validatePresignRequest(contentType: string, sizeBytes: number) {
    const normalizedContentType = normalizeMimeType(contentType || "");
    if (!normalizedContentType || !this.allowedMimeTypes.has(normalizedContentType)) {
      throw new BadRequestException({
        code: "invalid_content_type",
        message: "Unsupported photo content_type"
      });
    }

    if (!Number.isFinite(sizeBytes) || sizeBytes <= 0 || sizeBytes > this.maxFileSizeBytes) {
      throw new BadRequestException({
        code: "invalid_file_size",
        message: `Photo size must be between 1 byte and ${this.maxFileSizeBytes} bytes`
      });
    }
  }

  createUploadTarget(input: PresignPhotoInput): PresignPhotoOutput {
    const client = this.getBlobServiceClient();
    const credential = this.getSharedKeyCredential();

    const blobName = this.buildBlobName(input.listingId, input.clientUploadId, input.contentType);
    const containerClient = client.getContainerClient(this.containerName);
    const blobClient = containerClient.getBlockBlobClient(blobName);

    const startsOn = new Date(Date.now() - 5 * 60 * 1000);
    const expiresOn = new Date(Date.now() + this.sasTtlSeconds * 1000);

    const sasToken = generateBlobSASQueryParameters(
      {
        containerName: this.containerName,
        blobName,
        permissions: BlobSASPermissions.parse("cw"),
        protocol: SASProtocol.Https,
        startsOn,
        expiresOn,
        contentType: normalizeMimeType(input.contentType)
      },
      credential
    ).toString();

    return {
      uploadUrl: `${blobClient.url}?${sasToken}`,
      blobPath: blobName,
      expiresAt: expiresOn.toISOString()
    };
  }

  async validateUploadedBlob(listingId: string, blobPath: string) {
    const client = this.getBlobServiceClient();
    this.assertListingScopedBlobPath(listingId, blobPath);

    const containerClient = client.getContainerClient(this.containerName);
    const blobClient = containerClient.getBlockBlobClient(blobPath.replace(/^\/+/, ""));

    let properties: Awaited<ReturnType<typeof blobClient.getProperties>>;
    try {
      properties = await blobClient.getProperties();
    } catch (error) {
      const statusCode = (error as { statusCode?: number })?.statusCode;
      if (statusCode === 404) {
        throw new BadRequestException({
          code: "blob_not_found",
          message: "Uploaded blob was not found in storage"
        });
      }
      throw error;
    }

    const contentType = normalizeMimeType(properties.contentType || "");
    const contentLength = Number(properties.contentLength ?? 0);

    if (!contentType || !this.allowedMimeTypes.has(contentType)) {
      throw new BadRequestException({
        code: "invalid_blob_content_type",
        message: "Uploaded blob has an unsupported content type"
      });
    }

    if (
      !Number.isFinite(contentLength) ||
      contentLength <= 0 ||
      contentLength > this.maxFileSizeBytes
    ) {
      throw new BadRequestException({
        code: "invalid_blob_size",
        message: "Uploaded blob size is invalid"
      });
    }
  }

  getPhotoPublicBaseUrl() {
    const explicitBase = process.env.PHOTO_PUBLIC_BASE_URL?.trim();
    if (explicitBase) {
      return stripTrailingSlash(explicitBase);
    }

    if (!this.accountName || !this.containerName) {
      return "";
    }

    return `https://${this.accountName}.blob.core.windows.net/${this.containerName}`;
  }

  private getBlobServiceClient() {
    if (!this.blobServiceClient) {
      throw new BadRequestException({
        code: "photo_storage_not_configured",
        message: "Azure Blob storage is not configured"
      });
    }
    return this.blobServiceClient;
  }

  private getSharedKeyCredential() {
    if (!this.sharedKeyCredential) {
      throw new BadRequestException({
        code: "photo_storage_not_configured",
        message: "Azure Blob storage is not configured"
      });
    }
    return this.sharedKeyCredential;
  }

  private assertListingScopedBlobPath(listingId: string, blobPath: string) {
    const normalized = blobPath.replace(/^\/+/, "");
    if (!normalized.startsWith(`${listingId}/`)) {
      throw new BadRequestException({
        code: "invalid_blob_path",
        message: "blob_path does not belong to this listing"
      });
    }
  }

  private buildBlobName(listingId: string, clientUploadId: string, contentType: string) {
    const safeClientId = clientUploadId
      .trim()
      .replace(/[^a-zA-Z0-9._-]+/g, "_")
      .slice(0, 120);

    const fallbackId = randomUUID().slice(0, 8);
    const canonicalClientId = safeClientId || `upload-${fallbackId}`;
    const extension = inferFileExtension(contentType);

    return `${listingId}/${canonicalClientId}-${Date.now()}-${fallbackId}.${extension}`;
  }
}
