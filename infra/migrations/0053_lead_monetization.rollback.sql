-- infra/migrations/0053_lead_monetization.rollback.sql
-- Rollback 0053. Note: Postgres cannot drop enum values; the added
-- wallet_txn_type / contact_event_type values remain (harmless).
DROP INDEX IF EXISTS idx_leads_call_deadline;
ALTER TABLE leads DROP CONSTRAINT IF EXISTS leads_access_state_check;
ALTER TABLE leads DROP CONSTRAINT IF EXISTS leads_called_by_check;
ALTER TABLE leads
  DROP COLUMN IF EXISTS access_state,
  DROP COLUMN IF EXISTS unlocked_at,
  DROP COLUMN IF EXISTS unlock_txn_id,
  DROP COLUMN IF EXISTS called_at,
  DROP COLUMN IF EXISTS called_by,
  DROP COLUMN IF EXISTS call_deadline_at,
  DROP COLUMN IF EXISTS tenant_confirmed_at,
  DROP COLUMN IF EXISTS disputed_at;
