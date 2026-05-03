/**
 * Shared helpers for turning a `listing_photos.blob_path` value into a public
 * URL, used by both the tenant-facing listing detail endpoint and the owner
 * dashboard listings endpoint.
 *
 * URL resolution order:
 *   1. PHOTO_PUBLIC_BASE_URL  (preferred — explicit CDN / public origin)
 *   2. https://{AZURE_STORAGE_ACCOUNT_NAME}.blob.core.windows.net/{container}
 *      where container defaults to "listing-photos"
 *   3. Falls back to the raw blob_path (caller sees a relative path).
 *
 * If the stored value is already an absolute http(s) URL (legacy data, seed
 * fixtures), we return it untouched.
 */

export function buildPhotoPublicBaseUrl(): string {
  const explicit = process.env.PHOTO_PUBLIC_BASE_URL?.trim();
  if (explicit) return explicit.replace(/\/+$/, "");

  const accountName = process.env.AZURE_STORAGE_ACCOUNT_NAME?.trim();
  const container = process.env.AZURE_STORAGE_CONTAINER_LISTING_PHOTOS?.trim() || "listing-photos";
  if (!accountName) return "";
  return `https://${accountName}.blob.core.windows.net/${container}`;
}

export function toBlobUrl(blobPath: string | null | undefined): string | null {
  if (!blobPath) return null;
  if (/^https?:\/\//i.test(blobPath)) return blobPath;
  const base = buildPhotoPublicBaseUrl();
  if (!base) return blobPath;
  return `${base}/${blobPath.replace(/^\/+/, "")}`;
}
