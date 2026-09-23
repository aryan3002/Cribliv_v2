-- infra/migrations/0073_pg_rent_alloc_seq.rollback.sql
ALTER TABLE pg_rent_payment_allocations DROP COLUMN IF EXISTS seq;
DELETE FROM schema_migrations WHERE filename = '0073_pg_rent_alloc_seq.sql';
