-- Migration 0050: attribute a contact unlock to the traffic source that drove it
-- (e.g. a blog post: 'blog-2bhk-rent-in-noida'). Nullable + additive, so the
-- existing unlock flow is unchanged when no source is supplied. Powers the blog
-- "top converting posts" readout (content -> revenue attribution).

ALTER TABLE contact_unlocks ADD COLUMN IF NOT EXISTS source text;

-- Partial index: only attributed unlocks are queried for conversion reporting.
CREATE INDEX IF NOT EXISTS idx_contact_unlocks_source
  ON contact_unlocks (source)
  WHERE source IS NOT NULL;
