# Phase 2 Task P2.4 Frontend Report

## Status

DONE

## Scope delivered

- Extended `apps/web/lib/pg-operations-api.ts` with authenticated managed-property, layout, occupancy, bed-status, and relist calls using `fetchApi<T>()`.
- Added server-auth-gated operations routes at `pg-operator/properties/[propertyId]` and `.../layout`.
- Added client components for the occupancy summary, floor/status-filtered bed grid, inventory-style bed chips, and editable layout builder.
- The dashboard supports blocked, vacant, and relist mutations, updating the local bed state from the API response.
- The layout page shows `Set up bed layout` for `needs_setup`, supports manual room/bed review and editing, and saves the reviewed layout.
- First-time layout generation now receives real, ownership-scoped room type IDs and display attributes from the managed-property detail contract.
- Rooms without an assigned floor remain visible in a dedicated `Unassigned floor` group and filter option.

## Integration contract fix

- Added `PgManagedRoomType` and `PgManagedPropertyDetail` to `packages/shared-types/src/pg-operations.ts`; managed-property list summaries remain unchanged.
- `PgOccupancyService.getManagedProperty` now returns room types linked through the target property's listing after the existing managed-ownership assertion. The query also scopes the listing to the authenticated operator and normalizes rent from Postgres bigint to a number.
- The layout route consumes `property.room_types` directly and presents sharing, AC, bathroom, furnishing, and rent details while sending the real UUID to layout generation.
- Public `PgListingPayload` and migrations were not changed.

## Design

The workspace uses the light PG operator surface tokens with compact bordered sections, table-like occupancy counts, and dense bed chips as the visual signature. It does not add a hero, gradient, glass panel, or a generic KPI-card dashboard.

## TDD and verification

1. Prior frontend RED: `rtk proxy pnpm --filter @cribliv/web test -- lib/__tests__/pg-operations-api.test.ts components/pg-operator/ops/__tests__/PgBedGrid.test.tsx`
   - Failed as expected because the new operations functions and `PgBedGrid` did not exist.
2. Room-type contract RED: `rtk proxy env DATABASE_URL="postgres://postgres:postgres@127.0.0.1:5433/cribliv_v2" pnpm --filter @cribliv/api test -- layout-occupancy.integration.test.ts`
   - Failed as expected because managed-property detail did not contain `room_types`.
3. Unassigned-floor RED: `rtk proxy pnpm --filter @cribliv/web test -- components/pg-operator/ops/__tests__/PgBedGrid.test.tsx`
   - Failed as expected because null-floor rooms were omitted from the rendered floor groups.
4. `rtk proxy pnpm --filter @cribliv/shared-types build` passed.
5. Backend GREEN: the focused layout/occupancy integration suite passed with 1 file and 14 tests.
6. Frontend GREEN: the focused API/grid suites passed with 2 files and 5 tests.
7. `rtk proxy pnpm --filter @cribliv/web typecheck` passed.
8. `rtk git diff --check` passed.

## Browser capture

No browser capture was taken. The operations routes require a live authenticated `pg_operator` NextAuth session and a managed-property fixture; neither the web nor API server was running at verification time. A redirect-only capture would not validate the operations board.

## Concerns

None. Browser capture remains intentionally omitted because the route requires a live authenticated `pg_operator` NextAuth session and managed-property fixture; the contract and UI behavior are covered by focused integration/component tests and web typecheck.

## Review Fix Report - 2026-07-13

### Status

DONE

### Fixes delivered

- Dashboard property, occupancy, or layout API failures now render an explicit error state. The route no longer fabricates zero occupancy counts or an empty bed inventory.
- Layout property failures render an error state without the builder. Layout fetch failures use a distinct failed result and render a non-editable builder state with disabled add/save controls, preventing an empty payload from overwriting saved inventory.
- Layout reconciliation now matches supplied room and bed IDs before mutable room numbers and bed labels. Renames update the existing rows, while no-ID inputs retain number/label fallback behavior.
- Supplied room IDs are rejected unless they belong to the managed property. Supplied bed IDs are rejected unless they belong to the matched room.
- Successful block, vacant, and relist actions call `router.refresh()` after applying the returned bed state so the server-rendered occupancy totals, percentages, and upcoming movement lists are refreshed.
- Added `inactive` to the bed status filter.

### TDD evidence

1. Error-state/filter RED: the new operations route tests found the fabricated dashboard summary, enabled layout controls after fetch failure, redirect on property failure, and missing inactive filter. GREEN: 6 focused tests passed after explicit error states and the filter option were added.
2. Rename RED: the integration test received a different room ID after renaming `101` to `111`. GREEN: the same room ID, bed ID, and assignment foreign key are preserved after room and bed label changes.
3. Ownership RED: foreign room and bed IDs reached database uniqueness errors. GREEN: they are rejected as `invalid_room_id` and `invalid_bed_id` before reconciliation writes.
4. Summary-refresh RED: a successful status mutation called route refresh zero times. GREEN: status and relist tests each verify one refresh after success.

### Final verification

- `rtk proxy pnpm --filter @cribliv/web test -- lib/__tests__/pg-operations-api.test.ts components/pg-operator/ops/__tests__/PgBedGrid.test.tsx 'app/[locale]/pg-operator/properties/[propertyId]/__tests__/operations-pages.test.tsx'` passed: 3 files, 10 tests.
- `rtk proxy env DATABASE_URL="postgres://postgres:postgres@127.0.0.1:5433/cribliv_v2" pnpm --filter @cribliv/api test -- layout-occupancy.integration.test.ts` passed: 1 file, 17 tests.
- `rtk proxy pnpm --filter @cribliv/web typecheck` passed.
- Shared types were not changed, so the conditional shared-types build was not required.

### Concerns

No functional concerns. Vitest still prints the existing Vite CJS Node API deprecation warning in both focused suites.
