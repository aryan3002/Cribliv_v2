-- 0006_ai_pgvector_embeddings.sql
-- Phase B: AI-ready infrastructure – pgvector, listing embeddings, materialized scores, conversation sessions

BEGIN;

-- ─────────────────────────────────────────────
-- 1. Enable pgvector extension (requires superuser or rds_superuser on AWS)
-- ─────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS vector;

-- ─────────────────────────────────────────────
-- 2. Listing embeddings table  (1536-dim for text-embedding-ada-002 / text-embedding-3-small)
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS listing_embeddings (
  listing_id   UUID PRIMARY KEY REFERENCES listings(id) ON DELETE CASCADE,
  embedding    vector(1536)   NOT NULL,
  model        TEXT           NOT NULL DEFAULT 'text-embedding-3-small',
  token_count  INT            NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ    NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ    NOT NULL DEFAULT now()
);

-- HNSW index for fast cosine-similarity kNN searches
CREATE INDEX IF NOT EXISTS idx_listing_embeddings_hnsw
  ON listing_embeddings
  USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

-- Trigger to keep updated_at current
CREATE TRIGGER trg_listing_embeddings_updated_at
  BEFORE UPDATE ON listing_embeddings
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ─────────────────────────────────────────────
-- 3. Materialized listing scores table
--    Precomputed quality/ranking signals updated by background job
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
-- 4. Conversation sessions for multi-turn search
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
  ON conversation_sessions (session_token)
  WHERE expires_at > now();

CREATE INDEX IF NOT EXISTS idx_conversation_sessions_user
  ON conversation_sessions (user_id)
  WHERE user_id IS NOT NULL;

CREATE TRIGGER trg_conversation_sessions_updated_at
  BEFORE UPDATE ON conversation_sessions
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ─────────────────────────────────────────────
-- 5. Search source tracking column on existing search analytics
--    (add source column to listings for tracking voice vs text queries)
-- ─────────────────────────────────────────────
-- Add search_source column to audit_log if it doesn't exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'audit_log' AND column_name = 'search_source'
  ) THEN
    ALTER TABLE audit_log ADD COLUMN search_source TEXT DEFAULT 'text';
  END IF;
END $$;

COMMIT;
