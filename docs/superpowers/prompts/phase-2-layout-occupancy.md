# Phase 2 — Layout builder + bed grid + occupancy dashboard

> First read `docs/superpowers/prompts/00-EXECUTION-CONTEXT.md` and plan §4 (migrations `0056`, `0057`) + §6/§8/§10.2/§10.3. Depends on Phase 1 (a managed property with `manage_enabled=true`). All DB commands use the inline local `DATABASE_URL` (5433).

## Mission

Give an approved operator a physical room/bed layout they generate → review → save, a bed-status grid, and an occupancy summary. Reuse the existing dormant `pg_rooms`/`pg_beds` (built for this in `0031`), extended — not new tables.

## Approved approach (locked)

Extend `pg_rooms`/`pg_beds`; add `inactive` to the existing `pg_bed_status` (not a second enum). Occupancy dashboard is scoped: counts + %, floor filter, status filter, bed grid, upcoming move-ins/outs — not "fully configurable."

## Execution slices

### Slice 2.1 — Migration `0056_pg_bed_status_inactive.sql` (isolated enum add)

- Single statement: `ALTER TYPE pg_bed_status ADD VALUE IF NOT EXISTS 'inactive';`. **Its own migration** because Postgres forbids using a new enum value in the same transaction it's added. Rollback file: a no-op with an explanatory comment (Postgres can't drop an enum value cleanly — document that).
- Apply; confirm `SELECT unnest(enum_range(NULL::pg_bed_status));` includes `inactive`.

### Slice 2.2 — Migration `0057_pg_bed_operations.sql` (+ rollback)

- Use the **verbatim DDL in plan §4** (`0057` block): `ALTER pg_rooms ADD display_label/bed_count/status/updated_at` + `set_updated_at` trigger; `ALTER pg_beds ADD sort_order/metadata`. (Assignment tables in this same file belong to Phase 3 — you MAY create them now since they're in the plan's `0057`, but they carry no logic until Phase 3. If you prefer a tighter diff, split the assignment tables into Phase 3's migration and keep `0057` to the room/bed extensions only. Pick one and note it in the report.)
- Apply + rollback round-trip on 5433.

### Slice 2.3 — Backend: layout + occupancy services + controller + tests

- In `apps/api/src/modules/pg-operations/`:
  - `services/pg-layout.service.ts` (`PgLayoutService`), dual-mode + `assertManagedOwnership` first:
    - `generateDraft(operatorId, propertyId, roomCounts)`: `roomCounts` is operator input `[{ room_type_id, count, floor? }]` (room types alone don't encode room counts). For each, emit `count` proposed rooms; bed count per room from the room type's `sharing` (single=1,double=2,triple=3,quad=4; dorm=explicit N). Returns a `PgLayoutDraft` (NOT persisted).
    - `getLayout(operatorId, propertyId)`: current rooms+beds.
    - `putLayout(operatorId, propertyId, draft)`: persist reviewed rooms+beds in one transaction; set `pg_properties.layout_status='ready'`. Re-running edits: match by room_number/bed_label; **soft-retire** removed rooms/beds to `status/'inactive'` when assignment history exists (never hard-delete); brand-new ones inserted.
  - `services/pg-occupancy.service.ts` (`PgOccupancyService`): `summary(operatorId, propertyId, filters?)` — pure SQL aggregation: counts by `pg_bed_status`, occupancy %, floor rollups, upcoming move-ins/outs (from assignments once Phase 3 lands; until then return zeros for those sections), beds-available-from a date.
  - `pg-property-ops.controller.ts` (`@Controller("pg-operator/properties")`, `@Roles("pg_operator")`): `GET /` (operator's managed properties), `GET :propertyId`, `GET :propertyId/layout`, `POST :propertyId/layout/generate`, `PUT :propertyId/layout`, `GET :propertyId/occupancy`, `PATCH :propertyId/beds/:bedId/status` (set `blocked`/`vacant`/`inactive` when no active assignment blocks it — Phase 3 adds the assignment check; for now allow blocked↔vacant + inactive with a TODO), `POST :propertyId/beds/:bedId/relist` (updates private availability only; NEVER unpauses the public listing).
- Add DTOs to `packages/shared-types/src/pg-operations.ts`: `PgRoom`, `PgBed`, `PgLayoutDraft`, `PgLayoutPutInput`, `PgOccupancySummary`, `PgManagedPropertySummary`. Rebuild shared-types.
- **Integration tests** (real 5433): generate produces correct room/bed counts+labels from room types + sharing defaults; `putLayout` persists exactly; edit that removes a bed with no history hard-removes it, one with history flips to `inactive`; occupancy counts correct; every ops route 403s when `manage_enabled=false`.

### Slice 2.4 — Frontend: ops workspace shell + layout builder + bed grid

- New routes under `apps/web/app/[locale]/pg-operator/properties/[propertyId]/`:
  - `page.tsx` (server, auth-gated like the listing detail page): renders `PgOccupancySummary` + `PgBedGrid` (floor tabs, status chips, quick actions: block/vacant/relist) + upcoming move-ins/outs section.
  - `layout/page.tsx`: `PgLayoutBuilder` — pick room type + count + floor → generate → review/edit floors, room numbers, bed labels, counts → save. Show a "Set up bed layout" empty state when `layout_status='needs_setup'`.
- New client components in `apps/web/components/pg-operator/ops/`: `PgOccupancySummary`, `PgBedGrid`, `PgBedChip`, `PgLayoutBuilder`. Reuse `SectionCard`, `SegmentedControl`, `RupeeInput`, `@cribliv/ui` `Badge`/`Button`; CSS modules.
- Add the client fns to `apps/web/lib/pg-operations-api.ts`.

## Acceptance criteria

- `0056`+`0057` apply + rollback clean; `pg_bed_status` includes `inactive`; `pg_rooms` has the 4 new columns.
- Generate→save yields the exact rooms/beds implied by room types + sharing; edits preserve assignment history via `inactive`.
- Occupancy summary numbers match the underlying rows. Ops routes require `manage_enabled`.
- Bed grid renders per floor; block/vacant/relist update state from API responses; `relist` never changes public listing status.
- Gates in context §7 all green.

## Verification protocol

1. Migrations + rollback round-trip.
2. shared-types build → `pnpm typecheck` → `DATABASE_URL=…5433 pnpm --filter @cribliv/api test` (report counts).
3. Manual: as operator, open the property → generate a layout (e.g. 3 double + 2 triple) → save → bed grid + occupancy render; block a bed then mark vacant. Screenshot the grid.

## Model routing

Opus authors/reviews `PgLayoutService` (generate/persist/soft-retire is the judgment-heavy part). Sonnet does the controller, occupancy SQL, and all frontend.
