import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ListingPhotoPreparationError,
  ListingPhotoUploadError,
  calculateListingPhotoDimensions,
  detectListingPhotoKind,
  friendlyPhotoUploadError,
  prepareListingPhoto,
  uploadBlobWithProgress,
  type ListingPhotoPreparationDeps
} from "../listing-photo";

function file(name: string, type: string, size = 4) {
  return new File([new Uint8Array(size)], name, { type, lastModified: 1234 });
}

describe("listing photo preparation", () => {
  it("detects supported formats from MIME type and iPhone filename fallbacks", () => {
    expect(detectListingPhotoKind(file("room.jpeg", "image/jpeg"))).toBe("jpeg");
    expect(detectListingPhotoKind(file("room.png", "image/png"))).toBe("png");
    expect(detectListingPhotoKind(file("room.webp", "image/webp"))).toBe("webp");
    expect(detectListingPhotoKind(file("IMG_0001.HEIC", ""))).toBe("heic");
    expect(detectListingPhotoKind(file("room.heif", "image/heif"))).toBe("heif");
    expect(detectListingPhotoKind(file("room.gif", "image/gif"))).toBeNull();
  });

  it("constrains the long edge to 2560 pixels without upscaling", () => {
    expect(calculateListingPhotoDimensions(4032, 3024)).toEqual({
      width: 2560,
      height: 1920
    });
    expect(calculateListingPhotoDimensions(900, 1200)).toEqual({
      width: 900,
      height: 1200
    });
  });

  it("converts HEIC input and returns a normalized JPEG file", async () => {
    const close = vi.fn();
    const convertHeic = vi.fn(async () => new Blob(["converted"], { type: "image/png" }));
    const encodeJpeg = vi.fn(async () => new Blob(["jpeg"], { type: "image/jpeg" }));
    const deps: ListingPhotoPreparationDeps = {
      convertHeic,
      decodeImage: vi.fn(async () => ({
        source: {} as CanvasImageSource,
        width: 4032,
        height: 3024,
        close
      })),
      encodeJpeg
    };

    const result = await prepareListingPhoto(file("IMG_0001.HEIC", ""), deps);

    expect(convertHeic).toHaveBeenCalledTimes(1);
    expect(encodeJpeg).toHaveBeenCalledWith(expect.anything(), 2560, 1920, 0.82);
    expect(result.name).toBe("IMG_0001.jpg");
    expect(result.type).toBe("image/jpeg");
    expect(result.lastModified).toBe(1234);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("reduces JPEG quality when the first encoded result exceeds 10 MB", async () => {
    const qualities: number[] = [];
    const deps: ListingPhotoPreparationDeps = {
      convertHeic: vi.fn(),
      decodeImage: vi.fn(async () => ({
        source: {} as CanvasImageSource,
        width: 2000,
        height: 1500
      })),
      encodeJpeg: vi.fn(async (_source, _width, _height, quality) => {
        qualities.push(quality);
        const size = quality === 0.82 ? 10 * 1024 * 1024 + 1 : 1024;
        return new Blob([new Uint8Array(size)], { type: "image/jpeg" });
      })
    };

    const result = await prepareListingPhoto(file("room.png", "image/png"), deps);

    expect(qualities).toEqual([0.82, 0.72]);
    expect(result.size).toBe(1024);
  });

  it("rejects an image that remains above the upload limit", async () => {
    const deps: ListingPhotoPreparationDeps = {
      convertHeic: vi.fn(),
      decodeImage: vi.fn(async () => ({
        source: {} as CanvasImageSource,
        width: 2000,
        height: 1500
      })),
      encodeJpeg: vi.fn(async () => {
        return new Blob([new Uint8Array(10 * 1024 * 1024 + 1)], { type: "image/jpeg" });
      })
    };

    await expect(prepareListingPhoto(file("room.webp", "image/webp"), deps)).rejects.toMatchObject({
      kind: "too_large"
    });
  });
});

describe("listing photo upload transport", () => {
  const originalXhr = globalThis.XMLHttpRequest;

  afterEach(() => {
    Object.defineProperty(globalThis, "XMLHttpRequest", {
      configurable: true,
      writable: true,
      value: originalXhr
    });
  });

  it("reports transferred-byte progress and resolves for a successful Azure PUT", async () => {
    const progress: number[] = [];

    class SuccessfulXhr {
      status = 201;
      upload: { onprogress: ((event: ProgressEvent) => void) | null } = { onprogress: null };
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      onabort: (() => void) | null = null;
      open = vi.fn();
      setRequestHeader = vi.fn();
      send() {
        this.upload.onprogress?.({ lengthComputable: true, loaded: 5, total: 10 } as ProgressEvent);
        this.onload?.();
      }
    }

    Object.defineProperty(globalThis, "XMLHttpRequest", {
      configurable: true,
      writable: true,
      value: SuccessfulXhr
    });

    await uploadBlobWithProgress({
      url: "https://storage.test/photo",
      file: new Blob(["photo"]),
      contentType: "image/jpeg",
      onProgress: (percent) => progress.push(percent)
    });

    expect(progress).toEqual([50, 100]);
  });

  it("maps Azure rejection to actionable copy without exposing raw HTTP errors", async () => {
    class RejectedXhr {
      status = 403;
      upload = { onprogress: null };
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      onabort: (() => void) | null = null;
      open() {}
      setRequestHeader() {}
      send() {
        this.onload?.();
      }
    }

    Object.defineProperty(globalThis, "XMLHttpRequest", {
      configurable: true,
      writable: true,
      value: RejectedXhr
    });

    let caught: unknown;
    try {
      await uploadBlobWithProgress({
        url: "https://storage.test/photo",
        file: new Blob(["photo"]),
        contentType: "image/jpeg",
        onProgress: () => {}
      });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(ListingPhotoUploadError);
    expect(friendlyPhotoUploadError(caught)).toMatch(/upload link expired/i);
    expect(friendlyPhotoUploadError(caught)).not.toMatch(/http 403/i);
  });

  it("maps preparation and generic failures to owner-facing messages", () => {
    expect(
      friendlyPhotoUploadError(new ListingPhotoPreparationError("unsupported", "bad type"))
    ).toMatch(/jpg, png, heic, heif, or webp/i);
    expect(friendlyPhotoUploadError(new Error("Photo upload failed (HTTP 500)"))).toMatch(
      /still selected/i
    );
    expect(friendlyPhotoUploadError(new Error("Photo upload failed (HTTP 500)"))).not.toMatch(
      /http 500/i
    );
  });
});
