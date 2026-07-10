import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Client } from "pg";

const TEST_DB = process.env.TEST_DATABASE_URL;
const MIG = join(__dirname, "../../../infra/migrations");

describe.runIf(!!TEST_DB)("migration 0053_lead_monetization", () => {
  let client: Client;
  beforeAll(async () => {
    client = new Client({ connectionString: TEST_DB! });
    await client.connect();
    await client.query(readFileSync(join(MIG, "0053_lead_monetization.sql"), "utf8"));
  });
  afterAll(async () => {
    await client.query(readFileSync(join(MIG, "0053_lead_monetization.rollback.sql"), "utf8"));
    await client.end();
  });

  it("adds lead monetization columns with correct defaults", async () => {
    const r = await client.query(`
      SELECT column_name, data_type, is_nullable, column_default
      FROM information_schema.columns WHERE table_name = 'leads' ORDER BY column_name`);
    const by = Object.fromEntries(r.rows.map((c) => [c.column_name, c]));
    expect(by.access_state.is_nullable).toBe("NO");
    expect(by.access_state.column_default).toContain("locked");
    for (const col of [
      "unlocked_at",
      "called_at",
      "call_deadline_at",
      "tenant_confirmed_at",
      "disputed_at"
    ]) {
      expect(by[col].data_type, col).toBe("timestamp with time zone");
      expect(by[col].is_nullable, col).toBe("YES");
    }
    expect(by.called_by.data_type).toBe("text");
    expect(by.unlock_txn_id.data_type).toBe("uuid");
  });

  it("rejects invalid access_state and called_by values", async () => {
    await expect(
      client.query(
        `INSERT INTO leads (listing_id, owner_user_id, tenant_user_id, access_state)
         VALUES (gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), 'bogus')`
      )
    ).rejects.toThrow(/leads_access_state_check/);
    await expect(
      client.query(
        `INSERT INTO leads (listing_id, owner_user_id, tenant_user_id, called_by)
         VALUES (gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), 'stranger')`
      )
    ).rejects.toThrow(/leads_called_by_check/);
    const c = await client.query(`
      SELECT conname FROM pg_constraint
      WHERE conrelid = 'leads'::regclass AND conname IN ('leads_access_state_check','leads_called_by_check')`);
    expect(c.rows.map((x) => x.conname).sort()).toEqual([
      "leads_access_state_check",
      "leads_called_by_check"
    ]);
  });

  it("extends wallet_txn_type and contact_event_type enums", async () => {
    const w = await client.query(`SELECT unnest(enum_range(NULL::wallet_txn_type))::text AS v`);
    const values = w.rows.map((x) => x.v);
    expect(values).toContain("debit_lead_unlock");
    expect(values).toContain("refund_lead_dispute");
    const e = await client.query(`SELECT unnest(enum_range(NULL::contact_event_type))::text AS v`);
    const eventValues = e.rows.map((x) => x.v);
    expect(eventValues).toContain("dispute_refund");
    expect(eventValues).toContain("tenant_confirmed");
  });

  it("creates the sweep/rescue partial index", async () => {
    const r = await client.query(
      `SELECT indexname FROM pg_indexes WHERE tablename = 'leads' AND indexname = 'idx_leads_call_deadline'`
    );
    expect(r.rowCount).toBe(1);
  });
});
