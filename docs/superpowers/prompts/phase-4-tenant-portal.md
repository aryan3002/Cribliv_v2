# Phase 4 — Tenant portal: My Stay + Notice/Move-out

> First read `docs/superpowers/prompts/00-EXECUTION-CONTEXT.md` and plan §6/§8/§10.4/§14. Depends on Phase 3 (assignments + the tenant-side service methods). No new migration. All DB commands use inline local `DATABASE_URL` (5433).

## Mission

A tenant mapped to an active/reserved PG bed gets a resident dashboard showing their stay and can serve notice / request move-out — reusing the existing `tenant` role, gated on assignment existence (no `pg_tenant` role).

## Approved approach (locked)

Resolve residence by `tenant_user_id` OR verified `users.phone_e164` match. Strict scoping: a tenant sees only their own residence and **never** other occupants (privacy, §14). Keep `/tenant/dashboard` generic; add a residence card + a dedicated `/tenant/pg-residence` page.

## Execution slices

### Slice 4.1 — `PgResidenceService` + controller + tests

- `apps/api/src/modules/pg-operations/services/pg-residence.service.ts` (`PgResidenceService`), dual-mode (reads → `null` when DB off):
  - `resolve(userId)`: find the caller's active/reserved assignment (by `tenant_user_id`, else by the user's `phone_e164`); return a `PgTenantResidence` payload — managed property name, room number, bed label, sharing, rent (assignment override else room-type rent), deposit, notice period, lock-in, move-in date, food plan, operator/owner contact, house rules, and notice status + countdown when active. **Never** include other occupants.
  - Tenant actions delegate to `PgBedAssignmentService` (Phase 3): `serveNotice`, `tenantMoveOutRequest`, `acceptOperatorMoveOut(requestId)`, `rejectOperatorMoveOut(requestId)` — each re-verifies the assignment belongs to the caller.
- `pg-residence.controller.ts` (`@Controller("tenant/pg-residence")`, `@Roles("tenant")`): `GET /`, `POST notice`, `POST move-out-request`, `POST operator-move-out/:requestId/accept`, `POST operator-move-out/:requestId/reject`.
- Add `PgTenantResidence` DTO to shared-types; rebuild.
- **Integration tests** (real 5433): a tenant with an assignment (seeded `+919999999902` linked via Phase 3 move-in) sees their residence; a tenant with none gets `null`; a tenant cannot read another tenant's residence; notice/move-out actions transition the assignment and are scoped to the caller.

### Slice 4.2 — Frontend

- `apps/web/app/[locale]/tenant/pg-residence/page.tsx` — sections: **My Stay** (all the fields above), **Notice / Move-out** (serve-notice button + countdown; accept/reject operator move-out; request move-out). Client fns in `pg-operations-api.ts` (`getTenantResidence(token)`, `serveNotice(token)`, etc.).
- Enhance `apps/web/app/[locale]/tenant/dashboard/page.tsx` (currently a minimal client "My Account" page): call `getTenantResidence` and render a **"PG residence" card linking to `/tenant/pg-residence` only when a residence exists**; otherwise leave the generic dashboard untouched.
- Reuse `SectionCard`, `Badge`, `Button`; CSS modules; hardcoded English.

## Acceptance criteria

- Residence shows only for a mapped tenant; no cross-tenant leakage; no other-occupant data. Tenant actions correctly drive the Phase 3 state machine and are caller-scoped.
- `/tenant/dashboard` unchanged for tenants with no residence. Gates in context §7 green.

## Verification protocol

1. shared-types build → typecheck → `DATABASE_URL=…5433 pnpm --filter @cribliv/api test` (report counts).
2. Manual: after Phase 3 move-in of `+919999999902`, sign in as that tenant → `/en/tenant/dashboard` shows the residence card → open portal → My Stay correct → serve notice → operator sees it (Phase 3). Screenshot the portal.

## Model routing

Sonnet executes both slices from this brief. Opus reviews the scoping/privacy guarantees in Slice 4.1.
