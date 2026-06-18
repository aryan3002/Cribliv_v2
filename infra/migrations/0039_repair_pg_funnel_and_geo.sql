-- 0039_repair_pg_funnel_and_geo.sql
-- Repair migration. The migration runner previously matched ALL `^\d+_.*\.sql$`
-- files INCLUDING rollback files; for underscore-named rollbacks
-- (0035_pg_listing_finalization_rollback.sql, 0036_pg_listing_funnel_rollback.sql)
-- the rollback sorted AFTER its forward file and therefore ran last, dropping:
--   - pg_listing_funnel_events (+ its indexes)   [0036]
--   - pg_properties.lat / pg_properties.lng       [0035]
-- The runner now excludes rollback files; this migration restores the dropped
-- objects idempotently so existing databases self-heal on the next migrate.
BEGIN;

-- Restore 0036: PG listing-process funnel events (append-only, operator-scoped).
CREATE TABLE IF NOT EXISTS pg_listing_funnel_events (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  operator_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  draft_id         uuid,
  listing_id       uuid,
  event_type       text NOT NULL,   -- wizard_started|step_completed|geocode_resolved|photos_added|draft_saved|submitted|published|abandoned
  source           text NOT NULL,   -- manual|voice
  step_no          int,
  metadata         jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_pg_funnel_type_time ON pg_listing_funnel_events (event_type, created_at);
CREATE INDEX IF NOT EXISTS idx_pg_funnel_operator_time ON pg_listing_funnel_events (operator_user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_pg_funnel_draft ON pg_listing_funnel_events (draft_id);

-- Restore 0035: exact geocoding columns on pg_properties.
ALTER TABLE pg_properties
  ADD COLUMN IF NOT EXISTS lat double precision,
  ADD COLUMN IF NOT EXISTS lng double precision;

COMMIT;
