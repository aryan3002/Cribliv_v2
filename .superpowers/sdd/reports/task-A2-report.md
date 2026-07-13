# Task A2 Report: Extend `PgPublicDetail`

## Scope

Changed only `apps/web/lib/pg-public-api.ts` for implementation:

- Added exported `PgNearby` with `metro`, `college`, and `office` string arrays.
- Added `meal_charges_paise`, `deposit_refundable_pct`, `maintenance_paise`, and `nearby` to `PgPublicDetail["pg_details"]`.
- Added `total_floors` and `verification_status` to `PgPublicDetail`.
- Did not change request paths, request behavior, or any runtime logic.

## TDD Evidence

An ephemeral, compile-only TypeScript contract probe was used because task scope prohibited changing test files. The probe imported the requested types and required the new top-level and nested fields. It was not retained in the repository.

### RED

Command:

```sh
rtk proxy corepack pnpm --filter @cribliv/web exec tsc --noEmit --strict --target ES2022 --module esnext --moduleResolution bundler --jsx preserve --skipLibCheck /tmp/task-A2-pg-public-api-contract.ts
```

Output (exit 2):

```text
../../../../../../../../tmp/task-A2-pg-public-api-contract.ts(1,15): error TS2305: Module '"/Users/satviksarthak/.codex/worktrees/0f1d/Cribliv_v2_final/apps/web/lib/pg-public-api"' has no exported member 'PgNearby'.
../../../../../../../../tmp/task-A2-pg-public-api-contract.ts(4,36): error TS2344: Type '"total_floors" | "verification_status"' does not satisfy the constraint 'keyof PgPublicDetail'.
  Type '"total_floors"' is not assignable to type 'keyof PgPublicDetail'.
../../../../../../../../tmp/task-A2-pg-public-api-contract.ts(10,3): error TS2344: Type '"meal_charges_paise" | "deposit_refundable_pct" | "maintenance_paise" | "nearby"' does not satisfy the constraint '"total_beds" | "gender_policy" | "tenant_type" | "security_deposit_paise" | "notice_period_days" | "lock_in_months" | "electricity_mode" | "rent_due_day" | "price_negotiable" | "payment_modes" | "meals" | "amenities" | "house_rules"'.
  Type '"meal_charges_paise"' is not assignable to type '"total_beds" | "gender_policy" | "tenant_type" | "security_deposit_paise" | "notice_period_days" | "lock_in_months" | "electricity_mode" | "rent_due_day" | "price_negotiable" | "payment_modes" | "meals" | "amenities" | "house_rules"'.
```

### GREEN

Command:

```sh
rtk proxy corepack pnpm --filter @cribliv/web exec tsc --noEmit --strict --target ES2022 --module esnext --moduleResolution bundler --jsx preserve --skipLibCheck /tmp/task-A2-pg-public-api-contract.ts
```

Output (exit 0):

```text
(no output)
```

## Focused Verification

The focused component test initially could not collect because the worktree did not contain the `packages/ui/dist` package entry.

Initial command:

```sh
rtk proxy corepack pnpm --filter @cribliv/web test -- components/pg/__tests__/PgDetailClient.test.tsx
```

Initial output (exit 1):

```text
FAIL  components/pg/__tests__/PgDetailClient.test.tsx [ components/pg/__tests__/PgDetailClient.test.tsx ]
Error: Failed to resolve entry for package "@cribliv/ui". The package may have incorrect main/module/exports specified in its package.json.
```

Prerequisite command:

```sh
rtk proxy corepack pnpm --filter @cribliv/ui build
```

Output (exit 0):

```text
> @cribliv/ui@0.1.0 build /Users/satviksarthak/.codex/worktrees/0f1d/Cribliv_v2_final/packages/ui
> tsc -p tsconfig.json
```

Rerun command:

```sh
rtk proxy corepack pnpm --filter @cribliv/web test -- components/pg/__tests__/PgDetailClient.test.tsx
```

Output (exit 0):

```text
Test Files  1 passed (1)
Tests  12 passed (12)
```

The passing test emitted existing Vite CJS deprecation and React `act(...)` warnings. They are unrelated to this type-only task and no source files outside task scope were changed.

## Final Diff Check

Command:

```sh
rtk git diff --check
```

Output (exit 0):

```text
(no output)
```

## Concern

`PgPublicDetail` now requires the new fields, while the existing `makeDetail` fixture in `apps/web/components/pg/__tests__/PgDetailClient.test.tsx` does not provide them. Vitest transpilation does not perform TypeScript typechecking, so the focused test remains green. Updating that fixture or running a broad web typecheck is outside the requested single-file implementation boundary.
