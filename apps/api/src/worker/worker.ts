import "dotenv/config";
import { Pool } from "pg";
import { AppStateService } from "../common/app-state.service";
import { WhatsAppClient } from "../modules/notifications/whatsapp.client";
import { NotificationService } from "../modules/notifications/notification.service";

const REFUND_SWEEP_MS = 5 * 60 * 1000;
const REFUND_BATCH_SIZE = 100;
const OUTBOUND_DISPATCH_MS = 60 * 1000;
const OUTBOUND_BATCH_SIZE = 50;
const OUTBOUND_MAX_ATTEMPTS = 6;
const OUTBOUND_TIMEOUT_MS = 5_000;
const STALE_SWEEP_MS = 24 * 60 * 60 * 1000; // daily
const BROKER_SWEEP_MS = 7 * 24 * 60 * 60 * 1000; // weekly
const BOOST_EXPIRY_MS = 5 * 60 * 1000; // every 5 minutes
const RANKING_RECOMPUTE_MS = 6 * 60 * 60 * 1000; // every 6 hours
const LEAD_NUDGE_MS = 15 * 60 * 1000; // every 15 minutes
const SUBSCRIPTION_RENEWAL_MS = 24 * 60 * 60 * 1000; // daily
const SAVED_SEARCH_ALERT_MS = 24 * 60 * 60 * 1000; // daily
const SEEKER_PIN_CLEANUP_MS = 24 * 60 * 60 * 1000; // daily
const ALERT_ZONE_SWEEP_MS = 6 * 60 * 60 * 1000; // every 6 hours

async function runRefundSweepDb(pool: Pool) {
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
        await client.query(
          `
          INSERT INTO wallets(user_id, balance_credits, free_credits_granted)
          VALUES ($1::uuid, 0, 0)
          ON CONFLICT (user_id) DO NOTHING
          `,
          [unlock.tenant_user_id]
        );

        await client.query(
          `
          UPDATE wallets
          SET balance_credits = balance_credits + 1,
              updated_at = now()
          WHERE user_id = $1::uuid
          `,
          [unlock.tenant_user_id]
        );

        const refundTxn = await client.query<{ id: string }>(
          `
          INSERT INTO wallet_transactions(
            wallet_user_id,
            txn_type,
            credits_delta,
            reference_type,
            reference_id,
            metadata
          )
          VALUES ($1::uuid, 'refund_no_response', 1, 'contact_unlock', $2::uuid, '{}'::jsonb)
          RETURNING id::text
          `,
          [unlock.tenant_user_id, unlock.id]
        );

        const markRefunded = await client.query(
          `
          UPDATE contact_unlocks
          SET owner_response_status = 'timeout_refunded',
              unlock_status = 'refunded',
              refund_txn_id = $2::uuid,
              updated_at = now()
          WHERE id = $1::uuid
            AND owner_response_status = 'pending'
            AND unlock_status = 'active'
          `,
          [unlock.id, refundTxn.rows[0].id]
        );

        if (markRefunded.rowCount) {
          refundedCount += 1;
          await client.query(
            `
            INSERT INTO contact_events(contact_unlock_id, actor_role, event_type, metadata)
            VALUES ($1::uuid, 'system', 'refund_issued', '{}'::jsonb)
            `,
            [unlock.id]
          );
        }
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

function outboundBackoffSeconds(nextAttemptCount: number) {
  const exponent = Math.max(0, nextAttemptCount - 1);
  return Math.min(30 * 2 ** exponent, 60 * 60);
}

async function postOutboundEvent(
  crmWebhookUrl: string,
  event: {
    id: number;
    event_type: string;
    aggregate_type: string;
    aggregate_id: string | null;
    payload: Record<string, unknown>;
  }
) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), OUTBOUND_TIMEOUT_MS);

  try {
    const response = await fetch(crmWebhookUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        event_id: event.id,
        event_type: event.event_type,
        aggregate_type: event.aggregate_type,
        aggregate_id: event.aggregate_id,
        payload: event.payload,
        sent_at: new Date().toISOString()
      }),
      signal: controller.signal
    });

    if (!response.ok) {
      throw new Error(`crm_webhook_status_${response.status}`);
    }
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Send a WhatsApp notification event using the WhatsApp Business API.
 * Called by the worker for queued notification events.
 */
async function dispatchWhatsAppEvent(
  whatsAppClient: WhatsAppClient,
  event: {
    id: number;
    event_type: string;
    payload: Record<string, unknown>;
  }
) {
  const payload = event.payload;
  const phone = payload.recipient_phone as string;
  const templateName = payload.template_name as string;
  const languageCode = (payload.language_code as string) ?? "hi";
  const bodyParams = (payload.body_params as string[]) ?? [];

  if (!phone || !templateName) {
    throw new Error(`WhatsApp event ${event.id} missing recipient_phone or template_name`);
  }

  const result = await whatsAppClient.sendTemplate({
    to: phone,
    templateName,
    languageCode,
    bodyParams
  });

  if (!result.success) {
    throw new Error(result.error ?? "WhatsApp send failed");
  }

  console.log(
    JSON.stringify({
      job: "dispatch_whatsapp",
      event_id: event.id,
      event_type: event.event_type,
      message_id: result.messageId,
      status: "sent",
      timestamp: new Date().toISOString()
    })
  );
}

