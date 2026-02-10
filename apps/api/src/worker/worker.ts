import "dotenv/config";
import { Pool } from "pg";
import { AppStateService } from "../common/app-state.service";

const REFUND_SWEEP_MS = 5 * 60 * 1000;
const REFUND_BATCH_SIZE = 100;
const OUTBOUND_DISPATCH_MS = 60 * 1000;
const OUTBOUND_BATCH_SIZE = 50;
const OUTBOUND_MAX_ATTEMPTS = 6;
const OUTBOUND_TIMEOUT_MS = 5_000;

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

async function runOutboundDispatchDb(pool: Pool, crmWebhookUrl: string | undefined) {
  if (!crmWebhookUrl) {
    return { dispatchedCount: 0, failedCount: 0, skipped: true };
  }

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
          await postOutboundEvent(crmWebhookUrl, event);

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

async function run() {
  const databaseUrl = process.env.DATABASE_URL;
  const appState = !databaseUrl ? new AppStateService() : null;
  const pool = databaseUrl ? new Pool({ connectionString: databaseUrl }) : null;
  const crmWebhookUrl = process.env.CRM_WEBHOOK_URL?.trim() || undefined;

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
        ? await runOutboundDispatchDb(pool, crmWebhookUrl)
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

  console.log(
    JSON.stringify({
      worker: "started",
      jobs: ["refund_due_unlocks", "dispatch_outbound_events"],
      mode: pool ? "db" : "in_memory",
      interval_ms: {
        refund_due_unlocks: REFUND_SWEEP_MS,
        dispatch_outbound_events: OUTBOUND_DISPATCH_MS
      }
    })
  );
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
