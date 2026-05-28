-- 0007_voice_agent_sessions.sql
-- Real-time conversational Hindi voice agent sessions for property listing capture.
-- Tracks multi-turn conversations between the voice agent and property owners.

BEGIN;

-- ─── Voice agent session status enum ─────────────────────────────────────────
DO $$ BEGIN
  CREATE TYPE voice_agent_session_status AS ENUM ('active', 'completed', 'abandoned', 'error');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ─── Conversation phase enum ─────────────────────────────────────────────────
DO $$ BEGIN
  CREATE TYPE voice_agent_phase AS ENUM (
    'greeting', 'property_type', 'location', 'basics',
    'details', 'amenities', 'confirmation', 'complete'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ─── Voice agent sessions table ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS voice_agent_sessions (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  session_token     TEXT NOT NULL UNIQUE,
  status            voice_agent_session_status NOT NULL DEFAULT 'active',

  -- Conversation state
  current_phase     voice_agent_phase NOT NULL DEFAULT 'greeting',
  conversation_turns JSONB NOT NULL DEFAULT '[]'::jsonb,
  -- Each turn: { "role": "agent"|"user", "text": "...", "timestamp": "...", "extracted_fields": {...} }

  -- Running draft built up from conversation
  partial_draft     JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- Mirrors OwnerDraftPayloadSnakeCase shape

  -- Field tracking
  fields_collected  TEXT[] NOT NULL DEFAULT '{}',   -- field paths already confirmed
  fields_remaining  TEXT[] NOT NULL DEFAULT '{}',   -- required field paths still missing

  -- Metrics
  turn_count        INT NOT NULL DEFAULT 0,
  total_audio_seconds FLOAT NOT NULL DEFAULT 0,

  -- Timestamps
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at        TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '15 minutes')
);

-- ─── Indexes ─────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_voice_agent_sessions_user
  ON voice_agent_sessions(user_id)
  WHERE status = 'active';

CREATE INDEX IF NOT EXISTS idx_voice_agent_sessions_token
  ON voice_agent_sessions(session_token);

CREATE INDEX IF NOT EXISTS idx_voice_agent_sessions_expires
  ON voice_agent_sessions(expires_at)
  WHERE status = 'active';

-- ─── Auto-update updated_at trigger ──────────────────────────────────────────
CREATE OR REPLACE FUNCTION update_voice_agent_session_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_voice_agent_session_updated_at ON voice_agent_sessions;
CREATE TRIGGER trg_voice_agent_session_updated_at
  BEFORE UPDATE ON voice_agent_sessions
  FOR EACH ROW EXECUTE FUNCTION update_voice_agent_session_updated_at();

COMMIT;
