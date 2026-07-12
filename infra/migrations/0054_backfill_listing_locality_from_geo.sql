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
-- This migration reconnects the two: for each listing with no locality_id it
-- assigns a locality *in the same city* in three passes, most-accurate first.
-- Both tables carry a PostGIS geo_point GEOGRAPHY(Point,4326) column
-- (added/backfilled in 0044) with GIST indexes for cheap nearest-neighbour.
--
--   Pass 0 — TEXT match: the migrated listing titles/addresses embed the real
--            locality ("…, Gomtinagar"), which is more accurate than snapping to
--            the nearest centroid. Match the locality name inside the listing
--            text on a normalised comparison (strip spaces/punctuation, so
--            "Gomtinagar" == "Gomti Nagar"), preferring a top-level locality then
--            the longest name. A 4-char minimum on the normalised name avoids
--            short-name false hits (e.g. "NIT").
--   Pass 1 — GEO fallback: nearest TOP-LEVEL locality (parent_locality_id IS
--            NULL) within a 12 km guard (so a bad/absent coordinate can't snap to
--            a distant area), so counts land on recognisable areas users browse.
--   Pass 2 — GEO fallback: for anything still unmatched, nearest locality of any
--            level within 12 km. (If the hierarchy has no parents set, pass 1
--            already behaves like "nearest of any" and pass 2 is a no-op.)
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
  pass0_rows    int;
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

  -- ── Pass 0: TEXT match on the locality name embedded in the listing ────────
  -- The listing's own title/address is the most reliable signal ("…, Gomtinagar"
  -- → Gomti Nagar). Compare on a normalised form (lowercase, alphanumerics only)
  -- so spacing/punctuation variants match, require a 4-char minimum normalised
  -- name to avoid short-name false hits, and prefer a top-level locality then the
  -- longest name so a micro-area title still resolves to its recognisable parent.
  UPDATE listing_locations ll
  SET locality_id = (
        SELECT loc.id
        FROM localities loc
        WHERE loc.city_id = ll.city_id
          AND char_length(regexp_replace(loc.name_en, '[^a-zA-Z0-9]', '', 'g')) >= 4
          AND regexp_replace(
                lower(coalesce(l.title_en, '') || ' ' || coalesce(l.title_hi, '') || ' ' ||
                      coalesce(ll.address_line1, '') || ' ' || coalesce(ll.landmark, '')),
                '[^a-z0-9]', '', 'g')
              LIKE '%' || lower(regexp_replace(loc.name_en, '[^a-zA-Z0-9]', '', 'g')) || '%'
        ORDER BY (loc.parent_locality_id IS NULL) DESC, char_length(loc.name_en) DESC
        LIMIT 1
      ),
      updated_at = now()
  FROM listings l
  WHERE l.id = ll.listing_id
    AND ll.locality_id IS NULL
    AND ll.city_id IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM localities loc
      WHERE loc.city_id = ll.city_id
        AND char_length(regexp_replace(loc.name_en, '[^a-zA-Z0-9]', '', 'g')) >= 4
        AND regexp_replace(
              lower(coalesce(l.title_en, '') || ' ' || coalesce(l.title_hi, '') || ' ' ||
                    coalesce(ll.address_line1, '') || ' ' || coalesce(ll.landmark, '')),
              '[^a-z0-9]', '', 'g')
            LIKE '%' || lower(regexp_replace(loc.name_en, '[^a-zA-Z0-9]', '', 'g')) || '%'
    );
  GET DIAGNOSTICS pass0_rows = ROW_COUNT;
  RAISE NOTICE '0054: pass 0 (locality name in listing text) assigned % listing(s).', pass0_rows;

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
