-- R2: rollback restores legacy free-text priority, but the original per-row
-- values were dropped during the enum fold and are not recoverable; all rows
-- receive NULL priority values.

DROP INDEX IF EXISTS idx_pg_assignments_tenant_history;
DROP INDEX IF EXISTS idx_pg_maint_events_request;
DROP INDEX IF EXISTS idx_pg_maint_common_area;
DROP INDEX IF EXISTS idx_pg_maint_category_status;
DROP INDEX IF EXISTS idx_pg_maint_bed_status;
DROP INDEX IF EXISTS idx_pg_maint_assignment_created;
DROP INDEX IF EXISTS idx_pg_maint_auto_close_sweep;
DROP INDEX IF EXISTS idx_pg_maint_due_sweep;
DROP INDEX IF EXISTS idx_pg_maint_closed_at;
DROP INDEX IF EXISTS idx_pg_maint_queue_sla;
DROP INDEX IF EXISTS idx_pg_maint_queue;

DROP TRIGGER IF EXISTS pg_maintenance_apply_v2_defaults ON pg_maintenance_requests;
DROP FUNCTION IF EXISTS pg_maintenance_apply_v2_defaults();

ALTER TABLE pg_maintenance_requests
  DROP CONSTRAINT IF EXISTS pg_maint_resolution_required,
  DROP CONSTRAINT IF EXISTS pg_maint_priority_override_fields,
  DROP CONSTRAINT IF EXISTS pg_maint_sla_hours_matches_priority,
  DROP CONSTRAINT IF EXISTS pg_maint_location_required,
  DROP CONSTRAINT IF EXISTS pg_maint_sla_hours_positive,
  DROP CONSTRAINT IF EXISTS pg_maint_priority_source_valid,
  DROP CONSTRAINT IF EXISTS pg_maint_resolution_cost_nonnegative;

DROP TRIGGER IF EXISTS pg_maintenance_events_immutable ON pg_maintenance_events;
DROP FUNCTION IF EXISTS pg_maintenance_events_reject_mutation();
ALTER TABLE IF EXISTS pg_maintenance_events
  DROP CONSTRAINT IF EXISTS pg_maint_event_internal_note_private;

-- R2: restore legacy free-text priority column (values are lost, all NULL).
ALTER TABLE pg_maintenance_requests DROP COLUMN IF EXISTS priority;
ALTER TABLE pg_maintenance_requests ADD COLUMN IF NOT EXISTS priority text;

DROP TABLE IF EXISTS pg_maintenance_events;

ALTER TABLE pg_maintenance_requests
  DROP COLUMN IF EXISTS reopened_at,
  DROP COLUMN IF EXISTS auto_closed_at,
  DROP COLUMN IF EXISTS auto_close_after,
  DROP COLUMN IF EXISTS last_operator_activity_at,
  DROP COLUMN IF EXISTS last_tenant_activity_at,
  DROP COLUMN IF EXISTS chargeable_damage,
  DROP COLUMN IF EXISTS resolution_cost_paise,
  DROP COLUMN IF EXISTS fix_photo_paths,
  DROP COLUMN IF EXISTS resolution_note,
  DROP COLUMN IF EXISTS resolution_source,
  DROP COLUMN IF EXISTS resolved_by_user_id,
  DROP COLUMN IF EXISTS resolved_at,
  DROP COLUMN IF EXISTS sla_due_at,
  DROP COLUMN IF EXISTS sla_hours,
  DROP COLUMN IF EXISTS priority_override_reason,
  DROP COLUMN IF EXISTS priority_overridden_at,
  DROP COLUMN IF EXISTS priority_overridden_by,
  DROP COLUMN IF EXISTS priority_source,
  DROP COLUMN IF EXISTS location_snapshot,
  DROP COLUMN IF EXISTS location_detail,
  DROP COLUMN IF EXISTS common_area,
  DROP COLUMN IF EXISTS floor,
  DROP COLUMN IF EXISTS bed_id,
  DROP COLUMN IF EXISTS room_id,
  DROP COLUMN IF EXISTS location_kind,
  DROP COLUMN IF EXISTS category_label_snapshot,
  DROP COLUMN IF EXISTS category_slug;

DROP TRIGGER IF EXISTS set_updated_at ON pg_maintenance_categories;
DROP TABLE IF EXISTS pg_maintenance_categories;

DROP TYPE IF EXISTS pg_maintenance_event_visibility;
DROP TYPE IF EXISTS pg_maintenance_event_type;
DROP TYPE IF EXISTS pg_maintenance_common_area;
DROP TYPE IF EXISTS pg_maintenance_location_kind;
DROP TYPE IF EXISTS pg_maintenance_priority;
