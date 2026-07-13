ALTER TYPE wallet_txn_type ADD VALUE IF NOT EXISTS 'expire_signup';

ALTER TABLE wallets
  ADD COLUMN IF NOT EXISTS promotional_credits_remaining int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS promotional_credits_expires_at timestamptz;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'wallets_promotional_credits_nonnegative'
  ) THEN
    ALTER TABLE wallets
      ADD CONSTRAINT wallets_promotional_credits_nonnegative
      CHECK (promotional_credits_remaining >= 0);
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS idx_wallets_signup_promo_expiry
  ON wallets(promotional_credits_expires_at)
  WHERE promotional_credits_remaining > 0
    AND promotional_credits_expires_at IS NOT NULL;
