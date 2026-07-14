# Phase 1 — Manage-PG unlock gate + admin approval queue

> Paste this into Codex/Sonnet running in the repo. **First read** `docs/superpowers/prompts/00-EXECUTION-CONTEXT.md` (safety, DB, patterns) and `docs/superpowers/plans/2026-07-12-pg-operations-v2-plan.md` (§4 has the exact migration DDL). Follow the SAFETY section exactly — all DB commands use the inline local `DATABASE_URL` for 5433.

## Mission

Let an operator request "Manage PG" on a listing they own; let an admin approve/reject from a queue; on approval, flip the listing's existing `pg_property` into managed mode. This is the gate every later phase depends on. Payment is deferred but the DB rail is created now so Razorpay can be wired later with no schema change.

## Approved approach (locked)

Evolve existing tables. The ops aggregate is the `pg_property` **already linked to the listing** (every published PG listing owns one; see context §2). No `pg_managed_*` tables. Admin approval is a real blocking gate with a queue UI. Rejected alternatives: parallel `pg_managed_*` schema (2–3× code, two sources of truth); self-serve unlock (owner wanted admin curation).

## Execution slices (do in order, TDD each)

### Slice 1.1 — Migration `0058_pg_manage_requests.sql` (+ rollback)

- Create `infra/migrations/0058_pg_manage_requests.sql` using the **verbatim DDL in plan §4** (`0058` block): enum `pg_manage_request_status`; `ALTER TABLE pg_properties ADD manage_enabled/layout_status/managed_activated_at`; table `pg_manage_requests` (with the two partial unique indexes `uq_pg_manage_pending_per_listing`, `uq_pg_manage_approved_per_listing`); shell table `pg_manage_payment_orders`; the `payment_order_id` FK; the `set_updated_at` trigger.
- Create `infra/migrations/0058_pg_manage_requests.rollback.sql` that drops them in reverse dependency order.
- Apply: `DATABASE_URL="postgres://postgres:postgres@127.0.0.1:5433/cribliv_v2" pnpm db:migrate`. Verify with `\d pg_manage_requests` and `\d pg_properties`. Then apply the rollback manually once (`psql … -f`), confirm clean, re-apply forward. Leave the DB in the forward (migrated) state.
- **Do NOT touch** `pg_rooms`/`pg_beds`/`pg_bed_status` here — that's Phase 2.

### Slice 1.2 — Shared types

- Add `packages/shared-types/src/pg-operations.ts` with interfaces: `PgManageRequestStatus` (union), `PgManageRequest` (mirror the table columns, snake_case to match existing DTOs), `PgManageRequestState` (`{ status: 'none'|PgManageRequestStatus; request?: PgManageRequest; managed_property_id?: string; layout_status?: string }` — this is what the operator listing panel renders). Reuse existing types where possible.
- `export * from "./pg-operations";` in `packages/shared-types/src/index.ts`. Run `pnpm --filter @cribliv/shared-types build`.

### Slice 1.3 — Backend module + service + controllers + tests

- New module `apps/api/src/modules/pg-operations/` (copy wiring from `pg-operator.module.ts`): `imports: [CoreModule, GuardsModule, PgOperatorModule]`. Register in `apps/api/src/app.module.ts`.
- `services/pg-manage-request.service.ts` (`PgManageRequestService`), dual-mode per context §3:
  - `create(operatorId, listingId, reason?)`: verify `pg_listings.operator_user_id === operatorId` (else `ForbiddenException`); insert `pg_manage_requests` (`status='pending'`, snapshot `pg_property_id` from the listing). The partial unique indexes enforce one-pending/one-approved — catch the unique violation and return a clean `409 { code:'manage_request_exists' }`.
  - `getState(operatorId, listingId)`: return `PgManageRequestState`.
  - `listForAdmin(status?)`: join requests → listing/operator for the queue.
  - `approve(adminId, requestId, notes?)`: **one transaction** — set request `approved`, `decided_by/at`, `decision_notes`; `UPDATE pg_properties SET manage_enabled=true, layout_status='needs_setup', managed_activated_at=now()` for the request's `pg_property_id`. Idempotent if already approved.
  - `reject(adminId, requestId, notes?)`: set `rejected` + decision fields; do NOT touch the property.
  - Leave a clearly-commented `// PAYMENT HOOK (Phase 6): create pg_manage_payment_orders row here and gate approval on webhook 'paid'` between `create` and `approve`.
