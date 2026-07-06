import { beforeEach, describe, expect, it, vi } from "vitest";
import { SeoSearchService } from "../seo-search.service";

const ROW = {
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
};

describe("SeoSearchService", () => {
  let query: ReturnType<typeof vi.fn>;
  let database: { isEnabled: () => boolean; query: ReturnType<typeof vi.fn> };
  let gsc: { fetchCoverage: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    query = vi.fn();
    database = { isEnabled: () => true, query };
    gsc = { fetchCoverage: vi.fn(async () => ({ indexed_count: 10, submitted_count: 4 })) };
  });

  describe("getSearchPerformance", () => {
    it("returns empty result without querying when DB is disabled", async () => {
      database = { isEnabled: () => false, query };
      const service = new SeoSearchService(database as never, gsc as never);

      await expect(service.getSearchPerformance({})).resolves.toEqual({
        items: [],
        total: 0,
        totals: { total_impressions: 0, total_clicks: 0, avg_position: null }
      });
      expect(query).not.toHaveBeenCalled();
    });

    it("queries the latest snapshot per (keyword, page, locale) with no filters", async () => {
      query
        .mockResolvedValueOnce({ rows: [ROW], rowCount: 1 })
        .mockResolvedValueOnce({ rows: [{ count: 1 }] })
        .mockResolvedValueOnce({
          rows: [{ total_impressions: 320, total_clicks: 18, avg_position: 14.2 }]
        });
      const service = new SeoSearchService(database as never, gsc as never);

      const result = await service.getSearchPerformance({});

      expect(result.items).toEqual([ROW]);
      expect(result.total).toBe(1);
      expect(result.totals).toEqual({
        total_impressions: 320,
        total_clicks: 18,
        avg_position: 14.2
      });

      const [sql] = query.mock.calls[0];
      expect(sql).toContain("DISTINCT ON (keyword, page, locale)");
      expect(sql).toContain("ORDER BY keyword, page, locale, captured_at DESC");
      expect(sql).toContain("position::float8 AS position");
      expect(sql).toContain("ctr::float8 AS ctr");

      const [totalsSql] = query.mock.calls[2];
      expect(totalsSql).toContain("avg(position)::float8 AS avg_position");
    });

    it("filters to quick-wins (position 11-30) ordered by impressions desc", async () => {
      query
        .mockResolvedValueOnce({ rows: [ROW], rowCount: 1 })
        .mockResolvedValueOnce({ rows: [{ count: 1 }] })
        .mockResolvedValueOnce({
          rows: [{ total_impressions: 320, total_clicks: 18, avg_position: 14.2 }]
        });
      const service = new SeoSearchService(database as never, gsc as never);

      await service.getSearchPerformance({ quick_wins: true });

      const [sql] = query.mock.calls[0];
      expect(sql).toContain("position BETWEEN 11 AND 30");
      expect(sql).toContain("impressions DESC");
    });

    it("filters by city_slug and locale together", async () => {
      query
        .mockResolvedValueOnce({ rows: [], rowCount: 0 })
        .mockResolvedValueOnce({ rows: [{ count: 0 }] })
        .mockResolvedValueOnce({
          rows: [{ total_impressions: 0, total_clicks: 0, avg_position: null }]
        });
      const service = new SeoSearchService(database as never, gsc as never);

      await service.getSearchPerformance({ city_slug: "noida", locale: "hi" });

      const [sql, params] = query.mock.calls[0];
      expect(sql).toContain("city_slug = ");
      expect(sql).toContain("locale = ");
      expect(params).toEqual(expect.arrayContaining(["noida", "hi"]));
    });

    it("clamps limit to a max of 500 and defaults to 100", async () => {
      query
        .mockResolvedValueOnce({ rows: [], rowCount: 0 })
        .mockResolvedValueOnce({ rows: [{ count: 0 }] })
        .mockResolvedValueOnce({
          rows: [{ total_impressions: 0, total_clicks: 0, avg_position: null }]
        });
      const service = new SeoSearchService(database as never, gsc as never);

      await service.getSearchPerformance({ limit: 5000 });
      let [, params] = query.mock.calls[0];
      expect(params).toContain(500);

      query.mockClear();
      query
        .mockResolvedValueOnce({ rows: [], rowCount: 0 })
        .mockResolvedValueOnce({ rows: [{ count: 0 }] })
        .mockResolvedValueOnce({
          rows: [{ total_impressions: 0, total_clicks: 0, avg_position: null }]
        });
      await service.getSearchPerformance({});
      [, params] = query.mock.calls[0];
      expect(params).toContain(100);
    });
  });

  describe("exportSearchPerformanceCsv", () => {
    it("returns a header-only CSV without querying when DB is disabled", async () => {
      database = { isEnabled: () => false, query };
      const service = new SeoSearchService(database as never, gsc as never);

      const csv = await service.exportSearchPerformanceCsv({});
      expect(csv).toBe(
        "keyword,page,locale,city_slug,position,impressions,clicks,ctr,captured_at\n"
      );
      expect(query).not.toHaveBeenCalled();
    });

    it("renders rows as CSV with a header line", async () => {
      query.mockResolvedValueOnce({ rows: [ROW], rowCount: 1 });
      const service = new SeoSearchService(database as never, gsc as never);

      const csv = await service.exportSearchPerformanceCsv({});
      const lines = csv.trim().split("\n");
      expect(lines[0]).toBe(
        "keyword,page,locale,city_slug,position,impressions,clicks,ctr,captured_at"
      );
      expect(lines[1]).toBe("2bhk noida,/en/city/noida,en,noida,14.2,320,18,0.056,2026-07-06");
    });

    it("quotes fields containing commas", async () => {
      query.mockResolvedValueOnce({
        rows: [{ ...ROW, keyword: "2bhk, noida sector 62" }],
        rowCount: 1
      });
      const service = new SeoSearchService(database as never, gsc as never);

      const csv = await service.exportSearchPerformanceCsv({});
      expect(csv).toContain('"2bhk, noida sector 62"');
    });
  });

  describe("getCoverage", () => {
    it("delegates to GscService.fetchCoverage", async () => {
      const service = new SeoSearchService(database as never, gsc as never);
      await expect(service.getCoverage()).resolves.toEqual({
        indexed_count: 10,
        submitted_count: 4
      });
      expect(gsc.fetchCoverage).toHaveBeenCalledTimes(1);
    });
  });

  describe("getIndexingQueueSummary", () => {
    it("returns zeroed summary without querying when DB is disabled", async () => {
      database = { isEnabled: () => false, query };
      const service = new SeoSearchService(database as never, gsc as never);

      await expect(service.getIndexingQueueSummary()).resolves.toEqual({
        counts_by_status: {},
        submitted_today: 0,
        daily_quota: 200
      });
    });

    it("aggregates counts by status and reads GOOGLE_INDEXING_DAILY_QUOTA", async () => {
      const original = process.env.GOOGLE_INDEXING_DAILY_QUOTA;
      process.env.GOOGLE_INDEXING_DAILY_QUOTA = "50";
      try {
        query
          .mockResolvedValueOnce({
            rows: [
              { status: "pending", count: 12 },
              { status: "submitted", count: 30 },
              { status: "failed", count: 2 }
            ]
          })
          .mockResolvedValueOnce({ rows: [{ count: 5 }] });
        const service = new SeoSearchService(database as never, gsc as never);

        await expect(service.getIndexingQueueSummary()).resolves.toEqual({
          counts_by_status: { pending: 12, submitted: 30, failed: 2 },
          submitted_today: 5,
          daily_quota: 50
        });
      } finally {
        if (original === undefined) delete process.env.GOOGLE_INDEXING_DAILY_QUOTA;
        else process.env.GOOGLE_INDEXING_DAILY_QUOTA = original;
      }
    });
  });
});
