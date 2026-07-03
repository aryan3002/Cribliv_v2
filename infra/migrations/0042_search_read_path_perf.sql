-- 0042: Search read-path performance fixes (measured at 100k listings)
-- ─────────────────────────────────────────────────────────────────────────────
-- Problems found via EXPLAIN (ANALYZE) at 100k rows:
--   F1/F3  relevance search did a Parallel Seq Scan on listings + an external-merge
--          Sort that SPILLED TO DISK (91ms), because the city filter lives on
--          listing_locations (a join away) so the most-selective predicate could
--          not be pushed down — the whole rent-matched set was sorted before the
--          city filter was applied.
--   F2     full-text search computed to_tsvector() + similarity() PER ROW for
--          ~10k rows (210ms). The 'english' @@ predicate had no matching GIN index
--          (the existing FTS index is 'simple' config), and `similarity() > 0.15`
--          is not index-backed, so the GIN trigram indexes went unused.
--   F4     two byte-identical trigram indexes on title_en.
--
-- PROD DEPLOY NOTE: this project's migration runner wraps each file in a single
-- transaction, so plain CREATE INDEX is used here. On a LARGE production table,
-- CREATE INDEX locks writes — instead run each `CREATE INDEX` below as
-- `CREATE INDEX CONCURRENTLY` in a separate, non-transactional maintenance step
-- and run the backfill UPDATE in batches. The IF NOT EXISTS guards keep that safe.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── F4: drop the duplicate trigram index ────────────────────────────────────
-- idx_listings_title_trgm and idx_listings_title_en_trgm are identical
-- (gin(title_en gin_trgm_ops)); keep the more descriptive *_title_en_trgm.
DROP INDEX IF EXISTS idx_listings_title_trgm;

-- ── F1 + F3: denormalize the city slug onto listings ────────────────────────
-- Lets the city filter be applied directly on listings (with the composite index
-- below) instead of after a join to listing_locations → cities.
ALTER TABLE listings ADD COLUMN IF NOT EXISTS city_slug text;

-- Backfill existing rows from listing_locations → cities.
UPDATE listings l
SET city_slug = c.slug
FROM listing_locations ll
JOIN cities c ON c.id = ll.city_id
WHERE ll.listing_id = l.id
  AND l.city_slug IS DISTINCT FROM c.slug;

-- Keep city_slug in sync whenever a listing's location is created or its city
-- changes. Trigger on listing_locations → updates the denormalized copy on listings.
CREATE OR REPLACE FUNCTION sync_listing_city_slug() RETURNS trigger AS $$
BEGIN
  UPDATE listings
     SET city_slug = (SELECT slug FROM cities WHERE id = NEW.city_id)
   WHERE id = NEW.listing_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sync_listing_city_slug ON listing_locations;
CREATE TRIGGER trg_sync_listing_city_slug
  AFTER INSERT OR UPDATE OF city_id ON listing_locations
  FOR EACH ROW EXECUTE FUNCTION sync_listing_city_slug();

-- Composite partial index: (city_slug, monthly_rent, created_at) for active rows.
-- The planner can now filter active + city + rent range up front, so the
-- relevance ORDER BY only has to sort that small city-scoped set (no disk spill).
CREATE INDEX IF NOT EXISTS idx_listings_active_cityslug_rent_created
  ON listings (city_slug, monthly_rent, created_at DESC)
  WHERE status = 'active';

-- ── F2: make full-text search index-backed ──────────────────────────────────
-- searchListings used to compute to_tsvector('english', …) per row because the
-- existing idx_listings_text_search is 'simple' config (never matched the
-- 'english' predicate). These two indexes match the en/hi predicates EXACTLY so
-- search becomes a fast GIN lookup. (The per-row similarity() fuzzy branch was
-- also removed from the query — see the search.service comment — so no trigram
-- index is added here; the lossy trigram recheck was a 277ms–2.3s cliff.)
CREATE INDEX IF NOT EXISTS idx_listings_fts_en
  ON listings USING gin (
    to_tsvector('english', COALESCE(title_en, '') || ' ' || COALESCE(description_en, ''))
  );

CREATE INDEX IF NOT EXISTS idx_listings_fts_hi
  ON listings USING gin (
    to_tsvector('simple', COALESCE(title_hi, '') || ' ' || COALESCE(description_hi, ''))
  );

-- Refresh planner stats after the schema change + backfill.
ANALYZE listings;
