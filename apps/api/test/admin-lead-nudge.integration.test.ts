import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Pool } from "pg";
import { DatabaseService } from "../src/common/database.service";
import { AdminLeadOpsService } from "../src/modules/leads/admin-lead-ops.service";

const TEST_DB = process.env.TEST_DATABASE_URL;

describe.runIf(!!TEST_DB)("AdminLeadOpsService.nudgeOwner (DB)", () => {
  let pool: Pool;
  let db: DatabaseService;
  let svc: AdminLeadOpsService;
  const fakeNotifications: any = { send: async () => true };
  let adminId: string;
  let ownerId: string;
  let tenantId: string;
  let listingId: string;

  beforeAll(async () => {
    process.env.DATABASE_URL = TEST_DB;
    process.env.FF_ADMIN_LEAD_CENTER = "true";
    pool = new Pool({ connectionString: TEST_DB! });
    db = new DatabaseService();
    svc = new AdminLeadOpsService(db, fakeNotifications);
    const s = String(Math.floor(Math.random() * 1e8)).padStart(8, "0");
    adminId = (
      await pool.query<{ id: string }>(
        `INSERT INTO users (phone_e164, role) VALUES ($1,'admin') RETURNING id::text`,
        [`+9194${s}`]
      )
    ).rows[0].id;
    ownerId = (
      await pool.query<{ id: string }>(
        `INSERT INTO users (phone_e164, role) VALUES ($1,'owner') RETURNING id::text`,
        [`+9196${s}`]
      )
    ).rows[0].id;
    tenantId = (
      await pool.query<{ id: string }>(
        `INSERT INTO users (phone_e164, role, full_name) VALUES ($1,'tenant','Nudge Tenant') RETURNING id::text`,
        [`+9195${s}`]
      )
    ).rows[0].id;
    listingId = (
      await pool.query<{ id: string }>(
        `INSERT INTO listings (owner_user_id, listing_type, title_en, monthly_rent, status) VALUES ($1::uuid,'flat_house','Nudge Ep',9000,'active') RETURNING id::text`,
        [ownerId]
      )
    ).rows[0].id;
  }, 60_000);

  async function seedUncalledLead() {
    const lead = (
      await pool.query<{ id: string }>(
        `INSERT INTO leads (listing_id, owner_user_id, tenant_user_id, status, access_state, call_deadline_at)
         VALUES ($1::uuid,$2::uuid,$3::uuid,'new','locked', now() + interval '10 hours')
         RETURNING id::text`,
        [listingId, ownerId, tenantId]
      )
    ).rows[0].id;
    return { lead };
  }

  afterAll(async () => {
    await pool.query(`DELETE FROM admin_actions WHERE admin_user_id = $1::uuid`, [adminId]);
    await pool.query(
      `DELETE FROM lead_events WHERE lead_id IN (SELECT id FROM leads WHERE listing_id=$1::uuid)`,
      [listingId]
    );
    await pool.query(`DELETE FROM leads WHERE listing_id=$1::uuid`, [listingId]);
    await pool.query(`DELETE FROM listings WHERE id=$1::uuid`, [listingId]);
    await pool.query(`DELETE FROM users WHERE id IN ($1::uuid,$2::uuid,$3::uuid)`, [
      adminId,
      ownerId,
      tenantId
    ]);
    await db.onModuleDestroy();
    await pool.end();
    delete process.env.FF_ADMIN_LEAD_CENTER;
  }, 60_000);

  it("sends once, writes a nudge lead_event + admin_action, and rate-limits a second nudge", async () => {
    const { lead } = await seedUncalledLead();
    const first = await svc.nudgeOwner(lead, adminId);
    expect(first.nudged).toBe(true);
    const ev = await pool.query<{ n: number }>(
      `SELECT count(*)::int n FROM lead_events WHERE lead_id=$1::uuid AND notes='admin_nudged_owner'`,
      [lead]
    );
    expect(ev.rows[0].n).toBe(1);
    const audit = await pool.query<{ n: number }>(
      `SELECT count(*)::int n FROM admin_actions WHERE target_id=$1::uuid AND action='nudge_owner'`,
      [lead]
    );
    expect(audit.rows[0].n).toBe(1);
    const second = await svc.nudgeOwner(lead, adminId); // within 3h window
    expect(second.nudged).toBe(false);
  });
});
