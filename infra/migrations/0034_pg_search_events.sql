-- Migration 0034: search-scoped PG funnel events. listing_events requires a
-- listing_id; search events are query-scoped, so they get their own table.
-- shown_listing_ids holds the result-set ids the search page rendered, giving
-- TRUE per-listing impressions (appearances) via jsonb containment.
-- No FK points AT this table → rollback is always clean.
CREATE TABLE IF NOT EXISTS pg_search_events (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id          text        NOT NULL,
  user_id             uuid        REFERENCES users(id) ON DELETE SET NULL,
  query               text,
  city                text,
  filters             jsonb       NOT NULL DEFAULT '{}',
  result_count        int         NOT NULL DEFAULT 0,
  shown_listing_ids   jsonb       NOT NULL DEFAULT '[]',
  clicked_listing_id  uuid        REFERENCES listings(id) ON DELETE SET NULL,
  clicked_position    int,
  surface             text        NOT NULL DEFAULT 'pg_search',
  ip                  inet,
  user_agent          text,
  created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pse_session ON pg_search_events(session_id);
CREATE INDEX IF NOT EXISTS idx_pse_city    ON pg_search_events(city, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_pse_clicked ON pg_search_events(clicked_listing_id, created_at DESC)
  WHERE clicked_listing_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_pse_created ON pg_search_events(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_pse_shown   ON pg_search_events USING gin (shown_listing_ids);
