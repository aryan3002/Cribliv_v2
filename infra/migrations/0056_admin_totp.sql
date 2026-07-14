-- 0056_admin_totp.sql
-- OTP-free admin login via TOTP. One row per admin who has enrolled an
-- authenticator app. The secret is AES-256-GCM encrypted at rest (see
-- apps/api/src/modules/auth/admin-totp/totp.crypto.ts). All additive.

CREATE TABLE IF NOT EXISTS admin_totp (
  user_id          uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  secret_encrypted bytea       NOT NULL,
  status           text        NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending', 'enabled')),
  last_used_step   bigint,
  failed_attempts  int         NOT NULL DEFAULT 0,
  locked_until     timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  enabled_at       timestamptz,
  updated_at       timestamptz NOT NULL DEFAULT now()
);
