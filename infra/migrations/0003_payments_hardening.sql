ALTER TABLE payment_orders
  ADD COLUMN IF NOT EXISTS idempotency_key varchar(80),
  ADD COLUMN IF NOT EXISTS provider_payment_id text,
  ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE payment_webhook_events
  ADD COLUMN IF NOT EXISTS payment_order_id uuid REFERENCES payment_orders(id),
  ADD COLUMN IF NOT EXISTS wallet_txn_id uuid REFERENCES wallet_transactions(id),
  ADD COLUMN IF NOT EXISTS processing_note text;

CREATE UNIQUE INDEX IF NOT EXISTS idx_payment_orders_user_idempotency
  ON payment_orders (user_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_payment_orders_provider_order
  ON payment_orders (provider, provider_order_id)
  WHERE provider_order_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_payment_orders_provider_payment
  ON payment_orders (provider, provider_payment_id)
  WHERE provider_payment_id IS NOT NULL;
