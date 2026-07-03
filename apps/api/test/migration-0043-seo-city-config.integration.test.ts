import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Client } from "pg";

const TEST_DB = process.env.TEST_DATABASE_URL;
const MIG = join(__dirname, "../../../infra/migrations");

describe.runIf(!!TEST_DB)("migration 0043_seo_city_config", () => {
  let client: Client;
  beforeAll(async () => {
    client = new Client({ connectionString: TEST_DB! });
    await client.connect();
    await client.query(readFileSync(join(MIG, "0043_seo_city_config.sql"), "utf8"));
  });
  afterAll(async () => {
    await client.query(readFileSync(join(MIG, "0043_seo_city_config.rollback.sql"), "utf8"));
    await client.end();
  });

  it("creates seo_city_config with city_slug as primary key", async () => {
    const r = await client.query(`
      SELECT a.attname FROM pg_index i
      JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
      WHERE i.indrelid = 'seo_city_config'::regclass AND i.indisprimary`);
    expect(r.rows.map((x) => x.attname)).toEqual(["city_slug"]);
  });

  it("has all config columns with correct types and NOT NULL/defaults", async () => {
    const r = await client.query(`
      SELECT column_name, data_type, is_nullable, column_default
      FROM information_schema.columns WHERE table_name = 'seo_city_config' ORDER BY column_name`);
    const by = Object.fromEntries(r.rows.map((c) => [c.column_name, c]));
    expect(by.programmatic_enabled.data_type).toBe("boolean");
    expect(by.programmatic_enabled.is_nullable).toBe("NO");
    expect(by.programmatic_enabled.column_default).toContain("false");
    for (const col of ["locality_count", "landmark_count", "metro_count", "indexable_count"]) {
      expect(by[col].data_type, `${col} type`).toBe("integer");
      expect(by[col].is_nullable, `${col} nullable`).toBe("NO");
      expect(by[col].column_default, `${col} default`).toContain("0");
    }
    expect(by.enabled_at.data_type).toBe("timestamp with time zone");
    expect(by.enabled_at.is_nullable).toBe("YES");
    expect(by.notes.is_nullable).toBe("YES");
    expect(by.created_at.is_nullable).toBe("NO");
    expect(by.updated_at.is_nullable).toBe("NO");
  });

  it("enforces the FK to cities(slug) with ON DELETE CASCADE", async () => {
    const r = await client.query(`
      SELECT confdeltype FROM pg_constraint
      WHERE conrelid = 'seo_city_config'::regclass AND confrelid = 'cities'::regclass AND contype = 'f'`);
    expect(r.rowCount).toBe(1);
    expect(r.rows[0].confdeltype).toBe("c");
  });

  it("creates the partial enabled index", async () => {
    const r = await client.query(`SELECT indexdef FROM pg_indexes WHERE indexname = 'idx_seo_city_config_enabled'`);
    expect(r.rowCount).toBe(1);
    expect(r.rows[0].indexdef).toContain("WHERE");
  });

  it("adds the admin enum values used by the audited toggle", async () => {
    const tgt = await client.query(`SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
      WHERE t.typname = 'admin_target_type' AND e.enumlabel = 'seo_city'`);
    const act = await client.query(`SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
      WHERE t.typname = 'admin_action_type' AND e.enumlabel = 'toggle_seo_city'`);
    expect(tgt.rowCount).toBe(1);
    expect(act.rowCount).toBe(1);
  });

  it("bumps updated_at on UPDATE via the touch trigger", async () => {
    await client.query(`INSERT INTO cities(slug, name_en, name_hi, state_en, state_hi, is_active)
      VALUES ('lucknow','Lucknow','lko','UP','up',true) ON CONFLICT(slug) DO NOTHING`);
    await client.query(`INSERT INTO seo_city_config (city_slug, updated_at)
      VALUES ('lucknow', now() - interval '1 day')
      ON CONFLICT (city_slug) DO UPDATE SET updated_at = now() - interval '1 day'`);
    const before = await client.query(`SELECT updated_at FROM seo_city_config WHERE city_slug='lucknow'`);
    await client.query(`UPDATE seo_city_config SET notes = 'touched' WHERE city_slug='lucknow'`);
    const after = await client.query(`SELECT updated_at FROM seo_city_config WHERE city_slug='lucknow'`);
    expect(new Date(after.rows[0].updated_at).getTime()).toBeGreaterThan(new Date(before.rows[0].updated_at).getTime());
    await client.query(`DELETE FROM seo_city_config WHERE city_slug='lucknow'`);
  });

  it("is idempotent (re-applying the forward migration does not error)", async () => {
    await expect(client.query(readFileSync(join(MIG, "0043_seo_city_config.sql"), "utf8"))).resolves.toBeDefined();
  });
});
