ALTER TYPE admin_target_type ADD VALUE IF NOT EXISTS 'sales_lead';
ALTER TYPE admin_action_type ADD VALUE IF NOT EXISTS 'update_lead';

DO $$ BEGIN
  CREATE TYPE sales_lead_source AS ENUM ('pg_sales_assist', 'property_management');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE sales_lead_status AS ENUM (
    'new',
    'contacted',
    'qualified',
    'closed_won',
    'closed_lost'
  );
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

CREATE TABLE IF NOT EXISTS sales_leads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_by_user_id uuid NOT NULL REFERENCES users(id),
  listing_id uuid REFERENCES listings(id),
  source sales_lead_source NOT NULL,
  status sales_lead_status NOT NULL DEFAULT 'new',
  idempotency_key varchar(80),
  notes text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  crm_sync_status text NOT NULL DEFAULT 'pending',
  last_crm_push_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS verification_provider_logs (
  id bigserial PRIMARY KEY,
  attempt_id uuid REFERENCES verification_attempts(id) ON DELETE SET NULL,
  listing_id uuid REFERENCES listings(id) ON DELETE SET NULL,
  verification_type verification_type NOT NULL,
  provider text NOT NULL,
  provider_reference text,
  provider_result_code text,
  result verification_result NOT NULL,
  review_reason text,
  retryable boolean NOT NULL DEFAULT false,
  request_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  response_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS outbound_events (
  id bigserial PRIMARY KEY,
  event_type text NOT NULL,
  aggregate_type text NOT NULL,
  aggregate_id uuid,
  dedupe_key text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'pending',
  attempt_count int NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  last_error text,
  dispatched_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(dedupe_key)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_sales_leads_idempotency
  ON sales_leads (created_by_user_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_sales_leads_status_created
  ON sales_leads (status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_sales_leads_source_created
  ON sales_leads (source, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_verification_attempts_listing_result
  ON verification_attempts (listing_id, result, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_verification_provider_logs_attempt_created
  ON verification_provider_logs (attempt_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_payment_webhook_events_processed
  ON payment_webhook_events (provider, processed_at, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_outbound_events_pending
  ON outbound_events (status, next_attempt_at, created_at)
  WHERE status = 'pending';
