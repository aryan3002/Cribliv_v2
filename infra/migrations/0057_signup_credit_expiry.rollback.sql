-- wallet_txn_type values cannot be removed safely and remain in place.
DROP INDEX IF EXISTS idx_wallets_signup_promo_expiry;

ALTER TABLE wallets
  DROP CONSTRAINT IF EXISTS wallets_promotional_credits_nonnegative,
  DROP COLUMN IF EXISTS promotional_credits_expires_at,
  DROP COLUMN IF EXISTS promotional_credits_remaining;
