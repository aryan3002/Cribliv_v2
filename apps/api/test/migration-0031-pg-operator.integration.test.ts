import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Client } from "pg";

// Explicit opt-in only — never falls back to prod DATABASE_URL to avoid accidental writes.
const TEST_DB = process.env.TEST_DATABASE_URL;

describe.runIf(!!TEST_DB)("migration 0031_pg_operator_v1", () => {
  let client: Client;

  beforeAll(async () => {
    client = new Client({ connectionString: TEST_DB! });
    await client.connect();
  });

  afterAll(async () => {
    await client.end();
  });

  it("creates pg_properties table with one-primary EXCLUDE constraint", async () => {
    const r = await client.query(`
      SELECT conname FROM pg_constraint
      WHERE conname = 'pg_props_one_primary_per_operator'
    `);
    expect(r.rowCount).toBeGreaterThan(0);
  });

  it("adds pg_property_id column to listings (nullable, FK)", async () => {
    const r = await client.query(`
      SELECT column_name, is_nullable
      FROM information_schema.columns
      WHERE table_name='listings' AND column_name='pg_property_id'
    `);
    expect(r.rowCount).toBe(1);
    expect(r.rows[0].is_nullable).toBe("YES");
  });

  it("extends pg_details with all V1 fields", async () => {
    const cols = [
      "gender_policy",
      "tenant_type",
      "notice_period_days",
      "lock_in_months",
      "security_deposit_paise",
      "deposit_refundable_pct",
      "electricity_mode",
      "maintenance_paise",
      "rent_due_day",
      "payment_modes",
      "late_fee_policy",
      "price_negotiable",
      "meals",
      "meal_charges_paise",
      "amenities",
      "house_rules",
      "nearby",
      "schema_version"
    ];
    for (const col of cols) {
      const r = await client.query(
        `SELECT 1 FROM information_schema.columns WHERE table_name='pg_details' AND column_name=$1`,
        [col]
      );
      expect(r.rowCount, `pg_details.${col} missing`).toBe(1);
    }
  });

  it("creates pg_room_types with the matrix-cell UNIQUE constraint", async () => {
    const r = await client.query(`
      SELECT conname FROM pg_constraint
      WHERE conrelid = 'pg_room_types'::regclass AND contype = 'u'
    `);
    expect(r.rowCount).toBeGreaterThan(0);
  });

  it("creates pg_rooms and pg_beds with bed status enum", async () => {
    const r = await client.query(`SELECT 1 FROM pg_type WHERE typname='pg_bed_status'`);
    expect(r.rowCount).toBe(1);
    const beds = await client.query(`
      SELECT 1 FROM information_schema.tables WHERE table_name='pg_beds'
    `);
    expect(beds.rowCount).toBe(1);
    const rooms = await client.query(`
      SELECT 1 FROM information_schema.tables WHERE table_name='pg_rooms'
    `);
    expect(rooms.rowCount).toBe(1);
  });

  it("creates pg_voice_agent_sessions and pg_listing_drafts with ttl_expires_at", async () => {
    const a = await client.query(`
      SELECT 1 FROM information_schema.columns
      WHERE table_name='pg_voice_agent_sessions' AND column_name='ttl_expires_at'
    `);
    const b = await client.query(`
      SELECT 1 FROM information_schema.columns
      WHERE table_name='pg_listing_drafts' AND column_name='ttl_expires_at'
    `);
    expect(a.rowCount).toBe(1);
    expect(b.rowCount).toBe(1);
  });

  it("creates partial index idx_listings_pg_property (WHERE pg_property_id IS NOT NULL)", async () => {
    const r = await client.query(`
      SELECT indexdef FROM pg_indexes
      WHERE indexname = 'idx_listings_pg_property'
    `);
    expect(r.rowCount).toBe(1);
    expect(r.rows[0].indexdef).toContain("WHERE");
  });
});
