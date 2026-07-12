import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Pool } from "pg";
import { DatabaseService } from "../src/common/database.service";
import { AdminLeadOpsService } from "../src/modules/leads/admin-lead-ops.service";

const TEST_DB = process.env.TEST_DATABASE_URL;

describe.runIf(!!TEST_DB)("AdminLeadOpsService.refundLead (DB)", () => {
  let pool: Pool;
  let db: DatabaseService;
  let svc: AdminLeadOpsService;
  let adminId: string;
  let ownerId: string;
  let tenantId: string;
  let listingId: string;

  beforeAll(async () => {
    process.env.DATABASE_URL = TEST_DB;
    pool = new Pool({ connectionString: TEST_DB! });
    db = new DatabaseService();
    svc = new AdminLeadOpsService(db, { send: async () => true } as any);
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
        `INSERT INTO users (phone_e164, role) VALUES ($1,'tenant') RETURNING id::text`,
        [`+9195${s}`]
      )
    ).rows[0].id;
    await pool.query(
      `INSERT INTO wallets (user_id, balance_credits, free_credits_granted) VALUES ($1::uuid,0,0)`,
      [tenantId]
    );
    listingId = (
      await pool.query<{ id: string }>(
        `INSERT INTO listings (owner_user_id, listing_type, title_en, monthly_rent, status) VALUES ($1::uuid,'flat_house','Refund Ep',9000,'active') RETURNING id::text`,
        [ownerId]
      )
    ).rows[0].id;
  }, 60_000);

  async function seedPendingLead() {
    const idem = `rf-${Math.random().toString(36).slice(2)}`;
    const txn = (
      await pool.query<{ id: string }>(
        `INSERT INTO wallet_transactions (wallet_user_id, txn_type, credits_delta, reference_type, idempotency_key, metadata) VALUES ($1::uuid,'debit_contact_unlock',-1,'listing',$2,'{}'::jsonb) RETURNING id::text`,
        [tenantId, idem]
      )
    ).rows[0].id;
    const unlock = (
      await pool.query<{ id: string }>(
        `INSERT INTO contact_unlocks (tenant_user_id, listing_id, wallet_txn_id, idempotency_key, response_deadline_at, owner_response_status) VALUES ($1::uuid,$2::uuid,$3::uuid,$4, now() + interval '10 hours','pending') RETURNING id::text`,
        [tenantId, listingId, txn, idem]
      )
    ).rows[0].id;
    const lead = (
      await pool.query<{ id: string }>(
        `INSERT INTO leads (listing_id, owner_user_id, tenant_user_id, contact_unlock_id, status, access_state, call_deadline_at) VALUES ($1::uuid,$2::uuid,$3::uuid,$4::uuid,'new','locked', now() + interval '10 hours') ON CONFLICT (listing_id, tenant_user_id) DO UPDATE SET contact_unlock_id=EXCLUDED.contact_unlock_id, access_state='locked' RETURNING id::text`,
        [listingId, ownerId, tenantId, unlock]
      )
    ).rows[0].id;
    return { unlock, lead };
  }

  afterAll(async () => {
    await pool.query(`DELETE FROM admin_actions WHERE admin_user_id = $1::uuid`, [adminId]);
    await pool.query(
      `DELETE FROM contact_events WHERE contact_unlock_id IN (SELECT id FROM contact_unlocks WHERE listing_id=$1::uuid)`,
      [listingId]
    );
    await pool.query(`DELETE FROM leads WHERE listing_id=$1::uuid`, [listingId]);
    await pool.query(`UPDATE contact_unlocks SET refund_txn_id=NULL WHERE listing_id=$1::uuid`, [
      listingId
    ]);
    await pool.query(`DELETE FROM contact_unlocks WHERE listing_id=$1::uuid`, [listingId]);
    await pool.query(`DELETE FROM wallet_transactions WHERE wallet_user_id=$1::uuid`, [tenantId]);
    await pool.query(`DELETE FROM wallets WHERE user_id=$1::uuid`, [tenantId]);
    await pool.query(`DELETE FROM listings WHERE id=$1::uuid`, [listingId]);
    await pool.query(`DELETE FROM users WHERE id IN ($1::uuid,$2::uuid,$3::uuid)`, [
      adminId,
      ownerId,
      tenantId
    ]);
    await db.onModuleDestroy();
    await pool.end();
  }, 60_000);

  it("refunds the seeker, expires the locked lead, writes refund_admin txn + audit", async () => {
    const { unlock, lead } = await seedPendingLead();
    const res = await svc.refundLead(lead, adminId, "listing looked fake");
    expect(res.refunded).toBe(true);
    const wallet = await pool.query<{ balance_credits: number }>(
      `SELECT balance_credits FROM wallets WHERE user_id=$1::uuid`,
      [tenantId]
    );
    expect(wallet.rows[0].balance_credits).toBe(1);
    const txn = await pool.query<{ txn_type: string }>(
      `SELECT txn_type FROM wallet_transactions WHERE reference_id=$1::uuid AND credits_delta=1`,
      [unlock]
    );
    expect(txn.rows[0].txn_type).toBe("refund_admin");
    const ld = await pool.query<{ access_state: string }>(
      `SELECT access_state FROM leads WHERE id=$1::uuid`,
      [lead]
    );
    expect(ld.rows[0].access_state).toBe("expired");
    const audit = await pool.query<{ n: number }>(
      `SELECT count(*)::int n FROM admin_actions WHERE target_type='lead' AND target_id=$1::uuid AND action='lead_manual_refund'`,
      [lead]
    );
    expect(audit.rows[0].n).toBe(1);
  });

  it("409s when the owner already responded", async () => {
    const { unlock, lead } = await seedPendingLead();
    await pool.query(
      `UPDATE contact_unlocks SET owner_response_status='responded', owner_responded_at=now() WHERE id=$1::uuid`,
      [unlock]
    );
    await expect(svc.refundLead(lead, adminId, "x")).rejects.toMatchObject({
      response: { code: "already_responded" }
    });
  });
});
