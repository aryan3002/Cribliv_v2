-- Migration 0045: SEO indexing + measurement (Slice 2).
-- seo_indexing_queue: URLs to submit to Google's Indexing API (fast discovery
-- only -- the sitemap remains the durable source of truth). Upsert-on-url so a
-- re-enqueue (content changed) re-queues instead of duplicating rows.
-- keyword_rankings: weekly snapshot from GSC searchanalytics.query, keyed so a
-- re-poll for the same day updates in place (idempotent per captured_at).

CREATE TABLE IF NOT EXISTS seo_indexing_queue (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  url           text NOT NULL,
  status        text NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending', 'submitted', 'failed', 'skipped')),
  reason        text,
  attempts      int NOT NULL DEFAULT 0,
  submitted_at  timestamptz,
  response      jsonb,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (url)
);

CREATE INDEX IF NOT EXISTS idx_seo_indexing_queue_pending
  ON seo_indexing_queue (created_at)
  WHERE status = 'pending';

CREATE OR REPLACE FUNCTION seo_indexing_queue_touch_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_seo_indexing_queue_touch ON seo_indexing_queue;
CREATE TRIGGER trg_seo_indexing_queue_touch
  BEFORE UPDATE ON seo_indexing_queue
  FOR EACH ROW EXECUTE FUNCTION seo_indexing_queue_touch_updated_at();

CREATE TABLE IF NOT EXISTS keyword_rankings (
  id           bigserial PRIMARY KEY,
  keyword      text NOT NULL,
  page         text NOT NULL,
  locale       text NOT NULL,
  city_slug    text,
  position     numeric,
  impressions  int,
  clicks       int,
  ctr          numeric,
  source       text NOT NULL DEFAULT 'gsc',
  captured_at  date NOT NULL,
  is_target    boolean NOT NULL DEFAULT false,
  is_ignored   boolean NOT NULL DEFAULT false,
  UNIQUE (keyword, page, locale, captured_at)
);

CREATE INDEX IF NOT EXISTS idx_keyword_rankings_position
  ON keyword_rankings (position);

CREATE INDEX IF NOT EXISTS idx_keyword_rankings_city_slug
  ON keyword_rankings (city_slug);

-- Admin audit vocabulary for the indexing-queue endpoints (manual submit +
-- retry). ADD VALUE is safe here -- run-migrations.js wraps each file in its
-- own txn and the API only casts to these values after this file commits.
ALTER TYPE admin_target_type ADD VALUE IF NOT EXISTS 'seo_indexing_queue';
ALTER TYPE admin_action_type ADD VALUE IF NOT EXISTS 'submit_indexing_url';
ALTER TYPE admin_action_type ADD VALUE IF NOT EXISTS 'retry_indexing_url';
