import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../api", () => ({ fetchApi: vi.fn() }));

import { fetchApi } from "../api";
import {
  deleteSeoCopyOverride,
  fetchSeoCopyForPath,
  fetchSeoCopyStatus,
  fetchSeoTemplateCopy,
  generateSeoCopyBatchForCity,
  generateSeoCopyOne,
  listSeoCities,
  revalidateSeoPaths,
  setSeoCityEnabled,
  upsertSeoCopyOverride
} from "../admin-api";

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
        thinCount: 0,
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
      thinCount: 0,
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

describe("admin SEO copy control API", () => {
  it("fetchSeoCopyStatus GETs copy-status with citySlug + auth", async () => {
    mockedFetch.mockResolvedValueOnce({
      items: [{ slug: "gomti-nagar", en: "ai", hi: "template" }]
    });

    const rows = await fetchSeoCopyStatus("tok", "lucknow");

    expect(mockedFetch).toHaveBeenCalledWith("/admin/seo/copy-status?citySlug=lucknow", {
      headers: { Authorization: "Bearer tok" }
    });
    expect(rows).toEqual([{ slug: "gomti-nagar", en: "ai", hi: "template" }]);
  });

  it("fetchSeoCopyStatus returns [] when items missing", async () => {
    mockedFetch.mockResolvedValueOnce({});
    await expect(fetchSeoCopyStatus("tok", "lucknow")).resolves.toEqual([]);
  });

  it("generateSeoCopyOne POSTs generate-one with slugs + auth", async () => {
    mockedFetch.mockResolvedValueOnce({ en: null, hi: null });

    await generateSeoCopyOne("tok", "lucknow", "gomti-nagar");

    expect(mockedFetch).toHaveBeenCalledWith("/admin/seo/copy/generate-one", {
      method: "POST",
      headers: { Authorization: "Bearer tok" },
      body: JSON.stringify({ citySlug: "lucknow", localitySlug: "gomti-nagar" })
    });
  });

  it("upsertSeoCopyOverride PUTs the override payload", async () => {
    mockedFetch.mockResolvedValueOnce({ page_path: "/city/lucknow/gomti-nagar", locale: "en" });
    const copy = {
      h1: "H",
      meta_title: "T",
      meta_description: "D",
      intro_paragraph: "I",
      nearby_blurb: null,
      faq_items: []
    };

    await upsertSeoCopyOverride("tok", {
      citySlug: "lucknow",
      localitySlug: "gomti-nagar",
      locale: "en",
      copy,
      notes: "n"
    });

    expect(mockedFetch).toHaveBeenCalledWith("/admin/seo/copy/override", {
      method: "PUT",
      headers: { Authorization: "Bearer tok" },
      body: JSON.stringify({
        citySlug: "lucknow",
        localitySlug: "gomti-nagar",
        locale: "en",
        copy,
        notes: "n"
      })
    });
  });

  it("deleteSeoCopyOverride DELETEs with path + locale query", async () => {
    mockedFetch.mockResolvedValueOnce({ page_path: "/city/lucknow/gomti-nagar", locale: "en" });

    await deleteSeoCopyOverride("tok", "/city/lucknow/gomti-nagar", "en");

    const [path, init] = mockedFetch.mock.calls[0];
    expect(String(path)).toContain("/admin/seo/copy/override?");
    expect(String(path)).toContain("path=%2Fcity%2Flucknow%2Fgomti-nagar");
    expect(String(path)).toContain("locale=en");
    expect(init).toMatchObject({ method: "DELETE", headers: { Authorization: "Bearer tok" } });
  });

  it("generateSeoCopyBatchForCity POSTs the city batch and returns counts", async () => {
    mockedFetch.mockResolvedValueOnce({ generated: 4, skipped: 1 });

    const res = await generateSeoCopyBatchForCity("tok", "lucknow");

    expect(mockedFetch).toHaveBeenCalledWith("/admin/seo/copy/generate-batch", {
      method: "POST",
      headers: { Authorization: "Bearer tok" },
      body: JSON.stringify({ citySlug: "lucknow" })
    });
    expect(res).toEqual({ generated: 4, skipped: 1 });
  });

  it("fetchSeoCopyForPath GETs the public copy endpoint with path + locale", async () => {
    mockedFetch.mockResolvedValueOnce({
      h1: "H",
      meta_title: "T",
      meta_description: "D",
      intro_paragraph: "I",
      nearby_blurb: null,
      faq_items: []
    });

    const copy = await fetchSeoCopyForPath("/city/lucknow/gomti-nagar", "en");

    const [path] = mockedFetch.mock.calls[0];
    expect(String(path)).toContain("/seo/copy?");
    expect(String(path)).toContain("path=%2Fcity%2Flucknow%2Fgomti-nagar");
    expect(String(path)).toContain("locale=en");
    expect(copy?.h1).toBe("H");
  });
});

describe("revalidateSeoPaths", () => {
  it("POSTs paths to the Next /api/revalidate route with bearer auth", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response("{}", { status: 200 }));

    await revalidateSeoPaths("tok", ["/en/city/lucknow/x", "/hi/city/lucknow/x"]);

    expect(fetchSpy).toHaveBeenCalledWith(
      "/api/revalidate",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ Authorization: "Bearer tok" }),
        body: JSON.stringify({ paths: ["/en/city/lucknow/x", "/hi/city/lucknow/x"] })
      })
    );
    fetchSpy.mockRestore();
  });

  it("does nothing for an empty path list", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    await revalidateSeoPaths("tok", []);
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it("swallows fetch errors (best-effort)", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("network"));
    await expect(revalidateSeoPaths("tok", ["/en/x"])).resolves.toBeUndefined();
    fetchSpy.mockRestore();
  });
});

describe("fetchSeoTemplateCopy", () => {
  it("GETs the /api/seo-template route and unwraps data", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        new Response(JSON.stringify({ data: { h1: "Template H1" } }), { status: 200 })
      );

    const copy = await fetchSeoTemplateCopy("lucknow", "gomti-nagar", "en");

    const [url] = fetchSpy.mock.calls[0];
    expect(String(url)).toContain("/api/seo-template?");
    expect(String(url)).toContain("city=lucknow");
    expect(String(url)).toContain("locality=gomti-nagar");
    expect(String(url)).toContain("locale=en");
    expect(copy?.h1).toBe("Template H1");
    fetchSpy.mockRestore();
  });

  it("returns null on a non-ok response or error", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response("nope", { status: 500 }));
    await expect(fetchSeoTemplateCopy("lucknow", "x", "en")).resolves.toBeNull();
    fetchSpy.mockRestore();
  });
});
