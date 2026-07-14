import "dotenv/config";
import { Pool } from "pg";
import { AppStateService } from "../common/app-state.service";
import { WhatsAppClient } from "../modules/notifications/whatsapp.client";
import { SmsClient } from "../modules/notifications/sms.client";
import { NotificationService } from "../modules/notifications/notification.service";
import { PgScoreService } from "../modules/pg-operator/services/pg-score.service";
import type { DatabaseService } from "../common/database.service";
import { GoogleServiceAuth } from "../modules/seo/google/google-service-auth";
import { IndexingService } from "../modules/seo/indexing.service";
import { GscService } from "../modules/seo/gsc.service";
import { readFeatureFlags } from "../config/feature-flags";
import {
  blogFlagEnabled,
  runBlogEmbedSweep,
  runBlogGenerator,
  runBlogTopicPlanner
} from "./blog-worker";
import { runRefundSweepDb, runLeadReminderSweepDb } from "./callback-sweeps";
import { autoCloseResolvedMaintenance } from "./maintenance-sweeps";
import {
  emitSignupCreditExpiryTelemetry,
  runSignupCreditExpirySweepDb
} from "./signup-credit-sweep";

const REFUND_SWEEP_MS = 5 * 60 * 1000;
const SIGNUP_CREDIT_EXPIRY_SWEEP_MS = 60 * 60 * 1000;
const AUTO_CLOSE_SWEEP_MS = 60 * 60 * 1000;
const OUTBOUND_DISPATCH_MS = 60 * 1000;
const OUTBOUND_BATCH_SIZE = 50;
const OUTBOUND_MAX_ATTEMPTS = 6;
const OUTBOUND_TIMEOUT_MS = 5_000;
const STALE_SWEEP_MS = 24 * 60 * 60 * 1000; // daily
const PG_FRAUD_SWEEP_MS = 24 * 60 * 60 * 1000; // daily
const BROKER_SWEEP_MS = 7 * 24 * 60 * 60 * 1000; // weekly
const BOOST_EXPIRY_MS = 5 * 60 * 1000; // every 5 minutes
const RANKING_RECOMPUTE_MS = 6 * 60 * 60 * 1000; // every 6 hours
const LEAD_NUDGE_MS = 15 * 60 * 1000; // every 15 minutes
const SUBSCRIPTION_RENEWAL_MS = 24 * 60 * 60 * 1000; // daily
const SAVED_SEARCH_ALERT_MS = 24 * 60 * 60 * 1000; // daily
const SEEKER_PIN_CLEANUP_MS = 24 * 60 * 60 * 1000; // daily
const ALERT_ZONE_SWEEP_MS = 6 * 60 * 60 * 1000; // every 6 hours
const SEO_COPY_SWEEP_MS = 6 * 60 * 60 * 1000; // every 6 hours
const PG_TTL_SWEEP_MS = 24 * 60 * 60 * 1000; // daily — expire pg_voice_agent_sessions + uncommitted pg_listing_drafts
const PG_LEAD_AUTO_LOST_MS = 24 * 60 * 60 * 1000; // daily — auto-close unattended PG leads
const PG_LEAD_AUTO_LOST_DAYS = 30; // PG lead untouched this long → moved to 'lost'
const INDEXING_SUBMITTER_MS = 15 * 60 * 1000; // every 15 min
const GSC_POLLER_MS = 7 * 24 * 60 * 60 * 1000; // weekly
const BLOG_PLANNER_MS = 7 * 24 * 60 * 60 * 1000; // weekly
const BLOG_GENERATOR_MS = 24 * 60 * 60 * 1000; // daily
const BLOG_EMBED_SWEEP_MS = 5 * 60 * 1000; // every 5 minutes
const DEFAULT_GOOGLE_INDEXING_DAILY_QUOTA = 200;

