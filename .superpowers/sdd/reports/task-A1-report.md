# Task A1 Report: PG Detail Backend Contract and Loader

## Status

Complete. This report is included in the task-scoped commit.

## Scope and files

- `apps/api/src/modules/pg-operator/services/pg-listing.service.ts`
  - Extended `PgListingDetail` with the persisted public-detail fields:
    `pg_details.meal_charges_paise`, `deposit_refundable_pct`,
    `maintenance_paise`, `nearby`, and top-level `total_floors`.
  - Added the matching existing-table columns to `loadListingDetail`'s head
    query, without joins or schema changes.
  - Mapped bigint-backed numeric values with the loader's existing `Number(...)`
    convention, and exposed `total_floors` as a nullable number.
  - Added `normalizeNearby`, which rejects non-object input, trims invalid array
    members, retains only strings for `metro`, `college`, and `office`, and
    returns `null` when no usable values remain.
- `.superpowers/sdd/reports/task-A1-report.md`
  - Required task report only. No unrelated repository files were changed.

## Requirements review

- `verification_status` and `composite_score` were already present in both the
  interface and loader query, so they were intentionally unchanged.
- The new columns are selected from existing aliases `d` and `pp`; no new joins
  were added.
- The worktree was clean and on `codex/pg-detail-page-redesign`, with `HEAD`
  equal to `origin/master` (`d50ab4b311d780d8ac073125572844f913fb56b2`) before
  the change.

## TDD and verification evidence

Task A1's brief assigns extending `apps/api/test/pg-public-detail.test.ts` to
Task A3 and the user restricted production changes to the service. Therefore,
no A1 test file was created or edited. This task does not have a formal RED
signal for the new fields; the first contract assertion is intentionally
deferred to Task A3 by the governing brief.

Pre-change baseline after installing the lockfile-pinned dependencies:

```sh
rtk proxy pnpm --filter @cribliv/api test -- pg-public-detail
```

Result: passed, 1 test file and 3 tests.

Post-change focused loader verification:

```sh
rtk proxy pnpm --filter @cribliv/api test -- pg-public-detail
```

Result: passed, 1 test file and 3 tests. Vitest emitted the existing Vite CJS
Node API deprecation warning only.

Additional verification:

```sh
rtk proxy git diff --check
rtk proxy pnpm --filter @cribliv/shared-types build
rtk proxy pnpm --filter @cribliv/api typecheck
```

Results: whitespace check passed; shared-types build passed; API typecheck
passed. The initial API typecheck in the fresh worktree failed only because the
unbuilt `@cribliv/shared-types` workspace dependency could not be resolved;
after building that prerequisite, it passed without source changes.

## Concern

The current focused test exercises only `location_point`; it does not assert
the five fields added by A1. Task A3 must add those contract assertions before
the frontend consumes this enriched detail payload.