- `pg-manage-request.controller.ts` (`@Controller("pg-operator/listings")`, `@Roles("pg_operator")`): `POST :listingId/manage-request` (Idempotency-Key), `GET :listingId/manage-request`.
- `pg-admin-manage.controller.ts` (`@Controller("admin/pg/manage-requests")`, `@Roles("admin")`): `GET /`, `POST :requestId/approve`, `POST :requestId/reject`. (Provide `PgManageRequestService` in this module; both controllers use it.)
- **Integration tests** (`src/modules/pg-operations/__tests__/manage-request.integration.test.ts`, real local DB): publish/create a listing fixture; assert (a) requesting on an unowned listing → 403; (b) create → pending; (c) second pending → 409; (d) `approve` sets `manage_enabled=true` + `layout_status='needs_setup'` and the approved row is authoritative (they agree); (e) `reject` leaves `manage_enabled=false`; (f) admin routes reject non-admin role.

### Slice 1.4 — Frontend (operator panel + admin tab)

- `apps/web/lib/pg-operations-api.ts`: `getManageRequest(listingId, token)`, `requestManage(listingId, body, token)`, `fetchAdminPgManageRequests(status, token)`, `approveAdminPgManageRequest(id, body, token)`, `rejectAdminPgManageRequest(id, body, token)` — all thin `fetchApi` wrappers with `authHeaders(token)`.
- `apps/web/components/pg-operator/manage/PgManageRequestPanel.tsx` (client): renders the 4 states — `Request Manage PG` (button → POST) / `Pending approval` / `Open Manage PG` (link to `/[locale]/pg-operator/properties/[propertyId]`, Phase 2 route) / `Rejected` (show notes + contact support). Mount it on `apps/web/app/[locale]/pg-operator/listings/[id]/page.tsx` (server page passes `listingId` + `accessToken`).
- Admin tab `apps/web/components/admin/tabs/ManagePgRequestsTab.tsx`: queue table (operator, listing title, requested_at, status) + approve/reject buttons with a notes field; use `Toast`. Register it in `AdminShell`/`AdminSidebar`.

## Acceptance criteria

- Migration + rollback both clean on 5433. `pg_properties` has the 3 new columns; both partial unique indexes exist.
- All Slice 1.3 integration tests pass (report counts). Ownership + admin-role enforced on every route.
- Operator listing detail shows the correct state; admin queue approves → operator sees "Open Manage PG"; reject → property stays unmanaged.
- `pnpm typecheck` + `pnpm lint` green; existing `pnpm --filter @cribliv/api test` unaffected; public `/v1/pg/*` unchanged.

## Verification protocol

1. Apply migration (+rollback round-trip) as in Slice 1.1.
2. `pnpm --filter @cribliv/shared-types build && pnpm typecheck`.
3. `DATABASE_URL="postgres://postgres:postgres@127.0.0.1:5433/cribliv_v2" pnpm --filter @cribliv/api test` — new tests green, report N passed.
4. Manual: `pnpm dev`; sign in as operator `+919999999901`; you'll need a PG listing (create one via the wizard at `/en/pg-operator/listings/new`, or insert a minimal `pg_listings`+`pg_properties` fixture). Request Manage PG → sign in as admin `+919999999903` → approve → operator sees Open Manage PG. Screenshot both.

## Model routing

Sonnet can execute all four slices from this brief. Have Opus review Slice 1.3's approval transaction (the `manage_enabled` denormalization must be written in the same tx as approval).
