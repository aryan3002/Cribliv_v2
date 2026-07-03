import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  fetchEnabledCities: vi.fn(),
  fetchLocalities: vi.fn(),
  fetchLandmarks: vi.fn(),
  fetchMetroStationsForCity: vi.fn(),
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
  fetchLocalities: mocks.fetchLocalities,
  fetchLandmarks: mocks.fetchLandmarks,
  fetchMetroStationsForCity: mocks.fetchMetroStationsForCity
}));

vi.mock("../../lib/api", () => ({
  buildSearchQuery: mocks.buildSearchQuery,
  getApiBaseUrl: mocks.getApiBaseUrl
}));

import sitemap, { generateSitemaps } from "../sitemap";

const cityRows = [
  {
    id: 1,
    slug: "gomti-nagar",
    name_en: "Gomti Nagar",
    name_hi: "गोमती नगर",
    lat: null,
    lng: null,
    parent_locality_slug: null,
    listing_count: 3
  },
  {
    id: 2,
    slug: "thin-place",
    name_en: "Thin Place",
    name_hi: "थिन प्लेस",
    lat: null,
    lng: null,
    parent_locality_slug: null,
    listing_count: 2
  }
];

const landmarkRows = [
  {
    id: 1,
    slug: "charbagh-station",
    name_en: "Charbagh Station",
    name_hi: "चारबाग स्टेशन",
    type: "station",
    aka: [],
    lat: 26.831,
    lng: 80.923,
    primary_locality_slug: null,
    primary_locality_name_en: null
  }
];

const metroRows = [
  {
    id: 1,
    station_name: "Bhootnath Market",
    line_name: "Red Line",
    line_color: "#e11d48",
    lat: 26.871,
    lng: 80.995,
    sequence: 1
  }
];

beforeEach(() => {
  vi.clearAllMocks();
  mocks.fetchEnabledCities.mockResolvedValue(new Set(["lucknow"]));
  mocks.fetchLocalities.mockResolvedValue(cityRows);
  mocks.fetchLandmarks.mockResolvedValue(landmarkRows);
  mocks.fetchMetroStationsForCity.mockResolvedValue(metroRows);
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

    await expect(generateSitemaps()).resolves.toEqual([{ id: 0 }, { id: 1 }, { id: 2 }, { id: 3 }]);
  });

  it("generateSitemaps falls back to Lucknow when enabled-city lookup rejects", async () => {
    mocks.fetchEnabledCities.mockRejectedValueOnce(new Error("api unavailable"));

    await expect(generateSitemaps()).resolves.toEqual([{ id: 0 }, { id: 1 }, { id: 2 }]);
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

  it("sitemap id 2 builds Lucknow programmatic URLs from API data and excludes thin localities", async () => {
    mocks.fetchEnabledCities.mockResolvedValueOnce(new Set(["lucknow", "noida"]));

    const rows = await sitemap({ id: 2 });

    expect(mocks.fetchLocalities).toHaveBeenCalledWith("lucknow");
    expect(mocks.fetchLandmarks).toHaveBeenCalledWith("lucknow");
    expect(mocks.fetchMetroStationsForCity).toHaveBeenCalledWith("lucknow");
    expect(rows.some((row) => row.url.endsWith("/en/city/lucknow/gomti-nagar"))).toBe(true);
    expect(rows.some((row) => row.url.includes("thin-place"))).toBe(false);
    expect(rows.some((row) => row.url.endsWith("/en/city/lucknow/metro/bhootnath-market"))).toBe(
      true
    );
    expect(rows.some((row) => row.url.endsWith("/en/city/lucknow/near/charbagh-station"))).toBe(
      true
    );
  });

  it("returns an empty sitemap for out-of-range chunk ids", async () => {
    mocks.fetchEnabledCities.mockResolvedValueOnce(new Set(["lucknow"]));

    await expect(sitemap({ id: 99 })).resolves.toEqual([]);
  });

  it("returns an empty city chunk when city fetches fail", async () => {
    mocks.fetchEnabledCities.mockResolvedValueOnce(new Set(["lucknow"]));
    mocks.fetchLocalities.mockRejectedValueOnce(new Error("localities failed"));
    mocks.fetchLandmarks.mockRejectedValueOnce(new Error("landmarks failed"));
    mocks.fetchMetroStationsForCity.mockRejectedValueOnce(new Error("metro failed"));

    await expect(sitemap({ id: 2 })).resolves.toEqual([]);
  });
});
