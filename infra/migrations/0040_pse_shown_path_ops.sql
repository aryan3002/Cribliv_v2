-- Migration 0040: PERF-H1 — make the search-appearances read path index-able.
-- The dashboard read queries were rewritten from
--   jsonb_array_elements_text(shown_listing_ids) = id  (un-indexable: forced a
--   full seq scan + per-row array unnest on every operator dashboard load)
-- to containment:
--   shown_listing_ids @> to_jsonb(id)
-- The default jsonb_ops GIN serves @> but also indexes every key/value (for the
-- `?` operator we never use). jsonb_path_ops indexes ONLY containment paths —
-- smaller and faster, which is all the read path needs.
DROP INDEX IF EXISTS idx_pse_shown;
CREATE INDEX IF NOT EXISTS idx_pse_shown_path
  ON pg_search_events USING gin (shown_listing_ids jsonb_path_ops);
