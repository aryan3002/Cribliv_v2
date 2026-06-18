-- Reverses 0039. NOT auto-run by the migration runner (rollback files are
-- excluded); apply manually only if you intend to undo the repair.
BEGIN;
DROP TABLE IF EXISTS pg_listing_funnel_events;
ALTER TABLE pg_properties DROP COLUMN IF EXISTS lat;
ALTER TABLE pg_properties DROP COLUMN IF EXISTS lng;
COMMIT;
