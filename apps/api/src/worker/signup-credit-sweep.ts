import type { Pool } from "pg";
import { expireSignupCredits } from "../modules/wallet/wallet-balance";

const SIGNUP_CREDIT_EXPIRY_BATCH_SIZE = 100;

export async function runSignupCreditExpirySweepDb(pool: Pool): Promise<{
  walletsExpired: number;
  creditsExpired: number;
}> {
  const client = await pool.connect();
  let walletsExpired = 0;
  let creditsExpired = 0;
  let inTransaction = false;

  try {
    while (true) {
      await client.query("BEGIN");
      inTransaction = true;
      const dueWallets = await client.query<{ user_id: string }>(
        `
        SELECT user_id::text
        FROM wallets
        WHERE promotional_credits_remaining > 0
          AND promotional_credits_expires_at IS NOT NULL
          AND promotional_credits_expires_at <= now()
        ORDER BY promotional_credits_expires_at ASC
        FOR UPDATE SKIP LOCKED
        LIMIT $1
        `,
        [SIGNUP_CREDIT_EXPIRY_BATCH_SIZE]
      );

      if (!dueWallets.rowCount) {
        await client.query("COMMIT");
        inTransaction = false;
        break;
      }

      for (const wallet of dueWallets.rows) {
        const expired = await expireSignupCredits(client, wallet.user_id);
        if (expired > 0) {
          walletsExpired += 1;
          creditsExpired += expired;
        }
      }

      await client.query("COMMIT");
      inTransaction = false;
    }
  } catch (error) {
    if (inTransaction) {
      try {
        await client.query("ROLLBACK");
      } catch {
        // Preserve the failure that caused the transaction to abort.
      }
    }
    throw error;
  } finally {
    client.release();
  }

  return { walletsExpired, creditsExpired };
}
