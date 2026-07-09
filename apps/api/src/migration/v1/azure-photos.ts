const { createRequire } = require("module") as typeof import("module");
const path = require("path") as typeof import("path");
const requireFromApi = createRequire(path.resolve(__dirname, "../../../package.json"));
const { BlobServiceClient, StorageSharedKeyCredential } = requireFromApi("@azure/storage-blob");
import { extFromContentType } from "./v1-url";

export interface AzureCfg {
  account: string;
  key: string;
  container: string;
}

/** Deterministic blob path so re-runs overwrite the same blob (idempotent). */
export function buildBlobName(listingId: string, publicId: string, ext: string): string {
  const safe = publicId.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 120);
  return `${listingId}/v1-${safe}.${ext}`;
}

export function makeContainerClient(cfg: AzureCfg) {
  const cred = new StorageSharedKeyCredential(cfg.account, cfg.key);
  const svc = new BlobServiceClient(`https://${cfg.account}.blob.core.windows.net`, cred);
  return svc.getContainerClient(cfg.container);
}

export async function uploadPhoto(
  container: any,
  blobName: string,
  buffer: Buffer,
  contentType: string
): Promise<void> {
  const mime = ["image/jpeg", "image/png", "image/webp"].includes(contentType.split(";")[0])
    ? contentType.split(";")[0]
    : `image/${extFromContentType(contentType) === "bin" ? "jpeg" : extFromContentType(contentType)}`;
  const blob = container.getBlockBlobClient(blobName);
  await blob.upload(buffer, buffer.length, { blobHTTPHeaders: { blobContentType: mime } });
}
