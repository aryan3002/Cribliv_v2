-- ─── Migration 0026: SEO page copy cache + manual overrides ──────────────────
-- Stores AI-generated H1/meta/intro/FAQ copy for programmatic landing pages,
-- keyed by the canonical pathname + locale. `overrides` lets us hand-pin
-- copy for top pages (always preferred over `copy`).
--
-- Aggregates hash lets the worker detect when underlying listing data has
-- drifted enough to warrant regeneration, independent of the time-based
-- expires_at.

CREATE TABLE IF NOT EXISTS seo_page_copy (
  page_path        text NOT NULL,
  locale           text NOT NULL,
  h1               text NOT NULL,
  meta_title       text NOT NULL,
  meta_description text NOT NULL,
  intro_paragraph  text NOT NULL,
  nearby_blurb     text,
  faq_items        jsonb NOT NULL DEFAULT '[]'::jsonb,
  aggregates_hash  text NOT NULL,
  generated_at     timestamptz NOT NULL DEFAULT now(),
  expires_at       timestamptz NOT NULL DEFAULT (now() + interval '30 days'),
  PRIMARY KEY (page_path, locale)
);

CREATE INDEX IF NOT EXISTS idx_seo_page_copy_expires
  ON seo_page_copy (expires_at);

CREATE TABLE IF NOT EXISTS seo_page_overrides (
  page_path        text NOT NULL,
  locale           text NOT NULL,
  h1               text,
  meta_title       text,
  meta_description text,
  intro_paragraph  text,
  nearby_blurb     text,
  faq_items        jsonb,
  notes            text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (page_path, locale)
);
