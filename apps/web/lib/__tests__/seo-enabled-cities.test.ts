import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../api", () => ({ fetchApi: vi.fn() }));

import { fetchApi } from "../api";
import { fetchEnabledCities } from "../seo-api";

const f = fetchApi as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  f.mockReset();
});

describe("fetchEnabledCities", () => {
  it("returns enabled city slugs as a Set and fetches fresh (no-store)", async () => {
    f.mockResolvedValueOnce({
      items: [
        { city_slug: "lucknow", programmatic_enabled: true },
        { city_slug: "noida", programmatic_enabled: true }
      ]
    });

    const cities = await fetchEnabledCities();

    expect(cities).toBeInstanceOf(Set);
    expect(cities.has("lucknow")).toBe(true);
    expect(cities.has("noida")).toBe(true);
    // Fetched no-store so an admin enabling a city is reflected on the next
    // render rather than gated on a stale per-fetch cache.
    expect(f).toHaveBeenCalledWith("/seo/cities", undefined, { server: true });
  });

  it("excludes disabled cities from the returned Set", async () => {
    f.mockResolvedValueOnce({
      items: [
        { city_slug: "lucknow", programmatic_enabled: true },
        { city_slug: "kanpur", programmatic_enabled: false }
      ]
    });

    const cities = await fetchEnabledCities();

    expect(cities.has("lucknow")).toBe(true);
    expect(cities.has("kanpur")).toBe(false);
  });

  it("falls back to Lucknow when the API request fails", async () => {
    f.mockRejectedValueOnce(new Error("api unavailable"));

    await expect(fetchEnabledCities()).resolves.toEqual(new Set(["lucknow"]));
  });

  it("falls back to Lucknow when the payload is malformed", async () => {
    f.mockResolvedValueOnce({});

    await expect(fetchEnabledCities()).resolves.toEqual(new Set(["lucknow"]));
  });

  it("falls back to Lucknow when no enabled city is returned", async () => {
    f.mockResolvedValueOnce({
      items: [
        { city_slug: "noida", programmatic_enabled: false },
        { city_slug: "kanpur", programmatic_enabled: false }
      ]
    });

    await expect(fetchEnabledCities()).resolves.toEqual(new Set(["lucknow"]));
  });
});
