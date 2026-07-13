# Phase 2 Task P2.1-P2.2 Migration Report

## Scope completed

- Added `infra/migrations/0056_pg_bed_status_inactive.sql` with the isolated, idempotent enum addition:
  `ALTER TYPE pg_bed_status ADD VALUE IF NOT EXISTS 'inactive';`.
- Added `infra/migrations/0056_pg_bed_status_inactive.rollback.sql` as an explicit no-op. PostgreSQL cannot cleanly remove an enum value.
- Added `infra/migrations/0057_pg_bed_operations.sql` from plan section 4:
  - extends `pg_rooms` with `display_label`, `bed_count`, `status`, and `updated_at`;
  - creates the `pg_rooms` `set_updated_at` trigger using `trigger_set_updated_at()`;
  - extends `pg_beds` with `sort_order` and `metadata`;
  - creates the assignment enums, `pg_bed_assignments`, its indexes and trigger, and `pg_assignment_events` with its index.
- Added `infra/migrations/0057_pg_bed_operations.rollback.sql`, which reverses those objects in dependency order and deliberately leaves the `inactive` enum value intact.

The assignment tables are included in `0057`, as required by plan section 4 and the task brief.

## Static self-review

- `0056` contains only the required isolated enum statement.
- `0057` uses `IF NOT EXISTS` for columns, tables, and indexes; its enum creation handles `duplicate_object`; trigger recreation uses `DROP TRIGGER IF EXISTS`.
- The rollback drops assignment events before assignments, assignment indexes/triggers before their table, assignment enums after dependent tables, then the added bed and room surfaces.
- No production URL was uncommented or used. No files outside the five allowed paths were edited.

## Local verification attempted

All attempted database commands used the required inline local URL:

```sh
DATABASE_URL="postgres://postgres:postgres@127.0.0.1:5433/cribliv_v2" pnpm db:migrate
```

Executed as:

```sh
rtk proxy env DATABASE_URL="postgres://postgres:postgres@127.0.0.1:5433/cribliv_v2" pnpm db:migrate
```

Result: failed before any migration with `connect ECONNREFUSED 127.0.0.1:5433`.

The execution-context recovery command was then attempted:

```sh
rtk docker start cribliv-pg-local
```

Result: failed because the Docker daemon socket was unavailable:

```text
failed to connect to the docker API at unix:///Users/satviksarthak/.docker/run/docker.sock
failed to start containers: cribliv-pg-local
```

Consequently, these required live checks could not be run: applying `0056`/`0057`, querying `enum_range(NULL::pg_bed_status)`, checking the four `pg_rooms` columns, and the `0057` rollback/reapply round trip.

## Required follow-up once Docker is running

```sh
rtk proxy env DATABASE_URL="postgres://postgres:postgres@127.0.0.1:5433/cribliv_v2" pnpm db:migrate
rtk proxy env DATABASE_URL="postgres://postgres:postgres@127.0.0.1:5433/cribliv_v2" psql "postgres://postgres:postgres@127.0.0.1:5433/cribliv_v2" -c "SELECT unnest(enum_range(NULL::pg_bed_status));"
rtk proxy env DATABASE_URL="postgres://postgres:postgres@127.0.0.1:5433/cribliv_v2" psql "postgres://postgres:postgres@127.0.0.1:5433/cribliv_v2" -c "SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'pg_rooms' AND column_name IN ('display_label', 'bed_count', 'status', 'updated_at') ORDER BY column_name;"
rtk proxy env DATABASE_URL="postgres://postgres:postgres@127.0.0.1:5433/cribliv_v2" psql "postgres://postgres:postgres@127.0.0.1:5433/cribliv_v2" -f infra/migrations/0057_pg_bed_operations.rollback.sql
rtk proxy env DATABASE_URL="postgres://postgres:postgres@127.0.0.1:5433/cribliv_v2" psql "postgres://postgres:postgres@127.0.0.1:5433/cribliv_v2" -f infra/migrations/0057_pg_bed_operations.sql
```

The migration runner does not reapply a filename recorded in `schema_migrations`; the final reapply uses the SQL file directly after the round-trip rollback.

## Concern

Docker Desktop/the Docker daemon was unavailable, preventing the only required live PostgreSQL verification. The migration content received static review only.
