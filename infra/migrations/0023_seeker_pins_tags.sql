-- 0023_seeker_pins_tags.sql
-- Phase 3.6: structured tags extracted from the seeker's note via Azure OpenAI.
-- Lets owners filter / sort demand and unlocks future tag-based match scoring
-- against listing amenities. Fixed taxonomy enforced server-side (see
-- seeker-tags.service.ts ALLOWED_TAGS).

ALTER TABLE seeker_pins
  ADD COLUMN IF NOT EXISTS tags TEXT[] NOT NULL DEFAULT '{}';

CREATE INDEX IF NOT EXISTS idx_seeker_pins_tags ON seeker_pins USING GIN (tags);