// ── PG fraud sweep ──────────────────────────────────────────────────────────
// Runs priceAnomaly + contactReuse + scamText signals over PG listings
// active in the last 24h. Behind ff_pg_fraud_ai (env var).
async function runPgFraudSweep(pool: Pool): Promise<number> {
  const flagEnabled = ["1", "true", "yes"].includes(
    (process.env.FF_PG_FRAUD_AI ?? "").toLowerCase()
  );
  if (!flagEnabled) return 0;

  const SCAM_MARKERS = [
    "pay now",
    "advance required",
    "no visit",
    "no viewing",
    "100% guaranteed",
    "urgent deal",
    "limited time",
    "free gift",
    "pay via upi",
    "send money"
  ];

  const listings = await pool.query<{
    id: string;
    owner_user_id: string;
    description: string | null;
    city_slug: string;
  }>(
    `SELECT l.id::text, l.owner_user_id::text,
            COALESCE(l.description_en, '') AS description,
            c.slug AS city_slug
     FROM listings l
     JOIN listing_locations ll ON ll.listing_id = l.id
     JOIN cities c ON c.id = ll.city_id
     WHERE l.status = 'active' AND l.listing_type = 'pg'
       AND l.updated_at > now() - interval '24 hours'
     LIMIT 500`
  );

  let flagged = 0;
  for (const row of listings.rows) {
    // contactReuse: operator with 3+ active PG listings
    const countResult = await pool.query<{ count: number }>(
      `SELECT count(*)::int AS count FROM listings
       WHERE owner_user_id = $1::uuid AND status = 'active' AND listing_type = 'pg'`,
      [row.owner_user_id]
    );
    if ((countResult.rows[0]?.count ?? 0) >= 3) {
      await pool
        .query(
          `INSERT INTO fraud_flags (listing_id, flag_type, severity, details)
         VALUES ($1::uuid, 'contact_reuse', 'medium', $2::jsonb)
         ON CONFLICT DO NOTHING`,
          [
            row.id,
            JSON.stringify({
              listing_count: countResult.rows[0]?.count,
              operator_user_id: row.owner_user_id
            })
          ]
        )
        .catch(() => {});
      flagged++;
    }

    // scamText: keyword heuristic
    if (row.description) {
      const text = row.description.toLowerCase();
      const hits = SCAM_MARKERS.filter((m) => text.includes(m));
      const score = hits.length / SCAM_MARKERS.length;
      if (score >= 0.25) {
        await pool
          .query(
            `INSERT INTO fraud_flags (listing_id, flag_type, severity, details)
           VALUES ($1::uuid, 'suspicious_text', $2, $3::jsonb)
           ON CONFLICT DO NOTHING`,
            [row.id, score > 0.5 ? "high" : "medium", JSON.stringify({ score, hits })]
          )
          .catch(() => {});
        flagged++;
      }
    }

    // priceAnomaly: z-score per sharing
    const priceRows = await pool.query<{
      sharing: string;
      avg: number;
      stddev: number;
      rent: number;
    }>(
      `SELECT rt.sharing,
              avg(rt2.monthly_rent_paise)::float AS avg,
              stddev_pop(rt2.monthly_rent_paise)::float AS stddev,
              rt.monthly_rent_paise AS rent
       FROM pg_room_types rt
       JOIN pg_room_types rt2 ON rt2.sharing = rt.sharing
       JOIN listings l2 ON l2.id = rt2.listing_id
       JOIN listing_locations ll2 ON ll2.listing_id = l2.id
       JOIN cities c2 ON c2.id = ll2.city_id
       WHERE rt.listing_id = $1::uuid
         AND l2.status = 'active'
         AND c2.slug = $2
       GROUP BY rt.sharing, rt.monthly_rent_paise`,
      [row.id, row.city_slug]
    );
    for (const pr of priceRows.rows) {
      if (pr.stddev && pr.stddev > 0) {
        const z = Math.abs((pr.rent - pr.avg) / pr.stddev);
        if (z > 3) {
          await pool
            .query(
              `INSERT INTO fraud_flags (listing_id, flag_type, severity, details)
             VALUES ($1::uuid, 'price_anomaly', $2, $3::jsonb)
             ON CONFLICT DO NOTHING`,
              [
                row.id,
                z > 5 ? "high" : "medium",
                JSON.stringify({ z_score: z, sharing: pr.sharing, rent_paise: pr.rent })
              ]
            )
            .catch(() => {});
          flagged++;
        }
      }
    }
  }
  return flagged;
}

