# Phase 2 Task P2 Shared Types Report

## Status

DONE

## Scope completed

- Extended `packages/shared-types/src/pg-operations.ts` with the Phase 2 PG operations contracts:
  - `PgManagedPropertySummary`
  - `PgRoom`
  - `PgBed`
  - `PgLayoutDraft`
  - `PgLayoutPutInput`
  - `PgOccupancySummary`
- Added supporting type-only inputs and rollup contracts for room-count draft generation, nested beds, bed availability, floor occupancy, and upcoming moves.
- Added the `inactive` bed status and reused `PgPropertyStatus` from `pg-operator.ts`.
- Preserved the existing Phase 1 manage-request contracts unchanged.
- Confirmed `packages/shared-types/src/index.ts` already exports `pg-operations`; no index change was needed.
- Did not modify migrations or application code.

## Contract decisions

- `PgLayoutDraft.rooms` uses the editable `PgLayoutRoomInput[]` shape so generated drafts do not require persisted IDs or timestamps before save.
- `PgLayoutPutInput` accepts the same reviewed room/bed input shape, with optional IDs for matching existing records during edits.
- `PgBedStatus` includes `vacant`, `reserved`, `occupied`, `blocked`, and `inactive`.
- Occupancy exposes explicit status counts, a status map, floor rollups, upcoming move-in/move-out arrays, and available-from summaries.
- All additions are TypeScript type declarations; no runtime values were added.

## Verification

Command:

```text
rtk proxy pnpm --filter @cribliv/shared-types build
```

Result: passed. TypeScript compilation completed successfully.

No tests were added because this task is limited to shared type declarations and the required verification gate is the package build.

## Self-review

- Existing manage-request imports remain compatible.
- `PgListingPayload` was not changed.
- The shared-types barrel export was verified and left unchanged.
- `git diff --check` passed before the final build.
- Scope is limited to this report and `packages/shared-types/src/pg-operations.ts`.

## Commit

Commit created after verification: `feat(shared-types): add phase 2 pg operations contracts`
