-- 0019_search_suggest_trgm_indexes
-- GIN trigram indexes to make the homepage typeahead suggest endpoint
-- (search.service.ts -> suggest()) hit sub-5ms instead of the ~30-80ms
-- sequential scans it currently does. The pg_trgm extension is enabled
-- in 0001_init.sql; here we just add the supporting indexes.
--
-- These three queries scan with `similarity(col, $1) > 0.15 OR col ILIKE '%' || $1 || '%'`
-- which the planner can satisfy via gin_trgm_ops without touching every row.

CREATE INDEX IF NOT EXISTS idx_cities_name_en_trgm
  ON cities USING gin (name_en gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_localities_name_en_trgm
  ON localities USING gin (name_en gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_listings_title_en_trgm
  ON listings USING gin (title_en gin_trgm_ops);
