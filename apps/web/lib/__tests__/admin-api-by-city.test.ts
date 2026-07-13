import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../api", () => ({ fetchApi: vi.fn() }));

import { fetchApi } from "../api";
import { fetchAdminAnalyticsByCity } from "../admin-api";

const mockedFetch = vi.mocked(fetchApi);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("fetchAdminAnalyticsByCity", () => {
  it("maps the BARE data array the endpoint returns — regression for the {items} bug", async () => {
    // GET /admin/analytics/listings is ok(array); fetchApi unwraps `.data`, so
    // it resolves to a bare array — NOT a { items } envelope. Reading `.items`
    // here (the old bug) always produced [] → "No city data yet".
    mockedFetch.mockResolvedValueOnce([
      { city: "lucknow", locality: "Alambagh", count: 26 },
      { city: "varanasi", locality: null, count: 1 }
    ] as never);

    const rows = await fetchAdminAnalyticsByCity("acc_token");

    expect(mockedFetch).toHaveBeenCalledWith(
      "/admin/analytics/listings",
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: "Bearer acc_token" })
      })
    );
    expect(rows).toEqual([
      { city: "lucknow", locality: "Alambagh", count: 26 },
      { city: "varanasi", locality: null, count: 1 }
    ]);
  });

  it("returns [] when the endpoint yields nothing", async () => {
    mockedFetch.mockResolvedValueOnce(undefined as never);
    expect(await fetchAdminAnalyticsByCity("t")).toEqual([]);
  });
});
