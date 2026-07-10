import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Pool } from "pg";
import { runRefundSweepDb, runLeadReminderSweepDb } from "../src/worker/callback-sweeps";

const TEST_DB = process.env.TEST_DATABASE_URL;

describe.runIf(!!TEST_DB)("callback worker sweeps (DB)", () => {
  let pool: Pool;
  let ownerId: string;
  let tenantId: string;
  let listingId: string;

  async function seedUnlockAndLead(opts: {
    deadline: string; // SQL interval expression relative to now()
    accessState: "free" | "locked";
    responded?: boolean;
  }) {
    const idem = `sweep-${Math.random().toString(36).slice(2)}`;
    const txn = await pool.query<{ id: string }>(
      `INSERT INTO wallet_transactions (wallet_user_id, txn_type, credits_delta, reference_type, idempotency_key, metadata)
       VALUES ($1::uuid, 'debit_contact_unlock', -1, 'listing', $2, '{}'::jsonb) RETURNING id::text`,
      [tenantId, idem]
    );
    const unlock = await pool.query<{ id: string }>(
      `INSERT INTO contact_unlocks (tenant_user_id, listing_id, wallet_txn_id, idempotency_key,
                                    response_deadline_at, owner_response_status)
       VALUES ($1::uuid, $2::uuid, $3::uuid, $4, now() + ${opts.deadline},
               ${opts.responded ? "'responded'" : "'pending'"})
       RETURNING id::text`,
      [tenantId, listingId, txn.rows[0].id, idem]
    );
    const lead = await pool.query<{ id: string }>(
      `INSERT INTO leads (listing_id, owner_user_id, tenant_user_id, contact_unlock_id,
                          status, access_state, call_deadline_at)
       VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, 'new', $5, now() + ${opts.deadline})
       ON CONFLICT (listing_id, tenant_user_id) DO UPDATE SET
         contact_unlock_id = EXCLUDED.contact_unlock_id,
         access_state = EXCLUDED.access_state,
         call_deadline_at = EXCLUDED.call_deadline_at,
         called_at = NULL, called_by = NULL
       RETURNING id::text`,
      [listingId, ownerId, tenantId, unlock.rows[0].id, opts.accessState]
    );
    return { unlockId: unlock.rows[0].id, leadId: lead.rows[0].id };
  }

  beforeAll(async () => {
    process.env.FF_CALLBACK_LEADS = "true";
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
       VALUES ($1::uuid, 'flat_house', 'Sweep Test Flat', 9000, 'active') RETURNING id::text`,
      [ownerId]
    );
    listingId = listing.rows[0].id;
  }, 60_000);

  afterAll(async () => {
    await pool.query(
      `DELETE FROM outbound_events WHERE aggregate_id IN (SELECT id FROM leads WHERE listing_id = $1::uuid)`,
      [listingId]
    );
    await pool.query(
      `DELETE FROM contact_events WHERE contact_unlock_id IN (SELECT id FROM contact_unlocks WHERE listing_id = $1::uuid)`,
      [listingId]
    );
    await pool.query(
      `DELETE FROM lead_events WHERE lead_id IN (SELECT id FROM leads WHERE listing_id = $1::uuid)`,
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
    delete process.env.FF_CALLBACK_LEADS;
  }, 60_000);

  it("refund sweep refunds overdue unlock and expires the locked lead", async () => {
    const { unlockId, leadId } = await seedUnlockAndLead({
      deadline: "interval '-1 hour'",
      accessState: "locked"
    });
    const refunded = await runRefundSweepDb(pool);
    expect(refunded).toBeGreaterThanOrEqual(1);

    const unlock = await pool.query(
      `SELECT unlock_status FROM contact_unlocks WHERE id = $1::uuid`,
      [unlockId]
    );
    expect(unlock.rows[0].unlock_status).toBe("refunded");
    const lead = await pool.query(`SELECT access_state FROM leads WHERE id = $1::uuid`, [leadId]);
    expect(lead.rows[0].access_state).toBe("expired");
  });

  it("does not refund a responded unlock", async () => {
    const { unlockId } = await seedUnlockAndLead({
      deadline: "interval '-1 hour'",
      accessState: "free",
      responded: true
    });
    await runRefundSweepDb(pool);
    const unlock = await pool.query(
      `SELECT unlock_status FROM contact_unlocks WHERE id = $1::uuid`,
      [unlockId]
    );
    expect(unlock.rows[0].unlock_status).toBe("active");
  });

  it("reminder sweep queues one WhatsApp event per lead, once", async () => {
    const { leadId } = await seedUnlockAndLead({
      deadline: "interval '5 hours'",
      accessState: "locked"
    });
    const first = await runLeadReminderSweepDb(pool);
    expect(first).toBeGreaterThanOrEqual(1);
    const second = await runLeadReminderSweepDb(pool);
    const events = await pool.query(
      `SELECT count(*)::int AS n FROM outbound_events
       WHERE event_type = 'notification.whatsapp.lead_expiring' AND aggregate_id = $1`,
      [leadId]
    );
    expect(events.rows[0].n).toBe(1);
  });
});