async function runOutboundDispatchDb(
  pool: Pool,
  crmWebhookUrl: string | undefined,
  whatsAppClient?: WhatsAppClient
) {
  const client = await pool.connect();
  let dispatchedCount = 0;
  let failedCount = 0;

  try {
    while (true) {
      await client.query("BEGIN");
      const events = await client.query<{
        id: number;
        event_type: string;
        aggregate_type: string;
        aggregate_id: string | null;
        payload: Record<string, unknown>;
        attempt_count: number;
      }>(
        `
        SELECT id, event_type, aggregate_type, aggregate_id::text, payload, attempt_count
        FROM outbound_events
        WHERE status = 'pending'
          AND next_attempt_at <= now()
        ORDER BY created_at ASC
        FOR UPDATE SKIP LOCKED
        LIMIT $1
        `,
        [OUTBOUND_BATCH_SIZE]
      );

      if (!events.rowCount) {
        await client.query("COMMIT");
        break;
      }

      for (const event of events.rows) {
        try {
          const isWhatsApp = event.event_type.startsWith("notification.whatsapp.");

          if (isWhatsApp && whatsAppClient) {
            // Dispatch via WhatsApp API
            await dispatchWhatsAppEvent(whatsAppClient, event);
          } else if (isWhatsApp && !whatsAppClient) {
            // No WhatsApp client configured – auto-mark as dispatched in dev
            console.log(
              JSON.stringify({
                job: "dispatch_whatsapp",
                event_id: event.id,
                event_type: event.event_type,
                status: "skipped_no_client",
                timestamp: new Date().toISOString()
              })
            );
          } else if (crmWebhookUrl) {
            // Dispatch via CRM webhook
            await postOutboundEvent(crmWebhookUrl, event);
          } else {
            // No dispatch target – skip
          }

          await client.query(
            `
            UPDATE outbound_events
            SET
              status = 'dispatched',
              attempt_count = attempt_count + 1,
              dispatched_at = now(),
              last_error = NULL,
              updated_at = now()
            WHERE id = $1
            `,
            [event.id]
          );

          if (event.aggregate_type === "sales_lead" && event.aggregate_id) {
            await client.query(
              `
              UPDATE sales_leads
              SET crm_sync_status = 'synced', last_crm_push_at = now(), updated_at = now()
              WHERE id = $1::uuid
              `,
              [event.aggregate_id]
            );
          }

          dispatchedCount += 1;
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          const nextAttemptCount = Number(event.attempt_count) + 1;
          const shouldFail = nextAttemptCount >= OUTBOUND_MAX_ATTEMPTS;
          const backoffSeconds = outboundBackoffSeconds(nextAttemptCount);

          await client.query(
            `
            UPDATE outbound_events
            SET
              status = $2,
              attempt_count = $3,
              next_attempt_at = CASE WHEN $2 = 'failed'
                THEN next_attempt_at
                ELSE now() + make_interval(secs => $4)
              END,
              last_error = $5,
              updated_at = now()
            WHERE id = $1
            `,
            [
              event.id,
              shouldFail ? "failed" : "pending",
              nextAttemptCount,
              backoffSeconds,
              errorMessage
            ]
          );

          if (event.aggregate_type === "sales_lead" && event.aggregate_id) {
            await client.query(
              `
              UPDATE sales_leads
              SET crm_sync_status = $2, updated_at = now()
              WHERE id = $1::uuid
              `,
              [event.aggregate_id, shouldFail ? "failed" : "pending"]
            );
          }

          if (shouldFail) {
            failedCount += 1;
          }
        }
      }

      await client.query("COMMIT");
    }
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }

  return { dispatchedCount, failedCount, skipped: false };
}

