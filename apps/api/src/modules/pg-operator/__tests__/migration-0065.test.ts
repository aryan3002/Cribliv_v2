import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";

const databaseUrl = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL;
const suite = databaseUrl ? describe : describe.skip;

suite("migration 0065", () => {
  let pool: Pool;

  beforeAll(() => {
    pool = new Pool({ connectionString: databaseUrl });
  });

  afterAll(async () => {
    await pool.end();
  });

  it("adds deposit + balcony columns and identity unique", async () => {
    const columns = await pool.query(
      `SELECT column_name FROM information_schema.columns
       WHERE table_name = 'pg_room_types'
       AND column_name = ANY($1)`,
      [["has_balcony", "security_deposit_paise", "deposit_refundable_pct"]]
    );

    expect(columns.rows.map((row) => row.column_name).sort()).toEqual([
      "deposit_refundable_pct",
      "has_balcony",
      "security_deposit_paise"
    ]);

    const constraint = await pool.query(
      `SELECT 1 FROM pg_constraint WHERE conname = 'pg_room_types_identity_uniq'`
    );

    expect(constraint.rowCount).toBe(1);
  });
});
