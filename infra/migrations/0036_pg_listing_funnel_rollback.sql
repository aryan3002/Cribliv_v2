-- 0036_pg_listing_funnel_rollback.sql
BEGIN;
DROP TABLE IF EXISTS pg_listing_funnel_events;
COMMIT;
