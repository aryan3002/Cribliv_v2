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
