-- ╔══════════════════════════════════════════════════════════════════════════════╗
-- ║  Migration 0010: Lead Management + Fraud Detection                         ║
-- ║  Phase 1A: leads table, lead_events for status audit                       ║
-- ║  Phase 1B: fraud_flags, report_count, last_owner_activity_at               ║
-- ║  Phase 1C: availability toggle support                                     ║
-- ╚══════════════════════════════════════════════════════════════════════════════╝

-- ── Phase 1A: Lead Management ────────────────────────────────────────────────

DO $$ BEGIN
  CREATE TYPE lead_status AS ENUM (
    'new', 'contacted', 'visit_scheduled', 'deal_done', 'lost'
  );
EXCEPTION WHEN duplicate_object THEN null;
END $$;

CREATE TABLE IF NOT EXISTS leads (
  id                  UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id          UUID          NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
  owner_user_id       UUID          NOT NULL REFERENCES users(id),
  tenant_user_id      UUID          NOT NULL REFERENCES users(id),
  contact_unlock_id   UUID          REFERENCES contact_unlocks(id),
  status              lead_status   NOT NULL DEFAULT 'new',
  tenant_phone_masked TEXT,
  owner_notes         TEXT,
  status_changed_at   TIMESTAMPTZ   NOT NULL DEFAULT now(),
  created_at          TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ   NOT NULL DEFAULT now()
);

-- Dedup: same tenant can only have one lead per listing
CREATE UNIQUE INDEX IF NOT EXISTS idx_leads_listing_tenant
  ON leads (listing_id, tenant_user_id);

CREATE INDEX IF NOT EXISTS idx_leads_owner_status
  ON leads (owner_user_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_leads_listing
  ON leads (listing_id, created_at DESC);

CREATE TABLE IF NOT EXISTS lead_events (
  id              BIGSERIAL     PRIMARY KEY,
  lead_id         UUID          NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  from_status     lead_status,
  to_status       lead_status   NOT NULL,
  actor_user_id   UUID          REFERENCES users(id),
  notes           TEXT,
  created_at      TIMESTAMPTZ   NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_lead_events_lead
  ON lead_events (lead_id, created_at DESC);


-- ── Phase 1B: Fraud Detection ────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS fraud_flags (
  id                UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id        UUID          NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
  flag_type         TEXT          NOT NULL,   -- 'duplicate_listing', 'tenant_report', 'stale', 'broker_detected'
  severity          TEXT          NOT NULL DEFAULT 'medium', -- 'low', 'medium', 'high', 'critical'
  reporter_user_id  UUID          REFERENCES users(id),
  details           JSONB         NOT NULL DEFAULT '{}'::jsonb,
  resolved_at       TIMESTAMPTZ,
  resolved_by       UUID          REFERENCES users(id),
  created_at        TIMESTAMPTZ   NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_fraud_flags_listing
  ON fraud_flags (listing_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_fraud_flags_unresolved
  ON fraud_flags (flag_type, created_at DESC)
  WHERE resolved_at IS NULL;

-- Add report_count to listings for quick fraud threshold check
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'listings' AND column_name = 'report_count'
  ) THEN
    ALTER TABLE listings ADD COLUMN report_count SMALLINT NOT NULL DEFAULT 0;
  END IF;
END
$$;


-- ── Phase 1C: Availability Toggle ────────────────────────────────────────────

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'listings' AND column_name = 'last_owner_activity_at'
  ) THEN
    ALTER TABLE listings ADD COLUMN last_owner_activity_at TIMESTAMPTZ DEFAULT now();
  END IF;
END
$$;

-- Backfill last_owner_activity_at from updated_at for existing listings
UPDATE listings
SET last_owner_activity_at = COALESCE(updated_at, created_at)
WHERE last_owner_activity_at IS NULL;
