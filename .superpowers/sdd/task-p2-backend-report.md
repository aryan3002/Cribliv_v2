# Phase 2 Task P2.3 Backend Report

## Status

DONE

## Scope

Implemented the Phase 2 layout and occupancy backend only in `apps/api/src/modules/pg-operations/**`:

- `PgLayoutService` for draft generation, layout reads, and transactional layout reconciliation.
- `PgOccupancyService` for managed-property reads, SQL occupancy aggregation, bed status updates, and private relisting.
- `PgPropertyOpsController` with all eight required routes under `pg-operator/properties`.
- Module wiring and a focused real-Postgres integration suite.

No web, migration, or shared-types source files were changed.

## TDD Evidence

### Baseline

Command:

```bash
rtk proxy env DATABASE_URL="postgres://postgres:postgres@127.0.0.1:5433/cribliv_v2" pnpm --filter @cribliv/api test -- manage-request.integration.test.ts
```

Result: PASS, 1 file and 14 tests.

### RED

The focused integration test was added before either service existed.

Command:

```bash
rtk proxy env DATABASE_URL="postgres://postgres:postgres@127.0.0.1:5433/cribliv_v2" pnpm --filter @cribliv/api test -- layout-occupancy.integration.test.ts
```

Result: expected FAIL (exit 1):

```text
FAIL  src/modules/pg-operations/__tests__/layout-occupancy.integration.test.ts
Error: Failed to load url ../services/pg-layout.service
Test Files  1 failed (1)
Tests  no tests
```

This proved the new test surface could not run before the P2.3 implementation.

### GREEN

Focused command after implementation:

```bash
rtk proxy env DATABASE_URL="postgres://postgres:postgres@127.0.0.1:5433/cribliv_v2" pnpm --filter @cribliv/api test -- layout-occupancy.integration.test.ts
```

Result: PASS, 1 file and 9 tests.

The tests cover:

- sharing-based room/bed generation and deterministic labels;
- explicit dorm capacity plus the documented six-bed fallback;
- no persistence during draft generation;
- exact layout persistence and `layout_status = 'ready'`;
- hard deletion for a removed bed without history;
- inactive retirement for a removed bed with assignment history;
- occupancy totals, floor rollups, availability dates, and upcoming moves;
- 403 responses from every property-scoped route when `manage_enabled=false`;
- property/room scoping for bed IDs;
- private relisting without changing a paused public listing;
- DB-off typed-empty reads and `operations_requires_db` write failures.

## Implementation Notes

- Every property-scoped public service method checks `operator_id` and `manage_enabled=true` before reading or mutating property data.
- `putLayout` locks the managed property and reconciles rooms/beds in one transaction, matching rooms by `room_number` and beds by `bed_label`.
- Removed history-free rows are deleted. Removed rows with assignment history are retained as inactive.
- Draft room numbers are deterministic per floor (`101`, `201`, and so on); bed labels use spreadsheet-style labels (`A` through `Z`, then `AA`).
- Dorm capacity uses `room_counts[].bed_count` when provided and falls back to six beds otherwise.
- Occupancy percentage is occupied beds divided by non-inactive beds; inactive beds remain visible in status totals.
- Manual status updates currently allow only `blocked`, `vacant`, and `inactive`. A Phase 3 TODO marks the future active-assignment guard.
- Relist updates only `pg_beds.status` and `pg_beds.available_from`; it does not update `pg_listings`.
- PostgreSQL `date` values are formatted using local calendar fields to avoid positive-timezone day shifts.

## Verification

- Shared-types build: PASS.
- API typecheck: PASS.
- Focused real-Postgres P2.3 suite: PASS, 9/9.
- Existing Phase 1 manage-request suite baseline: PASS, 14/14.
- Final `pg-operations` real-Postgres gate: PASS, 2 files and 23/23 tests.
- `git diff --check` for the scoped API changes: PASS.

## Self-review

- Confirmed all mutation SQL remains property-scoped.
- Confirmed `generateDraft` performs no insert/update/delete.
- Confirmed transaction rollback executes on reconciliation failures.
- Confirmed no SQL in the new services mutates `pg_listings`.
- Confirmed unrelated dirty worktree files remain untouched.

## Concerns

The test runner emits the existing Vite CJS Node API deprecation warning. It does not affect test results and is outside this task's write scope.
