-- Migration 0052: v1 → v2 listing migration map.
-- One row per migrated v1 document. Two jobs:
--   (1) idempotency key — the migration script upserts keyed on v1_id, so a
--       re-run never creates duplicate listings.
--   (2) 301 source — the cutover redirect generator reads this to pair each old
--       v1 URL (…/properties/<slug>-<v1_id>) to its v2 canonical URL.
CREATE TABLE IF NOT EXISTS v1_migration_map (
  v1_id         text PRIMARY KEY,                        -- Mongo _id (24-hex string)
  v1_collection text NOT NULL,                           -- 'properties' | 'pgs'
  v1_name       text,                                    -- nameListing (for reporting / URL join)
  v2_listing_id uuid NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
  owner_source  text NOT NULL,                           -- 'mongo' | 'excel' | 'import_fallback'
  migrated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_v1_migration_map_listing ON v1_migration_map (v2_listing_id);
CREATE INDEX IF NOT EXISTS idx_v1_migration_map_collection ON v1_migration_map (v1_collection);
