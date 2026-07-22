DROP TABLE IF EXISTS listing_availability_alerts;
DROP INDEX IF EXISTS idx_listings_is_available_active;
ALTER TABLE listings
  DROP COLUMN IF EXISTS availability_source,
  DROP COLUMN IF EXISTS became_unavailable_at,
  DROP COLUMN IF EXISTS is_available;
-- Note: Postgres cannot remove an enum value; 'availability_change' remains on admin_action_type (harmless).
