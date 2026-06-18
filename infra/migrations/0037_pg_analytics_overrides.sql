-- 0037: Admin-controlled, non-destructive analytics masking for PG operators.
-- A row's presence with active=true hides analytics from the OPERATOR's dashboard
-- only. Underlying event tables are never touched; admin always reads raw data.

ALTER TYPE admin_target_type ADD VALUE IF NOT EXISTS 'pg_property';
ALTER TYPE admin_action_type ADD VALUE IF NOT EXISTS 'edit_pg_property';
ALTER TYPE admin_action_type ADD VALUE IF NOT EXISTS 'set_analytics_override';
ALTER TYPE admin_action_type ADD VALUE IF NOT EXISTS 'clear_analytics_override';

CREATE TABLE IF NOT EXISTS pg_analytics_overrides (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  operator_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  pg_property_id uuid REFERENCES pg_properties(id) ON DELETE CASCADE,  -- NULL = operator-global
  active         boolean NOT NULL DEFAULT true,
  reason         text,
  created_by     uuid NOT NULL REFERENCES users(id),
  updated_by     uuid REFERENCES users(id),
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_pg_override_global
  ON pg_analytics_overrides(operator_id) WHERE pg_property_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_pg_override_property
  ON pg_analytics_overrides(operator_id, pg_property_id) WHERE pg_property_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_pg_override_operator_active
  ON pg_analytics_overrides(operator_id) WHERE active = true;
