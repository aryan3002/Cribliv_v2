-- 0035_pg_listing_finalization.sql
-- PG listing finalization: exact geocoding columns on pg_properties.
-- Note: pg_draft_source enum ('voice','manual','imported') already exists in 0031.
BEGIN;

ALTER TABLE pg_properties
  ADD COLUMN IF NOT EXISTS lat double precision,
  ADD COLUMN IF NOT EXISTS lng double precision;

COMMIT;
