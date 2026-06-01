-- Rollback for 0032_pg_listings_split.sql
-- Drops the PG-owned head + property coordinates. The projected rows in
-- listings / listing_locations are left intact — they remain valid platform
-- read rows (listing_type='pg'), so public reads (maps/search) are unaffected.
DROP TRIGGER IF EXISTS set_updated_at ON pg_listings;
DROP TABLE IF EXISTS pg_listings;
ALTER TABLE pg_properties DROP COLUMN IF EXISTS lat;
ALTER TABLE pg_properties DROP COLUMN IF EXISTS lng;
