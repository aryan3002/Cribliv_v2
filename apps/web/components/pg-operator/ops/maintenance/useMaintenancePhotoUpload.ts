import type { PgMaintenanceRequest } from "@cribliv/shared-types";
import {
  completeMaintenancePhotos,
  completeResidenceMaintenancePhotos,
  presignMaintenancePhotos,
  presignResidenceMaintenancePhotos
} from "@/lib/pg-operations-api";

export type MaintenancePhotoUploadMode = "operator" | "tenant";

export type PendingMaintenancePhoto = {
  clientUploadId: string;
  file: File;
  previewUrl: string | null;
};

export type UseMaintenancePhotoUploadInput = {
  mode: MaintenancePhotoUploadMode;
  propertyId?: string;
  token: string;
};

const MAX_PHOTOS_PER_UPLOAD = 6;
const MAX_PHOTO_SIZE_BYTES = 10 * 1024 * 1024;
const ACCEPTED_PHOTO_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

export function createMaintenanceUploadId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function releaseMaintenancePhotoPreview(value: string | null) {
  if (!value || typeof URL === "undefined" || typeof URL.revokeObjectURL !== "function") return;
  URL.revokeObjectURL(value);
}

function createPreviewUrl(file: File): string | null {
  if (typeof URL === "undefined" || typeof URL.createObjectURL !== "function") return null;
  return URL.createObjectURL(file);
}

function buildPendingPhotos(
  files: FileList | File[],
  existingCount: number
): PendingMaintenancePhoto[] {
  const availableSlots = MAX_PHOTOS_PER_UPLOAD - existingCount;
  if (availableSlots <= 0) {
    throw new Error(`Add up to ${MAX_PHOTOS_PER_UPLOAD} photos.`);
  }
  const selected = Array.from(files).slice(0, availableSlots);
  if (selected.length === 0) return [];
  for (const file of selected) {
    if (!ACCEPTED_PHOTO_TYPES.has(file.type)) {
      throw new Error("Upload JPG, PNG, or WebP photos only.");
    }
    if (file.size > MAX_PHOTO_SIZE_BYTES) {
      throw new Error("Each photo must be 10 MB or smaller.");
    }
  }
  return selected.map((file) => ({
    clientUploadId: createMaintenanceUploadId(),
    file,
    previewUrl: createPreviewUrl(file)
  }));
}

async function uploadBlob(uploadUrl: string, file: File) {
  const response = await fetch(uploadUrl, {
    method: "PUT",
    headers: {
      "Content-Type": file.type,
      "x-ms-blob-type": "BlockBlob"
    },
    body: file
  });
  if (!response.ok) {
    throw new Error("Could not upload one of the selected photos.");
  }
}

export function useMaintenancePhotoUpload({
  mode,
  propertyId,
  token
}: UseMaintenancePhotoUploadInput): {
  addFiles(files: FileList | File[], existingCount: number): PendingMaintenancePhoto[];
  removePhoto(photos: PendingMaintenancePhoto[], clientUploadId: string): PendingMaintenancePhoto[];
  uploadForRequest(
    request: PgMaintenanceRequest,
    photos: PendingMaintenancePhoto[]
  ): Promise<PgMaintenanceRequest>;
  uploadForComment(
    request: PgMaintenanceRequest,
    photos: PendingMaintenancePhoto[]
  ): Promise<string[]>;
} {
  async function presignAndUploadPhotos(
    request: PgMaintenanceRequest,
    photos: PendingMaintenancePhoto[]
  ) {
    if (photos.length === 0) return [];
    const files = photos.map((photo) => ({
      clientUploadId: photo.clientUploadId,
      contentType: photo.file.type,
      sizeBytes: photo.file.size
    }));
    const presign =
      mode === "operator"
        ? propertyId
          ? await presignMaintenancePhotos(
              propertyId,
              request.id,
              files,
              token,
              createMaintenanceUploadId()
            )
          : null
        : await presignResidenceMaintenancePhotos(
            request.id,
            files,
            token,
            createMaintenanceUploadId()
          );
    if (!presign) throw new Error("Could not prepare photo uploads.");

    const photosByClientId = new Map(photos.map((photo) => [photo.clientUploadId, photo]));
    await Promise.all(
      presign.uploads.map((upload, index) => {
        const pendingPhoto = photosByClientId.get(upload.clientUploadId) ?? photos[index];
        if (!pendingPhoto) throw new Error("Could not match one of the selected photos.");
        return uploadBlob(upload.uploadUrl, pendingPhoto.file);
      })
    );

    return presign.uploads.map((upload) => ({
      clientUploadId: upload.clientUploadId,
      blobPath: upload.blobPath
    }));
  }

  return {
    addFiles(files, existingCount) {
      return buildPendingPhotos(files, existingCount);
    },
    removePhoto(photos, clientUploadId) {
      const removed = photos.find((photo) => photo.clientUploadId === clientUploadId);
      releaseMaintenancePhotoPreview(removed?.previewUrl ?? null);
      return photos.filter((photo) => photo.clientUploadId !== clientUploadId);
    },
    async uploadForRequest(request, photos) {
      if (photos.length === 0) return request;
      const completed = await presignAndUploadPhotos(request, photos);
      return mode === "operator"
        ? propertyId
          ? completeMaintenancePhotos(
              propertyId,
              request.id,
              completed,
              token,
              createMaintenanceUploadId()
            )
          : request
        : completeResidenceMaintenancePhotos(
            request.id,
            completed,
            token,
            createMaintenanceUploadId()
          );
    },
    async uploadForComment(request, photos) {
      if (photos.length === 0) return [];
      const uploaded = await presignAndUploadPhotos(request, photos);
      return uploaded.map((photo) => photo.blobPath);
    }
  };
}
