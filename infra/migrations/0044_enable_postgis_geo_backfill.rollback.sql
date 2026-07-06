-- Rollback for 0044_enable_postgis_geo_backfill.sql
--
-- Drops the geo_point columns and their GIST indexes. Leaves the PostGIS
-- extension installed, since other geo features may depend on it and dropping
-- an extension is rarely what you want in a rollback. Apply manually if needed;
-- the migration runner never runs *.rollback.sql automatically.

DROP INDEX IF EXISTS idx_listing_locations_geo;
DROP INDEX IF EXISTS idx_localities_geo;
DROP INDEX IF EXISTS idx_landmarks_geo_point;

ALTER TABLE listing_locations DROP COLUMN IF EXISTS geo_point;
ALTER TABLE localities DROP COLUMN IF EXISTS geo_point;
ALTER TABLE landmarks DROP COLUMN IF EXISTS geo_point;
