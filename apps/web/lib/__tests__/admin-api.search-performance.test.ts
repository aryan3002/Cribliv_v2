import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  fetchSearchPerformance,
  fetchSeoCoverage,
  fetchIndexingQueue,
  submitIndexingUrl,
  retryIndexingUrl,
  searchPerformanceExportUrl
} from "../admin-api";

const RAW_PERFORMANCE = {
  items: [
    {
      keyword: "2bhk noida",
      page: "/en/city/noida",
      locale: "en",
      city_slug: "noida",
      position: 14.2,
      impressions: 320,
      clicks: 18,
      ctr: 0.056,
      captured_at: "2026-07-06",
      is_target: false,
      is_ignored: false
    }
  ],
  total: 1,
  totals: { total_impressions: 320, total_clicks: 18, avg_position: 14.2 }
};

describe("admin-api search performance client fns", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ data: RAW_PERFORMANCE })
    }));
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("fetches and maps search performance rows to camelCase", async () => {
    const result = await fetchSearchPerformance("tok", { quickWins: true });

    expect(result.items[0]).toEqual({
      keyword: "2bhk noida",
      page: "/en/city/noida",
      locale: "en",
      citySlug: "noida",
      position: 14.2,
      impressions: 320,
      clicks: 18,
      ctr: 0.056,
      capturedAt: "2026-07-06",
      isTarget: false,
      isIgnored: false
    });
    expect(result.totals).toEqual({ totalImpressions: 320, totalClicks: 18, avgPosition: 14.2 });

    const [url] = fetchMock.mock.calls[0];
    expect(String(url)).toContain("quick_wins=true");
  });

  it("builds the CSV export URL with query params (no fetch call)", () => {
    const url = searchPerformanceExportUrl({ citySlug: "noida", quickWins: true });
    expect(url).toContain("/admin/seo/search-performance/export");
    expect(url).toContain("city_slug=noida");
    expect(url).toContain("quick_wins=true");
  });

  it("fetches coverage and maps to camelCase", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: { indexed_count: 10, submitted_count: 4 } })
    });

    await expect(fetchSeoCoverage("tok")).resolves.toEqual({
      indexedCount: 10,
      submittedCount: 4
    });
  });

  it("fetches the indexing queue and maps summary fields", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        data: {
          items: [
            {
              id: "q1",
              url: "https://cribliv.com/en/city/noida",
              status: "pending",
              reason: "city_enabled",
              attempts: 0,
              submitted_at: null,
              updated_at: "2026-07-06T00:00:00.000Z"
            }
          ],
          total: 1,
          summary: { counts_by_status: { pending: 1 }, submitted_today: 0, daily_quota: 200 }
        }
      })
    });

    const result = await fetchIndexingQueue("tok", { status: "pending" });
    expect(result.items[0].id).toBe("q1");
    expect(result.summary).toEqual({
      countsByStatus: { pending: 1 },
      submittedToday: 0,
      dailyQuota: 200
    });
  });

  it("submits a manual indexing URL", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        data: {
          id: "q2",
          url: "https://cribliv.com/x",
          status: "pending",
          reason: "manual_admin_submit",
          attempts: 0,
          submitted_at: null,
          updated_at: "2026-07-06T00:00:00.000Z"
        }
      })
    });

    const row = await submitIndexingUrl("tok", "https://cribliv.com/x");
    expect(row.id).toBe("q2");

    const [, init] = fetchMock.mock.calls[0];
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({ url: "https://cribliv.com/x" });
  });

  it("retries a failed indexing URL", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        data: {
          id: "q3",
          url: "https://cribliv.com/y",
          status: "pending",
          reason: "manual_admin_submit",
          attempts: 1,
          submitted_at: null,
          updated_at: "2026-07-06T00:00:00.000Z"
        }
      })
    });

    const row = await retryIndexingUrl("tok", "q3");
    expect(row.id).toBe("q3");

    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain("/admin/seo/indexing-queue/q3/retry");
    expect(init.method).toBe("POST");
  });
});
