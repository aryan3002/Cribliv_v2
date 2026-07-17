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

---

## Important Review Finding Fixes (2026-07-13)

### Status

DONE

### Fixes

1. **Retired layout round-trip**
   - Root cause: `getLayout()` returned inactive rooms and inactive historical beds even though the editable room `bed_count` represented only the reviewed active inventory. Resubmitting that payload could fail validation or reactivate an inactive room.
   - Fix: editable layout reads now return active rooms and non-inactive beds only. Historical rows remain persisted for assignment integrity, and a regression test retires both a bed and a room, resubmits the returned layout unchanged, and verifies the retired room/bed remain inactive.
   - RED: `returns only editable inventory after historical beds and rooms are retired` failed because the response included inactive bed `101/B` and inactive room `102` (`1 failed, 9 passed`).
   - GREEN: the focused suite passed after filtering retired inventory (`10 passed`).

2. **Cross-property room types**
   - Root cause: the `pg_rooms.room_type_id` foreign key validates only that the room type exists globally; `putLayout()` did not verify that its listing belongs to the target property.
   - Fix: inside the layout transaction, every distinct non-null `room_type_id` is validated through `pg_room_types -> pg_listings.pg_property_id` before reconciliation writes. Invalid membership raises `invalid_room_type`, and rollback preserves `layout_status='needs_setup'` with no rooms.
   - RED: `rejects room types that do not belong to the target property` resolved successfully instead of rejecting (`1 failed, 10 passed`).
   - GREEN: the focused suite passed with transactional validation (`11 passed`).

3. **Upcoming move physical-property scope**
   - Root cause: upcoming move-in/out SQL scoped only on `pg_bed_assignments.pg_property_id`, so inconsistent assignment data could expose a bed joined through a room in another property.
   - Fix: both move queries now also require `r.pg_property_id = $1::uuid`. The regression fixture covers mismatched reserved and notice-served assignments.
   - RED: `excludes upcoming moves when the assignment property does not match the bed room` returned the mismatched move-in (`1 failed, 11 passed`).
   - GREEN: the focused suite passed with both query predicates applied (`12 passed`).

### Covering Test

Command:

```bash
rtk proxy env DATABASE_URL="postgres://postgres:postgres@127.0.0.1:5433/cribliv_v2" pnpm --filter @cribliv/api test -- layout-occupancy.integration.test.ts
```

Result: PASS (exit 0), 1 test file passed and 12/12 tests passed. Vitest duration: 2.35s.

### Additional Verification

- `rtk proxy pnpm --filter @cribliv/api typecheck`: PASS (exit 0).
- `rtk proxy env DATABASE_URL="postgres://postgres:postgres@127.0.0.1:5433/cribliv_v2" pnpm --filter @cribliv/api test -- pg-operations`: PASS (exit 0), 2 test files and 26/26 tests passed.
- `rtk proxy pnpm --filter @cribliv/api lint`: PASS (exit 0); this package's lint script is currently a placeholder.
- Shared-types build was not rerun because no shared-types source or generated output changed.

### Concerns

The test runner continues to emit the existing Vite CJS Node API deprecation warning. No new warnings or failures were observed.

---

## Important Review Finding Fix (2026-07-13): inactive status layout round-trip

### Root cause

`PgLayoutService.getLayout()` correctly excludes inactive beds from editable layouts, but returned each room's stored `bed_count`. After the status route marked one of two beds inactive, GET therefore returned one editable bed with `bed_count: 2`, and re-submitting that payload failed `bed_count_mismatch`. Once the count was corrected, reconciliation would also have hard-deleted the already-inactive, history-free bed because it was absent from the intentionally filtered editable payload.

### Fix

- Derive editable `bed_count` from the returned non-inactive bed array.
- Leave already-inactive beds out of the removal delete path, so an unchanged GET layout can be PUT safely without resurrecting or deleting a bed retired through the status route.

### RED proof

Added route-based integration test: `round-trips an editable layout after a bed is marked inactive through the status route`.

Command:

```bash
rtk proxy env DATABASE_URL="postgres://postgres:postgres@127.0.0.1:5433/cribliv_v2" pnpm --filter @cribliv/api test -- layout-occupancy.integration.test.ts
```

Result: expected FAIL (exit 1), 1 failed and 12 passed. The GET response contained `bed_count: 2` while exposing only the one remaining editable bed.

### GREEN proof

Command:

```bash
rtk proxy env DATABASE_URL="postgres://postgres:postgres@127.0.0.1:5433/cribliv_v2" pnpm --filter @cribliv/api test -- layout-occupancy.integration.test.ts
```

Result: PASS (exit 0), 1 test file and 13/13 tests passed. The route test creates a two-bed layout, PATCHes one bed to `inactive`, GETs the editable layout, PUTs that exact payload, and verifies the retired bed remains `inactive`.

### Additional verification

- `rtk proxy pnpm --filter @cribliv/api typecheck`: PASS (exit 0).

### Concerns

The existing Vite CJS Node API deprecation warning remains in test output. It does not affect the passing result and is outside this task's scope.

---

## Final Whole-Branch Review Fixes (2026-07-13)

### Status

DONE

### Findings fixed

1. **Assigned-bed manual transitions**
   - Root cause: `updateBedStatus()` validated only the requested destination and updated any source status.
   - Fix: the scoped update now atomically excludes `reserved` and `occupied` source rows. Existing assigned beds return `invalid_bed_status_transition`; missing or cross-property beds still return `bed_not_found`.
   - RED: `rejects manual status transitions from reserved and occupied beds` resolved the first reserved-to-blocked attempt instead of rejecting (`1 failed, 18 passed`).

2. **Room-number and bed-label swaps**
   - Root cause: ID-based renames were persisted sequentially against immediate unique constraints, so the first side of a valid swap collided with the second side's old value.
   - Fix: inside the existing transaction, ID-matched renamed rooms and beds first move to guaranteed-unused temporary values. Normal reconciliation then writes final values without replacing rows or assignment foreign keys.
   - RED: `swaps existing room numbers and bed labels while preserving IDs and history` failed on `pg_rooms_pg_property_id_room_number_key` (`1 failed, 19 passed`).

### Final verification

- Focused real-Postgres API suite: PASS, 1 file and 20/20 tests.
- API typecheck: PASS.
- `rtk git diff --check`: PASS.

### Concerns

The existing Vite CJS Node API deprecation warning remains in the focused test output. No new backend warnings or failures were observed.
