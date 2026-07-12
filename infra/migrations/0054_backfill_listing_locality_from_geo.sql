-- ╔════════════════════════════════════════════════════════════════════════════╗
-- ║  Migration 0054: Backfill listing_locations.locality_id from geo            ║
-- ╚════════════════════════════════════════════════════════════════════════════╝
--
-- The v1→v2 listing migration (map-flat.ts / map-pg.ts) imported each listing's
-- city + coordinates but never assigned a locality_id. As a result every SEO
-- locality page (e.g. /city/lucknow/gomti-nagar) shows "0 active rentals", the
-- city hub's "All localities" grid shows no counts, and the `locality=` search
-- filter returns nothing — even though the city has plenty of live inventory.
-- The listing↔locality link (locality pages, aggregate counts, locality search
-- filter) all key off listing_locations.locality_id.
--
-- This migration reconnects the two: for each listing that has coordinates but
-- no locality_id, it assigns the geographically nearest locality *in the same
-- city*, within a 12 km guard (so a listing with a bad/absent coordinate can't
-- be snapped onto a distant area). Both tables carry a PostGIS geo_point
-- GEOGRAPHY(Point,4326) column (added/backfilled in 0044), and the GIST indexes
-- make the nearest-neighbour lookup cheap.
--
--   Pass 1 — prefer the nearest TOP-LEVEL locality (parent_locality_id IS NULL)
--            so counts land on the recognisable areas users actually browse
--            (Gomti Nagar, Alambagh, …) rather than a hyper-granular micro-area.
--   Pass 2 — for anything still unmatched, fall back to the nearest locality of
--            any level. (If the prod hierarchy has no parents set, pass 1 already
--            behaves like "nearest of any" and pass 2 is a no-op — safe either
--            way.)
--
-- Idempotent & re-runnable: only rows with locality_id IS NULL are touched, so a
-- second run only fills newly-imported listings. Owner-set localities and any
-- previously-assigned rows are never overwritten.
--
-- Defensive: if PostGIS is unavailable (local dev / CI without the postgis
-- image) it degrades to a logged no-op, exactly like 0044, so `pnpm db:migrate`
-- still succeeds everywhere.

DO $$
DECLARE
  has_geography boolean;
  before_null   int;
  pass1_rows    int;
  pass2_rows    int;
  after_null    int;
BEGIN
  SELECT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'geography') INTO has_geography;
  IF NOT has_geography THEN
    RAISE NOTICE '0054: PostGIS geography type unavailable — skipping locality backfill (no-op).';
    RETURN;
  END IF;

  -- Top up geo_point from lat/lng wherever it is still null. Migration 0044 only
  -- backfilled the rows that existed when it ran; listings imported since (e.g.
  -- the v1 migration) may carry lat/lng but a null geo_point, which the
  -- nearest-locality lookup below relies on. Idempotent, and uses the same GIST
  -- indexes 0044 created.
  UPDATE listing_locations
    SET geo_point = ST_SetSRID(ST_MakePoint(lng::float8, lat::float8), 4326)::geography
    WHERE lat IS NOT NULL AND lng IS NOT NULL AND geo_point IS NULL;
  UPDATE localities
    SET geo_point = ST_SetSRID(ST_MakePoint(lng::float8, lat::float8), 4326)::geography
    WHERE lat IS NOT NULL AND lng IS NOT NULL AND geo_point IS NULL;

  SELECT count(*) INTO before_null
  FROM listing_locations
  WHERE locality_id IS NULL AND geo_point IS NOT NULL AND city_id IS NOT NULL;
  RAISE NOTICE '0054: % listing(s) with coordinates are missing locality_id before backfill.', before_null;

  -- ── Pass 1: nearest TOP-LEVEL locality in the same city, within 12 km ──────
  -- The nearest-locality lookup is a correlated subquery in SET (not UPDATE …
  -- FROM LATERAL): Postgres does not allow a LATERAL item in the FROM clause to
  -- reference the UPDATE target table, but a subquery in the SET expression can.
  -- The matching EXISTS in WHERE ensures we only touch rows that will actually
  -- receive a locality — so non-matching rows are left NULL, not re-stamped.
  UPDATE listing_locations ll
  SET locality_id = (
        SELECT loc.id
        FROM localities loc
        WHERE loc.city_id = ll.city_id
          AND loc.parent_locality_id IS NULL
          AND loc.geo_point IS NOT NULL
          AND ST_DWithin(loc.geo_point, ll.geo_point, 12000)
        ORDER BY loc.geo_point <-> ll.geo_point
        LIMIT 1
      ),
      updated_at = now()
  WHERE ll.locality_id IS NULL
    AND ll.geo_point IS NOT NULL
    AND ll.city_id IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM localities loc
      WHERE loc.city_id = ll.city_id
        AND loc.parent_locality_id IS NULL
        AND loc.geo_point IS NOT NULL
        AND ST_DWithin(loc.geo_point, ll.geo_point, 12000)
    );
  GET DIAGNOSTICS pass1_rows = ROW_COUNT;
  RAISE NOTICE '0054: pass 1 (nearest top-level locality) assigned % listing(s).', pass1_rows;

  -- ── Pass 2: fallback to nearest locality of ANY level, within 12 km ───────
  UPDATE listing_locations ll
  SET locality_id = (
        SELECT loc.id
        FROM localities loc
        WHERE loc.city_id = ll.city_id
          AND loc.geo_point IS NOT NULL
          AND ST_DWithin(loc.geo_point, ll.geo_point, 12000)
        ORDER BY loc.geo_point <-> ll.geo_point
        LIMIT 1
      ),
      updated_at = now()
  WHERE ll.locality_id IS NULL
    AND ll.geo_point IS NOT NULL
    AND ll.city_id IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM localities loc
      WHERE loc.city_id = ll.city_id
        AND loc.geo_point IS NOT NULL
        AND ST_DWithin(loc.geo_point, ll.geo_point, 12000)
    );
  GET DIAGNOSTICS pass2_rows = ROW_COUNT;
  RAISE NOTICE '0054: pass 2 (nearest any-level locality) assigned % listing(s).', pass2_rows;

  SELECT count(*) INTO after_null
  FROM listing_locations
  WHERE locality_id IS NULL AND geo_point IS NOT NULL AND city_id IS NOT NULL;
  RAISE NOTICE '0054: % listing(s) still unmatched (no locality within 12 km).', after_null;
END$$;
