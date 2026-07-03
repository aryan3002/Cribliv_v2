-- Rollback for 0042_search_read_path_perf.sql
-- Note: dropping idx_listings_title_trgm (F4) is not restored — it was a pure
-- duplicate of idx_listings_title_en_trgm, so re-creating it would only re-add waste.

DROP TRIGGER IF EXISTS trg_sync_listing_city_slug ON listing_locations;
DROP FUNCTION IF EXISTS sync_listing_city_slug();

DROP INDEX IF EXISTS idx_listings_active_cityslug_rent_created;
DROP INDEX IF EXISTS idx_listings_fts_en;
DROP INDEX IF EXISTS idx_listings_fts_hi;

ALTER TABLE listings DROP COLUMN IF EXISTS city_slug;