async function runOutboundDispatchInMemory(
  appState: AppStateService,
  crmWebhookUrl: string | undefined
) {
  const now = Date.now();
  let dispatchedCount = 0;
  let failedCount = 0;
  const pending = appState.outboundEvents.filter(
    (event) => event.status === "pending" && event.nextAttemptAt <= now
  );

  for (const event of pending) {
    if (!crmWebhookUrl) {
      event.status = "dispatched";
      event.attemptCount += 1;
      event.updatedAt = Date.now();
      dispatchedCount += 1;
      continue;
    }

    try {
      await postOutboundEvent(crmWebhookUrl, {
        id: event.id,
        event_type: event.eventType,
        aggregate_type: event.aggregateType,
        aggregate_id: event.aggregateId ?? null,
        payload: event.payload
      });
      event.status = "dispatched";
      event.attemptCount += 1;
      event.updatedAt = Date.now();
      dispatchedCount += 1;
    } catch {
      const nextAttemptCount = event.attemptCount + 1;
      const shouldFail = nextAttemptCount >= OUTBOUND_MAX_ATTEMPTS;
      event.attemptCount = nextAttemptCount;
      event.status = shouldFail ? "failed" : "pending";
      event.nextAttemptAt = Date.now() + outboundBackoffSeconds(nextAttemptCount) * 1000;
      event.updatedAt = Date.now();
      if (shouldFail) {
        failedCount += 1;
      }
    }
  }

  return { dispatchedCount, failedCount, skipped: false };
}

// ── Ranking recompute (every 6h) ──────────────────────────────────────────────
// Computes composite listing scores in a single UPSERT — more efficient than
// the N+1 loop in RankingService.recomputeScores() used by the API.
async function runRankingRecompute(pool: Pool): Promise<number> {
  const result = await pool.query<{ listing_id: string }>(
    `
    INSERT INTO listing_scores
      (listing_id, verification_score, freshness_score, photo_score,
       response_rate_score, completeness_score, engagement_score,
       featured_score, boost_score, composite_score, computed_at)
    SELECT
      l.id,

      -- verification_score
      CASE l.verification_status
        WHEN 'verified' THEN 1.0
        WHEN 'pending'  THEN 0.5
        ELSE 0.0
      END AS verification_score,

      -- freshness_score: linear decay to 0 over 30 days
      GREATEST(0.0,
        1.0 - EXTRACT(EPOCH FROM (now() - l.created_at)) / 2592000.0
      ) AS freshness_score,

      -- photo_score: 0→0, 6→1
      LEAST(COALESCE(pc.cnt, 0)::float / 6.0, 1.0) AS photo_score,

      -- response_rate_score: defaults to 0.5 for new listings with no unlocks
      CASE
        WHEN COALESCE(uc.total, 0) > 0
          THEN LEAST(COALESCE(uc.responded, 0)::float / uc.total, 1.0)
        ELSE 0.5
      END AS response_rate_score,

      -- completeness_score: 7 key fields
      (
        (CASE WHEN l.title_en       IS NOT NULL AND l.title_en       != '' THEN 1 ELSE 0 END
        + CASE WHEN l.description_en IS NOT NULL AND l.description_en != '' THEN 1 ELSE 0 END
        + CASE WHEN l.monthly_rent   IS NOT NULL THEN 1 ELSE 0 END
        + CASE WHEN l.deposit        IS NOT NULL THEN 1 ELSE 0 END
        + CASE WHEN l.bhk            IS NOT NULL THEN 1 ELSE 0 END
        + CASE WHEN l.furnishing     IS NOT NULL THEN 1 ELSE 0 END
        + CASE WHEN l.area_sqft      IS NOT NULL THEN 1 ELSE 0 END)::float / 7.0
      ) AS completeness_score,

      -- engagement_score: normalized saves+unlocks, floor 0.5 for new listings
      GREATEST(
        LEAST((COALESCE(sc.cnt, 0) + COALESCE(uc.total, 0))::float / 20.0, 1.0),
        0.5
      ) AS engagement_score,

      -- featured_score: 1.0 featured, 0.5 boost, 0.0 none
      CASE
        WHEN COALESCE(fb.has_featured, false) THEN 1.0
        WHEN COALESCE(fb.has_boost,    false) THEN 0.5
        ELSE 0.0
      END AS featured_score,

      -- boost_score: 1.0 if any boost active
      CASE WHEN COALESCE(fb.has_boost, false) THEN 1.0 ELSE 0.0 END AS boost_score,

      -- composite_score: weighted sum matching DEFAULT_WEIGHTS in ranking.service.ts
      (
        0.40 * CASE WHEN COALESCE(fb.has_featured, false) THEN 1.0 WHEN COALESCE(fb.has_boost, false) THEN 0.5 ELSE 0.0 END
      + 0.18 * CASE l.verification_status WHEN 'verified' THEN 1.0 WHEN 'pending' THEN 0.5 ELSE 0.0 END
      + 0.12 * GREATEST(0.0, 1.0 - EXTRACT(EPOCH FROM (now() - l.created_at)) / 2592000.0)
      + 0.12 * LEAST(COALESCE(pc.cnt, 0)::float / 6.0, 1.0)
      + 0.09 * CASE WHEN COALESCE(uc.total, 0) > 0 THEN LEAST(COALESCE(uc.responded, 0)::float / uc.total, 1.0) ELSE 0.5 END
      + 0.06 * (
          (CASE WHEN l.title_en IS NOT NULL AND l.title_en != '' THEN 1 ELSE 0 END
          + CASE WHEN l.description_en IS NOT NULL AND l.description_en != '' THEN 1 ELSE 0 END
          + CASE WHEN l.monthly_rent IS NOT NULL THEN 1 ELSE 0 END
          + CASE WHEN l.deposit IS NOT NULL THEN 1 ELSE 0 END
          + CASE WHEN l.bhk IS NOT NULL THEN 1 ELSE 0 END
          + CASE WHEN l.furnishing IS NOT NULL THEN 1 ELSE 0 END
          + CASE WHEN l.area_sqft IS NOT NULL THEN 1 ELSE 0 END)::float / 7.0
        )
      + 0.03 * GREATEST(LEAST((COALESCE(sc.cnt, 0) + COALESCE(uc.total, 0))::float / 20.0, 1.0), 0.5)
      ) AS composite_score,

      now() AS computed_at

    FROM listings l

    LEFT JOIN (
      SELECT listing_id, count(*)::int AS cnt
      FROM listing_photos
      GROUP BY listing_id
    ) pc ON pc.listing_id = l.id

    LEFT JOIN (
      SELECT
        listing_id,
        count(*)::int AS total,
        count(*) FILTER (WHERE owner_response_status = 'responded')::int AS responded
      FROM contact_unlocks
      GROUP BY listing_id
    ) uc ON uc.listing_id = l.id

    LEFT JOIN (
      SELECT listing_id, count(*)::int AS cnt
      FROM shortlist_items
      GROUP BY listing_id
    ) sc ON sc.listing_id = l.id

    LEFT JOIN (
      SELECT
        listing_id,
        bool_or(boost_type = 'featured' AND is_active AND expires_at > now()) AS has_featured,
        bool_or(boost_type = 'boost'    AND is_active AND expires_at > now()) AS has_boost
      FROM listing_boosts
      GROUP BY listing_id
    ) fb ON fb.listing_id = l.id

    WHERE l.status = 'active'

    ON CONFLICT (listing_id) DO UPDATE SET
      verification_score   = EXCLUDED.verification_score,
      freshness_score      = EXCLUDED.freshness_score,
      photo_score          = EXCLUDED.photo_score,
      response_rate_score  = EXCLUDED.response_rate_score,
      completeness_score   = EXCLUDED.completeness_score,
      engagement_score     = EXCLUDED.engagement_score,
      featured_score       = EXCLUDED.featured_score,
      boost_score          = EXCLUDED.boost_score,
      composite_score      = EXCLUDED.composite_score,
      computed_at          = now()

    RETURNING listing_id::text
    `
  );

  return result.rowCount ?? 0;
}

