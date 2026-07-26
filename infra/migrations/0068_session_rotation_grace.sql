-- 0068: Refresh-token rotation reuse grace window.
--
-- Rotation revokes the old sessions row and mints a replacement. That is only
-- safe if the caller reliably receives the replacement. next-auth v5's React
-- Server Component `auth()` branch runs the jwt callback (which rotates) but
-- drops the resulting Set-Cookie header, so the browser kept holding tokens the
-- API had just revoked — a permanent 401 on every subsequent call.
--
-- Recording the successor lets a already-rotated refresh token replay the same
-- successor tokens for a short window, so a rotation whose response was lost
-- heals on the next poll instead of bricking the session.

ALTER TABLE sessions
  ADD COLUMN IF NOT EXISTS rotated_to_session_id uuid REFERENCES sessions(id);

-- Replay looks the predecessor up by refresh token, so that lookup must be fast
-- even though revoked rows accumulate.
CREATE INDEX IF NOT EXISTS idx_sessions_refresh_token_hash
  ON sessions (refresh_token_hash);
