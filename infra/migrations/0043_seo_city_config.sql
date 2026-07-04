-- Migration 0043: SEO city config (programmatic-SEO enablement).
-- Single source of truth for "which cities have programmatic SEO pages live".
-- Consumed by the 6 route templates (via GET /v1/seo/cities) and the sitemap.
-- One row per city; city_slug FKs cities(slug) so a city must exist first.
-- Counts are DENORMALIZED snapshots refreshed by the admin PATCH path, not the
-- hot page path. indexable_count = places with listing_count >= 3. Seed rows
-- (lucknow enabled, noida disabled) are upserted in data/seeds/seed.ts, not here.

CREATE TABLE IF NOT EXISTS seo_city_config (
  city_slug            text PRIMARY KEY REFERENCES cities(slug) ON DELETE CASCADE,
  programmatic_enabled boolean NOT NULL DEFAULT false,
  locality_count       int NOT NULL DEFAULT 0,
  landmark_count       int NOT NULL DEFAULT 0,
  metro_count          int NOT NULL DEFAULT 0,
  indexable_count      int NOT NULL DEFAULT 0,
  enabled_at           timestamptz,
  notes                text,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_seo_city_config_enabled
  ON seo_city_config (programmatic_enabled)
  WHERE programmatic_enabled = true;

CREATE OR REPLACE FUNCTION seo_city_config_touch_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_seo_city_config_touch ON seo_city_config;
CREATE TRIGGER trg_seo_city_config_touch
  BEFORE UPDATE ON seo_city_config
  FOR EACH ROW EXECUTE FUNCTION seo_city_config_touch_updated_at();

-- Admin audit vocabulary for the city toggle. ADD VALUE (not used in this same
-- txn) commits cleanly; run-migrations.js wraps each file in its own txn, and the
-- API that casts to these values deploys only after 0043 has committed.
ALTER TYPE admin_target_type ADD VALUE IF NOT EXISTS 'seo_city';
ALTER TYPE admin_action_type ADD VALUE IF NOT EXISTS 'toggle_seo_city';