// ── Lead 4-hour follow-up nudge (every 15 min) ───────────────────────────────
// Finds leads stuck in 'new' for >4h with no prior nudge event, queues a
// WhatsApp reminder to the owner via outbound_events, and records the nudge.
async function runLeadNudgeSweep(pool: Pool): Promise<number> {
  const leads = await pool.query<{
    lead_id: string;
    listing_title: string;
    owner_user_id: string;
    owner_phone: string;
    whatsapp_opt_in: boolean;
  }>(
    `
    SELECT
      ld.id::text          AS lead_id,
      COALESCE(NULLIF(l.title_en, ''), 'your listing') AS listing_title,
      ld.owner_user_id::text,
      u.phone              AS owner_phone,
      u.whatsapp_opt_in
    FROM leads ld
    JOIN users    u ON u.id  = ld.owner_user_id
    JOIN listings l ON l.id  = ld.listing_id
    WHERE ld.status = 'new'
      AND ld.created_at < now() - interval '4 hours'
      AND NOT EXISTS (
        SELECT 1 FROM lead_events le
        WHERE le.lead_id = ld.id
          AND le.notes = 'follow_up_nudge_sent'
      )
    LIMIT 50
    `
  );

  if (!leads.rowCount) return 0;

  const client = await pool.connect();
  let nudged = 0;
  try {
    for (const lead of leads.rows) {
      if (!lead.whatsapp_opt_in || !lead.owner_phone) continue;

      await client.query("BEGIN");

      // Queue WhatsApp notification via outbound_events dispatcher
      await client.query(
        `
        INSERT INTO outbound_events
          (event_type, aggregate_type, aggregate_id, payload, next_attempt_at)
        VALUES (
          'notification.whatsapp.lead_follow_up',
          'lead',
          $1::uuid,
          $2::jsonb,
          now()
        )
        `,
        [
          lead.lead_id,
          JSON.stringify({
            recipient_phone: lead.owner_phone,
            template_name: "lead_follow_up",
            language_code: "hi",
            body_params: [lead.listing_title]
          })
        ]
      );

      // Record nudge so we don't send again
      await client.query(
        `
        INSERT INTO lead_events (lead_id, notes)
        VALUES ($1::uuid, 'follow_up_nudge_sent')
        `,
        [lead.lead_id]
      );

      await client.query("COMMIT");
      nudged++;
    }
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }

  return nudged;
}

