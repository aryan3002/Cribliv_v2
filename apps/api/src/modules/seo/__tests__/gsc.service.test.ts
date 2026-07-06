import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GscService } from "../gsc.service";

describe("GscService", () => {
  let query: ReturnType<typeof vi.fn>;
  let database: { isEnabled: () => boolean; query: ReturnType<typeof vi.fn> };
  let auth: { getAccessToken: ReturnType<typeof vi.fn> };
  let fetchMock: ReturnType<typeof vi.fn>;
  let originalEnv: { flag?: string; site?: string };

  beforeEach(() => {
    query = vi.fn();
    database = { isEnabled: () => true, query };
    auth = { getAccessToken: vi.fn(async () => "ya29.fake") };
    fetchMock = vi.fn();
    originalEnv = { flag: process.env.FF_SEO_GSC, site: process.env.GSC_SITE_URL };
    process.env.FF_SEO_GSC = "true";
    process.env.GSC_SITE_URL = "sc-domain:cribliv.com";
  });

  afterEach(() => {
    if (originalEnv.flag === undefined) delete process.env.FF_SEO_GSC;
    else process.env.FF_SEO_GSC = originalEnv.flag;
    if (originalEnv.site === undefined) delete process.env.GSC_SITE_URL;
    else process.env.GSC_SITE_URL = originalEnv.site;
  });

  describe("pollAndUpsert", () => {
    it("does nothing when FF_SEO_GSC is off", async () => {
      process.env.FF_SEO_GSC = "false";
      const service = new GscService(database as never, auth as never, fetchMock as never);

      await expect(service.pollAndUpsert("2026-07-06")).resolves.toEqual({
        rowsUpserted: 0,
        pagesRead: 0
      });
      expect(fetchMock).not.toHaveBeenCalled();
      expect(query).not.toHaveBeenCalled();
    });

    it("does nothing when DB is disabled", async () => {
      database = { isEnabled: () => false, query };
      const service = new GscService(database as never, auth as never, fetchMock as never);

      await expect(service.pollAndUpsert("2026-07-06")).resolves.toEqual({
        rowsUpserted: 0,
        pagesRead: 0
      });
      expect(fetchMock).not.toHaveBeenCalled();
      expect(query).not.toHaveBeenCalled();
    });

    it("fetches searchanalytics.query with the right dimensions/date range and upserts rows", async () => {
      fetchMock
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            rows: [
              {
                keys: ["2bhk flat noida", "https://cribliv.com/en/city/noida"],
                clicks: 12,
                impressions: 300,
                ctr: 0.04,
                position: 8.5
              },
              {
                keys: ["pg near sector 62", "https://cribliv.com/hi/city/noida"],
                clicks: 3,
                impressions: 150,
                ctr: 0.02,
                position: 22.1
              }
            ]
          })
        })
        .mockResolvedValueOnce({ ok: true, json: async () => ({ rows: [] }) });
      query.mockResolvedValue({ rows: [] });

      const service = new GscService(database as never, auth as never, fetchMock as never);
      const result = await service.pollAndUpsert("2026-07-06");

      expect(result).toEqual({ rowsUpserted: 2, pagesRead: 1 });
      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe(
        "https://searchconsole.googleapis.com/webmasters/v3/sites/sc-domain%3Acribliv.com/searchAnalytics/query"
      );
      expect(init.method).toBe("POST");
      expect(init.headers.Authorization).toBe("Bearer ya29.fake");
      const body = JSON.parse(init.body);
      expect(body.dimensions).toEqual(["query", "page"]);
      expect(body.rowLimit).toBe(5000);
      expect(body.startRow).toBe(0);
      expect(body.endDate).toBe("2026-07-06");
      expect(body.startDate).toBe("2026-06-08");

      const [upsertSql, upsertParams] = query.mock.calls[0];
      expect(upsertSql).toContain("INSERT INTO keyword_rankings");
      expect(upsertSql).toContain("ON CONFLICT (keyword, page, locale, captured_at) DO UPDATE");
      expect(upsertParams).toEqual([
        "2bhk flat noida",
        "https://cribliv.com/en/city/noida",
        "en",
        "noida",
        8.5,
        300,
        12,
        0.04,
        "2026-07-06"
      ]);

      const [, secondParams] = query.mock.calls[1];
      expect(secondParams).toEqual([
        "pg near sector 62",
        "https://cribliv.com/hi/city/noida",
        "hi",
        "noida",
        22.1,
        150,
        3,
        0.02,
        "2026-07-06"
      ]);
    });

    it("defaults locale to en and city_slug to null for non-city-hub pages", async () => {
      fetchMock
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            rows: [
              {
                keys: ["rent flat lucknow", "https://cribliv.com/blog/renting-guide"],
                clicks: 1,
                impressions: 20,
                ctr: 0.05,
                position: 15
              }
            ]
          })
        })
        .mockResolvedValueOnce({ ok: true, json: async () => ({ rows: [] }) });
      query.mockResolvedValue({ rows: [] });

      const service = new GscService(database as never, auth as never, fetchMock as never);
      await service.pollAndUpsert("2026-07-06");

      const [, params] = query.mock.calls[0];
      expect(params[2]).toBe("en");
      expect(params[3]).toBeNull();
    });

    it("pages up to 5 times and stops even if Google keeps returning rows", async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        json: async () => ({
          rows: [
            {
              keys: ["k", "https://cribliv.com/en/city/noida"],
              clicks: 1,
              impressions: 10,
              ctr: 0.1,
              position: 5
            }
          ]
        })
      });
      query.mockResolvedValue({ rows: [] });

      const service = new GscService(database as never, auth as never, fetchMock as never);
      const result = await service.pollAndUpsert("2026-07-06");

      expect(fetchMock).toHaveBeenCalledTimes(5);
      expect(result.pagesRead).toBe(5);
      expect(result.rowsUpserted).toBe(5);
    });

    it("never throws when Google returns a non-OK response", async () => {
      fetchMock.mockResolvedValueOnce({ ok: false, status: 403, text: async () => "forbidden" });

      const service = new GscService(database as never, auth as never, fetchMock as never);
      await expect(service.pollAndUpsert("2026-07-06")).resolves.toEqual({
        rowsUpserted: 0,
        pagesRead: 0
      });
    });

    it("never throws when auth itself fails", async () => {
      auth.getAccessToken = vi.fn(async () => {
        throw new Error("auth exploded");
      });
      const service = new GscService(database as never, auth as never, fetchMock as never);

      await expect(service.pollAndUpsert("2026-07-06")).resolves.toEqual({
        rowsUpserted: 0,
        pagesRead: 0
      });
    });

    it("defaults captured_at to today (UTC date) when not provided", async () => {
      fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ rows: [] }) });
      const service = new GscService(database as never, auth as never, fetchMock as never);

      await service.pollAndUpsert();

      const [, init] = fetchMock.mock.calls[0];
      const body = JSON.parse(init.body);
      expect(body.endDate).toBe(new Date().toISOString().slice(0, 10));
    });
  });

  describe("fetchCoverage", () => {
    it("returns nulls without querying Google when DB is disabled", async () => {
      database = { isEnabled: () => false, query };
      const service = new GscService(database as never, auth as never, fetchMock as never);

      await expect(service.fetchCoverage()).resolves.toEqual({
        indexed_count: null,
        submitted_count: null
      });
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("derives indexed_count/submitted_count from local tables", async () => {
      query
        .mockResolvedValueOnce({ rows: [{ count: 42 }] })
        .mockResolvedValueOnce({ rows: [{ count: 7 }] });
      const service = new GscService(database as never, auth as never, fetchMock as never);

      await expect(service.fetchCoverage()).resolves.toEqual({
        indexed_count: 42,
        submitted_count: 7
      });
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });
});
