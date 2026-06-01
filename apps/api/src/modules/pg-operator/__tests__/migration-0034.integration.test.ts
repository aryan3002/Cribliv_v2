import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Pool } from "pg";

const DB = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL;
const d = DB ? describe : describe.skip; // skip cleanly when no DB in CI sandbox
const MIG = join(__dirname, "../../../../../../infra/migrations");

d("migration 0034 pg_search_events", () => {
  let pool: Pool;
  beforeAll(async () => {
    pool = new Pool({ connectionString: DB });
    await pool.query(readFileSync(join(MIG, "0034_pg_search_events.sql"), "utf8"));
  });
  afterAll(async () => {
    await pool.query(readFileSync(join(MIG, "0034_pg_search_events.rollback.sql"), "utf8"));
    await pool.end();
  });

  it("creates the table with shown_listing_ids jsonb", async () => {
    const r = await pool.query(
      `SELECT data_type FROM information_schema.columns
       WHERE table_name='pg_search_events' AND column_name='shown_listing_ids'`
    );
    expect(r.rows[0]?.data_type).toBe("jsonb");
  });

  it("creates all five indexes including a GIN on shown_listing_ids", async () => {
    const r = await pool.query(
      `SELECT indexname FROM pg_indexes WHERE tablename='pg_search_events'`
    );
    const names = r.rows.map((x) => x.indexname);
    expect(names).toEqual(
      expect.arrayContaining([
        "idx_pse_session",
        "idx_pse_city",
        "idx_pse_clicked",
        "idx_pse_created",
        "idx_pse_shown"
      ])
    );
  });

  it("is idempotent (re-applying does not error)", async () => {
    await expect(
      pool.query(readFileSync(join(MIG, "0034_pg_search_events.sql"), "utf8"))
    ).resolves.toBeDefined();
  });

  it("supports a containment query on shown_listing_ids", async () => {
    await pool.query(
      `INSERT INTO pg_search_events (session_id, shown_listing_ids, result_count)
       VALUES ('s1', '["11111111-1111-1111-1111-111111111111"]'::jsonb, 1)`
    );
    const r = await pool.query(
      `SELECT count(*)::int n FROM pg_search_events
       WHERE shown_listing_ids @> '["11111111-1111-1111-1111-111111111111"]'::jsonb`
    );
    expect(r.rows[0].n).toBe(1);
  });
});
