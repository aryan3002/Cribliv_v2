-- Migration 0008: WhatsApp notification log table
-- Tracks all outbound WhatsApp notifications for audit, debugging, and analytics.

BEGIN;

-- ——————————————————————————————————————————————
-- 1. Notification log table
-- ——————————————————————————————————————————————
CREATE TABLE IF NOT EXISTS notification_log (
  id            bigserial PRIMARY KEY,
  user_id       uuid        NOT NULL REFERENCES users(id),
  channel       text        NOT NULL DEFAULT 'whatsapp',  -- 'whatsapp', 'sms', 'email' (future)
  notification_type text    NOT NULL,                      -- e.g. 'owner.contact_unlocked'
  recipient_phone_masked text,                             -- e.g. '+919****10'
  provider_message_id text,                                -- Meta WABA message ID
  status        text        NOT NULL DEFAULT 'pending',    -- 'pending','delivered','failed','read'
  metadata      jsonb       NOT NULL DEFAULT '{}'::jsonb,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

-- Index for querying a user's notification history
CREATE INDEX IF NOT EXISTS idx_notification_log_user_id
  ON notification_log(user_id);

-- Index for filtering by type + status (admin dashboards, analytics)
CREATE INDEX IF NOT EXISTS idx_notification_log_type_status
  ON notification_log(notification_type, status);

-- Index for time-range queries (analytics, log rotation)
CREATE INDEX IF NOT EXISTS idx_notification_log_created_at
  ON notification_log(created_at DESC);

-- ——————————————————————————————————————————————
-- 2. Auto-update updated_at trigger
-- ——————————————————————————————————————————————
CREATE OR REPLACE FUNCTION trg_notification_log_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS set_notification_log_updated_at ON notification_log;
CREATE TRIGGER set_notification_log_updated_at
  BEFORE UPDATE ON notification_log
  FOR EACH ROW EXECUTE FUNCTION trg_notification_log_updated_at();

COMMIT;
