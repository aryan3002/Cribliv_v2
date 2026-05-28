-- 0022_seeker_pins_radius.sql
-- Phase 3.5: seeker pins represent search areas, not single points.
-- Adds an explicit radius (metres) so we can render the seeker's intent as
-- a circle on the map and match listings within range rather than at a
-- single coordinate.

ALTER TABLE seeker_pins
  ADD COLUMN IF NOT EXISTS radius_m INTEGER NOT NULL DEFAULT 1000
    CHECK (radius_m >= 100 AND radius_m <= 10000);
