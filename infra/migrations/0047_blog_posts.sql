-- Migration 0047: blog_posts - the content engine's core table (slice 3, spec section 8).
-- Bilingual body (en/hi), grounded-data provenance (sources, data_asof),
-- quality gate output (quality_score + quality_breakdown), FAQ block for
-- buildFaqPage, editorial byline (author), and the full state machine via a
-- status CHECK. Human approval is the only path to 'published' (enforced in
-- the service, not here).

CREATE TABLE IF NOT EXISTS blog_posts (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug              text NOT NULL UNIQUE,
  title             text NOT NULL,
  meta_title        text,
  meta_description  text,
  excerpt           text,
  body_en           text,
  body_hi           text,
  target_keyword    text,
  intent            text,
  city_slug         text,
  category_id       int REFERENCES blog_categories(id) ON DELETE SET NULL,
  status            text NOT NULL DEFAULT 'brief'
                      CHECK (status IN ('brief','generating','draft','needs_attention','in_review','published','archived')),
  generated_by      text NOT NULL DEFAULT 'planner'
                      CHECK (generated_by IN ('planner','manual','refresh','pillar')),
  quality_score     numeric,
  quality_breakdown jsonb NOT NULL DEFAULT '{}'::jsonb,
  faq_items         jsonb NOT NULL DEFAULT '[]'::jsonb,
  hero_image_path   text,
  author            text NOT NULL DEFAULT 'Aditi Sharma',
  sources           jsonb NOT NULL DEFAULT '[]'::jsonb,
  data_asof         date,
  script            text NOT NULL DEFAULT 'en'
                      CHECK (script IN ('en','hi','hinglish')),
  is_pillar         boolean NOT NULL DEFAULT false,
  brief_id          uuid,
  published_at      timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_blog_posts_status ON blog_posts (status);
CREATE INDEX IF NOT EXISTS idx_blog_posts_target_keyword ON blog_posts (target_keyword);
CREATE INDEX IF NOT EXISTS idx_blog_posts_city_slug ON blog_posts (city_slug) WHERE city_slug IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_blog_posts_published ON blog_posts (published_at DESC) WHERE status = 'published';

CREATE OR REPLACE FUNCTION blog_posts_touch_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_blog_posts_touch ON blog_posts;
CREATE TRIGGER trg_blog_posts_touch
  BEFORE UPDATE ON blog_posts
  FOR EACH ROW EXECUTE FUNCTION blog_posts_touch_updated_at();

-- Admin audit vocabulary for blog moderation (mirrors the 0043 pattern).
ALTER TYPE admin_target_type ADD VALUE IF NOT EXISTS 'blog_post';
ALTER TYPE admin_action_type ADD VALUE IF NOT EXISTS 'blog_approve';
ALTER TYPE admin_action_type ADD VALUE IF NOT EXISTS 'blog_publish';
ALTER TYPE admin_action_type ADD VALUE IF NOT EXISTS 'blog_archive';
ALTER TYPE admin_action_type ADD VALUE IF NOT EXISTS 'blog_edit';
ALTER TYPE admin_action_type ADD VALUE IF NOT EXISTS 'blog_generate';
