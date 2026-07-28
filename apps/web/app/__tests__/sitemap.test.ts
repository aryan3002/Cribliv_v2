import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  fetchEnabledCities: vi.fn(),
  fetchCityPlaces: vi.fn(),
  buildSearchQuery: vi.fn((params: Record<string, string | number | boolean | undefined>) => {
    const qs = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined) qs.set(key, String(value));
    }
    return qs.toString();
  }),
  getApiBaseUrl: vi.fn(() => "http://api.test/v1")
}));

vi.mock("../../lib/seo-api", () => ({
  fetchEnabledCities: mocks.fetchEnabledCities,
  fetchCityPlaces: mocks.fetchCityPlaces
}));

vi.mock("../../lib/api", () => ({
  buildSearchQuery: mocks.buildSearchQuery,
  getApiBaseUrl: mocks.getApiBaseUrl
}));

import sitemap, { generateSitemaps } from "../sitemap";

function place(slug: string, nameEn: string, listingCount: number) {
  return {
    slug,
    name_en: nameEn,
    name_hi: null,
    listing_count: listingCount,
    indexable: listingCount >= 3
  };
}

// Thin entries are deliberately present in every list: the API returns all
// places with their counts, and the sitemap is responsible for filtering on
// `indexable`. Metro and landmark used to be emitted unfiltered.
const lucknowPlaces = {
  city_slug: "lucknow",
  localities: [place("gomti-nagar", "Gomti Nagar", 3), place("thin-place", "Thin Place", 2)],
  metro_stations: [
    place("bhootnath-market", "Bhootnath Market", 4),
    place("kashmere-gate", "Kashmere Gate", 0)
  ],
  landmarks: [
    place("charbagh-station", "Charbagh Station", 5),
    place("thin-landmark", "Thin Landmark", 1)
  ]
};

const emptyPlaces = {
  city_slug: "lucknow",
  localities: [],
  metro_stations: [],
  landmarks: []
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.fetchEnabledCities.mockResolvedValue(new Set(["lucknow"]));
  mocks.fetchCityPlaces.mockResolvedValue(lucknowPlaces);
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: true,
      json: async () => ({ data: { items: [], total: 0, page_size: 60 } })
    }))
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("sitemap", () => {
  it("generateSitemaps returns core, listings, and one chunk per enabled city", async () => {
    mocks.fetchEnabledCities.mockResolvedValueOnce(new Set(["lucknow", "noida"]));

    // core, listings, 2 city chunks, then the trailing blog chunk
    await expect(generateSitemaps()).resolves.toEqual([
      { id: 0 },
      { id: 1 },
      { id: 2 },
      { id: 3 },
      { id: 4 }
    ]);
  });

  it("generateSitemaps falls back to Lucknow when enabled-city lookup rejects", async () => {
    mocks.fetchEnabledCities.mockRejectedValueOnce(new Error("api unavailable"));

    // core, listings, 1 fallback city chunk, then the trailing blog chunk
    await expect(generateSitemaps()).resolves.toEqual([{ id: 0 }, { id: 1 }, { id: 2 }, { id: 3 }]);
  });

  it("sitemap id 0 is the core chunk and excludes programmatic metro or near URLs", async () => {
    mocks.fetchEnabledCities.mockResolvedValueOnce(new Set(["lucknow", "noida"]));

    const rows = await sitemap({ id: 0 });

    expect(rows.some((row) => row.url.endsWith("/en"))).toBe(true);
    expect(rows.some((row) => row.url.endsWith("/en/city/lucknow"))).toBe(true);
    expect(rows.some((row) => row.url.endsWith("/en/search"))).toBe(true);
    expect(rows.some((row) => row.url.endsWith("/en/about"))).toBe(true);
    expect(rows.some((row) => row.url.includes("/metro/"))).toBe(false);
    expect(rows.some((row) => row.url.includes("/near/"))).toBe(false);
  });

  it("sitemap id 2 builds Lucknow programmatic URLs from one places call and excludes every thin place", async () => {
    mocks.fetchEnabledCities.mockResolvedValueOnce(new Set(["lucknow", "noida"]));

    const rows = await sitemap({ id: 2 });

    // One call, ISR-cached for the same window as the page.
    expect(mocks.fetchCityPlaces).toHaveBeenCalledWith("lucknow", { revalidate: 86400 });

    expect(rows.some((row) => row.url.endsWith("/en/city/lucknow/gomti-nagar"))).toBe(true);
    expect(rows.some((row) => row.url.endsWith("/en/city/lucknow/metro/bhootnath-market"))).toBe(
      true
    );
    expect(rows.some((row) => row.url.endsWith("/en/city/lucknow/near/charbagh-station"))).toBe(
      true
    );

    // Thin places are excluded across ALL three kinds, not just localities.
    expect(rows.some((row) => row.url.includes("thin-place"))).toBe(false);
    expect(rows.some((row) => row.url.includes("kashmere-gate"))).toBe(false);
    expect(rows.some((row) => row.url.includes("thin-landmark"))).toBe(false);
  });

  it("sitemap id 2 no longer sources metro stations from the map endpoint", async () => {
    mocks.fetchEnabledCities.mockResolvedValueOnce(new Set(["lucknow"]));

    await sitemap({ id: 2 });

    // /map/metro returns whole metro LINES touching a city, which is why
    // Faridabad shipped 2,916 metro URLs while having zero stations.
    expect(mocks.fetchCityPlaces).toHaveBeenCalledTimes(1);
    expect(mocks).not.toHaveProperty("fetchMetroStationsForCity");
  });

  it("returns an empty sitemap for out-of-range chunk ids", async () => {
    mocks.fetchEnabledCities.mockResolvedValueOnce(new Set(["lucknow"]));

    await expect(sitemap({ id: 99 })).resolves.toEqual([]);
  });

  it("returns an empty city chunk when the city has no qualifying places", async () => {
    mocks.fetchEnabledCities.mockResolvedValueOnce(new Set(["lucknow"]));
    mocks.fetchCityPlaces.mockResolvedValueOnce(emptyPlaces);

    await expect(sitemap({ id: 2 })).resolves.toEqual([]);
  });

  it("returns an empty city chunk rather than throwing when the places fetch rejects", async () => {
    mocks.fetchEnabledCities.mockResolvedValueOnce(new Set(["lucknow"]));
    mocks.fetchCityPlaces.mockRejectedValueOnce(new Error("places failed"));

    // A rejected chunk would be served as a 500; an empty urlset is far better.
    await expect(sitemap({ id: 2 })).resolves.toEqual([]);
  });
});
