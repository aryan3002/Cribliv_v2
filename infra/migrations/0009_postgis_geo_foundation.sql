-- ╔══════════════════════════════════════════════════════════════════════════════╗
-- ║  Migration 0009: PostGIS Geo Foundation + Listing Event Tracking           ║
-- ║  Phase 0A: PostGIS extension, geo_point columns, spatial indexes           ║
-- ║  Phase 0B: listing_events table for view/enquiry/click tracking            ║
-- ╚══════════════════════════════════════════════════════════════════════════════╝

-- ── Phase 0A: PostGIS ────────────────────────────────────────────────────────

-- Enable PostGIS extension (safe if already exists or not available)
DO $$
BEGIN
  CREATE EXTENSION IF NOT EXISTS postgis;
EXCEPTION
  WHEN OTHERS THEN
    RAISE NOTICE 'PostGIS extension not available — geo queries will be disabled. Error: %', SQLERRM;
END
$$;

-- Add geo_point columns + indexes only if PostGIS is available
DO $$
BEGIN
  -- Check if PostGIS is available by testing for the geography type
  IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'geography') THEN
    -- listing_locations geo_point
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_name = 'listing_locations' AND column_name = 'geo_point'
    ) THEN
      ALTER TABLE listing_locations ADD COLUMN geo_point GEOGRAPHY(Point, 4326);
    END IF;

    -- Backfill from lat/lng
    UPDATE listing_locations
    SET geo_point = ST_SetSRID(ST_MakePoint(lng::float8, lat::float8), 4326)::geography
    WHERE lat IS NOT NULL AND lng IS NOT NULL AND geo_point IS NULL;

    -- Spatial index
    IF NOT EXISTS (
      SELECT 1 FROM pg_indexes WHERE indexname = 'idx_listing_locations_geo'
    ) THEN
      CREATE INDEX idx_listing_locations_geo ON listing_locations USING GIST (geo_point);
    END IF;

    -- localities geo_point
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_name = 'localities' AND column_name = 'geo_point'
    ) THEN
      ALTER TABLE localities ADD COLUMN geo_point GEOGRAPHY(Point, 4326);
    END IF;

    -- Backfill localities
    UPDATE localities
    SET geo_point = ST_SetSRID(ST_MakePoint(lng::float8, lat::float8), 4326)::geography
    WHERE lat IS NOT NULL AND lng IS NOT NULL AND geo_point IS NULL;

    IF NOT EXISTS (
      SELECT 1 FROM pg_indexes WHERE indexname = 'idx_localities_geo'
    ) THEN
      CREATE INDEX idx_localities_geo ON localities USING GIST (geo_point);
    END IF;
  ELSE
    RAISE NOTICE 'PostGIS not available — skipping geo columns. Switch to postgis/postgis:16-3.4 image for geo-search.';
  END IF;
END
$$;


-- ── Phase 0B: Listing Event Tracking ─────────────────────────────────────────

CREATE TABLE IF NOT EXISTS listing_events (
  id          BIGSERIAL     PRIMARY KEY,
  listing_id  UUID          NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
  user_id     UUID          REFERENCES users(id),
  event_type  TEXT          NOT NULL,   -- 'view', 'enquiry', 'shortlist', 'share', 'call_click', 'search_impression'
  session_id  TEXT,
  ip          INET,
  user_agent  TEXT,
  metadata    JSONB         NOT NULL DEFAULT '{}'::jsonb,
  created_at  TIMESTAMPTZ   NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_listing_events_listing_type
  ON listing_events (listing_id, event_type, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_listing_events_created
  ON listing_events (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_listing_events_user
  ON listing_events (user_id, created_at DESC)
  WHERE user_id IS NOT NULL;
