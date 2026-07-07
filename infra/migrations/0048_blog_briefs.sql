-- Migration 0048: blog_briefs - the structured content brief the generator
-- writes to (spec sections 2.3 and 6). Never "write a blog about X": every
-- post starts here with a target keyword, intent, SERP-informed outline,
-- required data points, and mandatory internal-link targets.

CREATE TABLE IF NOT EXISTS blog_briefs (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  target_keyword         text NOT NULL,
  intent                 text,
  outline                jsonb NOT NULL DEFAULT '[]'::jsonb,
  required_data          jsonb NOT NULL DEFAULT '[]'::jsonb,
  internal_link_targets  jsonb NOT NULL DEFAULT '[]'::jsonb,
  source                 text NOT NULL DEFAULT 'manual'
                          CHECK (source IN ('gsc_quickwin','gap','data_trend','evergreen','manual')),
  status                 text NOT NULL DEFAULT 'pending'
                          CHECK (status IN ('pending','generating','done','dropped')),
  city_slug              text,
  category_slug          text,
  post_type              text NOT NULL DEFAULT 'evergreen'
                          CHECK (post_type IN ('data_report','local_guide','evergreen','query_targeted')),
  notes                  text,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_blog_briefs_status ON blog_briefs (status);
CREATE UNIQUE INDEX IF NOT EXISTS uq_blog_briefs_keyword_pending
  ON blog_briefs (lower(target_keyword)) WHERE status = 'pending';

CREATE OR REPLACE FUNCTION blog_briefs_touch_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_blog_briefs_touch ON blog_briefs;
CREATE TRIGGER trg_blog_briefs_touch
  BEFORE UPDATE ON blog_briefs
  FOR EACH ROW EXECUTE FUNCTION blog_briefs_touch_updated_at();
