-- 0038: Pivot analytics overrides from per-PROPERTY to per-LISTING granularity.
--
-- Root cause of the "per-PG cut killed the whole operator" bug: an operator owns
-- ONE pg_property that contains MANY pg_listings, so a per-property override
-- masked every listing. Overrides now target a single listing (listing_id) or
-- the whole operator (listing_id IS NULL = global). pg_property_id is retained
-- as an inert/deprecated column to avoid a destructive drop, but is no longer
-- read by the masking path.

ALTER TABLE pg_analytics_overrides
  ADD COLUMN IF NOT EXISTS listing_id uuid REFERENCES pg_listings(id) ON DELETE CASCADE;

-- Stale per-property overrides do not translate to the new model. Remove them.
-- Operator-global rows (pg_property_id IS NULL, listing_id IS NULL) are preserved.
DELETE FROM pg_analytics_overrides WHERE pg_property_id IS NOT NULL;

-- Rebuild uniqueness around (global | per-listing).
DROP INDEX IF EXISTS uq_pg_override_global;
DROP INDEX IF EXISTS uq_pg_override_property;
CREATE UNIQUE INDEX IF NOT EXISTS uq_pg_override_global
  ON pg_analytics_overrides(operator_id) WHERE listing_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_pg_override_listing
  ON pg_analytics_overrides(operator_id, listing_id) WHERE listing_id IS NOT NULL;
