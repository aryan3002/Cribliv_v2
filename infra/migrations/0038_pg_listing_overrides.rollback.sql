-- Reverses 0038. Restores the per-property unique indexes and drops listing_id.
DROP INDEX IF EXISTS uq_pg_override_listing;
DROP INDEX IF EXISTS uq_pg_override_global;
CREATE UNIQUE INDEX IF NOT EXISTS uq_pg_override_global
  ON pg_analytics_overrides(operator_id) WHERE pg_property_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_pg_override_property
  ON pg_analytics_overrides(operator_id, pg_property_id) WHERE pg_property_id IS NOT NULL;
ALTER TABLE pg_analytics_overrides DROP COLUMN IF EXISTS listing_id;
