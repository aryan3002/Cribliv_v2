import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../api", async (orig) => {
  const actual = await orig<typeof import("../api")>();
  return { ...actual, fetchApi: vi.fn() };
});

import { fetchApi } from "../api";
import { fetchAdminHomeDetail, fetchAdminHomes, fetchAdminLeadBoard } from "../admin-api";

const mockedFetchApi = vi.mocked(fetchApi);

describe("admin homes api", () => {
  beforeEach(() => vi.clearAllMocks());

  it("forwards homes list filters with auth", async () => {
    await fetchAdminHomes("tok", {
      status: "paused",
      city: "lucknow",
      sort: "views",
      page: 2,
      page_size: 50
    });

    expect(mockedFetchApi).toHaveBeenCalledWith(
      "/admin/homes?status=paused&city=lucknow&sort=views&page=2&page_size=50",
      { headers: { Authorization: "Bearer tok" } }
    );
  });

  it("requests home detail with auth", async () => {
    await fetchAdminHomeDetail("tok", "11111111-1111-4111-8111-111111111111");

    expect(mockedFetchApi).toHaveBeenCalledWith(
      "/admin/homes/11111111-1111-4111-8111-111111111111",
      { headers: { Authorization: "Bearer tok" } }
    );
  });

  it("forwards listing_id to the lead board", async () => {
    await fetchAdminLeadBoard("tok", { listing_id: "11111111-1111-4111-8111-111111111111" });

    expect(mockedFetchApi).toHaveBeenCalledWith(
      "/admin/leads/board?listing_id=11111111-1111-4111-8111-111111111111",
      { headers: { Authorization: "Bearer tok" } }
    );
  });
});
