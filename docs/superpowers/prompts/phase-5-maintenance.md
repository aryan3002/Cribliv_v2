# Phase 5 — Maintenance tickets (operator + tenant)

> First read `docs/superpowers/prompts/00-EXECUTION-CONTEXT.md` and plan §4 (`0058_pg_maintenance.sql`), §6, §10.3. Depends on Phases 3–4 (assignments + residence). All DB commands use inline local `DATABASE_URL` (5433).

## Mission

A resident raises maintenance tickets (category, description, optional photo, comment thread); the operator triages, comments, updates status, and closes.

## Approved approach (locked)

New `pg_maintenance_requests` + `pg_maintenance_comments`. Maintenance photos need a **property-scoped** blob namespace (`pg-maintenance/<propertyId>/…`), not the listing-scoped presign. Ship text-only tickets first if the photo namespace work runs long.

## Execution slices

### Slice 5.1 — Migration `0058_pg_maintenance.sql` (renumber if Phase 3 used 0058) (+ rollback)

- Use the **verbatim DDL in plan §4** (`0058` block): enum `pg_maintenance_status`; tables `pg_maintenance_requests`, `pg_maintenance_comments`; indexes; `set_updated_at` trigger. Apply + rollback round-trip.

### Slice 5.2 — `PgMaintenanceService` + controllers + tests

- `apps/api/src/modules/pg-operations/services/pg-maintenance.service.ts`, dual-mode:
  - `create(callerUserId, propertyId, assignmentId, input)` (tenant path resolves property from the caller's residence), `listForProperty(operatorId, propertyId, filters?)`, `listForResidence(tenantUserId)`, `updateStatus(operatorId, requestId, status)` per the §10.3 workflow (`open→in_progress→(waiting_on_tenant↔in_progress)→resolved→closed`; `open|in_progress→cancelled`), `addComment(callerUserId, requestId, body, attachments?)` with `author_role`.
  - Photos: add a property-scoped presign variant on `AzureBlobPhotoStorageService` (or a small guard relaxation) storing under `pg-maintenance/<propertyId>/…`; validate ownership before issuing the SAS. If deferring, accept text-only and leave a TODO.
- Operator controller `pg-maintenance.controller.ts` (`@Controller("pg-operator/properties")`, `@Roles("pg_operator")`): `GET :propertyId/maintenance`, `PATCH :propertyId/maintenance/:id`, `POST :propertyId/maintenance/:id/comments`.
- Tenant routes on the Phase 4 residence controller (`@Controller("tenant/pg-residence")`, `@Roles("tenant")`): `GET maintenance`, `POST maintenance`, `POST maintenance/:id/comments` — all scoped to the caller's residence.
- Add `PgMaintenanceRequest`, `PgMaintenanceComment` DTOs to shared-types; rebuild.
- **Integration tests** (real 5433): status workflow (legal transitions pass, illegal rejected); a tenant sees only their own tickets; operator triage/comment/close; comment thread ordering; property ownership enforced.

### Slice 5.3 — Frontend

- Operator: `apps/web/app/[locale]/pg-operator/properties/[propertyId]/maintenance/page.tsx` — ticket list + detail with status control + comment thread.
- Tenant: add a **Maintenance** section to `/tenant/pg-residence` (Phase 4) — raise-ticket form (category, description, optional photo) + list + comment thread.
- Client fns in `pg-operations-api.ts`. Reuse `SectionCard`, `SegmentedControl` (status), `Toast`; CSS modules.

## Acceptance criteria

- Migration + rollback clean. Status workflow enforced; tenant strictly sees only own tickets; operator scoped by property ownership. Photo uploads (if included) land under the property namespace.
- Gates in context §7 green.

## Verification protocol

1. Migration + rollback.
2. shared-types build → typecheck → `DATABASE_URL=…5433 pnpm --filter @cribliv/api test` (report counts).
3. Manual: tenant raises a ticket → operator triages/comments/closes; tenant sees the updates. Screenshot both sides.

## Model routing

Sonnet executes all slices. Opus reviews the tenant scoping in Slice 5.2 and the photo-namespace guard if implemented.

---

## Deferred (Phase 6 — not in this batch)

Rent ledger (`0059`), food opt-out (`0060`), and the Manage-PG Razorpay checkout (operator-side payment) that fills the `pg_manage_payment_orders` shell from Phase 1. See plan §4 (deferred migrations) and §10 row 6.
