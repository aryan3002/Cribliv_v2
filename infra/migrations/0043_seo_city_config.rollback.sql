-- Rollback for 0043_seo_city_config.sql
-- NOTE: Postgres cannot remove enum values, so 'seo_city' / 'toggle_seo_city'
-- remain on the admin enums after rollback. This is safe (unused) and accepted.
DROP TRIGGER IF EXISTS trg_seo_city_config_touch ON seo_city_config;
DROP FUNCTION IF EXISTS seo_city_config_touch_updated_at();
DROP INDEX IF EXISTS idx_seo_city_config_enabled;
DROP TABLE IF EXISTS seo_city_config;
