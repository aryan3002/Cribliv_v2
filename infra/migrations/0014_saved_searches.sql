-- ─── Migration 0014: Tenant Saved Search Alerts ──────────────────────────────
-- Stores tenant search preferences for new-listing / price-drop WhatsApp alerts.

CREATE TABLE IF NOT EXISTS saved_searches (
  id              uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  city_slug       text         NOT NULL,
  locality_id     int          REFERENCES localities(id) ON DELETE SET NULL,
  bhk             int,
  max_rent        int,
  listing_type    listing_type,
  last_alerted_at timestamptz,
  is_active       boolean      NOT NULL DEFAULT true,
  created_at      timestamptz  NOT NULL DEFAULT now(),
  updated_at      timestamptz  NOT NULL DEFAULT now(),
  UNIQUE (user_id, city_slug, locality_id, bhk, max_rent, listing_type)
);

CREATE INDEX IF NOT EXISTS idx_saved_searches_user
  ON saved_searches (user_id)
  WHERE is_active = true;

CREATE INDEX IF NOT EXISTS idx_saved_searches_alert_sweep
  ON saved_searches (last_alerted_at NULLS FIRST)
  WHERE is_active = true;
