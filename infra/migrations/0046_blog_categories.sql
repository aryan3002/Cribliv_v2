-- Migration 0046: blog_categories - taxonomy for the content engine (slice 3).
-- Bilingual names + descriptions. Seeded with the four post-type buckets from
-- the spec so blog_posts.category_id always resolves.

CREATE TABLE IF NOT EXISTS blog_categories (
  id              serial PRIMARY KEY,
  slug            text NOT NULL UNIQUE,
  name_en         text NOT NULL,
  name_hi         text NOT NULL,
  description_en  text,
  description_hi  text,
  sort_order      int NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION blog_categories_touch_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_blog_categories_touch ON blog_categories;
CREATE TRIGGER trg_blog_categories_touch
  BEFORE UPDATE ON blog_categories
  FOR EACH ROW EXECUTE FUNCTION blog_categories_touch_updated_at();

INSERT INTO blog_categories (slug, name_en, name_hi, description_en, sort_order) VALUES
  ('data-reports',  'Data Reports',  'डेटा रिपोर्ट',   'Rent trends and market data backed by live listings.', 1),
  ('local-guides',  'Local Guides',  'लोकल गाइड',      'Neighbourhood and city rental guides.',                 2),
  ('tenancy',       'Tenancy',       'किरायेदारी',     'Rent agreements, deposits, tenant rights, moving.',     3),
  ('market-updates','Market Updates','मार्केट अपडेट',  'Query-targeted and seasonal rental updates.',           4)
ON CONFLICT (slug) DO NOTHING;
