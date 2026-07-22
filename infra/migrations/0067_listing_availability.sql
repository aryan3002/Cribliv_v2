-- 0067: Unavailable listings + notify-when-available waitlist (flats/houses).
-- Availability is independent of listing_status. Unavailable = status='active' AND is_available=false.

ALTER TABLE listings
  ADD COLUMN IF NOT EXISTS is_available boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS became_unavailable_at timestamptz,
  ADD COLUMN IF NOT EXISTS availability_source text; -- 'owner' | 'admin' | null

CREATE INDEX IF NOT EXISTS idx_listings_is_available_active
  ON listings (is_available)
  WHERE status = 'active';

CREATE TABLE IF NOT EXISTS listing_availability_alerts (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id   uuid NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
  user_id      uuid,
  phone        text NOT NULL,
  locale       text,
  status       text NOT NULL DEFAULT 'waiting'
               CHECK (status IN ('waiting','ready','notified','cancelled')),
  created_at   timestamptz NOT NULL DEFAULT now(),
  ready_at     timestamptz,
  notified_at  timestamptz,
  UNIQUE (listing_id, phone)
);
CREATE INDEX IF NOT EXISTS idx_avail_alerts_listing ON listing_availability_alerts (listing_id);
CREATE INDEX IF NOT EXISTS idx_avail_alerts_status  ON listing_availability_alerts (status);

-- New admin audit action. This migration runner (run-migrations.js) wraps each
-- file in its own BEGIN/COMMIT, and ALTER TYPE ... ADD VALUE works fine inside
-- that transaction on PG12+ as long as the new value isn't USED in the same
-- transaction (it isn't — nothing in this file inserts 'availability_change').
ALTER TYPE admin_action_type ADD VALUE IF NOT EXISTS 'availability_change';