/**
 * Daily cleanup of expired PG voice agent state.
 * - pg_voice_agent_sessions past ttl (default 7d) -> hard delete
 * - pg_listing_drafts past ttl (default 30d) WITH no committed_listing_id -> hard delete
 *   Committed drafts stay as audit trail.
 */
async function runPgTtlSweep(pool: Pool): Promise<{ sessions: number; drafts: number }> {
  const s = await pool.query(
    `DELETE FROM pg_voice_agent_sessions WHERE ttl_expires_at < now() RETURNING id`
  );
  const d = await pool.query(
    `DELETE FROM pg_listing_drafts
      WHERE ttl_expires_at < now() AND committed_listing_id IS NULL
      RETURNING id`
  );
  return { sessions: s.rowCount ?? 0, drafts: d.rowCount ?? 0 };
}

/**
 * Auto-close unattended PG leads. Any PG lead (lead on a listing_type='pg'
 * listing) sitting in an open status (new / contacted / visit_scheduled) with no
 * activity for PG_LEAD_AUTO_LOST_DAYS is moved to 'lost', with a system
 * lead_events row (actor_user_id NULL, notes 'auto_lost_unattended'). Pure status
 * transition — PG contact is free for tenants, so there is no refund side effect.
 * Single CTE so the UPDATE + event insert see one snapshot.
 */
async function runPgLeadAutoLostSweep(pool: Pool): Promise<number> {
  const res = await pool.query(
    `
    WITH cand AS (
      SELECT ld.id, ld.status AS from_status
      FROM leads ld
      JOIN listings l ON l.id = ld.listing_id
      WHERE l.listing_type = 'pg'
        AND ld.status IN ('new', 'contacted', 'visit_scheduled')
        AND COALESCE(ld.status_changed_at, ld.created_at) < now() - ($1 || ' days')::interval
      LIMIT 1000
    ),
    upd AS (
      UPDATE leads
         SET status = 'lost', status_changed_at = now(), updated_at = now()
       WHERE id IN (SELECT id FROM cand)
      RETURNING id
    )
    INSERT INTO lead_events (lead_id, from_status, to_status, actor_user_id, notes)
    SELECT id, from_status, 'lost'::lead_status, NULL, 'auto_lost_unattended'
    FROM cand
    `,
    [PG_LEAD_AUTO_LOST_DAYS]
  );
  return res.rowCount ?? 0;
}

async function runSeoCopySweep(pool: Pool): Promise<number> {
  // Drop expired/stale AI copy. The on-demand renderer will regenerate it
  // the next time anyone hits the page — no need to pre-warm here, since
  // most programmatic URLs only get a few hits per month.
  const { rowCount } = await pool.query(`DELETE FROM seo_page_copy WHERE expires_at < now()`);
  return rowCount ?? 0;
}

export async function runIndexingSubmitterJob(
  pool: Pool
): Promise<{ submitted: number; failed: number; skippedQuota: number }> {
  try {
    if (!readFeatureFlags().ff_seo_indexing) {
      return { submitted: 0, failed: 0, skippedQuota: 0 };
    }

    const adapter = {
      isEnabled: () => true,
      query: (text: string, params?: unknown[]) => pool.query(text, params)
    } as unknown as DatabaseService;
    const auth = new GoogleServiceAuth();
    const service = new IndexingService(adapter, auth);

    const quota =
      Number(process.env.GOOGLE_INDEXING_DAILY_QUOTA) || DEFAULT_GOOGLE_INDEXING_DAILY_QUOTA;
    const submittedToday = await service.submittedCountToday();
    return await service.drainPending(quota, submittedToday);
  } catch (error) {
    console.error(
      JSON.stringify({
        job: "indexing_submitter",
        error: error instanceof Error ? error.message : String(error),
        timestamp: new Date().toISOString()
      })
    );
    return { submitted: 0, failed: 0, skippedQuota: 0 };
  }
}

