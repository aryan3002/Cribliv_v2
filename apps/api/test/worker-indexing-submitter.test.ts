import { generateKeyPairSync } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runIndexingSubmitterJob, runOutboundDispatchDb } from "../src/worker/worker";

const { privateKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
  publicKeyEncoding: { type: "spki", format: "pem" }
});

const FAKE_KEY = {
  client_email: "seo-worker@cribliv-seo.iam.gserviceaccount.com",
  private_key_id: "abc123",
  private_key: privateKey
};

describe("runIndexingSubmitterJob", () => {
  let poolQuery: ReturnType<typeof vi.fn>;
  let pool: { query: ReturnType<typeof vi.fn> };
  let originalEnv: { flag?: string; keyJson?: string; quota?: string };

  beforeEach(() => {
    poolQuery = vi.fn();
    pool = { query: poolQuery };
    originalEnv = {
      flag: process.env.FF_SEO_INDEXING,
      keyJson: process.env.GSC_SERVICE_ACCOUNT_JSON,
      quota: process.env.GOOGLE_INDEXING_DAILY_QUOTA
    };
    process.env.FF_SEO_INDEXING = "true";
    process.env.GSC_SERVICE_ACCOUNT_JSON = JSON.stringify(FAKE_KEY);
  });

  afterEach(() => {
    if (originalEnv.flag === undefined) delete process.env.FF_SEO_INDEXING;
    else process.env.FF_SEO_INDEXING = originalEnv.flag;
    if (originalEnv.keyJson === undefined) delete process.env.GSC_SERVICE_ACCOUNT_JSON;
    else process.env.GSC_SERVICE_ACCOUNT_JSON = originalEnv.keyJson;
    if (originalEnv.quota === undefined) delete process.env.GOOGLE_INDEXING_DAILY_QUOTA;
    else process.env.GOOGLE_INDEXING_DAILY_QUOTA = originalEnv.quota;
    vi.unstubAllGlobals();
  });

  it("reads GOOGLE_INDEXING_DAILY_QUOTA and submits pending rows within it", async () => {
    process.env.GOOGLE_INDEXING_DAILY_QUOTA = "5";
    poolQuery
      .mockResolvedValueOnce({ rows: [{ count: 0 }] })
      .mockResolvedValueOnce({ rows: [{ id: "q1", url: "https://cribliv.com/a", attempts: 0 }] })
      .mockResolvedValueOnce({ rows: [] });

    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ access_token: "ya29.fake", expires_in: 3600 })
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ urlNotificationMetadata: {} })
        })
    );

    const result = await runIndexingSubmitterJob(pool as never);

    expect(result).toEqual({ submitted: 1, failed: 0, skippedQuota: 0 });
  });

  it("defaults GOOGLE_INDEXING_DAILY_QUOTA to 200 when unset", async () => {
    delete process.env.GOOGLE_INDEXING_DAILY_QUOTA;
    poolQuery.mockResolvedValueOnce({ rows: [{ count: 0 }] }).mockResolvedValueOnce({ rows: [] });

    const result = await runIndexingSubmitterJob(pool as never);

    expect(result).toEqual({ submitted: 0, failed: 0, skippedQuota: 0 });
    const selectCall = poolQuery.mock.calls.find(
      ([sql]) => /SELECT.*FROM seo_indexing_queue/s.test(sql) && /LIMIT \$1/.test(sql)
    );
    expect(selectCall![1]).toEqual([201]);
  });

  it("never throws when FF_SEO_INDEXING is off - returns zero counts without querying", async () => {
    process.env.FF_SEO_INDEXING = "false";

    await expect(runIndexingSubmitterJob(pool as never)).resolves.toEqual({
      submitted: 0,
      failed: 0,
      skippedQuota: 0
    });
    expect(poolQuery).not.toHaveBeenCalled();
  });

  it("never throws when the DB query itself rejects", async () => {
    poolQuery.mockRejectedValueOnce(new Error("connection reset"));

    await expect(runIndexingSubmitterJob(pool as never)).resolves.toEqual({
      submitted: 0,
      failed: 0,
      skippedQuota: 0
    });
  });
});

describe("runOutboundDispatchDb - seo.queue_indexing audit branch", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("marks a seo.queue_indexing event dispatched without calling any external webhook", async () => {
    const crmWebhook = vi.fn();
    vi.stubGlobal("fetch", crmWebhook);
    let selectCalls = 0;
    const poolQuery = vi.fn(async (sql: string) => {
      if (/^BEGIN$|^COMMIT$/.test(sql.trim())) return { rows: [] };
      if (/SELECT id, event_type/.test(sql)) {
        selectCalls += 1;
        if (selectCalls > 1) return { rows: [], rowCount: 0 };
        return {
          rows: [
            {
              id: 1,
              event_type: "seo.queue_indexing",
              aggregate_type: "listing",
              aggregate_id: "l1",
              payload: { listing_id: "l1", reason: "listing_approved" },
              attempt_count: 0
            }
          ],
          rowCount: 1
        };
      }
      if (/UPDATE outbound_events/.test(sql)) return { rows: [], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    });
    const pool = { connect: vi.fn(async () => ({ query: poolQuery, release: vi.fn() })) };

    const result = await runOutboundDispatchDb(pool as never, "https://crm.example.com/webhook");

    expect(result.dispatchedCount).toBe(1);
    expect(result.failedCount).toBe(0);
    expect(crmWebhook).not.toHaveBeenCalled();
    const updateCall = poolQuery.mock.calls.find(([sql]) => /UPDATE outbound_events/.test(sql));
    expect(updateCall![1]).toEqual([1]);
  });
});
