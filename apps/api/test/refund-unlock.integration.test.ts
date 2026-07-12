import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Pool } from "pg";
import { refundUnlock } from "../src/modules/contacts/refund-unlock";

const TEST_DB = process.env.TEST_DATABASE_URL;

describe.runIf(!!TEST_DB)("refundUnlock (DB)", () => {
  let pool: Pool;
  let ownerId: string;
  let tenantId: string;
  let listingId: string;

  beforeAll(async () => {
    pool = new Pool({ connectionString: TEST_DB! });
    const suffix = String(Math.floor(Math.random() * 1e8)).padStart(8, "0");
    const owner = await pool.query<{ id: string }>(
      `INSERT INTO users (phone_e164, role, whatsapp_opt_in) VALUES ($1, 'owner', true) RETURNING id::text`,
      [`+9196${suffix}`]
    );
    ownerId = owner.rows[0].id;
    const tenant = await pool.query<{ id: string }>(
      `INSERT INTO users (phone_e164, role) VALUES ($1, 'tenant') RETURNING id::text`,
      [`+9195${suffix}`]
    );
    tenantId = tenant.rows[0].id;
    await pool.query(
      `INSERT INTO wallets (user_id, balance_credits, free_credits_granted) VALUES ($1::uuid, 0, 0)`,
      [tenantId]
    );
    const listing = await pool.query<{ id: string }>(
      `INSERT INTO listings (owner_user_id, listing_type, title_en, monthly_rent, status)
       VALUES ($1::uuid, 'flat_house', 'Refund Unlock Flat', 9000, 'active') RETURNING id::text`,
      [ownerId]
    );
    listingId = listing.rows[0].id;
  }, 60_000);

  async function seedPendingUnlockAndLockedLead() {
    const idem = `ru-${Math.random().toString(36).slice(2)}`;
    const txn = await pool.query<{ id: string }>(
      `INSERT INTO wallet_transactions (wallet_user_id, txn_type, credits_delta, reference_type, idempotency_key, metadata)
       VALUES ($1::uuid, 'debit_contact_unlock', -1, 'listing', $2, '{}'::jsonb) RETURNING id::text`,
      [tenantId, idem]
    );
    const unlock = await pool.query<{ id: string }>(
      `INSERT INTO contact_unlocks (tenant_user_id, listing_id, wallet_txn_id, idempotency_key,
                                    response_deadline_at, owner_response_status)
       VALUES ($1::uuid, $2::uuid, $3::uuid, $4, now() - interval '1 hour', 'pending') RETURNING id::text`,
      [tenantId, listingId, txn.rows[0].id, idem]
    );
    const lead = await pool.query<{ id: string }>(
      `INSERT INTO leads (listing_id, owner_user_id, tenant_user_id, contact_unlock_id, status, access_state, call_deadline_at)
       VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, 'new', 'locked', now() - interval '1 hour')
       ON CONFLICT (listing_id, tenant_user_id) DO UPDATE SET
         contact_unlock_id = EXCLUDED.contact_unlock_id, access_state = 'locked',
         called_at = NULL, called_by = NULL RETURNING id::text`,
      [listingId, ownerId, tenantId, unlock.rows[0].id]
    );
    return { unlockId: unlock.rows[0].id, leadId: lead.rows[0].id };
  }

  afterAll(async () => {
    await pool.query(
      `DELETE FROM contact_events WHERE contact_unlock_id IN (SELECT id FROM contact_unlocks WHERE listing_id = $1::uuid)`,
      [listingId]
    );
    await pool.query(`DELETE FROM leads WHERE listing_id = $1::uuid`, [listingId]);
    await pool.query(
      `UPDATE contact_unlocks SET refund_txn_id = NULL WHERE listing_id = $1::uuid`,
      [listingId]
    );
    await pool.query(`DELETE FROM contact_unlocks WHERE listing_id = $1::uuid`, [listingId]);
    await pool.query(`DELETE FROM wallet_transactions WHERE wallet_user_id = $1::uuid`, [tenantId]);
    await pool.query(`DELETE FROM wallets WHERE user_id = $1::uuid`, [tenantId]);
    await pool.query(`DELETE FROM listings WHERE id = $1::uuid`, [listingId]);
    await pool.query(`DELETE FROM users WHERE id IN ($1::uuid, $2::uuid)`, [ownerId, tenantId]);
    await pool.end();
  }, 60_000);

  it("refunds the tenant, marks the unlock, expires the locked lead, logs the event", async () => {
    const { unlockId, leadId } = await seedPendingUnlockAndLockedLead();
    const client = await pool.connect();
    let result;
    try {
      await client.query("BEGIN");
      await client.query(`SELECT 1 FROM contact_unlocks WHERE id = $1::uuid FOR UPDATE`, [
        unlockId
      ]);
      result = await refundUnlock(client, unlockId, {
        txnType: "refund_admin",
        actorRole: "admin",
        expireLockedLead: true
      });
      await client.query("COMMIT");
    } finally {
      client.release();
    }
    expect(result!.refunded).toBe(true);
    expect(result!.tenantUserId).toBe(tenantId);

    const wallet = await pool.query<{ balance_credits: number }>(
      `SELECT balance_credits FROM wallets WHERE user_id = $1::uuid`,
      [tenantId]
    );
    expect(wallet.rows[0].balance_credits).toBe(1);
    const txn = await pool.query<{ txn_type: string }>(
      `SELECT txn_type FROM wallet_transactions WHERE reference_id = $1::uuid AND credits_delta = 1`,
      [unlockId]
    );
    expect(txn.rows[0].txn_type).toBe("refund_admin");
    const unlock = await pool.query<{ unlock_status: string }>(
      `SELECT unlock_status FROM contact_unlocks WHERE id = $1::uuid`,
      [unlockId]
    );
    expect(unlock.rows[0].unlock_status).toBe("refunded");
    const lead = await pool.query<{ access_state: string }>(
      `SELECT access_state FROM leads WHERE id = $1::uuid`,
      [leadId]
    );
    expect(lead.rows[0].access_state).toBe("expired");
    const ev = await pool.query<{ n: number }>(
      `SELECT count(*)::int n FROM contact_events WHERE contact_unlock_id = $1::uuid AND event_type = 'refund_issued'`,
      [unlockId]
    );
    expect(ev.rows[0].n).toBe(1);

    const cu = await pool.query<{ owner_response_status: string; refund_txn_id: string | null }>(
      `SELECT owner_response_status, refund_txn_id::text FROM contact_unlocks WHERE id = $1::uuid`,
      [unlockId]
    );
    expect(cu.rows[0].owner_response_status).toBe("timeout_refunded");
    expect(cu.rows[0].refund_txn_id).not.toBeNull();
    const ev2 = await pool.query<{ actor_role: string }>(
      `SELECT actor_role FROM contact_events WHERE contact_unlock_id = $1::uuid AND event_type = 'refund_issued'`,
      [unlockId]
    );
    expect(ev2.rows[0].actor_role).toBe("admin");
  });

  it("is idempotent: a second refund on an already-refunded unlock is a no-op", async () => {
    const { unlockId } = await seedPendingUnlockAndLockedLead();
    const run = async () => {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await client.query(`SELECT 1 FROM contact_unlocks WHERE id = $1::uuid FOR UPDATE`, [
          unlockId
        ]);
        const r = await refundUnlock(client, unlockId, {
          txnType: "refund_admin",
          actorRole: "admin",
          expireLockedLead: true
        });
        await client.query("COMMIT");
        return r;
      } finally {
        client.release();
      }
    };
    const first = await run();
    const second = await run();
    expect(first.refunded).toBe(true);
    expect(second.refunded).toBe(false);
    const credits = await pool.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM wallet_transactions WHERE reference_id = $1::uuid AND credits_delta = 1`,
      [unlockId]
    );
    expect(credits.rows[0].n).toBe(1); // exactly one refund credit, even after two refund calls
  });
});
