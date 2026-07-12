import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { NotFoundException } from "@nestjs/common";
import { Pool } from "pg";
import { DatabaseService } from "../src/common/database.service";
import { AdminLeadOpsService } from "../src/modules/leads/admin-lead-ops.service";

const TEST_DB = process.env.TEST_DATABASE_URL;

describe.runIf(!!TEST_DB)("AdminLeadOpsService.getAnalytics + getOwnerDetail (DB)", () => {
  let pool: Pool;
  let db: DatabaseService;
  let svc: AdminLeadOpsService;
  let ownerId: string;
  let ownerPhone: string;
  let tenant1Id: string;
  let tenant2Id: string;
  let listingId: string;
  let sessionId: string;

  beforeAll(async () => {
    process.env.DATABASE_URL = TEST_DB;
    process.env.FF_ADMIN_LEAD_CENTER = "true";
    pool = new Pool({ connectionString: TEST_DB! });
    db = new DatabaseService();
    svc = new AdminLeadOpsService(db, { send: async () => true } as any);

    const suffix = String(Math.floor(Math.random() * 1e8)).padStart(8, "0");
    sessionId = `analytics-test-${suffix}`;
    ownerPhone = `+9197${suffix}`;

    const owner = await pool.query<{ id: string }>(
      `INSERT INTO users (phone_e164, role, full_name) VALUES ($1, 'owner', 'Analytics Owner') RETURNING id::text`,
      [ownerPhone]
    );
    ownerId = owner.rows[0].id;

    const tenant1 = await pool.query<{ id: string }>(
      `INSERT INTO users (phone_e164, role, full_name) VALUES ($1, 'tenant', 'Analytics Seeker 1') RETURNING id::text`,
      [`+9195${suffix}`]
    );
    tenant1Id = tenant1.rows[0].id;

    const tenant2 = await pool.query<{ id: string }>(
      `INSERT INTO users (phone_e164, role, full_name) VALUES ($1, 'tenant', 'Analytics Seeker 2') RETURNING id::text`,
      [`+9194${suffix}`]
    );
    tenant2Id = tenant2.rows[0].id;

    // wallet required before a wallet_transactions row can reference it
    await pool.query(
      `INSERT INTO wallets (user_id, balance_credits, free_credits_granted) VALUES ($1::uuid, 0, 0)`,
      [tenant2Id]
    );

    const listing = await pool.query<{ id: string }>(
      `INSERT INTO listings (owner_user_id, listing_type, title_en, monthly_rent, status, city_slug)
       VALUES ($1::uuid, 'flat_house', 'Analytics Test Flat', 9000, 'active', 'mumbai') RETURNING id::text`,
      [ownerId]
    );
    listingId = listing.rows[0].id;

    const idem = `an-${suffix}`;
    const txn = await pool.query<{ id: string }>(
      `INSERT INTO wallet_transactions (wallet_user_id, txn_type, credits_delta, reference_type, idempotency_key, metadata)
       VALUES ($1::uuid, 'debit_contact_unlock', -1, 'listing', $2, '{}'::jsonb) RETURNING id::text`,
      [tenant2Id, idem]
    );

    // Seed a contact_unlock that's already refunded (funnel.leads_refunded + engagement.callbacks_requested).
    const unlock = await pool.query<{ id: string }>(
      `INSERT INTO contact_unlocks (tenant_user_id, listing_id, wallet_txn_id, idempotency_key, response_deadline_at, unlock_status, owner_response_status)
       VALUES ($1::uuid, $2::uuid, $3::uuid, $4, now() + interval '10 hours', 'refunded', 'pending') RETURNING id::text`,
      [tenant2Id, listingId, txn.rows[0].id, idem]
    );
    const unlockId = unlock.rows[0].id;

    // Lead 1: called by the owner (funnel.leads_called, rates.median_response_minutes).
    await pool.query(
      `INSERT INTO leads (listing_id, owner_user_id, tenant_user_id, status, access_state, called_at, called_by, call_deadline_at, created_at)
       VALUES ($1::uuid, $2::uuid, $3::uuid, 'contacted', 'unlocked', now(), 'owner', now() + interval '24 hours', now())`,
      [listingId, ownerId, tenant1Id]
    );

    // Lead 2: linked to the refunded callback (by_owner refund_rate).
    await pool.query(
      `INSERT INTO leads (listing_id, owner_user_id, tenant_user_id, contact_unlock_id, status, access_state, call_deadline_at, created_at)
       VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, 'new', 'expired', now() + interval '24 hours', now())`,
      [listingId, ownerId, tenant2Id, unlockId]
    );

    await pool.query(
      `INSERT INTO listing_events (listing_id, event_type) VALUES ($1::uuid, 'view')`,
      [listingId]
    );

    await pool.query(`INSERT INTO pg_search_events (session_id, result_count) VALUES ($1, 1)`, [
      sessionId
    ]);
  }, 60_000);

  afterAll(async () => {
    await pool.query(`DELETE FROM listing_events WHERE listing_id = $1::uuid`, [listingId]);
    await pool.query(`DELETE FROM pg_search_events WHERE session_id = $1`, [sessionId]);
    await pool.query(`DELETE FROM leads WHERE listing_id = $1::uuid`, [listingId]);
    await pool.query(`DELETE FROM contact_unlocks WHERE listing_id = $1::uuid`, [listingId]);
    await pool.query(`DELETE FROM wallet_transactions WHERE wallet_user_id = $1::uuid`, [
      tenant2Id
    ]);
    await pool.query(`DELETE FROM wallets WHERE user_id = $1::uuid`, [tenant2Id]);
    await pool.query(`DELETE FROM listings WHERE id = $1::uuid`, [listingId]);
    await pool.query(`DELETE FROM users WHERE id IN ($1::uuid, $2::uuid, $3::uuid)`, [
      ownerId,
      tenant1Id,
      tenant2Id
    ]);
    await db.onModuleDestroy();
    await pool.end();
    delete process.env.FF_ADMIN_LEAD_CENTER;
  }, 60_000);

  it("returns funnel, engagement, rates, trend, and by_owner for the seeded scenario", async () => {
    const res = await svc.getAnalytics("30 days");

    expect(res.range).toBe("30 days");
    expect(typeof res.generated_at).toBe("string");

    expect(res.funnel.callbacks_requested).toBeGreaterThanOrEqual(1);
    expect(res.funnel.leads_created).toBeGreaterThanOrEqual(2);
    expect(res.funnel.leads_called).toBeGreaterThanOrEqual(1);
    expect(res.funnel.leads_refunded).toBeGreaterThanOrEqual(1);

    expect(res.engagement.searches).toBeGreaterThanOrEqual(1);
    expect(res.engagement.listing_views).toBeGreaterThanOrEqual(1);
    expect(res.engagement.signups).toBeGreaterThanOrEqual(1);

    expect(res.rates).toBeTruthy();
    expect(res.rates.median_response_minutes).not.toBeNull();
    expect(typeof res.rates.called_within_24h_rate).toBe("number");
    expect(typeof res.rates.team_rescue_rate).toBe("number");
    expect(typeof res.rates.refund_rate).toBe("number");
    expect(typeof res.rates.dispute_rate).toBe("number");

    expect(Array.isArray(res.trend)).toBe(true);
    expect(res.trend.length).toBeGreaterThan(0);

    const ownerRow = res.by_owner.find((o) => o.owner_user_id === ownerId);
    expect(ownerRow).toBeTruthy();
    expect(ownerRow!.leads).toBeGreaterThanOrEqual(2);
    expect(ownerRow!.called).toBeGreaterThanOrEqual(1);
  });

  it("defaults an out-of-allowlist range to 30 days", async () => {
    const res = await svc.getAnalytics("garbage");
    expect(res.range).toBe("30 days");
  });

  it("returns the owner header, funnel, rates, and in-flight leads for getOwnerDetail", async () => {
    const res = await svc.getOwnerDetail(ownerId, "30 days");

    expect(res.owner_user_id).toBe(ownerId);
    expect(res.name).toBe("Analytics Owner");
    expect(res.role).toBe("owner");
    expect(res.phone_masked).not.toBe(ownerPhone);
    expect(res.phone_masked.endsWith(ownerPhone.slice(-4))).toBe(true);

    expect(res.funnel.total).toBeGreaterThanOrEqual(1);
    expect(
      res.funnel.new +
        res.funnel.contacted +
        res.funnel.visit_scheduled +
        res.funnel.deal_done +
        res.funnel.lost
    ).toBe(res.funnel.total);

    expect(res.rates).toBeTruthy();
    expect(typeof res.rates.called_within_24h_rate).toBe("number");
    expect(typeof res.rates.team_rescue_rate).toBe("number");
    expect(typeof res.rates.refund_rate).toBe("number");
    expect(typeof res.rates.dispute_rate).toBe("number");

    expect(Array.isArray(res.in_flight)).toBe(true);
  });

  it("404s getOwnerDetail for an owner id that doesn't exist", async () => {
    await expect(
      svc.getOwnerDetail("00000000-0000-0000-0000-000000000000", "30 days")
    ).rejects.toThrow(NotFoundException);
  });
});
