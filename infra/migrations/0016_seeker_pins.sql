-- 0016_seeker_pins.sql
-- Phase 3: Seeker pins for CriblMap demand layer
-- Uses plain lat/lng FLOAT8 columns (no PostGIS dependency).

CREATE TABLE IF NOT EXISTS seeker_pins (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  lat            FLOAT8 NOT NULL,
  lng            FLOAT8 NOT NULL,
  city           TEXT NOT NULL DEFAULT 'delhi',
  budget_min     INTEGER DEFAULT 0,
  budget_max     INTEGER NOT NULL,
  bhk_preference SMALLINT[] DEFAULT '{}',
  move_in        TEXT DEFAULT 'flexible',
  listing_type   TEXT DEFAULT 'flat_house',
  note           TEXT,
  is_active      BOOLEAN NOT NULL DEFAULT true,
  expires_at     TIMESTAMPTZ NOT NULL DEFAULT (now() + INTERVAL '30 days'),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_seeker_pins_city         ON seeker_pins (city);
CREATE INDEX IF NOT EXISTS idx_seeker_pins_active       ON seeker_pins (is_active, expires_at);
CREATE INDEX IF NOT EXISTS idx_seeker_pins_user         ON seeker_pins (user_id);
CREATE INDEX IF NOT EXISTS idx_seeker_pins_lat_lng      ON seeker_pins (lat, lng);
