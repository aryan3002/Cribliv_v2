import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";

const DB = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL;
const d = DB ? describe : describe.skip; // skip cleanly when no DB in CI sandbox
const MIG = join(__dirname, "../../../../../../infra/migrations");

d("migration 0034 pg_search_events", () => {
  let pool: Pool;
  // Unique per run: the table is shared, so every row this suite writes is
  // scoped to (and cleaned up by) this id.
  const sessionId = `mig0034-${randomUUID()}`;

  beforeAll(async () => {
    pool = new Pool({ connectionString: DB });
    await pool.query(readFileSync(join(MIG, "0034_pg_search_events.sql"), "utf8"));
  });

  afterAll(async () => {
    // Delete only this suite's rows. This previously ran 0034's rollback SQL
    // (DROP TABLE pg_search_events) as teardown. That drop was never asserted
    // on — it was cleanup that assumed the test had created the table — but on
    // an already migrated DB it permanently deleted a live table that
    // schema_migrations still recorded as applied, so db:migrate would not
    // recreate it, and it raced suites reading pg_search_events in parallel.
    //
    // Cleanup is a scoped DELETE rather than wrapping the suite in a
    // transaction: the migration DDL below must keep autocommitting so its
    // locks are released immediately. Holding them for the whole suite
    // deadlocks against the other migration tests running in parallel.
    await pool.query(`DELETE FROM pg_search_events WHERE session_id = $1`, [sessionId]);
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
    // Scoped to this run's session id: the table is no longer recreated empty
    // for each run, so an unscoped count would depend on the rows the shared
    // DB already holds.
    const shownId = randomUUID();
    await pool.query(
      `INSERT INTO pg_search_events (session_id, shown_listing_ids, result_count)
       VALUES ($1, $2::jsonb, 1)`,
      [sessionId, JSON.stringify([shownId])]
    );
    const r = await pool.query(
      `SELECT count(*)::int n FROM pg_search_events
       WHERE session_id = $1 AND shown_listing_ids @> $2::jsonb`,
      [sessionId, JSON.stringify([shownId])]
    );
    expect(r.rows[0].n).toBe(1);
  });
});
