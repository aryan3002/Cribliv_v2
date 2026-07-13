import { beforeEach, describe, expect, it, vi } from "vitest";

const { fetchApi } = vi.hoisted(() => ({ fetchApi: vi.fn() }));

vi.mock("../api", () => ({ fetchApi }));

import {
  getManagedProperty,
  getOccupancySummary,
  relistBed,
  updateBedStatus
} from "../pg-operations-api";

describe("pg operations API client", () => {
  beforeEach(() => {
    fetchApi.mockReset();
  });

  it("passes filters and the bearer token to the occupancy endpoint", () => {
    getOccupancySummary("property-1", "token-1", { floor: 2, status: "vacant" });

    expect(fetchApi).toHaveBeenCalledWith(
      "/pg-operator/properties/property-1/occupancy?floor=2&status=vacant",
      expect.objectContaining({ headers: { Authorization: "Bearer token-1" } })
    );
  });

  it("sends bed actions to their property-scoped endpoints", () => {
    updateBedStatus("property-1", "bed-1", "blocked", "token-1");
    relistBed("property-1", "bed-1", "token-1");

    expect(fetchApi).toHaveBeenNthCalledWith(
      1,
      "/pg-operator/properties/property-1/beds/bed-1/status",
      expect.objectContaining({
        method: "PATCH",
        headers: expect.objectContaining({ Authorization: "Bearer token-1" }),
        body: JSON.stringify({ status: "blocked" })
      })
    );
    expect(fetchApi).toHaveBeenNthCalledWith(
      2,
      "/pg-operator/properties/property-1/beds/bed-1/relist",
      expect.objectContaining({
        method: "POST",
        headers: { Authorization: "Bearer token-1" }
      })
    );
  });

  it("gets the managed property before rendering an operations route", () => {
    getManagedProperty("property-1", "token-1");

    expect(fetchApi).toHaveBeenCalledWith(
      "/pg-operator/properties/property-1",
      expect.objectContaining({ headers: { Authorization: "Bearer token-1" } })
    );
  });
});
