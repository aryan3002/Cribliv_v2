-- Rollback for 0033: re-point the PG detail FKs back to listings(id).
-- (Only valid while pg_listings.id == listings.id 1:1, which the projection
-- guarantees.)
ALTER TABLE pg_details
  DROP CONSTRAINT IF EXISTS pg_details_listing_id_fkey;
ALTER TABLE pg_details
  ADD CONSTRAINT pg_details_listing_id_fkey
    FOREIGN KEY (listing_id) REFERENCES listings(id) ON DELETE CASCADE;

ALTER TABLE pg_room_types
  DROP CONSTRAINT IF EXISTS pg_room_types_listing_id_fkey;
ALTER TABLE pg_room_types
  ADD CONSTRAINT pg_room_types_listing_id_fkey
    FOREIGN KEY (listing_id) REFERENCES listings(id) ON DELETE CASCADE;
