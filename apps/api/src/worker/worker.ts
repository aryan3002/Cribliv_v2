import "dotenv/config";
import { Pool } from "pg";
import { AppStateService } from "../common/app-state.service";

const REFUND_SWEEP_MS = 5 * 60 * 1000;
const REFUND_BATCH_SIZE = 100;

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

async function run() {
  const databaseUrl = process.env.DATABASE_URL;
  const appState = !databaseUrl ? new AppStateService() : null;
  const pool = databaseUrl ? new Pool({ connectionString: databaseUrl }) : null;

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

  console.log(
    JSON.stringify({
      worker: "started",
      jobs: ["refund_due_unlocks", "process_verification_attempt", "search_router_fallback_log"],
      mode: pool ? "db" : "in_memory",
      interval_ms: REFUND_SWEEP_MS
    })
  );
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
