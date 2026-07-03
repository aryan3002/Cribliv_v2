import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../api", () => ({ fetchApi: vi.fn() }));

import { fetchApi } from "../api";
import { listSeoCities, setSeoCityEnabled } from "../admin-api";

const mockedFetch = vi.mocked(fetchApi);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("admin SEO city API", () => {
  it("lists city configs with auth and maps snake_case rows", async () => {
    mockedFetch.mockResolvedValueOnce({
      items: [
        {
          city_slug: "lucknow",
          name_en: "Lucknow",
          programmatic_enabled: true,
          locality_count: 26,
          landmark_count: 12,
          metro_count: 21,
          indexable_count: 18,
          enabled_at: "2026-07-03T00:00:00.000Z",
          notes: "reference",
          updated_at: "2026-07-03T01:00:00.000Z"
        }
      ]
    });

    const rows = await listSeoCities("tok");

    expect(mockedFetch).toHaveBeenCalledWith("/admin/seo/cities", {
      headers: { Authorization: "Bearer tok" }
    });
    expect(rows).toEqual([
      {
        citySlug: "lucknow",
        nameEn: "Lucknow",
        programmaticEnabled: true,
        localityCount: 26,
        landmarkCount: 12,
        metroCount: 21,
        indexableCount: 18,
        enabledAt: "2026-07-03T00:00:00.000Z",
        notes: "reference",
        updatedAt: "2026-07-03T01:00:00.000Z"
      }
    ]);
  });

  it("returns an empty array when items is missing", async () => {
    mockedFetch.mockResolvedValueOnce({});

    await expect(listSeoCities("tok")).resolves.toEqual([]);
  });

  it("patches a city toggle with notes and maps the returned row", async () => {
    mockedFetch.mockResolvedValueOnce({
      city_slug: "noida",
      programmatic_enabled: false,
      locality_count: 28,
      landmark_count: 14,
      metro_count: 8,
      indexable_count: 16,
      enabled_at: null,
      notes: "paused",
      updated_at: "2026-07-03T12:00:00.000Z"
    });

    const row = await setSeoCityEnabled("tok", "noida", false, "paused");

    expect(mockedFetch).toHaveBeenCalledWith("/admin/seo/cities/noida", {
      method: "PATCH",
      headers: { Authorization: "Bearer tok" },
      body: JSON.stringify({ programmatic_enabled: false, notes: "paused" })
    });
    expect(row).toEqual({
      citySlug: "noida",
      nameEn: "Noida",
      programmaticEnabled: false,
      localityCount: 28,
      landmarkCount: 14,
      metroCount: 8,
      indexableCount: 16,
      enabledAt: null,
      notes: "paused",
      updatedAt: "2026-07-03T12:00:00.000Z"
    });
  });

  it("omits notes from the patch body when notes is undefined", async () => {
    mockedFetch.mockResolvedValueOnce({
      city_slug: "noida",
      name_en: "Noida",
      programmatic_enabled: true,
      locality_count: 28,
      landmark_count: 14,
      metro_count: 8,
      indexable_count: 16,
      enabled_at: "2026-07-03T12:00:00.000Z",
      notes: null,
      updated_at: "2026-07-03T12:00:00.000Z"
    });

    await setSeoCityEnabled("tok", "noida", true);

    expect(mockedFetch).toHaveBeenCalledWith("/admin/seo/cities/noida", {
      method: "PATCH",
      headers: { Authorization: "Bearer tok" },
      body: JSON.stringify({ programmatic_enabled: true })
    });
  });
});
