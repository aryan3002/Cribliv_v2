-- Migration 0005: Security hardening, missing indexes, and updated_at triggers
-- This migration addresses findings from the technical audit.

-- ============================================================================
-- 1. Add client_ip column to otp_challenges for IP-based rate limiting
-- ============================================================================
ALTER TABLE otp_challenges
  ADD COLUMN IF NOT EXISTS client_ip inet;

-- ============================================================================
-- 2. Missing indexes identified in audit
-- ============================================================================

-- Owner dashboard queries by owner_user_id
CREATE INDEX IF NOT EXISTS idx_listings_owner_user_id
  ON listings (owner_user_id);

-- Wallet transaction lookups by reference_id
CREATE INDEX IF NOT EXISTS idx_wallet_transactions_reference_id
  ON wallet_transactions (reference_id);

-- Session lookups by user_id (logout, session list)
CREATE INDEX IF NOT EXISTS idx_sessions_user_id
  ON sessions (user_id);

-- Admin review queue — partial index on pending_review listings only
CREATE INDEX IF NOT EXISTS idx_listings_pending_review
  ON listings (created_at DESC)
  WHERE status = 'pending_review';

-- IP-based OTP rate limiting (complements existing idx_otp_ip_created)
CREATE INDEX IF NOT EXISTS idx_otp_challenges_client_ip_created
  ON otp_challenges (client_ip, created_at DESC)
  WHERE client_ip IS NOT NULL;

-- ============================================================================
-- 3. Auto-update updated_at trigger function
-- ============================================================================
CREATE OR REPLACE FUNCTION trigger_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply trigger to all tables with an updated_at column
DO $$
DECLARE
  tbl text;
BEGIN
  FOR tbl IN
    SELECT table_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND column_name = 'updated_at'
      AND table_name NOT LIKE 'pg_%'
  LOOP
    EXECUTE format(
      'DROP TRIGGER IF EXISTS set_updated_at ON %I; CREATE TRIGGER set_updated_at BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();',
      tbl, tbl
    );
  END LOOP;
END;
$$;
