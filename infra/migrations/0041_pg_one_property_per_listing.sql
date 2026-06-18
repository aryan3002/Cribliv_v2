-- Migration 0041: PG moves to 1 listing : 1 property.
--
-- (a) Drop the one-primary-per-operator EXCLUDE constraint. With N properties
--     per operator the single-primary invariant is meaningless. This was the
--     old "create-race" guard; per-listing properties are created fresh per
--     publish, so there is no shared-primary row to race on anymore. The
--     Bugs.md "Refuted / create race" note is updated in Task 7.
--
-- (b) Split every pg_property shared by >1 listing into per-listing clones so
--     each listing becomes an independent source of truth. Invariant after:
--     every pg_property.id is referenced by exactly one pg_listings row.
--
-- IMPORTANT: This split is NOT auto-reversible. The rollback file only
-- restores the constraint shape (for fresh/empty DBs). The cloned property
-- rows cannot be safely re-merged. See 0041_pg_one_property_per_listing.rollback.sql.
--
-- Do NOT run against production without a verified backup.

ALTER TABLE pg_properties DROP CONSTRAINT IF EXISTS pg_props_one_primary_per_operator;

DO $$
DECLARE
  rec    RECORD;
  new_id uuid;
BEGIN
  -- For each property with >1 pg_listings, keep the earliest listing (lowest
  -- created_at, tiebreak id) on the original property row and give every
  -- subsequent listing its own clone.
  FOR rec IN
    SELECT pl.id             AS listing_id,
           pl.pg_property_id AS prop_id,
           row_number() OVER (
             PARTITION BY pl.pg_property_id
             ORDER BY pl.created_at, pl.id
           )                 AS rn
    FROM   pg_listings pl
    WHERE  pl.pg_property_id IN (
             SELECT pg_property_id
             FROM   pg_listings
             GROUP  BY pg_property_id
             HAVING count(*) > 1
           )
  LOOP
    IF rec.rn = 1 THEN
      CONTINUE; -- first listing keeps the original property row
    END IF;

    new_id := gen_random_uuid();

    INSERT INTO pg_properties
      (id, operator_id, display_name, internal_code, city_id, locality_id,
       status, is_primary, total_floors, metadata, created_at, updated_at, lat, lng)
    SELECT
       new_id,
       operator_id, display_name, internal_code, city_id, locality_id,
       status, is_primary, total_floors, metadata, created_at, now(), lat, lng
    FROM  pg_properties
    WHERE id = rec.prop_id;

    UPDATE pg_listings SET pg_property_id = new_id WHERE id = rec.listing_id;
    UPDATE listings    SET pg_property_id = new_id WHERE id = rec.listing_id;
  END LOOP;
END $$;

-- NOTE: pg_rooms / pg_beds remain on the original property (V1-empty; no UI).
-- pg_analytics_overrides with a property FK also remains on the original
-- (operator-global overrides; reassign manually if needed in V2).
