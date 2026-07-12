"use client";

export type ListingPhotoKind = "jpeg" | "png" | "webp" | "heic" | "heif";
export type ListingPhotoPreparationErrorKind =
  | "unsupported"
  | "decode_failed"
  | "too_large"
  | "empty";
export type ListingPhotoUploadErrorKind = "network" | "expired" | "rejected" | "storage";

const MAX_LONG_EDGE = 2560;
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const JPEG_QUALITIES = [0.82, 0.72, 0.62] as const;

const MIME_KIND: Record<string, ListingPhotoKind> = {
  "image/jpeg": "jpeg",
  "image/jpg": "jpeg",
  "image/png": "png",
  "image/webp": "webp",
  "image/heic": "heic",
  "image/heif": "heif",
  "image/heic-sequence": "heic",
  "image/heif-sequence": "heif"
};

const EXTENSION_KIND: Record<string, ListingPhotoKind> = {
  jpg: "jpeg",
  jpeg: "jpeg",
  png: "png",
  webp: "webp",
  heic: "heic",
  heif: "heif"
};

export class ListingPhotoPreparationError extends Error {
  readonly kind: ListingPhotoPreparationErrorKind;

  constructor(kind: ListingPhotoPreparationErrorKind, message: string) {
    super(message);
    this.name = "ListingPhotoPreparationError";
    this.kind = kind;
  }
}

export class ListingPhotoUploadError extends Error {
  readonly kind: ListingPhotoUploadErrorKind;
  readonly status?: number;

  constructor(kind: ListingPhotoUploadErrorKind, message: string, status?: number) {
    super(message);
    this.name = "ListingPhotoUploadError";
    this.kind = kind;
    this.status = status;
  }
}

export interface DecodedListingPhoto {
  source: CanvasImageSource;
  width: number;
  height: number;
  close?: () => void;
}

export interface ListingPhotoPreparationDeps {
  convertHeic: (file: Blob) => Promise<Blob>;
  decodeImage: (file: Blob) => Promise<DecodedListingPhoto>;
  encodeJpeg: (
    source: CanvasImageSource,
    width: number,
    height: number,
    quality: number
  ) => Promise<Blob>;
}

export function detectListingPhotoKind(file: Pick<File, "name" | "type">) {
  const mime = file.type.split(";")[0]?.trim().toLowerCase() ?? "";
  if (MIME_KIND[mime]) return MIME_KIND[mime];

  const extension = file.name.split(".").pop()?.trim().toLowerCase() ?? "";
  return EXTENSION_KIND[extension] ?? null;
}

export function calculateListingPhotoDimensions(width: number, height: number) {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    throw new ListingPhotoPreparationError("decode_failed", "Photo dimensions are invalid");
  }

  const longEdge = Math.max(width, height);
  if (longEdge <= MAX_LONG_EDGE) {
    return { width: Math.round(width), height: Math.round(height) };
  }

  const scale = MAX_LONG_EDGE / longEdge;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale))
  };
}

async function convertHeicWithHeic2Any(file: Blob) {
  const heic2any = (await import("heic2any")).default;
  const output = await heic2any({
    blob: file,
    toType: "image/png",
    quality: 1
  });
  const first = Array.isArray(output) ? output[0] : output;
  if (!(first instanceof Blob) || first.size <= 0) {
    throw new ListingPhotoPreparationError("decode_failed", "HEIC conversion returned no image");
  }
  return first;
}

function decodeWithImageElement(file: Blob): Promise<DecodedListingPhoto> {
  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(objectUrl);
      resolve({
        source: image,
        width: image.naturalWidth,
        height: image.naturalHeight
      });
    };
    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new ListingPhotoPreparationError("decode_failed", "Browser could not decode image"));
    };
    image.src = objectUrl;
  });
}

async function decodeBrowserImage(file: Blob): Promise<DecodedListingPhoto> {
  if (typeof createImageBitmap === "function") {
    const bitmap = await createImageBitmap(file, {
      imageOrientation: "from-image"
    });
    return {
      source: bitmap,
      width: bitmap.width,
      height: bitmap.height,
      close: () => bitmap.close()
    };
  }
  return decodeWithImageElement(file);
}

function encodeCanvasJpeg(
  source: CanvasImageSource,
  width: number,
  height: number,
  quality: number
): Promise<Blob> {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { alpha: false });
  if (!context) {
    throw new ListingPhotoPreparationError("decode_failed", "Image canvas is unavailable");
  }
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, width, height);
  context.drawImage(source, 0, 0, width, height);

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob || blob.size <= 0) {
          reject(
            new ListingPhotoPreparationError("decode_failed", "JPEG encoding returned no image")
          );
          return;
        }
        resolve(blob);
      },
      "image/jpeg",
      quality
    );
  });
}

const DEFAULT_PREPARATION_DEPS: ListingPhotoPreparationDeps = {
  convertHeic: convertHeicWithHeic2Any,
  decodeImage: decodeBrowserImage,
  encodeJpeg: encodeCanvasJpeg
};

