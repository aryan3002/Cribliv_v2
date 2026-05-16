-- ─── Migration 0025: Locality hierarchy ──────────────────────────────────────
-- Adds a self-referential parent_locality_id to localities so micro-areas
-- (e.g. Vibhuti Khand inside Gomti Nagar) can be modelled as first-class
-- localities for SEO while preserving the parent relationship for the UI
-- ("part of Gomti Nagar") and breadcrumbs.
--
-- Also adds `seo_aliases` (alternate slugs people misspell or type, kept on
-- the row so we can resolve a request quickly without a separate table) and
-- an optional `pincode` (already exists on table, no-op safeguard) — no-op
-- check below preserves it.

ALTER TABLE localities
  ADD COLUMN IF NOT EXISTS parent_locality_id int REFERENCES localities(id);

ALTER TABLE localities
  ADD COLUMN IF NOT EXISTS seo_aliases text[] NOT NULL DEFAULT '{}';

ALTER TABLE localities
  ADD COLUMN IF NOT EXISTS description_en text;

ALTER TABLE localities
  ADD COLUMN IF NOT EXISTS description_hi text;

CREATE INDEX IF NOT EXISTS idx_localities_parent     ON localities (parent_locality_id);
CREATE INDEX IF NOT EXISTS idx_localities_aliases    ON localities USING GIN (seo_aliases);
