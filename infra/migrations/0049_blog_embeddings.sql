-- Migration 0049: blog_embeddings - vector(1536) per post for uniqueness
-- checks + semantic internal linking (spec sections 2.8 and 5). Mirrors
-- listing_embeddings from 0006: pgvector + HNSW cosine, created inside a safe
-- DO block so the migration still succeeds where pgvector is unavailable.

DO $$
BEGIN
  CREATE EXTENSION IF NOT EXISTS vector;

  EXECUTE '
    CREATE TABLE IF NOT EXISTS blog_embeddings (
      blog_post_id UUID PRIMARY KEY REFERENCES blog_posts(id) ON DELETE CASCADE,
      embedding    vector(1536) NOT NULL,
      model        TEXT NOT NULL DEFAULT ''text-embedding-3-small'',
      token_count  INT NOT NULL DEFAULT 0,
      created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  ';

  EXECUTE '
    CREATE INDEX IF NOT EXISTS idx_blog_embeddings_hnsw
      ON blog_embeddings
      USING hnsw (embedding vector_cosine_ops)
      WITH (m = 16, ef_construction = 64)
  ';

  RAISE NOTICE 'blog_embeddings table created.';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'pgvector not available (%). Skipping blog_embeddings.', SQLERRM;
END $$;
