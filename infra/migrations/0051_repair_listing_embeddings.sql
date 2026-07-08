-- Migration 0051: repair listing_embeddings after 0006 was recorded on
-- databases where pgvector was not installed yet. This migration is
-- intentionally strict: embeddings cannot run without pgvector, so failure
-- should stop the deploy instead of silently recording another skipped repair.

CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS listing_embeddings (
  listing_id   UUID PRIMARY KEY REFERENCES listings(id) ON DELETE CASCADE,
  embedding    vector(1536)   NOT NULL,
  model        TEXT           NOT NULL DEFAULT 'text-embedding-3-small',
  token_count  INT            NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ    NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ    NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_listing_embeddings_hnsw
  ON listing_embeddings
  USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'trg_listing_embeddings_updated_at'
  ) THEN
    CREATE TRIGGER trg_listing_embeddings_updated_at
      BEFORE UPDATE ON listing_embeddings
      FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();
  END IF;
END $$;
