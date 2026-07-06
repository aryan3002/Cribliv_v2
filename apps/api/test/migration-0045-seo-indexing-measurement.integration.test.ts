import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Client } from "pg";

const TEST_DB = process.env.TEST_DATABASE_URL;
const MIG = join(__dirname, "../../../infra/migrations");
const BASELINE_FILE = "0001_init.sql";
const FILE = "0045_seo_indexing_measurement.sql";
const ROLLBACK_FILE = "0045_seo_indexing_measurement.rollback.sql";

describe.runIf(!!TEST_DB)("migration 0045_seo_indexing_measurement", () => {
  let client: Client;
  beforeAll(async () => {
    client = new Client({ connectionString: TEST_DB! });
    await client.connect();
    await client.query(readFileSync(join(MIG, BASELINE_FILE), "utf8"));
    await client.query(readFileSync(join(MIG, FILE), "utf8"));
  });
  afterAll(async () => {
    await client.query(readFileSync(join(MIG, ROLLBACK_FILE), "utf8"));
    await client.end();
  });

  it("creates seo_indexing_queue with a unique url and a status check constraint", async () => {
    const cols = await client.query(`
      SELECT column_name, data_type, is_nullable, column_default
      FROM information_schema.columns WHERE table_name = 'seo_indexing_queue' ORDER BY column_name`);
    const by = Object.fromEntries(cols.rows.map((c) => [c.column_name, c]));
    expect(by.url.is_nullable).toBe("NO");
    expect(by.status.column_default).toContain("pending");
    expect(by.attempts.column_default).toContain("0");
    expect(by.created_at.is_nullable).toBe("NO");
    expect(by.updated_at.is_nullable).toBe("NO");

    const uniq = await client.query(`
      SELECT conname FROM pg_constraint
      WHERE conrelid = 'seo_indexing_queue'::regclass AND contype = 'u'`);
    expect(uniq.rowCount).toBeGreaterThanOrEqual(1);

    const chk = await client.query(`
      SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
      WHERE conrelid = 'seo_indexing_queue'::regclass AND contype = 'c'`);
    expect(chk.rows.some((r) => /status/.test(r.def))).toBe(true);
  });

  it("creates the partial pending index on seo_indexing_queue", async () => {
    const r = await client.query(
      `SELECT indexdef FROM pg_indexes WHERE indexname = 'idx_seo_indexing_queue_pending'`
    );
    expect(r.rowCount).toBe(1);
    expect(r.rows[0].indexdef).toContain("WHERE");
    expect(r.rows[0].indexdef).toContain("pending");
  });

  it("upserts on url and re-queues on conflict (ON CONFLICT DO UPDATE)", async () => {
    await client.query(
      `INSERT INTO seo_indexing_queue(url, reason) VALUES ('https://cribliv.com/a', 'new_listing')`
    );
    await client.query(
      `INSERT INTO seo_indexing_queue(url, reason, status)
       VALUES ('https://cribliv.com/a', 'content_changed', 'pending')
       ON CONFLICT (url) DO UPDATE SET reason = EXCLUDED.reason, status = 'pending', updated_at = now()`
    );
    const r = await client.query(
      `SELECT reason, status FROM seo_indexing_queue WHERE url = 'https://cribliv.com/a'`
    );
    expect(r.rowCount).toBe(1);
    expect(r.rows[0].reason).toBe("content_changed");
    await client.query(`DELETE FROM seo_indexing_queue WHERE url = 'https://cribliv.com/a'`);
  });

  it("creates keyword_rankings with the (keyword, page, locale, captured_at) unique key", async () => {
    const cols = await client.query(`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns WHERE table_name = 'keyword_rankings' ORDER BY column_name`);
    const by = Object.fromEntries(cols.rows.map((c) => [c.column_name, c]));
    expect(by.keyword.is_nullable).toBe("NO");
    expect(by.page.is_nullable).toBe("NO");
    expect(by.locale.is_nullable).toBe("NO");
    expect(by.captured_at.data_type).toBe("date");
    expect(by.city_slug.is_nullable).toBe("YES");

    const uniq = await client.query(`
      SELECT indexdef FROM pg_indexes
      WHERE tablename = 'keyword_rankings' AND indexdef ILIKE '%UNIQUE%'`);
    const businessKey = uniq.rows.find((r) => r.indexdef.includes("(keyword"));
    expect(businessKey).toBeDefined();
    expect(businessKey.indexdef).toContain("keyword");
    expect(businessKey.indexdef).toContain("page");
    expect(businessKey.indexdef).toContain("locale");
    expect(businessKey.indexdef).toContain("captured_at");
  });

  it("idempotently upserts keyword_rankings per captured_at (re-poll updates the day's row)", async () => {
    await client.query(
      `INSERT INTO keyword_rankings(keyword, page, locale, position, impressions, clicks, ctr, captured_at)
       VALUES ('2bhk noida', '/en/city/noida', 'en', 14, 100, 5, 0.05, '2026-07-06')`
    );
    await client.query(
      `INSERT INTO keyword_rankings(keyword, page, locale, position, impressions, clicks, ctr, captured_at)
       VALUES ('2bhk noida', '/en/city/noida', 'en', 12, 140, 9, 0.064, '2026-07-06')
       ON CONFLICT (keyword, page, locale, captured_at)
       DO UPDATE SET position = EXCLUDED.position, impressions = EXCLUDED.impressions,
                      clicks = EXCLUDED.clicks, ctr = EXCLUDED.ctr`
    );
    const r = await client.query(
      `SELECT position, impressions FROM keyword_rankings
       WHERE keyword = '2bhk noida' AND page = '/en/city/noida' AND locale = 'en' AND captured_at = '2026-07-06'`
    );
    expect(r.rowCount).toBe(1);
    expect(Number(r.rows[0].position)).toBe(12);
    expect(r.rows[0].impressions).toBe(140);
    await client.query(`DELETE FROM keyword_rankings WHERE keyword = '2bhk noida'`);
  });

  it("creates the position index and the city_slug index on keyword_rankings", async () => {
    const idx = await client.query(
      `SELECT indexname FROM pg_indexes WHERE tablename = 'keyword_rankings'`
    );
    const names = idx.rows.map((r) => r.indexname);
    expect(names).toContain("idx_keyword_rankings_position");
    expect(names).toContain("idx_keyword_rankings_city_slug");
  });

  it("adds the admin enum values used by the audited indexing endpoints", async () => {
    const tgt = await client.query(`SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
      WHERE t.typname = 'admin_target_type' AND e.enumlabel = 'seo_indexing_queue'`);
    const submit = await client.query(`SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
      WHERE t.typname = 'admin_action_type' AND e.enumlabel = 'submit_indexing_url'`);
    const retry = await client.query(`SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
      WHERE t.typname = 'admin_action_type' AND e.enumlabel = 'retry_indexing_url'`);
    expect(tgt.rowCount).toBe(1);
    expect(submit.rowCount).toBe(1);
    expect(retry.rowCount).toBe(1);
  });

  it("is idempotent (re-applying the forward migration does not error)", async () => {
    await expect(client.query(readFileSync(join(MIG, FILE), "utf8"))).resolves.toBeDefined();
  });
});
