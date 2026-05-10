-- ═══════════════════════════════════════════════════════════════════════
-- 0020: Backfill listing_locations with locality centroid coordinates
--
-- Many existing listings were created without lat/lng coordinates,
-- making them invisible on CriblMap. This migration approximates
-- their location using the centroid of their associated locality.
-- ═══════════════════════════════════════════════════════════════════════

-- Step 1: Copy lat/lng from the localities table where available
UPDATE listing_locations ll
SET lat = loc.lat,
    lng = loc.lng
FROM localities loc
WHERE ll.locality_id = loc.id
  AND ll.lat IS NULL
  AND loc.lat IS NOT NULL;

-- Step 2: Update geo_point for PostGIS spatial queries
-- Wrapped in DO block to gracefully handle PostGIS not being installed
DO $$
BEGIN
  UPDATE listing_locations
  SET geo_point = ST_SetSRID(ST_MakePoint(lng::float8, lat::float8), 4326)::geography
  WHERE lat IS NOT NULL
    AND lng IS NOT NULL
    AND geo_point IS NULL;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'PostGIS geo_point backfill skipped (extension not available): %', SQLERRM;
END $$;