export async function runGscPollerJob(
  pool: Pool
): Promise<{ rowsUpserted: number; pagesRead: number }> {
  try {
    if (!readFeatureFlags().ff_seo_gsc) {
      return { rowsUpserted: 0, pagesRead: 0 };
    }

    const adapter = {
      isEnabled: () => true,
      query: (text: string, params?: unknown[]) => pool.query(text, params)
    } as unknown as DatabaseService;
    const auth = new GoogleServiceAuth();
    const service = new GscService(adapter, auth);
    return await service.pollAndUpsert();
  } catch (error) {
    console.error(
      JSON.stringify({
        job: "gsc_poller",
        error: error instanceof Error ? error.message : String(error),
        timestamp: new Date().toISOString()
      })
    );
    return { rowsUpserted: 0, pagesRead: 0 };
  }
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

/**
 * Send an SMS notification event using the D7 SMS API.
 * Called by the worker for queued notification events (mode: "queued").
 * Mirrors dispatchWhatsAppEvent, but reads the sms_body/recipient_phone
 * fields written by NotificationService.enqueueSmsEvent.
 */
async function dispatchSmsEvent(
  smsClient: SmsClient,
  event: {
    id: number;
    event_type: string;
    payload: Record<string, unknown>;
  }
) {
  const payload = event.payload;
  const phone = payload.recipient_phone as string;
  const body = payload.sms_body as string;

  if (!phone || !body) {
    throw new Error(`SMS event ${event.id} missing recipient_phone or sms_body`);
  }

  const result = await smsClient.sendSms({ to: phone, body });

  if (!result.success) {
    throw new Error(result.error ?? "SMS send failed");
  }

  console.log(
    JSON.stringify({
      job: "dispatch_sms",
      event_id: event.id,
      event_type: event.event_type,
      message_id: result.messageId,
      status: "sent",
      timestamp: new Date().toISOString()
    })
  );
}

export async function runOutboundDispatchDb(
  pool: Pool,
  crmWebhookUrl: string | undefined,
  whatsAppClient?: WhatsAppClient,
  smsClient?: SmsClient
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
          AND event_type <> 'seo.embed_blog'
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
          const isSms = event.event_type.startsWith("notification.sms.");

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
          } else if (isSms && smsClient) {
            // Dispatch via D7 SMS API
            await dispatchSmsEvent(smsClient, event);
          } else if (isSms && !smsClient) {
            // No SMS client configured – auto-mark as dispatched in dev
            console.log(
              JSON.stringify({
                job: "dispatch_sms",
                event_id: event.id,
                event_type: event.event_type,
                status: "skipped_no_client",
                timestamp: new Date().toISOString()
              })
            );
          } else if (event.event_type === "seo.queue_indexing") {
            // Audit marker only. The seo_indexing_queue write happens
            // synchronously in AdminController.listingDecision (via
            // IndexingService.enqueue) at approval time; nothing to dispatch
            // here — just fall through and mark the event dispatched.
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
      FROM shortlists
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

    -- PG listings are scored by the PG-specific formula (see runPgScoreRecompute);
    -- the generic flat/house formula here keys completeness on bhk/area_sqft
    -- (NULL for PG) and would clobber the PG score. Exclude them.
    WHERE l.status = 'active' AND l.listing_type <> 'pg'

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

// ── PG ranking recompute (every 6h) ──────────────────────────────────────────
// PG listings are EXCLUDED from runRankingRecompute (generic flat/house formula
// keyed on bhk/area_sqft). Here we re-score every active PG with the SHARED PG
// formula via PgScoreService.rescoreListing → computePgListingScore, reading
// real photo/verification/geo from the DB. Same code path as create/submit, so
// no formula duplication / drift. Also backfills PGs that have no score row yet.
async function runPgScoreRecompute(pool: Pool): Promise<number> {
  const adapter = {
    isEnabled: () => true,
    query: (text: string, params?: unknown[]) => pool.query(text, params)
  } as unknown as DatabaseService;
  const scorer = new PgScoreService(adapter);

  // PERF-H5: keyset-paged set read + set UPSERT inside the service, instead of
  // a per-listing (1 SELECT + 1 UPSERT) loop with no LIMIT.
  return scorer.recomputeActiveScores();
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
  // Initialize SMS client for worker-based notification dispatch (mock provider by default)
  const smsClient = new SmsClient();

  if (pool) {
    const maintenanceDb = {
      isEnabled: () => true,
      getClient: () => pool.connect(),
      query: (text: string, params?: unknown[]) => pool.query(text, params)
    } as DatabaseService;

    setInterval(async () => {
      try {
        const result = await runSignupCreditExpirySweepDb(pool);
        emitSignupCreditExpiryTelemetry(result);
        console.log(
          JSON.stringify({
            job: "signup_credit_expiry_sweep",
            wallets_expired: result.walletsExpired,
            credits_expired: result.creditsExpired,
            timestamp: new Date().toISOString()
          })
        );
      } catch (error) {
        console.error(
          JSON.stringify({
            job: "signup_credit_expiry_sweep",
            error: error instanceof Error ? error.message : String(error),
            timestamp: new Date().toISOString()
          })
        );
      }
    }, SIGNUP_CREDIT_EXPIRY_SWEEP_MS);

    setInterval(async () => {
      try {
        const closedCount = await autoCloseResolvedMaintenance(maintenanceDb);
        if (closedCount > 0) {
          console.log(
            JSON.stringify({
              job: "maintenance_auto_close_sweep",
              closed_count: closedCount,
              timestamp: new Date().toISOString()
            })
          );
        }
      } catch (error) {
        console.error(
          JSON.stringify({
            job: "maintenance_auto_close_sweep",
            error: error instanceof Error ? error.message : String(error),
            timestamp: new Date().toISOString()
          })
        );
      }
    }, AUTO_CLOSE_SWEEP_MS);
  }

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

  const LEAD_REMINDER_SWEEP_MS = 10 * 60 * 1000;
  if (pool) {
    setInterval(async () => {
      try {
        const remindedCount = await runLeadReminderSweepDb(pool);
        console.log(
          JSON.stringify({
            job: "lead_expiry_reminders",
            reminded_count: remindedCount,
            timestamp: new Date().toISOString()
          })
        );
      } catch (error) {
        console.error(
          JSON.stringify({
            job: "lead_expiry_reminders",
            error: error instanceof Error ? error.message : String(error),
            timestamp: new Date().toISOString()
          })
        );
      }
    }, LEAD_REMINDER_SWEEP_MS);
  }

  setInterval(async () => {
    try {
      const result = pool
        ? await runOutboundDispatchDb(pool, crmWebhookUrl, whatsAppClient, smsClient)
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

    // ── PG ranking recompute (every 6h) — PG-specific formula, also backfills ──
    const runPgScore = async () => {
      try {
        const count = await runPgScoreRecompute(pool);
        console.log(
          JSON.stringify({
            job: "pg_score_recompute",
            updated_count: count,
            timestamp: new Date().toISOString()
          })
        );
      } catch (error) {
        console.error(
          JSON.stringify({
            job: "pg_score_recompute",
            error: error instanceof Error ? error.message : String(error),
            timestamp: new Date().toISOString()
          })
        );
      }
    };
    runPgScore(); // warm up + backfill PG scores on startup
    setInterval(runPgScore, RANKING_RECOMPUTE_MS);

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

    // ── PG TTL sweep (daily) — voice sessions + uncommitted drafts ──
    const runPgTtl = async () => {
      try {
        const counts = await runPgTtlSweep(pool);
        if (counts.sessions > 0 || counts.drafts > 0) {
          console.log(
            JSON.stringify({
              job: "pg_ttl_sweep",
              expired_sessions: counts.sessions,
              expired_drafts: counts.drafts,
              timestamp: new Date().toISOString()
            })
          );
        }
      } catch (err) {
        console.error(
          JSON.stringify({
            job: "pg_ttl_sweep",
            error: err instanceof Error ? err.message : String(err),
            timestamp: new Date().toISOString()
          })
        );
      }
    };
    setInterval(runPgTtl, PG_TTL_SWEEP_MS);
    // Run once at boot too:
    void runPgTtl();

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

    // SEO copy expiry sweep — best-effort, swallows errors (table may not
    // yet exist in pre-migration environments).
    const runSeo = async () => {
      try {
        const cleared = await runSeoCopySweep(pool);
        if (cleared > 0) {
          console.log(
            JSON.stringify({
              job: "seo_copy_sweep",
              expired_rows_cleared: cleared,
              timestamp: new Date().toISOString()
            })
          );
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        // Suppress "relation does not exist" — happens before migration 0026.
        if (!/relation .* does not exist/i.test(message)) {
          console.error(
            JSON.stringify({
              job: "seo_copy_sweep",
              error: message,
              timestamp: new Date().toISOString()
            })
          );
        }
      }
    };
    setInterval(runSeo, SEO_COPY_SWEEP_MS);

    // ── PG fraud sweep (daily, gated by FF_PG_FRAUD_AI) ──
    const runPgFraud = async () => {
      try {
        const count = await runPgFraudSweep(pool);
        if (count > 0) {
          console.log(
            JSON.stringify({
              job: "pg_fraud_sweep",
              flagged: count,
              timestamp: new Date().toISOString()
            })
          );
        }
      } catch (err) {
        console.error(
          JSON.stringify({
            job: "pg_fraud_sweep",
            error: err instanceof Error ? err.message : String(err),
            timestamp: new Date().toISOString()
          })
        );
      }
    };
    setInterval(runPgFraud, PG_FRAUD_SWEEP_MS);

    // ── PG lead auto-lost sweep (daily) — close leads unattended for 30 days ──
    const runPgLeadAutoLost = async () => {
      try {
        const count = await runPgLeadAutoLostSweep(pool);
        if (count > 0) {
          console.log(
            JSON.stringify({
              job: "pg_lead_auto_lost_sweep",
              closed_count: count,
              unattended_days: PG_LEAD_AUTO_LOST_DAYS,
              timestamp: new Date().toISOString()
            })
          );
        }
      } catch (err) {
        console.error(
          JSON.stringify({
            job: "pg_lead_auto_lost_sweep",
            error: err instanceof Error ? err.message : String(err),
            timestamp: new Date().toISOString()
          })
        );
      }
    };
    setInterval(runPgLeadAutoLost, PG_LEAD_AUTO_LOST_MS);
    // Run once at boot too:
    void runPgLeadAutoLost();

    // ── Indexing API submitter (every 15 min, gated by FF_SEO_INDEXING) ──
    const runIndexingSubmitter = async () => {
      try {
        const result = await runIndexingSubmitterJob(pool);
        if (result.submitted > 0 || result.failed > 0 || result.skippedQuota > 0) {
          console.log(
            JSON.stringify({
              job: "indexing_submitter",
              submitted_count: result.submitted,
              failed_count: result.failed,
              skipped_quota_count: result.skippedQuota,
              timestamp: new Date().toISOString()
            })
          );
        }
      } catch (error) {
        console.error(
          JSON.stringify({
            job: "indexing_submitter",
            error: error instanceof Error ? error.message : String(error),
            timestamp: new Date().toISOString()
          })
        );
      }
    };
    setInterval(runIndexingSubmitter, INDEXING_SUBMITTER_MS);
    void runIndexingSubmitter();

    // ── GSC poller (weekly, gated by FF_SEO_GSC) ──
    const runGscPoller = async () => {
      try {
        const result = await runGscPollerJob(pool);
        if (result.rowsUpserted > 0 || result.pagesRead > 0) {
          console.log(
            JSON.stringify({
              job: "gsc_poller",
              rows_upserted: result.rowsUpserted,
              pages_read: result.pagesRead,
              timestamp: new Date().toISOString()
            })
          );
        }
      } catch (error) {
        console.error(
          JSON.stringify({
            job: "gsc_poller",
            error: error instanceof Error ? error.message : String(error),
            timestamp: new Date().toISOString()
          })
        );
      }
    };
    setInterval(runGscPoller, GSC_POLLER_MS);
    void runGscPoller();

    // ── Blog topic planner (weekly, gated by FF_SEO_BLOG) ──
    const runBlogPlanner = async () => {
      if (!blogFlagEnabled()) return;
      try {
        const result = await runBlogTopicPlanner(pool);
        if (result.created > 0) {
          console.log(
            JSON.stringify({
              job: "blog_topic_planner",
              created: result.created,
              timestamp: new Date().toISOString()
            })
          );
        }
      } catch (error) {
        console.error(
          JSON.stringify({
            job: "blog_topic_planner",
            error: error instanceof Error ? error.message : String(error),
            timestamp: new Date().toISOString()
          })
        );
      }
    };
    setInterval(runBlogPlanner, BLOG_PLANNER_MS);

    // ── Blog generator (daily, gated by FF_SEO_BLOG). Writes drafts only. ──
    const runBlogGen = async () => {
      if (!blogFlagEnabled()) return;
      try {
        const result = await runBlogGenerator(pool, 3);
        if (result.drafted > 0 || result.needsAttention > 0) {
          console.log(
            JSON.stringify({
              job: "blog_generator",
              drafted: result.drafted,
              needs_attention: result.needsAttention,
              timestamp: new Date().toISOString()
            })
          );
        }
      } catch (error) {
        console.error(
          JSON.stringify({
            job: "blog_generator",
            error: error instanceof Error ? error.message : String(error),
            timestamp: new Date().toISOString()
          })
        );
      }
    };
    setInterval(runBlogGen, BLOG_GENERATOR_MS);

    // ── Blog embed sweep (every 5 min, gated) ──
    const runBlogEmbed = async () => {
      if (!blogFlagEnabled()) return;
      try {
        const result = await runBlogEmbedSweep(pool, 25);
        if (result.embedded > 0) {
          console.log(
            JSON.stringify({
              job: "blog_embed_sweep",
              embedded: result.embedded,
              timestamp: new Date().toISOString()
            })
          );
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (!/relation .* does not exist/i.test(message)) {
          console.error(
            JSON.stringify({
              job: "blog_embed_sweep",
              error: message,
              timestamp: new Date().toISOString()
            })
          );
        }
      }
    };
    setInterval(runBlogEmbed, BLOG_EMBED_SWEEP_MS);
  }

  console.log(
    JSON.stringify({
      worker: "started",
      jobs: [
        "refund_due_unlocks",
        ...(pool ? ["signup_credit_expiry_sweep"] : []),
        "dispatch_outbound_events",
        "stale_listing_sweep",
        "broker_detection_sweep",
        "maintenance_auto_close_sweep",
        "boost_expiry_sweep",
        "ranking_recompute",
        "lead_nudge_sweep",
        "subscription_renewal_sweep",
        "saved_search_alert_sweep",
        "seeker_pin_cleanup",
        "alert_zone_sweep",
        "seo_copy_sweep",
        "pg_fraud_sweep",
        "pg_lead_auto_lost_sweep",
        "indexing_submitter",
        "gsc_poller",
        "blog_topic_planner",
        "blog_generator",
        "blog_embed_sweep"
      ],
      mode: pool ? "db" : "in_memory",
      whatsapp_enabled: whatsAppEnabled,
      whatsapp_provider: whatsAppEnabled ? (process.env.WHATSAPP_PROVIDER ?? "mock") : "disabled",
      interval_ms: {
        refund_due_unlocks: REFUND_SWEEP_MS,
        ...(pool ? { signup_credit_expiry_sweep: SIGNUP_CREDIT_EXPIRY_SWEEP_MS } : {}),
        ...(pool ? { maintenance_auto_close_sweep: AUTO_CLOSE_SWEEP_MS } : {}),
        dispatch_outbound_events: OUTBOUND_DISPATCH_MS,
        ranking_recompute: RANKING_RECOMPUTE_MS,
        lead_nudge_sweep: LEAD_NUDGE_MS,
        subscription_renewal_sweep: SUBSCRIPTION_RENEWAL_MS,
        saved_search_alert_sweep: SAVED_SEARCH_ALERT_MS,
        seeker_pin_cleanup: SEEKER_PIN_CLEANUP_MS,
        alert_zone_sweep: ALERT_ZONE_SWEEP_MS,
        indexing_submitter: INDEXING_SUBMITTER_MS,
        gsc_poller: GSC_POLLER_MS,
        blog_topic_planner: BLOG_PLANNER_MS,
        blog_generator: BLOG_GENERATOR_MS,
        blog_embed_sweep: BLOG_EMBED_SWEEP_MS
      }
    })
  );
}

if (require.main === module) {
  run().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
