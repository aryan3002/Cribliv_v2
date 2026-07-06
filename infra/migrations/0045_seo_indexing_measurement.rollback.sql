-- Rollback for 0045_seo_indexing_measurement.sql
-- NOTE: Postgres cannot remove enum values, so 'seo_indexing_queue' /
-- 'submit_indexing_url' / 'retry_indexing_url' remain on the admin enums
-- after rollback. This is safe (unused) and accepted, matching 0043's note.
DROP TRIGGER IF EXISTS trg_seo_indexing_queue_touch ON seo_indexing_queue;
DROP FUNCTION IF EXISTS seo_indexing_queue_touch_updated_at();
DROP INDEX IF EXISTS idx_seo_indexing_queue_pending;
DROP TABLE IF EXISTS seo_indexing_queue;
DROP INDEX IF EXISTS idx_keyword_rankings_position;
DROP INDEX IF EXISTS idx_keyword_rankings_city_slug;
DROP TABLE IF EXISTS keyword_rankings;
