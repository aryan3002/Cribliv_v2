import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../api", async (orig) => {
  const actual = await orig<typeof import("../api")>();
  return { ...actual, fetchApi: vi.fn() };
});

import { fetchApi } from "../api";
import { setAdminHomeAvailability, fetchAdminHomeWaitlist } from "../admin-api";

const mockedFetchApi = vi.mocked(fetchApi);

describe("admin homes availability + waitlist api", () => {
  beforeEach(() => vi.clearAllMocks());

  it("setAdminHomeAvailability PATCHes the availability-status route with a reason", async () => {
    mockedFetchApi.mockResolvedValue({ listing_id: "L1", is_available: false });

    const result = await setAdminHomeAvailability("tok", "L1", false, "went off-market");

    expect(mockedFetchApi).toHaveBeenCalledWith("/admin/homes/L1/availability-status", {
      method: "PATCH",
      headers: { Authorization: "Bearer tok" },
      body: JSON.stringify({ available: false, reason: "went off-market" })
    });
    expect(result).toEqual({ listingId: "L1", isAvailable: false });
  });

  it("setAdminHomeAvailability omits the reason when not provided", async () => {
    mockedFetchApi.mockResolvedValue({ listing_id: "L1", is_available: true });

    const result = await setAdminHomeAvailability("tok", "L1", true);

    expect(mockedFetchApi).toHaveBeenCalledWith("/admin/homes/L1/availability-status", {
      method: "PATCH",
      headers: { Authorization: "Bearer tok" },
      body: JSON.stringify({ available: true, reason: undefined })
    });
    expect(result).toEqual({ listingId: "L1", isAvailable: true });
  });

  it("fetchAdminHomeWaitlist GETs the waitlist route", async () => {
    mockedFetchApi.mockResolvedValue({
      items: [{ id: "a1", phone: "+91900", user_id: null, status: "waiting", created_at: "" }]
    });

    const leads = await fetchAdminHomeWaitlist("tok", "L1");

    expect(mockedFetchApi).toHaveBeenCalledWith("/admin/homes/L1/waitlist", {
      headers: { Authorization: "Bearer tok" }
    });
    expect(leads[0].phone).toBe("+91900");
  });

  it("fetchAdminHomeWaitlist returns an empty array when items is missing", async () => {
    mockedFetchApi.mockResolvedValue({});

    const leads = await fetchAdminHomeWaitlist("tok", "L1");

    expect(leads).toEqual([]);
  });
});
