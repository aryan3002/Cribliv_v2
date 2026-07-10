-- infra/migrations/0053_lead_monetization.sql
-- Migration 0053: callback-guarantee lead monetization (spec 2026-07-10).
-- Leads gain an access lifecycle: 'free' (first-2 per owner), 'locked' (blurred,
-- owner must pay), 'unlocked' (owner paid), 'expired' (24h passed while locked).
-- Enum additions require PG >= 12 (values usable after this migration's txn commits).

ALTER TYPE wallet_txn_type ADD VALUE IF NOT EXISTS 'debit_lead_unlock';
ALTER TYPE wallet_txn_type ADD VALUE IF NOT EXISTS 'refund_lead_dispute';
ALTER TYPE contact_event_type ADD VALUE IF NOT EXISTS 'dispute_refund';
ALTER TYPE contact_event_type ADD VALUE IF NOT EXISTS 'tenant_confirmed';
ALTER TYPE wallet_ref_type ADD VALUE IF NOT EXISTS 'lead';

ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS access_state        text        NOT NULL DEFAULT 'locked',
  ADD COLUMN IF NOT EXISTS unlocked_at         timestamptz,
  ADD COLUMN IF NOT EXISTS unlock_txn_id       uuid        REFERENCES wallet_transactions(id),
  ADD COLUMN IF NOT EXISTS called_at           timestamptz,
  ADD COLUMN IF NOT EXISTS called_by           text,
  ADD COLUMN IF NOT EXISTS call_deadline_at    timestamptz,
  ADD COLUMN IF NOT EXISTS tenant_confirmed_at timestamptz,
  ADD COLUMN IF NOT EXISTS disputed_at         timestamptz;

DO $$ BEGIN
  ALTER TABLE leads ADD CONSTRAINT leads_access_state_check
    CHECK (access_state IN ('free','locked','unlocked','expired'));
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE leads ADD CONSTRAINT leads_called_by_check
    CHECK (called_by IS NULL OR called_by IN ('owner','team'));
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- Rescue queue + reminder sweep scan: uncalled leads approaching their deadline.
CREATE INDEX IF NOT EXISTS idx_leads_call_deadline
  ON leads (call_deadline_at)
  WHERE called_at IS NULL AND call_deadline_at IS NOT NULL;
