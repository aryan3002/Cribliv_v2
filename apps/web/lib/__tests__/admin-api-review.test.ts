import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("../api", async (orig) => {
  const actual = await orig<typeof import("../api")>();
  return { ...actual, fetchApi: vi.fn() };
});

import { fetchApi } from "../api";
import { fetchAdminListingDetail, fetchVerificationArtifactLink } from "../admin-api";

const mockedFetch = vi.mocked(fetchApi);

describe("admin review api", () => {
  beforeEach(() => vi.clearAllMocks());

  it("fetchAdminListingDetail calls the detail endpoint with auth", async () => {
    mockedFetch.mockResolvedValueOnce({ listing: { id: "L1" }, photos: [] } as any);
    const out = await fetchAdminListingDetail("tok", "L1");
    expect(mockedFetch).toHaveBeenCalledWith("/admin/review/listings/L1", {
      headers: { Authorization: "Bearer tok" }
    });
    expect(out.listing.id).toBe("L1");
  });

  it("fetchVerificationArtifactLink passes the kind query param", async () => {
    mockedFetch.mockResolvedValueOnce({ url: "https://x", expires_at: "t" } as any);
    const out = await fetchVerificationArtifactLink("tok", "V1", "video_liveness");
    expect(mockedFetch).toHaveBeenCalledWith(
      "/admin/review/verifications/V1/artifact-link?kind=video_liveness",
      { headers: { Authorization: "Bearer tok" } }
    );
    expect(out?.url).toBe("https://x");
    expect(out?.expiresAt).toBe("t");
  });
});
