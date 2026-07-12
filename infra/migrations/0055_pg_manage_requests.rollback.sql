DROP TRIGGER IF EXISTS set_updated_at ON pg_manage_requests;

ALTER TABLE pg_manage_requests
  DROP CONSTRAINT IF EXISTS pg_manage_requests_payment_order_fk;

DROP INDEX IF EXISTS uq_pg_manage_pay_provider_order;
DROP TABLE IF EXISTS pg_manage_payment_orders;

DROP INDEX IF EXISTS idx_pg_manage_requests_operator;
DROP INDEX IF EXISTS idx_pg_manage_requests_status;
DROP INDEX IF EXISTS uq_pg_manage_approved_per_listing;
DROP INDEX IF EXISTS uq_pg_manage_pending_per_listing;
DROP TABLE IF EXISTS pg_manage_requests;

DROP TYPE IF EXISTS pg_manage_request_status;

ALTER TABLE pg_properties
  DROP COLUMN IF EXISTS managed_activated_at,
  DROP COLUMN IF EXISTS layout_status,
  DROP COLUMN IF EXISTS manage_enabled;
