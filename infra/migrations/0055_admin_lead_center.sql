-- 0055_admin_lead_center.sql
-- Admin Lead Center: audit enum values for admin lead actions, a ledger txn_type
-- for admin-initiated refunds, and covering indexes for the live-board filters.
-- All additive. ADD VALUE cannot be rolled back (enum values persist); the
-- rollback drops only the indexes.

ALTER TYPE admin_target_type ADD VALUE IF NOT EXISTS 'lead';
ALTER TYPE admin_action_type ADD VALUE IF NOT EXISTS 'nudge_owner';
ALTER TYPE admin_action_type ADD VALUE IF NOT EXISTS 'lead_manual_refund';
ALTER TYPE admin_action_type ADD VALUE IF NOT EXISTS 'mark_team_called';
ALTER TYPE wallet_txn_type   ADD VALUE IF NOT EXISTS 'refund_admin';

CREATE INDEX IF NOT EXISTS idx_leads_owner_created ON leads (owner_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_leads_access_state  ON leads (access_state);
CREATE INDEX IF NOT EXISTS idx_leads_created_at    ON leads (created_at DESC);
