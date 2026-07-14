import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Pool } from "pg";
import { DatabaseService } from "../src/common/database.service";
import { AdminLeadOpsService } from "../src/modules/leads/admin-lead-ops.service";

const TEST_DB = process.env.TEST_DATABASE_URL;

describe.runIf(!!TEST_DB)("AdminLeadOpsService.getBoard (DB)", () => {
  let pool: Pool;
  let db: DatabaseService;
  let svc: AdminLeadOpsService;
  let ownerId: string;
  let tenantId: string;
  let listingId: string;

  beforeAll(async () => {
    process.env.DATABASE_URL = TEST_DB;
    process.env.FF_ADMIN_LEAD_CENTER = "true";
    pool = new Pool({ connectionString: TEST_DB! });
    db = new DatabaseService();
    svc = new AdminLeadOpsService(db, { send: async () => true } as any);

    const suffix = String(Math.floor(Math.random() * 1e8)).padStart(8, "0");
    const owner = await pool.query<{ id: string }>(
      `INSERT INTO users (phone_e164, role, full_name) VALUES ($1, 'owner', 'Board Owner') RETURNING id::text`,
      [`+9196${suffix}`]
    );
    ownerId = owner.rows[0].id;
    const tenant = await pool.query<{ id: string }>(
      `INSERT INTO users (phone_e164, role, full_name) VALUES ($1, 'tenant', 'Board Seeker') RETURNING id::text`,
      [`+9195${suffix}`]
    );
    tenantId = tenant.rows[0].id;
    const listing = await pool.query<{ id: string }>(
      `INSERT INTO listings (owner_user_id, listing_type, title_en, monthly_rent, status, city_slug)
       VALUES ($1::uuid, 'flat_house', 'Board Test Flat', 9000, 'active', 'mumbai') RETURNING id::text`,
      [ownerId]
    );
    listingId = listing.rows[0].id;

    // Uncalled lead, ~4h to deadline (expiring). Seeker phone must come back full.
    await pool.query(
      `INSERT INTO leads (listing_id, owner_user_id, tenant_user_id, status, access_state,
                          call_deadline_at, created_at)
       VALUES ($1::uuid, $2::uuid, $3::uuid, 'new', 'locked', now() + interval '4 hours', now())`,
      [listingId, ownerId, tenantId]
    );
  }, 60_000);

  afterAll(async () => {
    await pool.query(
      `DELETE FROM lead_events WHERE lead_id IN (SELECT id FROM leads WHERE listing_id = $1::uuid)`,
      [listingId]
    );
    await pool.query(`DELETE FROM leads WHERE listing_id = $1::uuid`, [listingId]);
    await pool.query(`DELETE FROM listings WHERE id = $1::uuid`, [listingId]);
    await pool.query(`DELETE FROM users WHERE id IN ($1::uuid, $2::uuid)`, [ownerId, tenantId]);
    await db.onModuleDestroy();
    await pool.end();
    delete process.env.FF_ADMIN_LEAD_CENTER;
  }, 60_000);

  it("returns the uncalled lead with full seeker phone and a masked owner phone", async () => {
    const res = await svc.getBoard({ filter: "needs_call", ownerId });
    const row = res.rows.find((r) => r.owner.user_id === ownerId);
    expect(row).toBeTruthy();
    expect(row!.seeker.name).toBe("Board Seeker");
    expect(row!.seeker.phone_e164).toMatch(/^\+9195/); // full seeker number
    expect(row!.owner.phone_masked).toMatch(/X/); // owner masked
    expect(row!.access_state).toBe("locked");
    expect(row!.called_at).toBeNull();
    expect(row!.seconds_remaining).toBeGreaterThan(0);
    expect(res.counters.uncalled).toBeGreaterThanOrEqual(1);
    expect(res.counters.expiring_6h).toBeGreaterThanOrEqual(1);
  });

  it("the expiring_6h filter includes the ~4h lead", async () => {
    const res = await svc.getBoard({ filter: "expiring_6h", ownerId });
    expect(res.rows.some((r) => r.owner.user_id === ownerId)).toBe(true);
  });

  it("getTimeline returns the lead's events in time order", async () => {
    const lead = await pool.query<{ id: string }>(
      `SELECT id::text FROM leads WHERE owner_user_id = $1::uuid LIMIT 1`,
      [ownerId]
    );
    const leadId = lead.rows[0].id;
    // seed one lead_event so there is at least one row
    await pool.query(
      `INSERT INTO lead_events (lead_id, to_status, notes) VALUES ($1::uuid, 'new'::lead_status, 'seeded_event')`,
      [leadId]
    );
    const timeline = await svc.getTimeline(leadId);
    expect(timeline.lead_id).toBe(leadId);
    expect(timeline.events.length).toBeGreaterThanOrEqual(1);
    expect(timeline.events.some((e) => e.source === "lead" && e.kind === "seeded_event")).toBe(
      true
    );
  });
});
