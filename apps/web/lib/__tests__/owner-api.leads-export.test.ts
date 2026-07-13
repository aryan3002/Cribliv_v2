import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ApiError } from "../api";
import { exportOwnerLeadsCsv } from "../owner-api";

describe("owner leads CSV export API", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("fetches the guarded CSV export with the owner bearer token and returns a Blob", async () => {
    const blob = new Blob(["lead_id,tenant\nlead-1,Asha\n"], { type: "text/csv" });
    fetchMock.mockResolvedValueOnce({
      ok: true,
      blob: async () => blob
    });

    const result = await exportOwnerLeadsCsv("tok_owner");

    expect(result).toBe(blob);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe("http://localhost:4000/v1/owner/leads/export");
    expect(init.method).toBe("GET");
    expect(new Headers(init.headers).get("Authorization")).toBe("Bearer tok_owner");
    expect(new Headers(init.headers).has("Content-Type")).toBe(false);
  });

  it("throws ApiError with API error metadata without reading raw HTTP text", async () => {
    const text = vi.fn(async () => "raw forbidden text");
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 403,
      json: async () => ({
        error: {
          code: "forbidden",
          message: "Owner role required",
          details: { role: "tenant" }
        }
      }),
      text
    });

    await expect(exportOwnerLeadsCsv("tok_owner")).rejects.toMatchObject({
      name: "ApiError",
      status: 403,
      code: "forbidden",
      message: "Owner role required",
      details: { role: "tenant" }
    } satisfies Partial<ApiError>);
    expect(text).not.toHaveBeenCalled();
  });
});
