# Phase 3 — Bed assignments + notice/move-out state machine

> First read `docs/superpowers/prompts/00-EXECUTION-CONTEXT.md` and plan §4 (`0057` assignment tables), §6, §9 (state machines), §15. Depends on Phase 2 (rooms/beds exist). **This is the highest-risk phase — Opus should author the service.** All DB commands use inline local `DATABASE_URL` (5433).

## Mission

Let an operator reserve a bed, move an occupant in, and run the full notice/move-out lifecycle with a tenant counter-party — with hard DB constraints preventing double-booking, and an audit event on every transition.

## Approved approach (locked)

Occupant records first; `tenant_user_id` linked when `occupant_phone_e164` matches a `users.phone_e164`. One active assignment per bed and per tenant enforced by **partial unique indexes** (not app code). Bed status is derived from the bed's active assignment.

## CURRENT STATE — read before you start (Phases 1–2 are merged, commit `6baea94`)

Phases 1 and 2 are DONE and committed on `feat/pg-operations-v2`. Do NOT re-create any of this:

- **The assignment schema already exists** — migration `0060_pg_bed_operations.sql` already created enums `pg_assignment_status` (`reserved|active|notice_served|move_out_requested|move_out_pending_confirmation|moved_out|cancelled`) and `pg_assignment_initiator` (`operator|tenant|system`), tables `pg_bed_assignments` (with **both** partial unique indexes `uq_pg_active_assignment_per_bed` and `uq_pg_active_assignment_per_tenant`) and `pg_assignment_events`, plus triggers/indexes. The table is empty. **So Phase 3 needs NO new migration — it is service + controller + tests + frontend only.** (Phase 5 maintenance is already migration `0061_pg_maintenance.sql`.)
- **`PgOccupancyService.summary` already queries assignments** for upcoming move-ins/outs (it reads `status`, `expected_move_in_date`, `move_out_date`, `notice_end_date`, `occupant_name`). Your writes must populate those columns so the dashboard lights up.
- **Guards already in place that your state machine MUST respect (don't regress them):**
  - `pg_beds` derived status is the coupling point. `PgOccupancyService.updateBedStatus` refuses manual changes on `reserved`/`occupied` beds; `relistBed` refuses `reserved`/`occupied`/`inactive`; `PgLayoutService` refuses to remove/retire a `reserved`/`occupied` bed. Your transitions are the ONLY code allowed to move a bed into/out of `reserved`/`occupied`.
- **Reuse the exact transaction+lock pattern from `PgManageRequestService.approve`** (`getClient()` → `BEGIN` → `SELECT … FOR UPDATE` → mutate → `COMMIT`, catch `23505` → 409) and the `assertManagedOwnership` helper style from `PgLayoutService`.

## Execution slices

### Slice 3.1 — (NO migration needed) Verify the constraints, then write a constraint-proof test

- Confirm the schema is present: `psql …5433 -c '\d pg_bed_assignments'` shows both partial unique indexes.
- **Prove the constraints in a test** (real 5433): insert one `active` assignment on a bed, then insert a second `active`/`reserved` on the same bed → expect a `23505` unique violation; likewise a second active assignment for the same `tenant_user_id` → `23505`. These indexes are the load-bearing anti-double-booking guarantee; your service catches `23505` → `409 { code:'bed_or_tenant_occupied' }`.
- If (and only if) you find a genuine schema gap, first check the latest migration on `origin/master`, then add the next free `0062_…`-style migration — but the plan's DDL is already applied, so you should not need to.

### Slice 3.2 — `PgBedAssignmentService` (Opus authors)

In `apps/api/src/modules/pg-operations/services/pg-bed-assignment.service.ts`, dual-mode + `assertManagedOwnership` first. Implement the state machine from plan §9/§15. Every method writes a `pg_assignment_events` row (from_status→to_status, initiator, actor). Catch unique-violation → clean `409 { code:'bed_or_tenant_occupied' }`.

- `reserve(operatorId, propertyId, bedId, occupant)`: create `status='reserved'` assignment; set bed `reserved`. Requires bed currently `vacant`.
- `moveIn(operatorId, propertyId, bedId, occupant)`: activate a reserved assignment or create one directly; set `status='active'`, `move_in_date`, bed `occupied`. **Match `occupant_phone_e164` → `users.phone_e164`; if found, set `tenant_user_id`.**
- `list(operatorId, propertyId, filters?)`.
- Operator-side move-out: `operatorMoveOutRequest` (`active|notice_served → move_out_pending_confirmation`), `confirmMoveOut` (`… → moved_out`, set `move_out_date`, bed `vacant`), `cancelMoveOut` (`move_out_pending_confirmation → active`).
- Tenant-side (called by Phase 4's residence service): `serveNotice` (`active → notice_served`, set `notice_served_date`/`notice_end_date`; **bed stays `occupied`**; notify operator), `tenantMoveOutRequest` (`active → move_out_requested`), `acceptOperatorMoveOut`/`rejectOperatorMoveOut`.
- Enforce the bed-status↔assignment-status coupling in code (bed stays `occupied` while assignment is `notice_served`; only `confirmMoveOut` frees the bed).
- Best-effort `NotificationService.send` on operator-facing transitions; never block on it. Add notification types `operator.pg_notice_served`, `operator.pg_move_out_requested`, `tenant.pg_move_out_requested` + templates.

### Slice 3.3 — Assignment controller

`pg-assignment.controller.ts` (`@Controller("pg-operator/properties")`, `@Roles("pg_operator")`, Idempotency-Key on creators): `GET :propertyId/assignments`, `POST :propertyId/beds/:bedId/reserve`, `POST :propertyId/beds/:bedId/move-in`, `POST :propertyId/assignments/:id/operator-move-out-request`, `POST :propertyId/assignments/:id/confirm-move-out`, `POST :propertyId/assignments/:id/cancel-move-out`. Add `PgBedAssignment` DTO to shared-types; rebuild.

### Slice 3.4 — Integration tests (real 5433, exhaustive)

Both partial unique indexes reject doubles; reserve→move-in transitions and bed-status coupling; phone match sets `tenant_user_id` (use seeded tenant `+919999999902`); full notice→move-out-request→pending→moved_out path frees the bed; cancel returns to active; every transition writes one `pg_assignment_events` row; illegal transitions rejected (e.g. move-in on a `blocked` bed).

### Slice 3.5 — Frontend

`apps/web/app/[locale]/pg-operator/properties/[propertyId]/tenants/page.tsx` — assignments list + `PgAssignmentDrawer` (reserve, move-in with occupant form, notice status, operator move-out actions). Wire bed-grid quick actions (Phase 2) to open the drawer. Add client fns to `pg-operations-api.ts`.

## Acceptance criteria

- Constraints proven at the DB level (double-book impossible). Full state machine covered by passing tests (report counts).
- Phone→user linking works; audit events written on every transition; bed frees only on confirmed move-out.
- Notifications never block a transition. Gates in context §7 green.

## Verification protocol

1. Migration + constraint proof + rollback.
2. shared-types build → typecheck → `DATABASE_URL=…5433 pnpm --filter @cribliv/api test`.
3. Manual: reserve → move-in a seeded tenant's phone (prove linking) → serve notice (bed stays occupied) → operator move-out request → confirm (bed vacant). Screenshot the tenants page + occupancy delta.

## Model routing

**Opus authors Slice 3.2 and reviews 3.1/3.4** (constraints + state machine). Sonnet does the controller and frontend.
