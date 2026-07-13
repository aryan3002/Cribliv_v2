import type { PoolClient } from "pg";

export interface RefundUnlockOptions {
  /** Ledger attribution: 'refund_no_response' (worker sweep) | 'refund_admin' (admin manual). */
  txnType: "refund_no_response" | "refund_admin";
  /** contact_events actor_role for the refund_issued row. */
  actorRole: "system" | "admin";
  /** Expire a still-locked linked lead (spec §3.5). */
  expireLockedLead: boolean;
  metadata?: Record<string, unknown>;
}

export interface RefundUnlockResult {
  refunded: boolean;
  tenantUserId: string | null;
  refundTxnId: string | null;
}

/**
 * Refund one contact_unlock's credit to the tenant. The CALLER must already have
 * opened a transaction and locked the row (FOR UPDATE / FOR UPDATE SKIP LOCKED).
 *
 * The guarded status flip is the atomic claim: only the caller that flips the row
 * from ('pending','active') credits the wallet, so a second call on an
 * already-refunded unlock is a no-op returning refunded:false. Shared by the
 * worker timeout sweep and the admin manual refund so the two never diverge.
 */
export async function refundUnlock(
  client: PoolClient,
  unlockId: string,
  opts: RefundUnlockOptions
): Promise<RefundUnlockResult> {
  const meta = JSON.stringify(opts.metadata ?? {});

  // Atomic claim FIRST — no credit unless this flip wins.
  const claim = await client.query<{ tenant_user_id: string }>(
    `UPDATE contact_unlocks
     SET owner_response_status = 'timeout_refunded', unlock_status = 'refunded', updated_at = now()
     WHERE id = $1::uuid AND owner_response_status = 'pending' AND unlock_status = 'active'
     RETURNING tenant_user_id::text`,
    [unlockId]
  );
  if (!claim.rowCount) {
    return { refunded: false, tenantUserId: null, refundTxnId: null };
  }
  const tenantUserId = claim.rows[0].tenant_user_id;

  await client.query(
    `INSERT INTO wallets(user_id, balance_credits, free_credits_granted)
     VALUES ($1::uuid, 0, 0) ON CONFLICT (user_id) DO NOTHING`,
    [tenantUserId]
  );
  await client.query(
    `UPDATE wallets SET balance_credits = balance_credits + 1, updated_at = now()
     WHERE user_id = $1::uuid`,
    [tenantUserId]
  );
  const refundTxn = await client.query<{ id: string }>(
    `INSERT INTO wallet_transactions(
       wallet_user_id, txn_type, credits_delta, reference_type, reference_id, metadata)
     VALUES ($1::uuid, $2, 1, 'contact_unlock', $3::uuid, $4::jsonb)
     RETURNING id::text`,
    [tenantUserId, opts.txnType, unlockId, meta]
  );
  const refundTxnId = refundTxn.rows[0].id;

  await client.query(
    `UPDATE contact_unlocks SET refund_txn_id = $2::uuid, updated_at = now() WHERE id = $1::uuid`,
    [unlockId, refundTxnId]
  );
  await client.query(
    `INSERT INTO contact_events(contact_unlock_id, actor_role, event_type, metadata)
     VALUES ($1::uuid, $2, 'refund_issued', $3::jsonb)`,
    [unlockId, opts.actorRole, meta]
  );
  if (opts.expireLockedLead) {
    await client.query(
      `UPDATE leads SET access_state = 'expired', updated_at = now()
       WHERE contact_unlock_id = $1::uuid AND access_state = 'locked'`,
      [unlockId]
    );
  }
  return { refunded: true, tenantUserId, refundTxnId };
}
