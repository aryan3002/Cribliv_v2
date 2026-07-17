DO $$ BEGIN
  CREATE TYPE pg_manage_request_status AS ENUM ('pending','approved','rejected','cancelled');
  -- forward-compat: 'payment_pending' can be ADDed later without touching bed tables
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- ops columns on the existing property aggregate (denormalized 'is managed' for fast guard checks;
-- authoritative source is an approved pg_manage_requests row, updated atomically at approval)
ALTER TABLE pg_properties
  ADD COLUMN IF NOT EXISTS manage_enabled       boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS layout_status        text NOT NULL DEFAULT 'needs_setup',  -- 'needs_setup' | 'ready'
  ADD COLUMN IF NOT EXISTS managed_activated_at timestamptz;

CREATE TABLE IF NOT EXISTS pg_manage_requests (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id         uuid NOT NULL REFERENCES pg_listings(id) ON DELETE CASCADE,
  pg_property_id     uuid REFERENCES pg_properties(id) ON DELETE SET NULL, -- snapshot of listing's property
  operator_user_id   uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status             pg_manage_request_status NOT NULL DEFAULT 'pending',
  requested_reason   text,
  decided_by         uuid REFERENCES users(id),
  decided_at         timestamptz,
  decision_notes     text,
  payment_order_id   uuid,   -- FK added below; nullable; unused until payment phase
  metadata           jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);
-- one pending request per listing; one approved request per listing
CREATE UNIQUE INDEX IF NOT EXISTS uq_pg_manage_pending_per_listing
  ON pg_manage_requests(listing_id) WHERE status = 'pending';
CREATE UNIQUE INDEX IF NOT EXISTS uq_pg_manage_approved_per_listing
  ON pg_manage_requests(listing_id) WHERE status = 'approved';
CREATE INDEX IF NOT EXISTS idx_pg_manage_requests_status ON pg_manage_requests(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_pg_manage_requests_operator ON pg_manage_requests(operator_user_id);

-- forward-compat payment rail (SHELL -- mirrors rent_agreement_payment_orders 0029; NO service wired in MVP)
CREATE TABLE IF NOT EXISTS pg_manage_payment_orders (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             uuid NOT NULL REFERENCES users(id),
  request_id          uuid NOT NULL REFERENCES pg_manage_requests(id) ON DELETE CASCADE,
  provider            text NOT NULL CHECK (provider IN ('razorpay','upi')),
  idempotency_key     text NOT NULL,
  provider_order_id   text NOT NULL,
  provider_payment_id text,
  amount_paise        integer NOT NULL CHECK (amount_paise >= 0),
  status              text NOT NULL DEFAULT 'pending_payment' CHECK (status IN ('pending_payment','paid')),
  metadata            jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, idempotency_key)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_pg_manage_pay_provider_order
  ON pg_manage_payment_orders(provider_order_id);

ALTER TABLE pg_manage_requests
  ADD CONSTRAINT pg_manage_requests_payment_order_fk
  FOREIGN KEY (payment_order_id) REFERENCES pg_manage_payment_orders(id);

-- updated_at trigger reuse
DROP TRIGGER IF EXISTS set_updated_at ON pg_manage_requests;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON pg_manage_requests
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();
