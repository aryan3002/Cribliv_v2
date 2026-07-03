import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Client } from "pg";

const TEST_DB = process.env.TEST_DATABASE_URL;
const MIG = join(__dirname, "../../../infra/migrations");

// Exercises the exact seo_city_config upsert that data/seeds/seed.ts runs
// (Task 6, Step 6) against a real DB: lucknow enabled, noida disabled,
// ON CONFLICT DO NOTHING so a re-seed never clobbers an admin-set flag.
const SEED_UPSERT = `
  INSERT INTO seo_city_config (city_slug, programmatic_enabled, enabled_at)
  VALUES ('lucknow', true, now()), ('noida', false, NULL)
  ON CONFLICT (city_slug) DO NOTHING
`;

describe.runIf(!!TEST_DB)("seed.ts seo_city_config upsert", () => {
  let client: Client;

  beforeAll(async () => {
    client = new Client({ connectionString: TEST_DB! });
    await client.connect();
    await client.query(readFileSync(join(MIG, "0043_seo_city_config.sql"), "utf8"));

    // Ensure lucknow/noida exist (ON CONFLICT DO NOTHING — do not disturb
    // pre-existing rows/data owned by other tests or a prior seed run).
    await client.query(`
      INSERT INTO cities(slug, name_en, name_hi, state_en, state_hi, is_active)
      VALUES
        ('lucknow', 'Lucknow', 'लखनऊ', 'Uttar Pradesh', 'उत्तर प्रदेश', true),
        ('noida', 'Noida', 'नोएडा', 'Uttar Pradesh', 'उत्तर प्रदेश', true)
      ON CONFLICT (slug) DO NOTHING
    `);
  });

  afterAll(async () => {
    // Only clean up the seo_city_config rows this test created — the cities
    // themselves (and any localities/landmarks under them) are shared,
    // pre-existing fixtures owned by other tests/seeds and must not be deleted.
    await client.query(`DELETE FROM seo_city_config WHERE city_slug IN ('lucknow', 'noida')`);
    await client.query(readFileSync(join(MIG, "0043_seo_city_config.rollback.sql"), "utf8"));
    await client.end();
  });

  it("seeds lucknow enabled and noida disabled", async () => {
    await client.query(SEED_UPSERT);

    const r = await client.query(
      `SELECT city_slug, programmatic_enabled, enabled_at FROM seo_city_config
       WHERE city_slug IN ('lucknow', 'noida') ORDER BY city_slug`
    );
    expect(r.rowCount).toBe(2);

    const lucknow = r.rows.find((row) => row.city_slug === "lucknow");
    const noida = r.rows.find((row) => row.city_slug === "noida");

    expect(lucknow.programmatic_enabled).toBe(true);
    expect(lucknow.enabled_at).not.toBeNull();

    expect(noida.programmatic_enabled).toBe(false);
    expect(noida.enabled_at).toBeNull();
  });

  it("is idempotent and does not reset an admin-set flag on re-run", async () => {
    // Simulate an admin enabling noida via the admin toggle path.
    await client.query(
      `UPDATE seo_city_config SET programmatic_enabled = true, enabled_at = now() WHERE city_slug = 'noida'`
    );

    // Re-run the exact seed upsert (as seed.ts would on a re-seed).
    await client.query(SEED_UPSERT);

    const r = await client.query(
      `SELECT programmatic_enabled, enabled_at FROM seo_city_config WHERE city_slug = 'noida'`
    );
    expect(r.rowCount).toBe(1);
    // ON CONFLICT DO NOTHING must NOT reset the admin-set flag back to false.
    expect(r.rows[0].programmatic_enabled).toBe(true);
    expect(r.rows[0].enabled_at).not.toBeNull();

    // lucknow should still be untouched/enabled too.
    const lucknowRow = await client.query(
      `SELECT programmatic_enabled FROM seo_city_config WHERE city_slug = 'lucknow'`
    );
    expect(lucknowRow.rows[0].programmatic_enabled).toBe(true);
  });
});
