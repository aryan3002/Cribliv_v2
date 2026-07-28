ALTER TABLE leads
  DROP COLUMN IF EXISTS transferred_at;
-- Note: Postgres cannot remove an enum value; 'transfer_owner' remains on
-- admin_action_type (harmless).
