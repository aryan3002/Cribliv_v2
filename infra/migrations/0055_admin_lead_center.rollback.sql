-- 0055_admin_lead_center.rollback.sql
-- Enum ADD VALUE is not reversible in Postgres; the added values are harmless
-- and left in place. Only the indexes are dropped.
DROP INDEX IF EXISTS idx_leads_owner_created;
DROP INDEX IF EXISTS idx_leads_access_state;
DROP INDEX IF EXISTS idx_leads_created_at;
