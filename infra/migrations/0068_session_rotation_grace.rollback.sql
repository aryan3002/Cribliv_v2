DROP INDEX IF EXISTS idx_sessions_refresh_token_hash;
ALTER TABLE sessions
  DROP COLUMN IF EXISTS rotated_to_session_id;