// ── Subscription renewal reminder (daily) ────────────────────────────────────
// Finds active subscriptions expiring within 3 days with auto_renew=true,
// queues a WhatsApp reminder to the owner.
async function runSubscriptionRenewalSweep(pool: Pool): Promise<number> {
  const subs = await pool.query<{
    subscription_id: string;
    owner_user_id: string;
    plan_label: string;
    expires_at: string;
    owner_phone: string;
    whatsapp_opt_in: boolean;
  }>(
    `
    SELECT
      os.id::text           AS subscription_id,
      os.owner_user_id::text,
      sp.label              AS plan_label,
      os.expires_at::text,
      u.phone               AS owner_phone,
      u.whatsapp_opt_in
    FROM owner_subscriptions os
    JOIN subscription_plans  sp ON sp.plan_id = os.plan_id
    JOIN users               u  ON u.id       = os.owner_user_id
    WHERE os.status     = 'active'
      AND os.auto_renew = true
      AND os.expires_at < now() + interval '3 days'
      AND NOT EXISTS (
        SELECT 1 FROM outbound_events oe
        WHERE oe.aggregate_type = 'subscription'
          AND oe.aggregate_id   = os.id
          AND oe.event_type     = 'notification.whatsapp.subscription_renewal_reminder'
          AND oe.created_at     > now() - interval '24 hours'
      )
    LIMIT 50
    `
  );

  if (!subs.rowCount) return 0;

  let queued = 0;
  for (const sub of subs.rows) {
    if (!sub.whatsapp_opt_in || !sub.owner_phone) continue;

    await pool.query(
      `
      INSERT INTO outbound_events
        (event_type, aggregate_type, aggregate_id, payload, next_attempt_at)
      VALUES (
        'notification.whatsapp.subscription_renewal_reminder',
        'subscription',
        $1::uuid,
        $2::jsonb,
        now()
      )
      `,
      [
        sub.subscription_id,
        JSON.stringify({
          recipient_phone: sub.owner_phone,
          template_name: "subscription_renewal_reminder",
          language_code: "hi",
          body_params: [sub.plan_label, sub.expires_at.slice(0, 10)]
        })
      ]
    );

    queued++;
  }

  return queued;
}

// ── Saved search alert sweep (daily) ─────────────────────────────────────────
// For each active saved search, finds new listings posted since last_alerted_at
// and queues a WhatsApp notification to the tenant if new matches exist.
async function runSavedSearchAlertSweep(pool: Pool): Promise<number> {
  // Fetch saved searches that haven't been alerted in the past 24h (or never)
  const searches = await pool.query<{
    id: string;
    user_id: string;
    city_slug: string;
    locality_id: number | null;
    bhk: number | null;
    max_rent: number | null;
    listing_type: string | null;
    last_alerted_at: string | null;
    user_phone: string;
    whatsapp_opt_in: boolean;
  }>(
    `
    SELECT
      ss.id::text,
      ss.user_id::text,
      ss.city_slug,
      ss.locality_id,
      ss.bhk,
      ss.max_rent,
      ss.listing_type::text,
      ss.last_alerted_at::text,
      u.phone   AS user_phone,
      u.whatsapp_opt_in
    FROM saved_searches ss
    JOIN users u ON u.id = ss.user_id
    WHERE ss.is_active = true
      AND (ss.last_alerted_at IS NULL OR ss.last_alerted_at < now() - interval '24 hours')
    LIMIT 100
    `
  );

  if (!searches.rowCount) return 0;

  let alerted = 0;
  for (const ss of searches.rows) {
    if (!ss.whatsapp_opt_in || !ss.user_phone) continue;

    // Count new matching listings since last alert
    const since = ss.last_alerted_at ?? new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    const matches = await pool.query<{ cnt: number }>(
      `
      SELECT count(*)::int AS cnt
      FROM listings l
      JOIN listing_locations ll ON ll.listing_id = l.id
      JOIN cities            c  ON c.id          = ll.city_id
      WHERE l.status     = 'active'
        AND l.created_at > $1::timestamptz
        AND c.slug       = $2
        AND ($3::int  IS NULL OR ll.locality_id = $3)
        AND ($4::int  IS NULL OR l.bhk          = $4)
        AND ($5::int  IS NULL OR l.monthly_rent <= $5)
        AND ($6::text IS NULL OR l.listing_type  = $6::listing_type)
      `,
      [since, ss.city_slug, ss.locality_id, ss.bhk, ss.max_rent, ss.listing_type]
    );

    const newCount = matches.rows[0]?.cnt ?? 0;
    if (newCount === 0) {
      // No new listings — still update last_alerted_at to avoid re-checking every run
      await pool.query(
        `UPDATE saved_searches SET last_alerted_at = now(), updated_at = now() WHERE id = $1::uuid`,
        [ss.id]
      );
      continue;
    }

    // Queue WhatsApp alert
    await pool.query(
      `
      INSERT INTO outbound_events
        (event_type, aggregate_type, aggregate_id, payload, next_attempt_at)
      VALUES (
        'notification.whatsapp.saved_search_alert',
        'saved_search',
        $1::uuid,
        $2::jsonb,
        now()
      )
      `,
      [
        ss.id,
        JSON.stringify({
          recipient_phone: ss.user_phone,
          template_name: "saved_search_alert",
          language_code: "hi",
          body_params: [String(newCount), ss.city_slug]
        })
      ]
    );

    await pool.query(
      `UPDATE saved_searches SET last_alerted_at = now(), updated_at = now() WHERE id = $1::uuid`,
      [ss.id]
    );

    alerted++;
  }

  return alerted;
}

