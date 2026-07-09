-- Rollback for 0052_v1_migration_map.sql
DROP INDEX IF EXISTS idx_v1_migration_map_collection;
DROP INDEX IF EXISTS idx_v1_migration_map_listing;
DROP TABLE IF EXISTS v1_migration_map;
