-- 0006_ai_pgvector_embeddings.sql
-- Phase B: AI-ready infrastructure – pgvector, listing embeddings, materialized scores, conversation sessions
-- NOTE: pgvector extension and listing_embeddings table are created inside a safe DO block.
--       If pgvector is not installed on this PostgreSQL instance, those parts are skipped
--       gracefully and the migration still succeeds. Core app functionality is unaffected.

BEGIN;

-- ─────────────────────────────────────────────
-- 1. Enable pgvector + listing_embeddings (optional – skipped if extension unavailable)
-- ─────────────────────────────────────────────
DO $$
BEGIN
  CREATE EXTENSION IF NOT EXISTS vector;

  EXECUTE '
    CREATE TABLE IF NOT EXISTS listing_embeddings (
      listing_id   UUID PRIMARY KEY REFERENCES listings(id) ON DELETE CASCADE,
      embedding    vector(1536)   NOT NULL,
      model        TEXT           NOT NULL DEFAULT ''text-embedding-3-small'',
      token_count  INT            NOT NULL DEFAULT 0,
      created_at   TIMESTAMPTZ    NOT NULL DEFAULT now(),
      updated_at   TIMESTAMPTZ    NOT NULL DEFAULT now()
    )
  ';

  -- HNSW index for fast cosine-similarity kNN searches
  EXECUTE '
    CREATE INDEX IF NOT EXISTS idx_listing_embeddings_hnsw
      ON listing_embeddings
      USING hnsw (embedding vector_cosine_ops)
      WITH (m = 16, ef_construction = 64)
  ';

  -- Trigger to keep updated_at current
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'trg_listing_embeddings_updated_at'
  ) THEN
    EXECUTE '
      CREATE TRIGGER trg_listing_embeddings_updated_at
        BEFORE UPDATE ON listing_embeddings
        FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at()
    ';
  END IF;

  RAISE NOTICE 'pgvector extension and listing_embeddings table created successfully.';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'pgvector extension not available (%). Skipping listing_embeddings. Install pgvector and re-run this migration to enable AI embeddings.', SQLERRM;
END $$;

-- ─────────────────────────────────────────────
-- 2. Materialized listing scores table
--    Precomputed quality/ranking signals updated by background job
--    (no pgvector dependency – always created)
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS listing_scores (
  listing_id          UUID PRIMARY KEY REFERENCES listings(id) ON DELETE CASCADE,
  verification_score  REAL NOT NULL DEFAULT 0,   -- 0-1 based on verification_status
  freshness_score     REAL NOT NULL DEFAULT 0,   -- 0-1 exponential decay from created_at
  photo_score         REAL NOT NULL DEFAULT 0,   -- 0-1 based on photo_count / 6
  response_rate_score REAL NOT NULL DEFAULT 0.5, -- 0-1 from owner response history
  completeness_score  REAL NOT NULL DEFAULT 0.5, -- 0-1 from filled fields / total fields
  engagement_score    REAL NOT NULL DEFAULT 0.5, -- 0-1 from views, saves, unlocks
  composite_score     REAL NOT NULL DEFAULT 0,   -- weighted combination of all signals
  computed_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_listing_scores_composite
  ON listing_scores (composite_score DESC);

-- ─────────────────────────────────────────────
-- 3. Conversation sessions for multi-turn search (no pgvector dependency)
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS conversation_sessions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID           REFERENCES users(id) ON DELETE SET NULL,
  session_token TEXT           NOT NULL UNIQUE,
  context       JSONB          NOT NULL DEFAULT '{}',
  turn_count    INT            NOT NULL DEFAULT 0,
  last_intent   TEXT,
  last_filters  JSONB          NOT NULL DEFAULT '{}',
  source        TEXT           NOT NULL DEFAULT 'text', -- 'text' | 'voice'
  created_at    TIMESTAMPTZ    NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ    NOT NULL DEFAULT now(),
  expires_at    TIMESTAMPTZ    NOT NULL DEFAULT (now() + interval '30 minutes')
);

CREATE INDEX IF NOT EXISTS idx_conversation_sessions_token
  ON conversation_sessions (session_token);

CREATE INDEX IF NOT EXISTS idx_conversation_sessions_user
  ON conversation_sessions (user_id)
  WHERE user_id IS NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'trg_conversation_sessions_updated_at'
  ) THEN
    CREATE TRIGGER trg_conversation_sessions_updated_at
      BEFORE UPDATE ON conversation_sessions
      FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();
  END IF;
END $$;

-- ─────────────────────────────────────────────
-- 4. Search source tracking column on existing tables
-- ─────────────────────────────────────────────
DO $$
BEGIN
  -- Only add column if the table exists AND the column is not already there
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'audit_logs'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'audit_logs' AND column_name = 'search_source'
  ) THEN
    ALTER TABLE audit_logs ADD COLUMN search_source TEXT DEFAULT 'text';
  END IF;
END $$;

COMMIT;
