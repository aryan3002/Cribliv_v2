# PG Operator UX Final Fix Report

## Scope

Final-review recovery limited to the web menu, toast, maintenance filter, and PG operator token surfaces. Reverted the previous partial changes to the property operations CSS and assignment drawer files. Preserved unrelated dirty API, config, and documentation work.

## Changes

- Overflow menus now retain their inline fixed `left` position without a competing `right: 0`, and use intrinsic content width.
- Toast actions dismiss their originating toast after invoking the action. The visible-toast cap retains the three newest notifications.
- Desktop maintenance filters are visible by default; the mobile media query still presents the trigger and bottom sheet.
- Mobile maintenance filters now have dialog semantics, initial close-button focus, Escape dismissal, Tab and Shift+Tab focus cycling, trigger focus restoration, and an inert analytics region while open.
- Kept the locale-layout `ToastProvider` in place and retained the tenant residence coverage that mounts `PgResidenceClient` under a provider.
- Added light token aliases for text, raised surfaces, and existing bed status tints in the scoped PG operator token source.

## RED / GREEN

- RED: `OverflowMenu.test.tsx`, `toast-provider.test.tsx`, and `MaintenanceQueueList.test.tsx` initially failed for portal width, oldest-toast visibility/action persistence, and missing modal semantics.
- GREEN: the focused three-file run passed with 18 tests after the fixes.
- A follow-up typecheck exposed the JSX `inert` type mismatch; it was corrected and the maintenance test plus typecheck passed.

## Verification

- `rtk corepack pnpm --filter @cribliv/web test -- OverflowMenu.test.tsx toast-provider.test.tsx MaintenanceQueueList.test.tsx MaintenanceKanban.test.tsx MaintenanceWorkspace.test.tsx PgResidenceClient.test.tsx locale-layout-toast.test.tsx PgBedGrid.test.tsx` - 8 files, 50 tests passed.
- `rtk corepack pnpm --filter @cribliv/web typecheck` - passed.
- Required path-limited `rtk git diff --check` - passed.

## Files Changed

- `apps/web/components/ui/menu/overflow-menu.module.css`
- `apps/web/components/ui/menu/__tests__/OverflowMenu.test.tsx`
- `apps/web/components/ui/toast/Toast.tsx`
- `apps/web/components/ui/toast/toast-provider.tsx`
- `apps/web/components/ui/toast/__tests__/toast-provider.test.tsx`
- `apps/web/components/pg-operator/ops/maintenance/MaintenanceAnalyticsStrip.tsx`
- `apps/web/components/pg-operator/ops/maintenance/MaintenanceQueue.module.css`
- `apps/web/components/pg-operator/ops/maintenance/MaintenanceQueueFilters.tsx`
- `apps/web/components/pg-operator/ops/maintenance/MaintenanceQueueList.tsx`
- `apps/web/components/pg-operator/ops/maintenance/__tests__/MaintenanceQueueList.test.tsx`
- `apps/web/app/[locale]/pg-operator/pg-operator.css`

## Concerns

- React's installed JSX typing models `inert` as a boolean while the runtime requires the empty-attribute form; the analytics component uses a narrow local cast to emit the native inert attribute without a runtime warning.
