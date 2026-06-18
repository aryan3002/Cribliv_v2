-- Rollback 0040: restore the original default-opclass GIN index.
DROP INDEX IF EXISTS idx_pse_shown_path;
CREATE INDEX IF NOT EXISTS idx_pse_shown
  ON pg_search_events USING gin (shown_listing_ids);
