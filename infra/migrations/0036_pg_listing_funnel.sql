-- 0036_pg_listing_funnel.sql
-- PG listing-process funnel events. Receiving table for the client-side
-- trackPgFunnel() seam (shipped in Plan 1) and the admin analytics aggregates
-- (Plan 3). Operator-scoped, append-only, listing/draft-correlatable.
BEGIN;

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

COMMIT;
