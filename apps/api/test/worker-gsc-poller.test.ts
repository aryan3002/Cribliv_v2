import { generateKeyPairSync } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runGscPollerJob } from "../src/worker/worker";

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

describe("runGscPollerJob", () => {
  let poolQuery: ReturnType<typeof vi.fn>;
  let pool: { query: ReturnType<typeof vi.fn> };
  let originalEnv: { flag?: string; keyJson?: string; site?: string };

  beforeEach(() => {
    poolQuery = vi.fn();
    pool = { query: poolQuery };
    originalEnv = {
      flag: process.env.FF_SEO_GSC,
      keyJson: process.env.GSC_SERVICE_ACCOUNT_JSON,
      site: process.env.GSC_SITE_URL
    };
    process.env.FF_SEO_GSC = "true";
    process.env.GSC_SERVICE_ACCOUNT_JSON = JSON.stringify(FAKE_KEY);
    process.env.GSC_SITE_URL = "sc-domain:cribliv.com";
  });

  afterEach(() => {
    if (originalEnv.flag === undefined) delete process.env.FF_SEO_GSC;
    else process.env.FF_SEO_GSC = originalEnv.flag;
    if (originalEnv.keyJson === undefined) delete process.env.GSC_SERVICE_ACCOUNT_JSON;
    else process.env.GSC_SERVICE_ACCOUNT_JSON = originalEnv.keyJson;
    if (originalEnv.site === undefined) delete process.env.GSC_SITE_URL;
    else process.env.GSC_SITE_URL = originalEnv.site;
    vi.unstubAllGlobals();
  });

  it("polls and upserts via GscService, returning its result shape", async () => {
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
          json: async () => ({
            rows: [
              {
                keys: ["2bhk noida", "https://cribliv.com/en/city/noida"],
                clicks: 5,
                impressions: 100,
                ctr: 0.05,
                position: 10
              }
            ]
          })
        })
        .mockResolvedValueOnce({ ok: true, json: async () => ({ rows: [] }) })
    );
    poolQuery.mockResolvedValue({ rows: [] });

    const result = await runGscPollerJob(pool as never);

    expect(result).toEqual({ pagesRead: 1, rowsUpserted: 1 });
  });

  it("never throws when FF_SEO_GSC is off", async () => {
    process.env.FF_SEO_GSC = "false";

    await expect(runGscPollerJob(pool as never)).resolves.toEqual({
      rowsUpserted: 0,
      pagesRead: 0
    });
    expect(poolQuery).not.toHaveBeenCalled();
  });

  it("never throws when GscService itself throws unexpectedly", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network down");
      })
    );

    await expect(runGscPollerJob(pool as never)).resolves.toEqual({
      rowsUpserted: 0,
      pagesRead: 0
    });
  });
});
