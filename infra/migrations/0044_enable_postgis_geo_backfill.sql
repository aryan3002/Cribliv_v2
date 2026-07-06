-- ╔════════════════════════════════════════════════════════════════════════════╗
-- ║  Migration 0044: Enable PostGIS + backfill geo_point columns                 ║
-- ╚════════════════════════════════════════════════════════════════════════════╝
--
-- Migrations 0009 (listing_locations, localities) and 0027 (landmarks) add a
-- geo_point GEOGRAPHY column *only if PostGIS is available* — otherwise they
-- RAISE NOTICE and skip, but STILL mark themselves applied. On the Azure prod
-- database PostGIS was not installed when those ran, so the geo_point columns
-- were silently skipped and can never be re-created by 0009/0027 (already in
-- schema_migrations).
--
-- PostGIS is now available on that server (allowlisted), so this migration
-- installs the extension and (idempotently) creates + backfills the geo_point
-- columns and their GIST indexes for the three tables that need them. Column
-- and index names match 0009/0027 exactly so the app's spatial queries resolve.
--
-- Defensive: if PostGIS is genuinely unavailable (local dev / CI without the
-- postgis image) it degrades to a no-op, exactly like 0009 — so `pnpm db:migrate`
-- still succeeds everywhere.

-- ── Install PostGIS (no-op if already present or unavailable) ─────────────────
DO $$
BEGIN
  CREATE EXTENSION IF NOT EXISTS postgis;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'PostGIS extension not available — geo_point backfill will be skipped. Error: %', SQLERRM;
END$$;

-- ── Add + backfill geo_point columns, only if the geography type now exists ───
DO $$
BEGIN
  PERFORM 1 FROM pg_type WHERE typname = 'geography';
  IF NOT FOUND THEN
    RAISE NOTICE 'PostGIS geography type not available — skipping geo_point columns.';
    RETURN;
  END IF;

  -- listing_locations
  ALTER TABLE listing_locations ADD COLUMN IF NOT EXISTS geo_point GEOGRAPHY(Point, 4326);
  UPDATE listing_locations
    SET geo_point = ST_SetSRID(ST_MakePoint(lng::float8, lat::float8), 4326)::geography
    WHERE lat IS NOT NULL AND lng IS NOT NULL AND geo_point IS NULL;
  CREATE INDEX IF NOT EXISTS idx_listing_locations_geo ON listing_locations USING GIST (geo_point);

  -- localities
  ALTER TABLE localities ADD COLUMN IF NOT EXISTS geo_point GEOGRAPHY(Point, 4326);
  UPDATE localities
    SET geo_point = ST_SetSRID(ST_MakePoint(lng::float8, lat::float8), 4326)::geography
    WHERE lat IS NOT NULL AND lng IS NOT NULL AND geo_point IS NULL;
  CREATE INDEX IF NOT EXISTS idx_localities_geo ON localities USING GIST (geo_point);

  -- landmarks
  ALTER TABLE landmarks ADD COLUMN IF NOT EXISTS geo_point GEOGRAPHY(Point, 4326);
  UPDATE landmarks
    SET geo_point = ST_SetSRID(ST_MakePoint(lng::float8, lat::float8), 4326)::geography
    WHERE lat IS NOT NULL AND lng IS NOT NULL AND geo_point IS NULL;
  CREATE INDEX IF NOT EXISTS idx_landmarks_geo_point ON landmarks USING GIST (geo_point);
END$$;
