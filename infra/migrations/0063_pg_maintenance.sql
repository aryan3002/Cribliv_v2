DO $$ BEGIN
  CREATE TYPE pg_maintenance_status AS ENUM
    ('open','in_progress','waiting_on_tenant','resolved','closed','cancelled');
EXCEPTION WHEN duplicate_object THEN null; END $$;

CREATE TABLE IF NOT EXISTS pg_maintenance_requests (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pg_property_id     uuid NOT NULL REFERENCES pg_properties(id) ON DELETE CASCADE,
  assignment_id      uuid REFERENCES pg_bed_assignments(id) ON DELETE SET NULL,
  created_by_user_id uuid REFERENCES users(id),
  category           text NOT NULL,
  description        text NOT NULL,
  photo_paths        jsonb NOT NULL DEFAULT '[]'::jsonb,
  status             pg_maintenance_status NOT NULL DEFAULT 'open',
  priority           text,
  closed_at          timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_pg_maint_property ON pg_maintenance_requests(pg_property_id, status);
CREATE INDEX IF NOT EXISTS idx_pg_maint_assignment ON pg_maintenance_requests(assignment_id);
DROP TRIGGER IF EXISTS set_updated_at ON pg_maintenance_requests;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON pg_maintenance_requests
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

CREATE TABLE IF NOT EXISTS pg_maintenance_comments (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id     uuid NOT NULL REFERENCES pg_maintenance_requests(id) ON DELETE CASCADE,
  author_user_id uuid REFERENCES users(id),
  author_role    text NOT NULL,
  body           text NOT NULL,
  attachments    jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_pg_maint_comments_request ON pg_maintenance_comments(request_id, created_at);
