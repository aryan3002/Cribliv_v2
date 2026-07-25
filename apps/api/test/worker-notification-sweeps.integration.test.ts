import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import {
  runLeadNudgeSweep,
  runSavedSearchAlertSweep,
  runSubscriptionRenewalSweep
} from "../src/worker/worker";

const TEST_DB = process.env.TEST_DATABASE_URL;

/**
 * These sweeps all JOIN `users` and read the owner/tenant phone. They ran for
 * months in production doing nothing at all, because they selected a column
 * (`u.phone`) that does not exist — a failure no SQL-string assertion would
 * catch. Everything here therefore runs against a real schema.
 */
describe.runIf(!!TEST_DB)("worker notification sweeps (DB)", () => {
  let pool: Pool;
  const createdUserIds: string[] = [];
  const createdListingIds: string[] = [];
  const createdLeadIds: string[] = [];

  async function seedUser(optIn: boolean): Promise<string> {
    const phone = `+9199${Math.floor(10000000 + Math.random() * 89999999)}`;
    const { rows } = await pool.query<{ id: string }>(
      `INSERT INTO users (phone_e164, whatsapp_opt_in) VALUES ($1, $2) RETURNING id::text`,
      [phone, optIn]
    );
    createdUserIds.push(rows[0].id);
    return rows[0].id;
  }

  async function seedListing(ownerId: string): Promise<string> {
    const { rows } = await pool.query<{ id: string }>(
      `INSERT INTO listings (owner_user_id, listing_type, title_en, monthly_rent)
       VALUES ($1::uuid, 'pg', 'Sweep test listing', 7000) RETURNING id::text`,
      [ownerId]
    );
    createdListingIds.push(rows[0].id);
    return rows[0].id;
  }

  /** A brand-new lead nobody has answered, `ageInterval` old. */
  async function seedUnansweredLead(ownerId: string, ageInterval: string): Promise<string> {
    const tenantId = await seedUser(false);
    const listingId = await seedListing(ownerId);
    const { rows } = await pool.query<{ id: string }>(
      `INSERT INTO leads (listing_id, owner_user_id, tenant_user_id, status, access_state, created_at)
       VALUES ($1::uuid, $2::uuid, $3::uuid, 'new', 'free', now() - ${ageInterval})
       RETURNING id::text`,
      [listingId, ownerId, tenantId]
    );
    createdLeadIds.push(rows[0].id);
    return rows[0].id;
  }

  async function nudgeArtifacts(leadId: string) {
    const [events, marks] = await Promise.all([
      pool.query(
        `SELECT 1 FROM outbound_events
          WHERE aggregate_id = $1::uuid AND event_type = 'notification.whatsapp.lead_follow_up'`,
        [leadId]
      ),
      pool.query(
        `SELECT 1 FROM lead_events WHERE lead_id = $1::uuid AND notes = 'follow_up_nudge_sent'`,
        [leadId]
      )
    ]);
    return { queued: events.rowCount ?? 0, marked: marks.rowCount ?? 0 };
  }

  beforeAll(async () => {
    pool = new Pool({ connectionString: TEST_DB });
  });

  afterAll(async () => {
    for (const leadId of createdLeadIds) {
      await pool.query(`DELETE FROM outbound_events WHERE aggregate_id = $1::uuid`, [leadId]);
      await pool.query(`DELETE FROM lead_events WHERE lead_id = $1::uuid`, [leadId]);
      await pool.query(`DELETE FROM leads WHERE id = $1::uuid`, [leadId]);
    }
    for (const listingId of createdListingIds) {
      await pool.query(`DELETE FROM listings WHERE id = $1::uuid`, [listingId]);
    }
    for (const userId of createdUserIds) {
      await pool.query(`DELETE FROM users WHERE id = $1::uuid`, [userId]);
    }
    await pool.end();
  });

  it("nudges the owner about a lead that has gone unanswered", async () => {
    const ownerId = await seedUser(true);
    const leadId = await seedUnansweredLead(ownerId, "interval '6 hours'");

    await runLeadNudgeSweep(pool);

    expect(await nudgeArtifacts(leadId)).toEqual({ queued: 1, marked: 1 });
  });

  it("does not nudge the same lead twice", async () => {
    const ownerId = await seedUser(true);
    const leadId = await seedUnansweredLead(ownerId, "interval '6 hours'");

    await runLeadNudgeSweep(pool);
    await runLeadNudgeSweep(pool);

    expect(await nudgeArtifacts(leadId)).toEqual({ queued: 1, marked: 1 });
  });

  it("leaves stale leads alone so a first run cannot blast owners about old history", async () => {
    const ownerId = await seedUser(true);
    const leadId = await seedUnansweredLead(ownerId, "interval '90 days'");

    await runLeadNudgeSweep(pool);

    expect(await nudgeArtifacts(leadId)).toEqual({ queued: 0, marked: 0 });
  });

  it("skips owners who never opted in to WhatsApp", async () => {
    const ownerId = await seedUser(false);
    const leadId = await seedUnansweredLead(ownerId, "interval '6 hours'");

    await runLeadNudgeSweep(pool);

    expect(await nudgeArtifacts(leadId)).toEqual({ queued: 0, marked: 0 });
  });

  it("runs the subscription renewal sweep against the real schema", async () => {
    await expect(runSubscriptionRenewalSweep(pool)).resolves.toBeTypeOf("number");
  });

  it("runs the saved search alert sweep against the real schema", async () => {
    await expect(runSavedSearchAlertSweep(pool)).resolves.toBeTypeOf("number");
  });
});
