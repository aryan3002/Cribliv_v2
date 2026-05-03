-- 0018_users_last_login_at
-- Adds last_login_at to users so the admin dashboard can compute owner
-- "freshness" (recency) as part of the Owner Health Score, and surface
-- inactive-owner signals in the Fraud Intelligence Feed.
--
-- Backfill strategy: leave NULL for users who haven't logged in since the
-- column was added; the Owner Health calculator treats NULL as "never seen
-- recently" → max-decay on the freshness component, which is the right
-- behavior. Once the next OTP verify fires we'll start populating it.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS last_login_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_users_last_login_at ON users(last_login_at);
