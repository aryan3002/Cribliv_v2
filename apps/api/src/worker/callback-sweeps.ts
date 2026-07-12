import { Pool } from "pg";
import { readFeatureFlags } from "../config/feature-flags";
import { refundUnlock } from "../modules/contacts/refund-unlock";

const REFUND_BATCH_SIZE = 100;

export async function runRefundSweepDb(pool: Pool) {
  const client = await pool.connect();
  let refundedCount = 0;
  try {
    while (true) {
      await client.query("BEGIN");
      const dueUnlocks = await client.query<{
        id: string;
        tenant_user_id: string;
      }>(
        `
        SELECT id::text, tenant_user_id::text
        FROM contact_unlocks
        WHERE owner_response_status = 'pending'
          AND unlock_status = 'active'
          AND response_deadline_at <= now()
        ORDER BY response_deadline_at ASC
        FOR UPDATE SKIP LOCKED
        LIMIT $1
        `,
        [REFUND_BATCH_SIZE]
      );

      if (!dueUnlocks.rowCount) {
        await client.query("COMMIT");
        break;
      }

      for (const unlock of dueUnlocks.rows) {
        const res = await refundUnlock(client, unlock.id, {
          txnType: "refund_no_response",
          actorRole: "system",
          expireLockedLead: true
        });
        if (res.refunded) refundedCount += 1;
      }

      await client.query("COMMIT");
    }
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }

  return refundedCount;
}

const REMINDER_BATCH_SIZE = 50;

/**
 * 6h-warning for the callback guarantee: owners with an uncalled lead entering
 * the final window get a WhatsApp nudge via the outbound_events dispatcher.
 * Deduped by a lead_events marker, mirroring runLeadNudgeSweep.
 */
export async function runLeadReminderSweepDb(pool: Pool): Promise<number> {
  if (!readFeatureFlags().ff_callback_leads) return 0;

  const due = await pool.query<{
    lead_id: string;
    listing_title: string;
    status: string;
    owner_phone: string;
    whatsapp_opt_in: boolean;
  }>(
    `SELECT ld.id::text AS lead_id,
            COALESCE(NULLIF(l.title_en, ''), 'your listing') AS listing_title,
            ld.status::text AS status,
            u.phone_e164 AS owner_phone,
            u.whatsapp_opt_in
     FROM leads ld
     JOIN users u ON u.id = ld.owner_user_id
     JOIN listings l ON l.id = ld.listing_id
     WHERE ld.called_at IS NULL
       AND ld.call_deadline_at IS NOT NULL
       AND ld.call_deadline_at > now()
       AND ld.call_deadline_at <= now() + interval '6 hours'
       AND ld.access_state <> 'expired'
       AND NOT EXISTS (
         SELECT 1 FROM lead_events le
         WHERE le.lead_id = ld.id AND le.notes = 'expiry_reminder_sent'
       )
     LIMIT $1`,
    [REMINDER_BATCH_SIZE]
  );
  if (!due.rowCount) return 0;

  const client = await pool.connect();
  let reminded = 0;
  try {
    for (const lead of due.rows) {
      if (!lead.whatsapp_opt_in || !lead.owner_phone) continue;
      await client.query("BEGIN");
      await client.query(
        `INSERT INTO outbound_events (event_type, aggregate_type, aggregate_id, payload, next_attempt_at)
         VALUES ('notification.whatsapp.lead_expiring', 'lead', $1::uuid, $2::jsonb, now())`,
        [
          lead.lead_id,
          JSON.stringify({
            recipient_phone: lead.owner_phone,
            template_name: "lead_expiring",
            language_code: "hi",
            body_params: [lead.listing_title]
          })
        ]
      );
      await client.query(
        `INSERT INTO lead_events (lead_id, to_status, notes)
         VALUES ($1::uuid, $2::lead_status, 'expiry_reminder_sent')`,
        [lead.lead_id, lead.status]
      );
      await client.query("COMMIT");
      reminded += 1;
    }
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
  return reminded;
}
