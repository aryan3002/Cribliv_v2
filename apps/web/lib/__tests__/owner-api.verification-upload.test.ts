import { afterEach, describe, expect, it, vi } from "vitest";
import { friendlyVerificationArtifactUploadError, uploadVerificationArtifact } from "../owner-api";
import { ApiError, fetchApi } from "../api";

vi.mock("../api", async () => {
  const actual = await vi.importActual<typeof import("../api")>("../api");
  return {
    ...actual,
    getApiBaseUrl: vi.fn(() => "http://api.test/v1"),
    fetchApi: vi.fn()
  };
});

const fetchApiMock = vi.mocked(fetchApi);

function mp4File() {
  return new File(
    [new Uint8Array([0x00, 0x00, 0x00, 0x14]), "ftypisom", new Uint8Array([0x00])],
    "video-proof.mp4",
    { type: "video/mp4", lastModified: 1234 }
  );
}

describe("uploadVerificationArtifact", () => {
  const originalXhr = globalThis.XMLHttpRequest;

  afterEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(globalThis, "XMLHttpRequest", {
      configurable: true,
      writable: true,
      value: originalXhr
    });
  });

  it("presigns, uploads multipart bytes with bearer auth, completes, and reports progress", async () => {
    const progress: number[] = [];
    let uploadUrl = "";
    let uploadMethod = "";
    let uploadHeaders: Record<string, string> = {};
    let uploadBody: XMLHttpRequestBodyInit | null = null;
    const file = mp4File();

    fetchApiMock
      .mockResolvedValueOnce({
        upload_token: "upload-token-1",
        upload_url: "/owner/verification/artifacts/upload",
        blob_path: "listing-1/verification/video_liveness/video-proof.mp4",
        expires_at: "2026-07-13T12:10:00.000Z"
      })
      .mockResolvedValueOnce({
        blob_path: "listing-1/verification/video_liveness/video-proof.mp4"
      });

    class SuccessfulXhr {
      status = 201;
      upload: { onprogress: ((event: ProgressEvent) => void) | null } = { onprogress: null };
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      onabort: (() => void) | null = null;
      open(method: string, url: string) {
        uploadMethod = method;
        uploadUrl = url;
      }
      setRequestHeader(name: string, value: string) {
        uploadHeaders[name] = value;
      }
      send(body: XMLHttpRequestBodyInit) {
        uploadBody = body;
        this.upload.onprogress?.({
          lengthComputable: true,
          loaded: 5,
          total: 10
        } as ProgressEvent);
        this.onload?.();
      }
    }

    Object.defineProperty(globalThis, "XMLHttpRequest", {
      configurable: true,
      writable: true,
      value: SuccessfulXhr
    });

    const result = await uploadVerificationArtifact("owner-token", {
      listingId: "listing-1",
      kind: "video_liveness",
      file,
      onProgress: (percent) => progress.push(percent)
    });

    expect(result).toEqual({ blobPath: "listing-1/verification/video_liveness/video-proof.mp4" });
    expect(fetchApiMock).toHaveBeenNthCalledWith(1, "/owner/verification/artifacts/presign", {
      method: "POST",
      headers: { Authorization: "Bearer owner-token" },
      body: JSON.stringify({
        listing_id: "listing-1",
        kind: "video_liveness",
        content_type: "video/mp4",
        size_bytes: file.size,
        file_name: "video-proof.mp4"
      })
    });
    expect(uploadMethod).toBe("POST");
    expect(uploadUrl).toBe("http://api.test/v1/owner/verification/artifacts/upload");
    expect(uploadHeaders.Authorization).toBe("Bearer owner-token");
    expect(uploadBody).toBeInstanceOf(FormData);
    const formData = uploadBody as unknown as FormData;
    expect(formData.get("upload_token")).toBe("upload-token-1");
    expect(formData.get("file")).toBeInstanceOf(File);
    expect(fetchApiMock).toHaveBeenNthCalledWith(2, "/owner/verification/artifacts/complete", {
      method: "POST",
      headers: { Authorization: "Bearer owner-token" },
      body: JSON.stringify({
        listing_id: "listing-1",
        upload_token: "upload-token-1",
        blob_path: "listing-1/verification/video_liveness/video-proof.mp4"
      })
    });
    expect(progress).toEqual([50, 100]);
  });

  it("maps upload and API failures to friendly messages without raw HTTP text", async () => {
    expect(
      friendlyVerificationArtifactUploadError(
        new ApiError("Unsupported verification artifact content_type", {
          status: 400,
          code: "invalid_content_type"
        })
      )
    ).toBe("Choose a supported verification file.");

    expect(
      friendlyVerificationArtifactUploadError(
        new ApiError("Artifact size must be between 1 byte and 10485760 bytes", {
          status: 400,
          code: "invalid_file_size"
        })
      )
    ).toBe("This file is too large. Choose a smaller file.");

    expect(
      friendlyVerificationArtifactUploadError(
        new ApiError("upload_token has expired", {
          status: 400,
          code: "upload_token_expired"
        })
      )
    ).toBe("The upload expired. Select the file again, then retry.");

    expect(
      friendlyVerificationArtifactUploadError(
        new ApiError("Request failed with status 401", {
          status: 401,
          code: "unauthorized"
        })
      )
    ).toBe("Your session expired. Sign in again, then retry.");

    expect(friendlyVerificationArtifactUploadError(new Error("HTTP 500"))).toBe(
      "We couldn't complete the upload. The file is still selected, so you can retry."
    );
  });
});
