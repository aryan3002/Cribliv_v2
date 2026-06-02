-- 0035_pg_listing_finalization_rollback.sql
BEGIN;
ALTER TABLE pg_properties DROP COLUMN IF EXISTS lat;
ALTER TABLE pg_properties DROP COLUMN IF EXISTS lng;
COMMIT;