function jpegFileName(name: string) {
  const trimmed = name.trim() || "listing-photo";
  const withoutExtension = trimmed.replace(/\.[^.]+$/, "");
  return `${withoutExtension || "listing-photo"}.jpg`;
}

export async function prepareListingPhoto(
  file: File,
  deps: ListingPhotoPreparationDeps = DEFAULT_PREPARATION_DEPS
) {
  if (!file.size) {
    throw new ListingPhotoPreparationError("empty", "Photo file is empty");
  }

  const kind = detectListingPhotoKind(file);
  if (!kind) {
    throw new ListingPhotoPreparationError("unsupported", "Unsupported listing photo format");
  }

  let browserImage: Blob = file;
  try {
    if (kind === "heic" || kind === "heif") {
      browserImage = await deps.convertHeic(file);
    }
  } catch (error) {
    if (error instanceof ListingPhotoPreparationError) throw error;
    throw new ListingPhotoPreparationError(
      "decode_failed",
      error instanceof Error ? error.message : "HEIC conversion failed"
    );
  }

  let decoded: DecodedListingPhoto;
  try {
    decoded = await deps.decodeImage(browserImage);
  } catch (error) {
    if (error instanceof ListingPhotoPreparationError) throw error;
    throw new ListingPhotoPreparationError(
      "decode_failed",
      error instanceof Error ? error.message : "Photo decoding failed"
    );
  }

  try {
    const dimensions = calculateListingPhotoDimensions(decoded.width, decoded.height);
    for (const quality of JPEG_QUALITIES) {
      const encoded = await deps.encodeJpeg(
        decoded.source,
        dimensions.width,
        dimensions.height,
        quality
      );
      if (encoded.size <= MAX_FILE_BYTES) {
        return new File([encoded], jpegFileName(file.name), {
          type: "image/jpeg",
          lastModified: file.lastModified
        });
      }
    }
  } finally {
    decoded.close?.();
  }

  throw new ListingPhotoPreparationError(
    "too_large",
    "Photo remains larger than 10 MB after compression"
  );
}

function uploadErrorForStatus(status: number) {
  if (status === 401 || status === 403) {
    return new ListingPhotoUploadError("expired", "Azure upload URL expired", status);
  }
  if (status === 400 || status === 409 || status === 413 || status === 415) {
    return new ListingPhotoUploadError("rejected", "Azure rejected the photo", status);
  }
  return new ListingPhotoUploadError("storage", "Azure storage upload failed", status);
}

export function uploadBlobWithProgress(input: {
  url: string;
  file: Blob;
  contentType: string;
  onProgress: (percent: number) => void;
}) {
  return new Promise<void>((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open("PUT", input.url);
    request.setRequestHeader("x-ms-blob-type", "BlockBlob");
    request.setRequestHeader("Content-Type", input.contentType);

    request.upload.onprogress = (event) => {
      if (!event.lengthComputable || event.total <= 0) return;
      const percent = Math.max(0, Math.min(100, Math.round((event.loaded / event.total) * 100)));
      input.onProgress(percent);
    };
    request.onerror = () => {
      reject(new ListingPhotoUploadError("network", "Photo upload network error"));
    };
    request.onabort = () => {
      reject(new ListingPhotoUploadError("network", "Photo upload was interrupted"));
    };
    request.onload = () => {
      if (request.status >= 200 && request.status < 300) {
        input.onProgress(100);
        resolve();
        return;
      }
      reject(uploadErrorForStatus(request.status));
    };
    request.send(input.file);
  });
}

export function friendlyPhotoUploadError(error: unknown) {
  if (error instanceof ListingPhotoPreparationError) {
    switch (error.kind) {
      case "unsupported":
        return "Choose a JPG, PNG, HEIC, HEIF, or WebP photo.";
      case "empty":
        return "This photo is empty. Choose another image.";
      case "too_large":
        return "This photo is still over 10 MB after compression. Choose a smaller image.";
      case "decode_failed":
        return "We couldn't read this photo. Try exporting it as JPEG, then select it again.";
    }
  }

  if (error instanceof ListingPhotoUploadError) {
    switch (error.kind) {
      case "network":
        return "The upload was interrupted. Check your connection, then retry.";
      case "expired":
        return "The upload link expired. Retry upload to create a new link.";
      case "rejected":
        return "This photo couldn't be accepted. It is still selected, so you can retry.";
      case "storage":
        return "Storage couldn't finish the upload. The photo is still selected, so you can retry.";
    }
  }

  const status =
    typeof error === "object" && error !== null && "status" in error
      ? Number((error as { status?: unknown }).status)
      : null;
  if (status === 401) {
    return "Your session expired. Sign in again, then retry this photo.";
  }
  if (status === 413) {
    return "This photo is over the 10 MB upload limit.";
  }

  return "We couldn't upload this photo. It is still selected, so you can retry.";
}