async function run() {
  const databaseUrl = process.env.DATABASE_URL;
  const appState = !databaseUrl ? new AppStateService() : null;
  const pool = databaseUrl ? new Pool({ connectionString: databaseUrl }) : null;
  const crmWebhookUrl = process.env.CRM_WEBHOOK_URL?.trim() || undefined;

  // Initialize WhatsApp client for worker-based notification dispatch
  const whatsAppEnabled = process.env.FF_WHATSAPP_NOTIFICATIONS !== "false";
  const whatsAppClient = whatsAppEnabled ? new WhatsAppClient() : undefined;

  setInterval(async () => {
    try {
      const refundedCount = pool
        ? await runRefundSweepDb(pool)
        : (appState?.runRefundSweep().length ?? 0);
      console.log(
        JSON.stringify({
          job: "refund_due_unlocks",
          refunded_count: refundedCount,
          mode: pool ? "db" : "in_memory",
          timestamp: new Date().toISOString()
        })
      );
    } catch (error) {
      console.error(
        JSON.stringify({
          job: "refund_due_unlocks",
          error: error instanceof Error ? error.message : String(error),
          timestamp: new Date().toISOString()
        })
      );
    }
  }, REFUND_SWEEP_MS);

  setInterval(async () => {
    try {
      const result = pool
        ? await runOutboundDispatchDb(pool, crmWebhookUrl, whatsAppClient)
        : await runOutboundDispatchInMemory(appState!, crmWebhookUrl);
      console.log(
        JSON.stringify({
          job: "dispatch_outbound_events",
          dispatched_count: result.dispatchedCount,
          failed_count: result.failedCount,
          skipped: result.skipped,
          mode: pool ? "db" : "in_memory",
          timestamp: new Date().toISOString()
        })
      );
    } catch (error) {
      console.error(
        JSON.stringify({
          job: "dispatch_outbound_events",
          error: error instanceof Error ? error.message : String(error),
          timestamp: new Date().toISOString()
        })
      );
    }
  }, OUTBOUND_DISPATCH_MS);

  // ── Stale listing sweep (daily) ──
  if (pool) {
    const runStaleSweep = async () => {
      try {
        const result = await pool.query(
          `UPDATE listings
           SET status = 'paused', updated_at = now()
           WHERE status = 'active'
             AND last_owner_activity_at < now() - interval '30 days'
           RETURNING id::text`
        );
        const count = result.rowCount ?? 0;
        if (count > 0) {
          for (const row of result.rows) {
            await pool
              .query(
                `INSERT INTO fraud_flags (listing_id, flag_type, severity, details)
               VALUES ($1::uuid, 'stale', 'low', '{"reason":"no_activity_30d"}'::jsonb)`,
                [row.id]
              )
              .catch(() => {});
          }
        }
        console.log(
          JSON.stringify({
            job: "stale_listing_sweep",
            paused_count: count,
            timestamp: new Date().toISOString()
          })
        );
      } catch (error) {
        console.error(
          JSON.stringify({
            job: "stale_listing_sweep",
            error: error instanceof Error ? error.message : String(error),
            timestamp: new Date().toISOString()
          })
        );
      }
    };

    // Run once on startup, then daily
    runStaleSweep();
    setInterval(runStaleSweep, STALE_SWEEP_MS);

    // ── Broker detection sweep (weekly) ──
    const runBrokerSweep = async () => {
      try {
        const result = await pool.query<{
          owner_user_id: string;
          listing_count: number;
          listing_ids: string[];
        }>(
          `SELECT l.owner_user_id::text, count(*)::int AS listing_count, array_agg(l.id::text) AS listing_ids
           FROM listings l
           WHERE l.status IN ('active', 'pending_review')
           GROUP BY l.owner_user_id
           HAVING count(*) >= 3`
        );
        let flagged = 0;
        for (const row of result.rows) {
          const existing = await pool.query(
            `SELECT id FROM fraud_flags WHERE listing_id = ANY($1::uuid[]) AND flag_type = 'broker_detected' AND resolved_at IS NULL LIMIT 1`,
            [row.listing_ids]
          );
          if (!existing.rowCount) {
            await pool.query(
              `INSERT INTO fraud_flags (listing_id, flag_type, severity, details)
               VALUES ($1::uuid, 'broker_detected', 'high', $2::jsonb)`,
              [
                row.listing_ids[0],
                JSON.stringify({
                  reason: "multiple_listings",
                  owner_user_id: row.owner_user_id,
                  listing_count: row.listing_count
                })
              ]
            );
            flagged++;
          }
        }
        console.log(
          JSON.stringify({
            job: "broker_detection_sweep",
            flagged,
            timestamp: new Date().toISOString()
          })
        );
      } catch (error) {
        console.error(
          JSON.stringify({
            job: "broker_detection_sweep",
            error: error instanceof Error ? error.message : String(error),
            timestamp: new Date().toISOString()
          })
        );
      }
    };

    setInterval(runBrokerSweep, BROKER_SWEEP_MS);

    // ── Boost expiry sweep (every 5 min) ──
    setInterval(async () => {
      try {
        const result = await pool.query(
          `UPDATE listing_boosts SET is_active = false, updated_at = now()
           WHERE is_active = true AND expires_at <= now()`
        );
        const count = result.rowCount ?? 0;
        if (count > 0) {
          console.log(
            JSON.stringify({
              job: "boost_expiry_sweep",
              expired_count: count,
              timestamp: new Date().toISOString()
            })
          );
        }
      } catch (error) {
        console.error(
          JSON.stringify({
            job: "boost_expiry_sweep",
            error: error instanceof Error ? error.message : String(error),
            timestamp: new Date().toISOString()
          })
        );
      }
    }, BOOST_EXPIRY_MS);

    // ── Ranking recompute (every 6h) ──
    const runRanking = async () => {
      try {
        const count = await runRankingRecompute(pool);
        console.log(
          JSON.stringify({
            job: "ranking_recompute",
            updated_count: count,
            timestamp: new Date().toISOString()
          })
        );
      } catch (error) {
        console.error(
          JSON.stringify({
            job: "ranking_recompute",
            error: error instanceof Error ? error.message : String(error),
            timestamp: new Date().toISOString()
          })
        );
      }
    };
    runRanking(); // run once on startup to warm up scores
    setInterval(runRanking, RANKING_RECOMPUTE_MS);

    // ── Lead 4-hour follow-up nudge (every 15 min) ──
    setInterval(async () => {
      try {
        const count = await runLeadNudgeSweep(pool);
        if (count > 0) {
          console.log(
            JSON.stringify({
              job: "lead_nudge_sweep",
              nudged_count: count,
              timestamp: new Date().toISOString()
            })
          );
        }
      } catch (error) {
        console.error(
          JSON.stringify({
            job: "lead_nudge_sweep",
            error: error instanceof Error ? error.message : String(error),
            timestamp: new Date().toISOString()
          })
        );
      }
    }, LEAD_NUDGE_MS);

    // ── Subscription renewal reminder (daily) ──
    const runSubscriptionRenewal = async () => {
      try {
        const count = await runSubscriptionRenewalSweep(pool);
        if (count > 0) {
          console.log(
            JSON.stringify({
              job: "subscription_renewal_sweep",
              queued_count: count,
              timestamp: new Date().toISOString()
            })
          );
        }
      } catch (error) {
        console.error(
          JSON.stringify({
            job: "subscription_renewal_sweep",
            error: error instanceof Error ? error.message : String(error),
            timestamp: new Date().toISOString()
          })
        );
      }
    };
    setInterval(runSubscriptionRenewal, SUBSCRIPTION_RENEWAL_MS);

    // ── Saved search alert sweep (daily) ──
    const runSavedSearchAlerts = async () => {
      try {
        const count = await runSavedSearchAlertSweep(pool);
        if (count > 0) {
          console.log(
            JSON.stringify({
              job: "saved_search_alert_sweep",
              alerted_count: count,
              timestamp: new Date().toISOString()
            })
          );
        }
      } catch (error) {
        console.error(
          JSON.stringify({
            job: "saved_search_alert_sweep",
            error: error instanceof Error ? error.message : String(error),
            timestamp: new Date().toISOString()
          })
        );
      }
    };
    setInterval(runSavedSearchAlerts, SAVED_SEARCH_ALERT_MS);

    // ── Seeker pin cleanup (daily) ──
    const runSeekerPinCleanup = async () => {
      try {
        const result = await pool.query(
          `UPDATE seeker_pins SET is_active = false WHERE is_active = true AND expires_at < NOW()`
        );
        const count = result.rowCount ?? 0;
        if (count > 0) {
          console.log(
            JSON.stringify({
              job: "seeker_pin_cleanup",
              deactivated_count: count,
              timestamp: new Date().toISOString()
            })
          );
        }
      } catch (error) {
        console.error(
          JSON.stringify({
            job: "seeker_pin_cleanup",
            error: error instanceof Error ? error.message : String(error),
            timestamp: new Date().toISOString()
          })
        );
      }
    };
    setInterval(runSeekerPinCleanup, SEEKER_PIN_CLEANUP_MS);

    // ── Alert zone sweep (every 6 hours) ──
    const runAlertZoneSweep = async () => {
      try {
        const zones = await pool.query<{
          id: string;
          user_id: string;
          sw_lat: number;
          sw_lng: number;
          ne_lat: number;
          ne_lng: number;
          filters: Record<string, unknown>;
          label: string;
        }>(
          `SELECT az.id::text, az.user_id::text, az.sw_lat, az.sw_lng, az.ne_lat, az.ne_lng, az.filters, az.label
           FROM alert_zones az
           WHERE az.is_active = true
             AND (az.last_triggered IS NULL OR az.last_triggered < NOW() - INTERVAL '6 hours')`
        );

        let triggeredCount = 0;
        for (const zone of zones.rows) {
          const listings = await pool.query<{
            id: string;
            title: string;
            bhk: number;
            monthly_rent: number;
          }>(
            `SELECT l.id::text, COALESCE(NULLIF(l.title_en, ''), 'Listing') AS title, l.bhk, l.monthly_rent
             FROM listings l
             JOIN listing_locations ll ON ll.listing_id = l.id
             WHERE l.status = 'active'
               AND l.created_at >= NOW() - INTERVAL '6 hours'
               AND ll.lat IS NOT NULL
               AND ll.lat::float8 BETWEEN $1 AND $2
               AND ll.lng::float8 BETWEEN $3 AND $4
             LIMIT 5`,
            [zone.sw_lat, zone.ne_lat, zone.sw_lng, zone.ne_lng]
          );

          if ((listings.rowCount ?? 0) > 0) {
            const first = listings.rows[0];
            await pool.query(
              `INSERT INTO outbound_events (event_type, recipient_user_id, payload, status)
               VALUES ('notification.whatsapp.alert_zone_match', $1::uuid, $2::jsonb, 'pending')`,
              [
                zone.user_id,
                JSON.stringify({
                  listing_title: first.title,
                  bhk_text: first.bhk ? `${first.bhk}BHK` : "",
                  rent: `₹${first.monthly_rent?.toLocaleString("en-IN")}`,
                  zone_label: zone.label,
                  match_count: listings.rowCount
                })
              ]
            );

            await pool.query(`UPDATE alert_zones SET last_triggered = NOW() WHERE id = $1::uuid`, [
              zone.id
            ]);
            triggeredCount++;
          }
        }

        if (triggeredCount > 0) {
          console.log(
            JSON.stringify({
              job: "alert_zone_sweep",
              triggered_count: triggeredCount,
              timestamp: new Date().toISOString()
            })
          );
        }
      } catch (error) {
        console.error(
          JSON.stringify({
            job: "alert_zone_sweep",
            error: error instanceof Error ? error.message : String(error),
            timestamp: new Date().toISOString()
          })
        );
      }
    };
    setInterval(runAlertZoneSweep, ALERT_ZONE_SWEEP_MS);
  }

  console.log(
    JSON.stringify({
      worker: "started",
      jobs: [
        "refund_due_unlocks",
        "dispatch_outbound_events",
        "stale_listing_sweep",
        "broker_detection_sweep",
        "boost_expiry_sweep",
        "ranking_recompute",
        "lead_nudge_sweep",
        "subscription_renewal_sweep",
        "saved_search_alert_sweep",
        "seeker_pin_cleanup",
        "alert_zone_sweep"
      ],
      mode: pool ? "db" : "in_memory",
      whatsapp_enabled: whatsAppEnabled,
      whatsapp_provider: whatsAppEnabled ? (process.env.WHATSAPP_PROVIDER ?? "mock") : "disabled",
      interval_ms: {
        refund_due_unlocks: REFUND_SWEEP_MS,
        dispatch_outbound_events: OUTBOUND_DISPATCH_MS,
        ranking_recompute: RANKING_RECOMPUTE_MS,
        lead_nudge_sweep: LEAD_NUDGE_MS,
        subscription_renewal_sweep: SUBSCRIPTION_RENEWAL_MS,
        saved_search_alert_sweep: SAVED_SEARCH_ALERT_MS,
        seeker_pin_cleanup: SEEKER_PIN_CLEANUP_MS,
        alert_zone_sweep: ALERT_ZONE_SWEEP_MS
      }
    })
  );
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
