import type { PoolClient } from "pg";

export type WalletBalanceErrorCode =
  | "invalid_credits"
  | "wallet_not_found"
  | "insufficient_credits"
  | "idempotency_conflict";

export class WalletBalanceError extends Error {
  constructor(
    readonly code: WalletBalanceErrorCode,
    message: string
  ) {
    super(message);
    this.name = "WalletBalanceError";
  }
}

type LockedWallet = {
  balanceCredits: number;
  promotionalCreditsRemaining: number;
  promotionalCreditsExpiresAt: string | null;
};

type ExistingWalletTransaction = {
  id: string;
  txn_type: string;
  credits_delta: number;
  reference_type: string | null;
  reference_id: string | null;
  metadata: Record<string, unknown> | null;
};

type DebitWalletInput = {
  userId: string;
  credits: number;
  txnType: "debit_contact_unlock" | "debit_lead_unlock" | "admin_adjustment";
  referenceType: "listing" | "lead" | "admin";
  referenceId: string;
  idempotencyKey?: string;
  metadata?: Record<string, unknown>;
};

type DebitWalletResult = {
  transactionId: string;
  inserted: boolean;
  balanceCredits: number;
  promotionalCreditsUsed: number;
};

async function lockWallet(client: PoolClient, userId: string): Promise<LockedWallet | null> {
  const result = await client.query<{
    balance_credits: number;
    promotional_credits_remaining: number;
    promotional_credits_expires_at: string | null;
  }>(
    `
    SELECT
      balance_credits,
      promotional_credits_remaining,
      promotional_credits_expires_at::text
    FROM wallets
    WHERE user_id = $1::uuid
    FOR UPDATE
    `,
    [userId]
  );
  const row = result.rows[0];
  if (!row) return null;

  return {
    balanceCredits: Number(row.balance_credits),
    promotionalCreditsRemaining: Number(row.promotional_credits_remaining),
    promotionalCreditsExpiresAt: row.promotional_credits_expires_at
  };
}

async function expireLockedSignupCredits(
  client: PoolClient,
  userId: string,
  wallet: LockedWallet
): Promise<number> {
  if (wallet.promotionalCreditsRemaining <= 0 || wallet.promotionalCreditsExpiresAt === null) {
    return 0;
  }

  const expiredCredits = wallet.promotionalCreditsRemaining;
  const result = await client.query<{
    balance_credits: number;
    promotional_credits_expires_at: string | null;
  }>(
    `
    UPDATE wallets
    SET balance_credits = balance_credits - promotional_credits_remaining,
        promotional_credits_remaining = 0,
        updated_at = now()
    WHERE user_id = $1::uuid
      AND promotional_credits_remaining > 0
      AND promotional_credits_expires_at <= now()
    RETURNING balance_credits, promotional_credits_expires_at::text
    `,
    [userId]
  );
  const expiredWallet = result.rows[0];
  if (!expiredWallet) return 0;

  const expiresAt =
    expiredWallet.promotional_credits_expires_at ?? wallet.promotionalCreditsExpiresAt;
  await client.query(
    `
    INSERT INTO wallet_transactions(
      wallet_user_id,
      txn_type,
      credits_delta,
      reference_type,
      reference_id,
      metadata
    )
    VALUES ($1::uuid, 'expire_signup', $2, 'user', $1::uuid, $3::jsonb)
    `,
    [
      userId,
      -expiredCredits,
      JSON.stringify({
        expired_credits: expiredCredits,
        expires_at: expiresAt
      })
    ]
  );

  wallet.balanceCredits = Number(expiredWallet.balance_credits);
  wallet.promotionalCreditsRemaining = 0;
  return expiredCredits;
}

async function findIdempotentTransaction(
  client: PoolClient,
  userId: string,
  idempotencyKey: string
): Promise<ExistingWalletTransaction | null> {
  const result = await client.query<ExistingWalletTransaction>(
    `
    SELECT
      id::text,
      txn_type::text,
      credits_delta,
      reference_type::text,
      reference_id::text,
      metadata
    FROM wallet_transactions
    WHERE wallet_user_id = $1::uuid
      AND idempotency_key = $2
    LIMIT 1
    `,
    [userId, idempotencyKey]
  );
  return result.rows[0] ?? null;
}

