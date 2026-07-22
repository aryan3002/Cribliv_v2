import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("../api", async (orig) => {
  const actual = await orig<typeof import("../api")>();
  return { ...actual, fetchApi: vi.fn() };
});

import { fetchApi } from "../api";
import { setListingAvailability, toggleListingAvailability } from "../owner-api";

const mockedFetch = vi.mocked(fetchApi);

describe("owner-api availability functions", () => {
  beforeEach(() => vi.clearAllMocks());

  describe("setListingAvailability", () => {
    it("PATCHes /availability-status with { available }", async () => {
      mockedFetch.mockResolvedValueOnce({
        listing_id: "L1",
        is_available: false
      } as any);

      const res = await setListingAvailability("tok", "L1", false);

      expect(mockedFetch).toHaveBeenCalledWith(
        "/owner/listings/L1/availability-status",
        expect.objectContaining({
          method: "PATCH",
          headers: { Authorization: "Bearer tok" },
          body: JSON.stringify({ available: false })
        })
      );
      expect(res.listing_id).toBe("L1");
      expect(res.is_available).toBe(false);
    });

    it("returns correct type for true availability", async () => {
      mockedFetch.mockResolvedValueOnce({
        listing_id: "L2",
        is_available: true
      } as any);

      const res = await setListingAvailability("tok", "L2", true);

      expect(res.listing_id).toBe("L2");
      expect(res.is_available).toBe(true);
    });
  });

  describe("toggleListingAvailability", () => {
    it("PATCHes /visibility (not /availability)", async () => {
      mockedFetch.mockResolvedValueOnce({
        listing_id: "L1",
        status: "active"
      } as any);

      const res = await toggleListingAvailability("tok", "L1", true);

      expect(mockedFetch).toHaveBeenCalledWith(
        "/owner/listings/L1/visibility",
        expect.objectContaining({
          method: "PATCH",
          headers: { Authorization: "Bearer tok" },
          body: JSON.stringify({ available: true })
        })
      );
      expect(res.listingId).toBe("L1");
      expect(res.status).toBe("active");
    });

    it("pauses the listing by sending available: false", async () => {
      mockedFetch.mockResolvedValueOnce({
        listing_id: "L3",
        status: "paused"
      } as any);

      const res = await toggleListingAvailability("tok", "L3", false);

      expect(mockedFetch).toHaveBeenCalledWith(
        "/owner/listings/L3/visibility",
        expect.objectContaining({
          body: JSON.stringify({ available: false })
        })
      );
      expect(res.status).toBe("paused");
    });
  });
});
