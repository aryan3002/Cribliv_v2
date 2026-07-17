DROP INDEX IF EXISTS idx_pg_assignment_events_assignment;
DROP TABLE IF EXISTS pg_assignment_events;

DROP TRIGGER IF EXISTS set_updated_at ON pg_bed_assignments;
DROP INDEX IF EXISTS idx_pg_assignments_phone;
DROP INDEX IF EXISTS idx_pg_assignments_property;
DROP INDEX IF EXISTS uq_pg_active_assignment_per_tenant;
DROP INDEX IF EXISTS uq_pg_active_assignment_per_bed;
DROP TABLE IF EXISTS pg_bed_assignments;

DROP TYPE IF EXISTS pg_assignment_initiator;
DROP TYPE IF EXISTS pg_assignment_status;

ALTER TABLE pg_beds
  DROP COLUMN IF EXISTS metadata,
  DROP COLUMN IF EXISTS sort_order;

DROP TRIGGER IF EXISTS set_updated_at ON pg_rooms;
ALTER TABLE pg_rooms
  DROP COLUMN IF EXISTS updated_at,
  DROP COLUMN IF EXISTS status,
  DROP COLUMN IF EXISTS bed_count,
  DROP COLUMN IF EXISTS display_label;
