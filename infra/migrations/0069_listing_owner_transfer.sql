-- 0069: Listing ownership transfer (flat/house).
--
-- `transferred_at` marks a lead that changed hands with its listing rather than
-- arriving organically. leads.service.ts excludes these from the per-owner
-- lifetime count that grants the first two leads free, so inheriting a listing
-- with history never costs the new owner their allowance.
ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS transferred_at timestamptz;

-- New admin audit action. run-migrations.js wraps each file in its own
-- BEGIN/COMMIT, and ALTER TYPE ... ADD VALUE works inside that transaction on
-- PG12+ so long as the new value is not USED in the same transaction (it is not
-- -- nothing in this file inserts 'transfer_owner').
ALTER TYPE admin_action_type ADD VALUE IF NOT EXISTS 'transfer_owner';