function promotionalCreditsUsed(metadata: Record<string, unknown> | null): number {
  const raw = metadata?.promotional_credits_used ?? metadata?.promotionalCreditsUsed;
  const parsed = Number(raw ?? 0);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : 0;
}

function exactReplay(transaction: ExistingWalletTransaction, input: DebitWalletInput): boolean {
  return (
    transaction.txn_type === input.txnType &&
    transaction.reference_type === input.referenceType &&
    transaction.reference_id === input.referenceId &&
    Number(transaction.credits_delta) === -input.credits
  );
}

function replayResult(
  transaction: ExistingWalletTransaction,
  wallet: LockedWallet
): DebitWalletResult {
  return {
    transactionId: transaction.id,
    inserted: false,
    balanceCredits: wallet.balanceCredits,
    promotionalCreditsUsed: promotionalCreditsUsed(transaction.metadata)
  };
}

function idempotencyConflict(): WalletBalanceError {
  return new WalletBalanceError(
    "idempotency_conflict",
    "Wallet idempotency key conflicts with a different transaction"
  );
}

export async function expireSignupCredits(client: PoolClient, userId: string): Promise<number> {
  const wallet = await lockWallet(client, userId);
  if (!wallet) return 0;
  return expireLockedSignupCredits(client, userId, wallet);
}

export async function debitWalletCredits(
  client: PoolClient,
  input: DebitWalletInput
): Promise<DebitWalletResult> {
  if (!Number.isInteger(input.credits) || input.credits <= 0) {
    throw new WalletBalanceError(
      "invalid_credits",
      "Wallet debit credits must be a positive integer"
    );
  }

  const wallet = await lockWallet(client, input.userId);
  if (!wallet) {
    throw new WalletBalanceError("wallet_not_found", "Wallet does not exist");
  }

  await expireLockedSignupCredits(client, input.userId, wallet);

  if (input.idempotencyKey) {
    const existing = await findIdempotentTransaction(client, input.userId, input.idempotencyKey);
    if (existing) {
      if (!exactReplay(existing, input)) throw idempotencyConflict();
      return replayResult(existing, wallet);
    }
  }

  if (wallet.balanceCredits < input.credits) {
    throw new WalletBalanceError("insufficient_credits", "Insufficient wallet credits");
  }

  const promotionalUsed = Math.min(wallet.promotionalCreditsRemaining, input.credits);
  const transaction = await client.query<{ id: string }>(
    `
    INSERT INTO wallet_transactions(
      wallet_user_id,
      txn_type,
      credits_delta,
      reference_type,
      reference_id,
      idempotency_key,
      metadata
    )
    VALUES (
      $1::uuid,
      $2::wallet_txn_type,
      $3,
      $4::wallet_ref_type,
      $5::uuid,
      $6,
      $7::jsonb
    )
    ON CONFLICT (wallet_user_id, idempotency_key) DO NOTHING
    RETURNING id::text
    `,
    [
      input.userId,
      input.txnType,
      -input.credits,
      input.referenceType,
      input.referenceId,
      input.idempotencyKey ?? null,
      JSON.stringify({
        ...input.metadata,
        promotional_credits_used: promotionalUsed
      })
    ]
  );

  const transactionId = transaction.rows[0]?.id;
  if (!transactionId) {
    if (!input.idempotencyKey) throw idempotencyConflict();
    const existing = await findIdempotentTransaction(client, input.userId, input.idempotencyKey);
    if (!existing || !exactReplay(existing, input)) throw idempotencyConflict();
    return replayResult(existing, wallet);
  }

  const updated = await client.query<{
    balance_credits: number;
    promotional_credits_remaining: number;
  }>(
    `
    UPDATE wallets
    SET balance_credits = balance_credits - $2,
        promotional_credits_remaining = promotional_credits_remaining - $3,
        updated_at = now()
    WHERE user_id = $1::uuid
      AND balance_credits >= $2
      AND promotional_credits_remaining >= $3
    RETURNING balance_credits, promotional_credits_remaining
    `,
    [input.userId, input.credits, promotionalUsed]
  );
  const updatedWallet = updated.rows[0];
  if (!updatedWallet) {
    throw new WalletBalanceError("insufficient_credits", "Insufficient wallet credits");
  }

  return {
    transactionId,
    inserted: true,
    balanceCredits: Number(updatedWallet.balance_credits),
    promotionalCreditsUsed: promotionalUsed
  };
}
