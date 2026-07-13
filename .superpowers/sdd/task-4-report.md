# Task 4 Report: Responsive Leads Route And Kanban Crash Fix

## Status

Complete.

## Root Cause

`LeadKanban` rendered `Droppable` and `Draggable` nodes when `enableDrag` was false, but only wrapped the board in `DragDropContext` when `enableDrag` was true. On coarse/mobile paths this mounted `Droppable` outside the DnD provider and crashed with:

`Could not find "store" in the context of "Connect(Droppable)"`

## Changes

- Changed `/[locale]/owner/leads` from a dashboard redirect to the dedicated `LeadsClient` route.
- Made `LeadKanban` always own `DragDropContext`; drag is still disabled per `Droppable`/`Draggable` through existing `enableDrag` flags.
- Added `LeadMobileList`, a non-DnD mobile/coarse-pointer path with:
  - client-side search and status filtering;
  - existing `LeadCard` and callback-lead monetization controls;
  - optimistic status updates;
  - rollback and visible status message on API failure.
- Refactored `LeadsClient` to derive desktop board capability from:

  ```ts
  window.matchMedia("(hover: hover) and (pointer: fine) and (min-width: 1024px)").matches
  ```

- Kept board/list toggle on fine desktop pointers only.
- Moved mobile export into an overflow action and kept desktop export as a direct button.
- Added callback-lead credit bar under the existing callback lead feature flag.
- Preserved desktop list view and wired it to the shared search query.
- Added responsive styles for sticky mobile search/filter controls, mobile overflow actions, empty/error states, and 44px mobile targets.

## TDD Record

RED:

```bash
pnpm --filter @cribliv/web test -- components/owner/__tests__/leads-client.responsive.test.tsx components/owner/__tests__/lead-kanban-provider.test.tsx
```

Result: failed as expected. `lead-kanban-provider.test.tsx` reproduced the `Connect(Droppable)` store/context crash, and mobile LeadsClient tests failed because the mobile list was absent and Kanban still mounted on coarse pointer.

GREEN:

```bash
pnpm --filter @cribliv/web test -- components/owner/__tests__/leads-client.responsive.test.tsx components/owner/__tests__/lead-kanban-provider.test.tsx
```

Result: 2 files passed, 5 tests passed.

## Final Verification

```bash
pnpm --filter @cribliv/web test -- components/owner/__tests__/leads-client.responsive.test.tsx components/owner/__tests__/lead-kanban-provider.test.tsx components/owner/__tests__/lead-monetization-controls.test.tsx components/owner/__tests__/lead-credit-balance-bar.test.tsx
```

Result: 4 files passed, 16 tests passed.

```bash
pnpm typecheck
```

Result: 6 tasks successful.

```bash
pnpm lint
```

Result: 4 tasks successful. Existing unrelated Next lint warnings remain in other app areas.

```bash
pnpm build
```

Result: 4 tasks successful. Web route `/[locale]/owner/leads` built successfully.

## Concerns

- `pnpm lint` still reports pre-existing warnings outside the touched owner leads files.
- Vitest prints existing jsdom warnings for localStorage availability and navigation during lead monetization tests; tests pass.
- `next build` prints the existing edge-runtime static generation warning; build passes.

## Review Fix Evidence

Status: Complete.

Follow-up changes:

- Replaced the raw guarded CSV export link with `exportOwnerLeadsCsv()`, an authenticated owner API helper that sends `Authorization: Bearer <token>` and returns a CSV `Blob`.
- Updated `LeadsClient` to download CSVs through a button-triggered object URL, revoke the URL, and show localized success/failure status without exposing raw HTTP text.
- Scoped mobile lead cards in the owner leads mobile list to `8px` radius while leaving desktop/public card styling untouched.
- Localized the leads route/mobile-list copy in English and Hindi, including heading, trend text, search, filters, view/export controls, loading/error/empty states, and lead actions.
- Kept the existing `DragDropContext` provider ownership and the mobile non-Kanban path unchanged.

RED:

```bash
pnpm --filter @cribliv/web test -- lib/__tests__/owner-api.leads-export.test.ts components/owner/__tests__/leads-client.responsive.test.tsx
```

Result: failed as expected before implementation. Failures showed `exportOwnerLeadsCsv is not a function`, no button-based CSV export behavior, and missing Hindi localized leads route text.

GREEN:

```bash
pnpm --filter @cribliv/web test -- lib/__tests__/owner-api.leads-export.test.ts components/owner/__tests__/leads-client.responsive.test.tsx
```

Result: 2 files passed, 8 tests passed.

```bash
pnpm --filter @cribliv/web test -- lib/__tests__/owner-api.leads-export.test.ts components/owner/__tests__/leads-client.responsive.test.tsx components/owner/__tests__/lead-kanban-provider.test.tsx
```

Result: 3 files passed, 9 tests passed.

Existing monetization and credit controls:

```bash
pnpm --filter @cribliv/web test -- components/owner/__tests__/lead-monetization-controls.test.tsx components/owner/__tests__/lead-credit-balance-bar.test.tsx
```

Result: 2 files passed, 11 tests passed.

Full required verification:

```bash
pnpm typecheck
```

Result: 6 tasks successful.

```bash
pnpm lint
```

Result: 4 tasks successful. Existing unrelated Next lint warnings remain outside the touched leads files.

```bash
pnpm build
```

Result: 4 tasks successful. Web route `/[locale]/owner/leads` built successfully.
