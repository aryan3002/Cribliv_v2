CREATE TABLE IF NOT EXISTS idempotency_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id uuid NOT NULL REFERENCES users(id),
  route text NOT NULL,
  idem_key varchar(80) NOT NULL,
  response jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT now() + interval '24 hours',
  UNIQUE(actor_user_id, route, idem_key)
);

CREATE INDEX IF NOT EXISTS idx_idempotency_keys_expiry
  ON idempotency_keys (expires_at);
