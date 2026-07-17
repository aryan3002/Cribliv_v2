-- Extend existing physical-inventory tables (do NOT create pg_managed_rooms/beds).
ALTER TABLE pg_rooms
  ADD COLUMN IF NOT EXISTS display_label text,
  ADD COLUMN IF NOT EXISTS bed_count     smallint,
  ADD COLUMN IF NOT EXISTS status        text NOT NULL DEFAULT 'active',   -- 'active' | 'inactive'
  ADD COLUMN IF NOT EXISTS updated_at    timestamptz NOT NULL DEFAULT now();
DROP TRIGGER IF EXISTS set_updated_at ON pg_rooms;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON pg_rooms
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

ALTER TABLE pg_beds
  ADD COLUMN IF NOT EXISTS sort_order smallint,
  ADD COLUMN IF NOT EXISTS metadata   jsonb NOT NULL DEFAULT '{}'::jsonb;

DO $$ BEGIN
  CREATE TYPE pg_assignment_status AS ENUM
    ('reserved','active','notice_served','move_out_requested','move_out_pending_confirmation','moved_out','cancelled');
EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN
  CREATE TYPE pg_assignment_initiator AS ENUM ('operator','tenant','system');
EXCEPTION WHEN duplicate_object THEN null; END $$;

CREATE TABLE IF NOT EXISTS pg_bed_assignments (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pg_property_id         uuid NOT NULL REFERENCES pg_properties(id) ON DELETE CASCADE,
  bed_id                 uuid NOT NULL REFERENCES pg_beds(id),
  tenant_user_id         uuid REFERENCES users(id) ON DELETE SET NULL,
  occupant_name          text NOT NULL,
  occupant_phone_e164    text NOT NULL,            -- E.164, matches users.phone_e164 convention
  occupant_gender        text,
  emergency_contact      jsonb,
  status                 pg_assignment_status NOT NULL,
  expected_move_in_date  date,
  move_in_date           date,
  notice_served_date     date,
  notice_end_date        date,
  move_out_date          date,
  monthly_rent_paise     bigint,                   -- Tenant-specific override; null = inherit room type.
  security_deposit_paise bigint,
  operator_notes         text,
  created_by             uuid REFERENCES users(id),
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now()
);
-- One active/held assignment per bed.
CREATE UNIQUE INDEX IF NOT EXISTS uq_pg_active_assignment_per_bed
  ON pg_bed_assignments(bed_id)
  WHERE status IN ('reserved','active','notice_served','move_out_requested','move_out_pending_confirmation');
-- One active occupied assignment per linked tenant user.
CREATE UNIQUE INDEX IF NOT EXISTS uq_pg_active_assignment_per_tenant
  ON pg_bed_assignments(tenant_user_id)
  WHERE tenant_user_id IS NOT NULL
    AND status IN ('active','notice_served','move_out_requested','move_out_pending_confirmation');
CREATE INDEX IF NOT EXISTS idx_pg_assignments_property ON pg_bed_assignments(pg_property_id, status);
CREATE INDEX IF NOT EXISTS idx_pg_assignments_phone ON pg_bed_assignments(occupant_phone_e164);
DROP TRIGGER IF EXISTS set_updated_at ON pg_bed_assignments;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON pg_bed_assignments
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

CREATE TABLE IF NOT EXISTS pg_assignment_events (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  assignment_id uuid NOT NULL REFERENCES pg_bed_assignments(id) ON DELETE CASCADE,
  event_type    text NOT NULL,
  initiator     pg_assignment_initiator NOT NULL,
  actor_user_id uuid REFERENCES users(id),
  from_status   text,
  to_status     text,
  payload       jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_pg_assignment_events_assignment ON pg_assignment_events(assignment_id, created_at);
