import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../api", () => ({
  fetchApi: vi.fn(),
  buildSearchQuery: vi.fn(() => "")
}));

import { fetchApi } from "../api";
import { fetchCityPlaces } from "../seo-api";

const mockFetchApi = vi.mocked(fetchApi);

afterEach(() => {
  vi.resetAllMocks();
});

describe("fetchCityPlaces", () => {
  it("requests the places endpoint and passes the caller's revalidate through", async () => {
    mockFetchApi.mockResolvedValueOnce({
      city_slug: "lucknow",
      localities: [
        {
          slug: "gomti-nagar",
          name_en: "Gomti Nagar",
          name_hi: null,
          listing_count: 4,
          indexable: true
        }
      ],
      metro_stations: [],
      landmarks: []
    });

    const places = await fetchCityPlaces("lucknow", { revalidate: 86400 });

    expect(places.localities[0].indexable).toBe(true);
    expect(mockFetchApi).toHaveBeenCalledWith("/seo/cities/lucknow/places", undefined, {
      server: true,
      revalidate: 86400
    });
  });

  it("returns empty place lists when the API is unreachable", async () => {
    mockFetchApi.mockRejectedValueOnce(new Error("ECONNREFUSED"));

    await expect(fetchCityPlaces("lucknow")).resolves.toEqual({
      city_slug: "lucknow",
      localities: [],
      metro_stations: [],
      landmarks: []
    });
  });

  it("tolerates a partial payload rather than throwing on undefined lists", async () => {
    mockFetchApi.mockResolvedValueOnce({ city_slug: "noida" });

    await expect(fetchCityPlaces("noida")).resolves.toEqual({
      city_slug: "noida",
      localities: [],
      metro_stations: [],
      landmarks: []
    });
  });

  it("url-encodes the city slug", async () => {
    mockFetchApi.mockResolvedValueOnce({
      city_slug: "a b",
      localities: [],
      metro_stations: [],
      landmarks: []
    });

    await fetchCityPlaces("a b");

    expect(mockFetchApi).toHaveBeenCalledWith("/seo/cities/a%20b/places", undefined, {
      server: true,
      revalidate: undefined
    });
  });
});
