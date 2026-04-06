-- ╔══════════════════════════════════════════════════════════════════════════════╗
-- ║  Migration 0011: Featured Listings & Boost (Monetization)                  ║
-- ║  Phase 2A: listing_boosts table, boost_type enum, ranking score columns    ║
-- ╚══════════════════════════════════════════════════════════════════════════════╝

DO $$ BEGIN
  CREATE TYPE boost_type AS ENUM ('featured', 'boost');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

CREATE TABLE IF NOT EXISTS listing_boosts (
  id                UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id        UUID          NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
  owner_user_id     UUID          NOT NULL REFERENCES users(id),
  boost_type        boost_type    NOT NULL,
  payment_order_id  UUID          REFERENCES payment_orders(id),
  starts_at         TIMESTAMPTZ   NOT NULL DEFAULT now(),
  expires_at        TIMESTAMPTZ   NOT NULL,
  is_active         BOOLEAN       NOT NULL DEFAULT true,
  created_at        TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ   NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_listing_boosts_active
  ON listing_boosts (listing_id, is_active, expires_at DESC)
  WHERE is_active = true;

CREATE INDEX IF NOT EXISTS idx_listing_boosts_expires
  ON listing_boosts (expires_at)
  WHERE is_active = true;

-- Add featured/boost score columns to listing_scores
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'listing_scores' AND column_name = 'featured_score'
  ) THEN
    ALTER TABLE listing_scores ADD COLUMN featured_score REAL NOT NULL DEFAULT 0;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'listing_scores' AND column_name = 'boost_score'
  ) THEN
    ALTER TABLE listing_scores ADD COLUMN boost_score REAL NOT NULL DEFAULT 0;
  END IF;
END
$$;
