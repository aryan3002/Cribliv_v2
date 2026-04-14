-- 0017_alert_zones.sql
-- Phase 5: Alert zones for CriblMap
-- Stores rectangles as sw/ne bounding box coordinates (no PostGIS dependency).

CREATE TABLE IF NOT EXISTS alert_zones (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  sw_lat          FLOAT8 NOT NULL,
  sw_lng          FLOAT8 NOT NULL,
  ne_lat          FLOAT8 NOT NULL,
  ne_lng          FLOAT8 NOT NULL,
  label           TEXT NOT NULL DEFAULT 'My Alert Zone',
  filters         JSONB NOT NULL DEFAULT '{}'::jsonb,
  notify_whatsapp BOOLEAN NOT NULL DEFAULT true,
  notify_email    BOOLEAN NOT NULL DEFAULT false,
  is_active       BOOLEAN NOT NULL DEFAULT true,
  last_triggered  TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_alert_zones_user   ON alert_zones (user_id);
CREATE INDEX IF NOT EXISTS idx_alert_zones_active ON alert_zones (is_active) WHERE is_active = true;
