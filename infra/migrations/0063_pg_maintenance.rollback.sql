DROP INDEX IF EXISTS idx_pg_maint_comments_request;
DROP TABLE IF EXISTS pg_maintenance_comments;

DROP TRIGGER IF EXISTS set_updated_at ON pg_maintenance_requests;
DROP INDEX IF EXISTS idx_pg_maint_assignment;
DROP INDEX IF EXISTS idx_pg_maint_property;
DROP TABLE IF EXISTS pg_maintenance_requests;

DROP TYPE IF EXISTS pg_maintenance_status;
