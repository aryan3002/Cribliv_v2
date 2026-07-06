import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IndexingService } from "../indexing.service";

describe("IndexingService", () => {
  let query: ReturnType<typeof vi.fn>;
  let database: { isEnabled: () => boolean; query: ReturnType<typeof vi.fn> };
  let auth: { getAccessToken: ReturnType<typeof vi.fn> };
  let fetchMock: ReturnType<typeof vi.fn>;
  let originalFlag: string | undefined;

  beforeEach(() => {
    originalFlag = process.env.FF_SEO_INDEXING;
    query = vi.fn();
    database = { isEnabled: () => true, query };
    auth = { getAccessToken: vi.fn(async () => "ya29.fake") };
    fetchMock = vi.fn();
  });

  afterEach(() => {
    if (originalFlag === undefined) delete process.env.FF_SEO_INDEXING;
    else process.env.FF_SEO_INDEXING = originalFlag;
  });

  describe("enqueue", () => {
    it("no-ops without querying when DB is disabled", async () => {
      database = { isEnabled: () => false, query };
      const service = new IndexingService(database as never, auth as never, fetchMock as never);

      await expect(service.enqueue("https://cribliv.com/a", "new_listing")).resolves.toBeNull();
      expect(query).not.toHaveBeenCalled();
    });

    it("upserts by url, re-queuing to pending on conflict", async () => {
      const row = {
        id: "q1",
        url: "https://cribliv.com/a",
        status: "pending",
        reason: "new_listing",
        attempts: 0,
        submitted_at: null,
        response: null,
        created_at: "2026-07-06T00:00:00.000Z",
        updated_at: "2026-07-06T00:00:00.000Z"
      };
      query.mockResolvedValueOnce({ rows: [row] });
      const service = new IndexingService(database as never, auth as never, fetchMock as never);

      await expect(service.enqueue("https://cribliv.com/a", "new_listing")).resolves.toEqual(row);

      const [sql, params] = query.mock.calls[0];
      expect(sql).toContain("INSERT INTO seo_indexing_queue");
      expect(sql).toContain("ON CONFLICT (url) DO UPDATE");
      expect(sql).toContain("status = 'pending'");
      expect(params).toEqual(["https://cribliv.com/a", "new_listing"]);
    });

    it("normalizes a site-relative path to an absolute URL before storing", async () => {
      // The Indexing API rejects relative URLs; enqueue must absolutize any
      // path callers pass (e.g. the city-enable and listing-approval paths).
      query.mockResolvedValueOnce({ rows: [] });
      const service = new IndexingService(database as never, auth as never, fetchMock as never);

      await service.enqueue("/en/city/noida", "city_enabled");

      const [, params] = query.mock.calls[0];
      expect(params).toEqual(["https://cribliv.com/en/city/noida", "city_enabled"]);
    });
  });

  describe("drainPending", () => {
    it("does nothing when FF_SEO_INDEXING is off", async () => {
      process.env.FF_SEO_INDEXING = "false";
      const service = new IndexingService(database as never, auth as never, fetchMock as never);

      await expect(service.drainPending(200, 0)).resolves.toEqual({
        submitted: 0,
        failed: 0,
        skippedQuota: 0
      });
      expect(query).not.toHaveBeenCalled();
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("submits pending rows up to the remaining quota, newest first, and marks them submitted", async () => {
      process.env.FF_SEO_INDEXING = "true";
      const pendingRows = [
        { id: "q1", url: "https://cribliv.com/a", attempts: 0 },
        { id: "q2", url: "https://cribliv.com/b", attempts: 0 }
      ];
      query
        .mockResolvedValueOnce({ rows: pendingRows })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] });
      fetchMock
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ urlNotificationMetadata: { url: "https://cribliv.com/a" } })
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ urlNotificationMetadata: { url: "https://cribliv.com/b" } })
        });

      const service = new IndexingService(database as never, auth as never, fetchMock as never);
      const result = await service.drainPending(200, 0);

      expect(result).toEqual({ submitted: 2, failed: 0, skippedQuota: 0 });
      expect(fetchMock).toHaveBeenCalledTimes(2);
      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe("https://indexing.googleapis.com/v3/urlNotifications:publish");
      expect(init.method).toBe("POST");
      expect(init.headers.Authorization).toBe("Bearer ya29.fake");
      expect(JSON.parse(init.body)).toEqual({
        url: "https://cribliv.com/a",
        type: "URL_UPDATED"
      });

      const [updateSql, updateParams] = query.mock.calls[1];
      expect(updateSql).toContain("SET status = 'submitted'");
      expect(updateParams[0]).toBe("q1");
    });

    it("respects the remaining quota and leaves rows beyond it pending", async () => {
      process.env.FF_SEO_INDEXING = "true";
      const pendingRows = [
        { id: "q1", url: "https://cribliv.com/a", attempts: 0 },
        { id: "q2", url: "https://cribliv.com/b", attempts: 0 }
      ];
      query.mockResolvedValueOnce({ rows: pendingRows }).mockResolvedValueOnce({ rows: [] });
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ urlNotificationMetadata: { url: "https://cribliv.com/a" } })
      });

      const service = new IndexingService(database as never, auth as never, fetchMock as never);
      const result = await service.drainPending(200, 199);

      expect(result).toEqual({ submitted: 1, failed: 0, skippedQuota: 1 });
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(query.mock.calls[0][1]).toEqual([2]);
    });

    it("increments attempts and marks failed after 5 attempts on a Google error", async () => {
      process.env.FF_SEO_INDEXING = "true";
      const pendingRows = [{ id: "q1", url: "https://cribliv.com/a", attempts: 4 }];
      query.mockResolvedValueOnce({ rows: pendingRows }).mockResolvedValueOnce({ rows: [] });
      fetchMock.mockResolvedValueOnce({
        ok: false,
        status: 429,
        text: async () => "quota exceeded"
      });

      const service = new IndexingService(database as never, auth as never, fetchMock as never);
      const result = await service.drainPending(200, 0);

      expect(result).toEqual({ submitted: 0, failed: 1, skippedQuota: 0 });
      const [updateSql, updateParams] = query.mock.calls[1];
      expect(updateSql).toContain("SET status = 'failed'");
      expect(updateSql).toContain("attempts = attempts + 1");
      expect(updateParams[0]).toBe("q1");
    });

    it("keeps status pending and bumps attempts when under the 5-attempt cap", async () => {
      process.env.FF_SEO_INDEXING = "true";
      const pendingRows = [{ id: "q1", url: "https://cribliv.com/a", attempts: 1 }];
      query.mockResolvedValueOnce({ rows: pendingRows }).mockResolvedValueOnce({ rows: [] });
      fetchMock.mockResolvedValueOnce({
        ok: false,
        status: 500,
        text: async () => "server error"
      });

      const service = new IndexingService(database as never, auth as never, fetchMock as never);
      await service.drainPending(200, 0);

      const [updateSql] = query.mock.calls[1];
      expect(updateSql).toContain("SET status = 'pending'");
      expect(updateSql).toContain("attempts = attempts + 1");
    });

    it("never throws even if Google auth itself fails", async () => {
      process.env.FF_SEO_INDEXING = "true";
      query
        .mockResolvedValueOnce({ rows: [{ id: "q1", url: "https://cribliv.com/a", attempts: 0 }] })
        .mockResolvedValueOnce({ rows: [] });
      auth.getAccessToken = vi.fn(async () => {
        throw new Error("auth exploded");
      });

      const service = new IndexingService(database as never, auth as never, fetchMock as never);
      await expect(service.drainPending(200, 0)).resolves.toEqual({
        submitted: 0,
        failed: 1,
        skippedQuota: 0
      });
    });
  });

  describe("submittedCountToday / listQueue / retry", () => {
    it("returns submitted rows for the current day", async () => {
      query.mockResolvedValueOnce({ rows: [{ count: 3 }] });
      const service = new IndexingService(database as never, auth as never, fetchMock as never);

      await expect(service.submittedCountToday()).resolves.toBe(3);
      expect(query.mock.calls[0][0]).toContain("submitted_at >= date_trunc('day', now())");
    });

    it("lists queue rows filtered by status with total count", async () => {
      query
        .mockResolvedValueOnce({ rows: [{ id: "q1" }], rowCount: 1 })
        .mockResolvedValueOnce({ rows: [{ count: 1 }] });
      const service = new IndexingService(database as never, auth as never, fetchMock as never);

      const result = await service.listQueue({ status: "failed", limit: 20, offset: 0 });
      expect(result.items).toEqual([{ id: "q1" }]);
      expect(result.total).toBe(1);

      const [sql, params] = query.mock.calls[0];
      expect(sql).toContain("WHERE status = $1");
      expect(params).toEqual(["failed", 20, 0]);
    });

    it("resets a failed row to pending on retry", async () => {
      const row = { id: "q1", status: "pending", attempts: 3 };
      query.mockResolvedValueOnce({ rows: [row] });
      const service = new IndexingService(database as never, auth as never, fetchMock as never);

      await expect(service.retry("q1")).resolves.toEqual(row);
      const [sql, params] = query.mock.calls[0];
      expect(sql).toContain("SET status = 'pending'");
      expect(sql).toContain("WHERE id = $1");
      expect(params).toEqual(["q1"]);
    });
  });
});
