# PG Operator Dashboard V2 — Bed Management (MVP2) + Tenant Portal (MVP3)

**Date:** 2026-07-12
**Status:** Plan for approval
**Supersedes:** `~/Desktop/2026-07-12-pg-saas-operations-v2-design.md` (the Codex draft — this plan corrects its architecture after verifying the codebase)

---

## 1. Context

CribLiv today lets a PG operator create a **public PG listing** (property, room-type pricing, amenities, photos, rules) via a wizard, submit it for admin review, and see a **listing/analytics dashboard**. That is MVP1, and it is live in production on Azure Postgres.

This plan expands the operator into a **PG operations product** on top of that listing:

- **MVP2 — Bed management:** physical rooms, a bed grid, bed statuses, occupant assignments, notice/move-out, and an occupancy dashboard.
- **MVP3 (first cut) — Tenant portal:** a resident "My Stay" view + notice/move-out actions, and maintenance tickets.

Operations are unlocked per-listing through an **admin-approved "Manage PG" request**, keeping the public listing flow untouched and creating a future monetization gate.

**Why this plan differs from the Codex draft:** the draft proposed a brand-new parallel `pg_managed_*` schema (~11 new tables + full in-memory mirror) on the belief that the existing tables were "too listing-shaped." Verified against the code, that premise is wrong:

- `pg_properties` is already a property-shaped operations aggregate (`operator_id`, `display_name`, `city_id`, `locality_id`, `total_floors`, `lat/lng`, `metadata`, `status`).
- `pg_rooms` / `pg_beds` already exist ([`0031_pg_operator_v1.sql`](infra/migrations/0031_pg_operator_v1.sql)) and were **built for this exact feature** — the migration comments: _"V2 hydrates rooms/beds rows + a UI grid; no migration needed."_
- Migration `0041` already **removed** the one-property-per-operator constraint, so **every published PG listing already owns its own dedicated `pg_property`** (`PgPropertiesService` comment: _"1 listing : 1 property — every published listing mints its own pg_property"_).

So the operations aggregate is not something we create — it is the property already linked to the listing. We **evolve** the existing tables and add new tables only for genuinely new concepts (requests, assignments, events, maintenance). This cuts ~11 new tables to ~6, reuses `PgPropertiesService`, and fits a realistic build.

**Outcome:** an operator approved for "Manage PG" gets a bed-grid + occupancy workspace and can assign/relocate occupants; their residents get a portal; the public listing and its admin review are unchanged.

---

## 2. Locked decisions (from brainstorm)

| #   | Decision            | Choice                                                                                                                                                                                                                                                                                                                                          |
| --- | ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Ops schema          | **Evolve** `pg_properties` / `pg_rooms` / `pg_beds`; add new tables only for requests, assignments, events, maintenance. No `pg_managed_*`.                                                                                                                                                                                                     |
| 2   | Unlock gate         | **Full admin-approval queue.** Payment deferred but table is **forward-compatible with Razorpay** (mirror the `rent_agreement_payment_orders` 0029/0030 pattern); operator-side payment wired in a later phase.                                                                                                                                 |
| 3   | MVP3 first cut      | **Tenant "My Stay" + Notice/Move-out** and **Maintenance tickets**. Rent ledger + food opt-out deferred to a later phase.                                                                                                                                                                                                                       |
| 4   | Dual-mode           | Keep the `isEnabled()` guard on every method (API must still boot). Ops **require Postgres**: reads return typed-empty when DB off, writes raise a clear error. **No** in-memory parity for the state machines. Correctness proven by **real Postgres integration tests** (model on `admin/__tests__/pg-admin.controller.integration.test.ts`). |
| 5   | Environments        | **Develop + test against LOCAL Postgres only** (`docker compose -f infra/docker-compose.yml up -d` → `pnpm db:migrate`). The live Azure production DB is migrated **only after all phases are implemented, reviewed, and verified.**                                                                                                            |
| 6   | Roles               | **No new `pg_tenant` role.** Reuse the existing `tenant` role; gate the portal on an active/reserved assignment mapped to the user's id or `phone_e164`.                                                                                                                                                                                        |
| 7   | Occupancy dashboard | Scope to summary counts + %, floor filter, status filter, bed grid, upcoming move-ins/outs. Drop the doc's "fully configurable" gold-plating.                                                                                                                                                                                                   |
| 8   | i18n                | New PG-ops UI uses hardcoded English, matching the adjacent newer PG UI (dashboard, listing detail). Hindi keys via `lib/i18n.ts` are a follow-up.                                                                                                                                                                                              |

---

## 3. Architecture (evolve approach)

```
listings (public projection) ── 1:1 id ── pg_listings (head, source of truth)
                                              │ pg_property_id (already set on publish)
                                              ▼
pg_manage_requests ──approve──▶ pg_properties  (+ manage_enabled, layout_status)   ← OPS AGGREGATE
  (admin queue)                     │
  └ payment_order_id (nullable)     ├── pg_room_types   (existing pricing bands, reused as-is)
       ▼ future Razorpay            ├── pg_rooms        (extended: display_label, bed_count, status)
  pg_manage_payment_orders          │      └── pg_beds  (extended: sort_order, metadata; +'inactive' status)
       (shell, no service yet)      │              └── pg_bed_assignments ── pg_assignment_events
                                    └── pg_maintenance_requests ── pg_maintenance_comments
```

**Key reuse:** a bed's rent = its room's `room_type_id → pg_room_types.monthly_rent_paise`; a tenant-specific override lives on `pg_bed_assignments.monthly_rent_paise`. No room-type copying (the doc's `pg_managed_room_types` is unnecessary).

---

## 4. Data model — migrations

All migrations follow the runner rules ([`infra/migrations/run-migrations.js`](infra/migrations/run-migrations.js)): filename `^\d+_.*\.sql$`, no substring `rollback`, idempotent (`IF NOT EXISTS` / `DO $$ … EXCEPTION WHEN duplicate_object`), one `BEGIN…COMMIT` per file. Next free number is **0055** (highest today is `0054`). Reuse the existing `trigger_set_updated_at()` function for `updated_at` triggers (pattern in 0031). Each migration ships a paired `*.rollback.sql`.

### `0055_pg_manage_requests.sql` — Phase 1 (unlock gate)

```sql
DO $$ BEGIN
  CREATE TYPE pg_manage_request_status AS ENUM ('pending','approved','rejected','cancelled');
  -- forward-compat: 'payment_pending' can be ADDed later without touching bed tables
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- ops columns on the existing property aggregate (denormalized 'is managed' for fast guard checks;
-- authoritative source is an approved pg_manage_requests row, updated atomically at approval)
ALTER TABLE pg_properties
  ADD COLUMN IF NOT EXISTS manage_enabled       boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS layout_status        text NOT NULL DEFAULT 'needs_setup',  -- 'needs_setup' | 'ready'
  ADD COLUMN IF NOT EXISTS managed_activated_at timestamptz;

CREATE TABLE IF NOT EXISTS pg_manage_requests (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id         uuid NOT NULL REFERENCES pg_listings(id) ON DELETE CASCADE,
  pg_property_id     uuid REFERENCES pg_properties(id) ON DELETE SET NULL, -- snapshot of listing's property
  operator_user_id   uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status             pg_manage_request_status NOT NULL DEFAULT 'pending',
  requested_reason   text,
  decided_by         uuid REFERENCES users(id),
  decided_at         timestamptz,
  decision_notes     text,
  payment_order_id   uuid,   -- FK added below; nullable; unused until payment phase
  metadata           jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);
-- one pending request per listing; one approved request per listing
CREATE UNIQUE INDEX IF NOT EXISTS uq_pg_manage_pending_per_listing
  ON pg_manage_requests(listing_id) WHERE status = 'pending';
CREATE UNIQUE INDEX IF NOT EXISTS uq_pg_manage_approved_per_listing
  ON pg_manage_requests(listing_id) WHERE status = 'approved';
CREATE INDEX IF NOT EXISTS idx_pg_manage_requests_status ON pg_manage_requests(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_pg_manage_requests_operator ON pg_manage_requests(operator_user_id);

-- forward-compat payment rail (SHELL — mirrors rent_agreement_payment_orders 0029; NO service wired in MVP)
CREATE TABLE IF NOT EXISTS pg_manage_payment_orders (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             uuid NOT NULL REFERENCES users(id),
  request_id          uuid NOT NULL REFERENCES pg_manage_requests(id) ON DELETE CASCADE,
  provider            text NOT NULL CHECK (provider IN ('razorpay','upi')),
  idempotency_key     text NOT NULL,
  provider_order_id   text NOT NULL,
  provider_payment_id text,
  amount_paise        integer NOT NULL CHECK (amount_paise >= 0),
  status              text NOT NULL DEFAULT 'pending_payment' CHECK (status IN ('pending_payment','paid')),
  metadata            jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, idempotency_key)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_pg_manage_pay_provider_order
  ON pg_manage_payment_orders(provider_order_id);

ALTER TABLE pg_manage_requests
  ADD CONSTRAINT pg_manage_requests_payment_order_fk
  FOREIGN KEY (payment_order_id) REFERENCES pg_manage_payment_orders(id);

-- updated_at trigger reuse
DROP TRIGGER IF EXISTS set_updated_at ON pg_manage_requests;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON pg_manage_requests
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();
```

### `0056_pg_bed_status_inactive.sql` — Phase 2 (enum value, isolated)

Isolated on purpose: `ALTER TYPE … ADD VALUE` is safe on Azure PG (12+) but the new value cannot be _used_ in the same transaction, so it gets its own migration before any table uses it.

```sql
ALTER TYPE pg_bed_status ADD VALUE IF NOT EXISTS 'inactive';
```

### `0057_pg_bed_operations.sql` — Phase 2/3 (layout + assignments)

```sql
-- extend existing physical-inventory tables (do NOT create pg_managed_rooms/beds)
ALTER TABLE pg_rooms
  ADD COLUMN IF NOT EXISTS display_label text,
  ADD COLUMN IF NOT EXISTS bed_count     smallint,
  ADD COLUMN IF NOT EXISTS status        text NOT NULL DEFAULT 'active',   -- 'active' | 'inactive'
  ADD COLUMN IF NOT EXISTS updated_at    timestamptz NOT NULL DEFAULT now();
DROP TRIGGER IF EXISTS set_updated_at ON pg_rooms;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON pg_rooms
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

ALTER TABLE pg_beds
  ADD COLUMN IF NOT EXISTS sort_order smallint,
  ADD COLUMN IF NOT EXISTS metadata   jsonb NOT NULL DEFAULT '{}'::jsonb;

DO $$ BEGIN
  CREATE TYPE pg_assignment_status AS ENUM
    ('reserved','active','notice_served','move_out_requested','move_out_pending_confirmation','moved_out','cancelled');
EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN
  CREATE TYPE pg_assignment_initiator AS ENUM ('operator','tenant','system');
EXCEPTION WHEN duplicate_object THEN null; END $$;

CREATE TABLE IF NOT EXISTS pg_bed_assignments (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pg_property_id        uuid NOT NULL REFERENCES pg_properties(id) ON DELETE CASCADE,
  bed_id                uuid NOT NULL REFERENCES pg_beds(id),
  tenant_user_id        uuid REFERENCES users(id) ON DELETE SET NULL,
  occupant_name         text NOT NULL,
  occupant_phone_e164   text NOT NULL,            -- E.164, matches users.phone_e164 convention
  occupant_gender       text,
  emergency_contact     jsonb,
  status                pg_assignment_status NOT NULL,
  expected_move_in_date date,
  move_in_date          date,
  notice_served_date    date,
  notice_end_date       date,
  move_out_date         date,
  monthly_rent_paise    bigint,                   -- tenant-specific override; null = inherit room type
  security_deposit_paise bigint,
  operator_notes        text,
  created_by            uuid REFERENCES users(id),
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);
-- one active/held assignment per bed
CREATE UNIQUE INDEX IF NOT EXISTS uq_pg_active_assignment_per_bed
  ON pg_bed_assignments(bed_id)
  WHERE status IN ('reserved','active','notice_served','move_out_requested','move_out_pending_confirmation');
-- one active occupied assignment per linked tenant user
CREATE UNIQUE INDEX IF NOT EXISTS uq_pg_active_assignment_per_tenant
  ON pg_bed_assignments(tenant_user_id)
  WHERE tenant_user_id IS NOT NULL
    AND status IN ('active','notice_served','move_out_requested','move_out_pending_confirmation');
CREATE INDEX IF NOT EXISTS idx_pg_assignments_property ON pg_bed_assignments(pg_property_id, status);
CREATE INDEX IF NOT EXISTS idx_pg_assignments_phone ON pg_bed_assignments(occupant_phone_e164);
DROP TRIGGER IF EXISTS set_updated_at ON pg_bed_assignments;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON pg_bed_assignments
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

CREATE TABLE IF NOT EXISTS pg_assignment_events (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  assignment_id uuid NOT NULL REFERENCES pg_bed_assignments(id) ON DELETE CASCADE,
  event_type    text NOT NULL,
  initiator     pg_assignment_initiator NOT NULL,
  actor_user_id uuid REFERENCES users(id),
  from_status   text,
  to_status     text,
  payload       jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_pg_assignment_events_assignment ON pg_assignment_events(assignment_id, created_at);
```

### `0058_pg_maintenance.sql` — Phase 5 (maintenance)

```sql
DO $$ BEGIN
  CREATE TYPE pg_maintenance_status AS ENUM
    ('open','in_progress','waiting_on_tenant','resolved','closed','cancelled');
EXCEPTION WHEN duplicate_object THEN null; END $$;

CREATE TABLE IF NOT EXISTS pg_maintenance_requests (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pg_property_id     uuid NOT NULL REFERENCES pg_properties(id) ON DELETE CASCADE,
  assignment_id      uuid REFERENCES pg_bed_assignments(id) ON DELETE SET NULL,
  created_by_user_id uuid REFERENCES users(id),
  category           text NOT NULL,
  description        text NOT NULL,
  photo_paths        jsonb NOT NULL DEFAULT '[]'::jsonb,
  status             pg_maintenance_status NOT NULL DEFAULT 'open',
  priority           text,
  closed_at          timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_pg_maint_property ON pg_maintenance_requests(pg_property_id, status);
CREATE INDEX IF NOT EXISTS idx_pg_maint_assignment ON pg_maintenance_requests(assignment_id);
DROP TRIGGER IF EXISTS set_updated_at ON pg_maintenance_requests;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON pg_maintenance_requests
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

CREATE TABLE IF NOT EXISTS pg_maintenance_comments (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id     uuid NOT NULL REFERENCES pg_maintenance_requests(id) ON DELETE CASCADE,
  author_user_id uuid REFERENCES users(id),
  author_role    text NOT NULL,   -- 'tenant' | 'pg_operator' | 'admin'
  body           text NOT NULL,
  attachments    jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_pg_maint_comments_request ON pg_maintenance_comments(request_id, created_at);
```

### Deferred migrations (later phase, schemas designed but not built in first cut)

- `0059_pg_rent_ledger.sql` — `pg_rent_ledger_entries` (enum `pg_rent_ledger_status`), periods + paise breakdown, per doc §5.11.
- `0060_pg_food_opt_outs.sql` — `pg_food_opt_outs` (enum `pg_food_opt_out_status`) + `pg_properties.food_opt_out_cutoff_hours smallint DEFAULT 24`, per doc §5.12.

---

## 5. Shared types

New file `packages/shared-types/src/pg-operations.ts` (interfaces only — no runtime values). Add `export * from "./pg-operations";` to [`packages/shared-types/src/index.ts`](packages/shared-types/src/index.ts) (barrel pattern already used there). **Reuse** existing `PgSharingKind`, `PgBathroomKind`, `PgFurnishing` from `pg-operator.ts` — do not redefine.

DTOs: `PgManageRequest`, `PgManageRequestState` (union of statuses + optional `managed_property_id`/`layout_status` for the operator listing panel), `PgManagedPropertySummary`, `PgRoom`, `PgBed`, `PgLayoutDraft`, `PgLayoutPutInput`, `PgBedAssignment`, `PgOccupancySummary`, `PgTenantResidence`, `PgMaintenanceRequest`, `PgMaintenanceComment`. Keep `PgListingPayload` untouched (doc §9 / risk §19 — do not overload it with bed fields).

---

## 6. API — new module `apps/api/src/modules/pg-operations/`

Modeled on `PgOperatorModule` wiring ([`pg-operator.module.ts`](apps/api/src/modules/pg-operator/pg-operator.module.ts)). `imports: [CoreModule, GuardsModule, PgOperatorModule, NotificationsModule]` (reuses `PgPropertiesService` + `NotificationService`, both exported by their modules). Register the new module in [`apps/api/src/app.module.ts`](apps/api/src/app.module.ts) imports. `AdminModule` imports `PgOperationsModule` for the admin-manage controller's service.

### Controllers (all under global `/v1`)

| Controller (`@Controller`)                             | Guards / Roles                         | Routes                                                                                                                                                                                                                                                                               |
| ------------------------------------------------------ | -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `PgManageRequestController` (`pg-operator/listings`)   | `AuthGuard,RolesGuard` / `pg_operator` | `POST :listingId/manage-request`, `GET :listingId/manage-request`                                                                                                                                                                                                                    |
| `PgPropertyOpsController` (`pg-operator/properties`)   | / `pg_operator`                        | `GET /`, `GET :propertyId`, `GET :propertyId/layout`, `POST :propertyId/layout/generate`, `PUT :propertyId/layout`, `GET :propertyId/occupancy`, `PATCH :propertyId/beds/:bedId/status`, `POST :propertyId/beds/:bedId/relist`                                                       |
| `PgAssignmentController` (`pg-operator/properties`)    | / `pg_operator`                        | `GET :propertyId/assignments`, `POST :propertyId/beds/:bedId/reserve`, `POST :propertyId/beds/:bedId/move-in`, `POST :propertyId/assignments/:id/operator-move-out-request`, `POST :propertyId/assignments/:id/confirm-move-out`, `POST :propertyId/assignments/:id/cancel-move-out` |
| `PgMaintenanceController` (`pg-operator/properties`)   | / `pg_operator`                        | `GET :propertyId/maintenance`, `PATCH :propertyId/maintenance/:id`, `POST :propertyId/maintenance/:id/comments`                                                                                                                                                                      |
| `PgResidenceController` (`tenant/pg-residence`)        | / `tenant`                             | `GET /`, `POST notice`, `POST move-out-request`, `POST operator-move-out/:requestId/accept`, `POST operator-move-out/:requestId/reject`, `GET maintenance`, `POST maintenance`, `POST maintenance/:id/comments`                                                                      |
| `PgAdminManageController` (`admin/pg/manage-requests`) | / `admin`                              | `GET /`, `POST :requestId/approve`, `POST :requestId/reject`                                                                                                                                                                                                                         |

Nest allows multiple controllers to share the `pg-operator/properties` prefix as long as route paths are distinct (they are). Mutations use the existing `Idempotency-Key` convention where they create rows (reserve/move-in/manage-request).

### Services (each keeps the `db.isEnabled()` guard; reads → empty when off, writes → `ServiceUnavailableException({code:'operations_requires_db'})`)

- **`PgManageRequestService`** — `create(operatorId, listingId, reason?)` (verify listing ownership via `pg_listings.operator_user_id`; enforce one-pending/one-approved via the partial unique indexes), `getState(operatorId, listingId)`, `listForAdmin(status?)`, `approve(adminId, requestId, notes?)`, `reject(adminId, requestId, notes?)`. **Approve** runs one transaction: set request `approved` + `decided_by/at`; `UPDATE pg_properties SET manage_enabled=true, layout_status='needs_setup', managed_activated_at=now()` for the listing's property; insert an audit row. **Forward-compat payment hook:** a documented insertion point between `create` and `approve` where a future `PgManageCheckoutService` (clone of `CheckoutService`/`PaymentOrdersRepository`) creates a `pg_manage_payment_orders` row and gates approval on webhook `paid`.
- **`PgLayoutService`** — `generateDraft(propertyId, roomCounts[])` builds a proposed room/bed grid from `pg_room_types` + sharing→bed-count defaults (`single=1,double=2,triple=3,quad=4,dorm=N`); operator supplies **rooms-per-type** (room types alone don't encode room counts). `getLayout`, `putLayout` (persist reviewed rooms+beds, set `layout_status='ready'`), `editLayout`, soft-retire beds/rooms to `inactive` when assignment history exists (never hard-delete).
- **`PgOccupancyService`** — `summary(propertyId, filters?)`: counts by status, occupancy %, floor/room rollups, upcoming move-ins/outs, beds-available-from-date. Pure SQL aggregation.
- **`PgBedAssignmentService`** — `reserve`, `moveIn` (match `occupant_phone_e164` → `users.phone_e164` to set `tenant_user_id`), `list`, notice/move-out state machine (`operatorMoveOutRequest`, `confirmMoveOut`, `cancelMoveOut`, tenant `serveNotice`, `tenantMoveOutRequest`, `acceptOperatorMoveOut`, `rejectOperatorMoveOut`). Enforces bed-status ↔ assignment-status coupling (§10). Writes `pg_assignment_events` on every transition. Best-effort `NotificationService.send` (see §7).
- **`PgResidenceService`** — `resolve(userId)`: find active/reserved assignment by `tenant_user_id` OR `users.phone_e164`; return `PgTenantResidence` payload (property name, room, bed, sharing, rent, deposit, notice, lock-in, move-in, food plan, operator contact, house rules, notice countdown) — **never other occupants** (§14). Delegates tenant actions to `PgBedAssignmentService`/`PgMaintenanceService`.
- **`PgMaintenanceService`** — ticket CRUD, status workflow (§10.3), comment thread, attachment paths. Photos: reuse `AzureBlobPhotoStorageService` but namespace blobs by **property** (`pg-maintenance/<propertyId>/…`) rather than `listingId` (its current `assertListingScopedBlobPath` is listing-scoped — add a maintenance-scoped presign variant or a small guard relaxation). For first cut, maintenance photo upload can ship after text-only tickets if time-constrained.

### Access control (service-level, matching `getOwnedProperty` precedent)

Every operator ops method starts with `assertManagedOwnership(operatorId, propertyId)`: property `operator_id === operatorId` **and** `manage_enabled = true`; else `ForbiddenException`. Tenant methods scope strictly to the caller's residence. No property/bed id is ever trusted without this check.

---

## 7. Notifications

`NotificationService` ([`notifications/notification.service.ts`](apps/api/src/modules/notifications/notification.service.ts)) is WhatsApp-only and opt-in/`FF_WHATSAPP_NOTIFICATIONS`-gated. In-app source of truth = `pg_assignment_events` (operator dashboard surfaces pending move-outs/notices from it). Add new `NotificationType` values + templates ([`notification.templates.ts`](apps/api/src/modules/notifications/notification.templates.ts)): `operator.pg_notice_served`, `operator.pg_move_out_requested`, `tenant.pg_move_out_requested`, `tenant.pg_maintenance_update`. WhatsApp dispatch is **best-effort** — never block a state transition on it.

---

## 8. Frontend

Web app: Next.js App Router, CSS modules (no Tailwind), `fetchApi<T>()` unwraps `{data}`, token passed explicitly via `authHeaders(token)` ([`lib/api.ts`](apps/web/lib/api.ts), pattern in [`lib/pg-operator-api.ts`](apps/web/lib/pg-operator-api.ts)). New client file `apps/web/lib/pg-operations-api.ts` for all new calls. Middleware already protects `/*/pg-operator/*`→`pg_operator`, `/*/tenant/*`→`tenant`, `/*/admin/*`→`admin` — no middleware change.

### Operator

- **Listing detail** ([`pg-operator/listings/[id]/page.tsx`](apps/web/app/[locale]/pg-operator/listings/[id]/page.tsx)): add a **`PgManageRequestPanel`** (client) rendering the state machine — `Request Manage PG` / `Pending approval` / `Open Manage PG` (→ ops workspace) / `Rejected` (contact support). Fetches `getManageRequest(listingId, token)`.
- **New ops workspace** `apps/web/app/[locale]/pg-operator/properties/[propertyId]/`:
  - `page.tsx` — ops dashboard: `PgOccupancySummary` + `PgBedGrid` (floor tabs, status chips) + quick actions (reserve / move-in / block / mark vacant / relist) + upcoming move-ins/outs.
  - `layout/page.tsx` — `PgLayoutBuilder` (generate from room types → review → save; edit floors/room numbers/bed labels/counts; mark removed beds inactive).
  - `tenants/page.tsx` — assignments list + `PgBedDrawer`/`PgAssignmentDrawer` (reserve, move-in, notice, move-out).
  - `maintenance/page.tsx` — tickets list + detail with comment thread + status control.
- **Reuse** app-local primitives: `SectionCard`, `SegmentedControl`, `Toggle`, `RupeeInput`, `ChipMultiSelect`, `PgScoreMeter`, admin `Toast`, plus `@cribliv/ui` `Button`/`Badge`.

### Tenant

- **New** `apps/web/app/[locale]/tenant/pg-residence/page.tsx` — sections: My Stay, Notice/Move-out, Maintenance (rent/food are later phases). Uses new residence API client.
- **Enhance** [`tenant/dashboard/page.tsx`](apps/web/app/[locale]/tenant/dashboard/page.tsx) to render a "PG residence" card linking to the portal **only when** `getTenantResidence(token)` returns a residence.

### Admin

- **New** AdminShell tab `apps/web/components/admin/tabs/ManagePgRequestsTab.tsx` — request queue with approve/reject, registered in `AdminShell`/`AdminSidebar`. Client `admin-api.ts` fns: `fetchAdminPgManageRequests`, `approveAdminPgManageRequest`, `rejectAdminPgManageRequest`. Public listing review tabs stay unchanged.

---

## 9. State machines (from the doc — kept)

- **Bed status:** `vacant→reserved→occupied`; `occupied` stays `occupied` while its assignment is `notice_served`; `→vacant` only after confirmed move-out; `blocked↔vacant`; any history-free bed `→inactive`.
- **Assignment:** `reserved→active|cancelled`; `active→notice_served|move_out_requested`; `notice_served|move_out_requested→move_out_pending_confirmation`; `move_out_pending_confirmation→moved_out|active`.
- **Maintenance:** `open→in_progress→(waiting_on_tenant↔in_progress)→resolved→closed`; `open|in_progress→cancelled`.
- **Manage request:** `pending→approved|rejected|cancelled`; `rejected→pending` on re-request (enforced by the partial unique indexes).

Bed status is derived from the bed's active assignment; the coupling is enforced in `PgBedAssignmentService`, not by the DB.

---

## 10. Phasing & execution model (sub-agent driven)

Each phase is independently shippable and testable, has its own migration(s), and follows **TDD** (write the failing Postgres integration test first, then implement). Per the model playbook: **Opus** authors/reviews each phase brief; **Sonnet** executes from the brief; verification flows upward (reviewed by ≥ the model that wrote it). Each phase ends at a review checkpoint before the next starts.

| Phase                                             | Deliverable                                                                                       | Migration(s) | New files (representative)                                                                                                                                                                                              |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------- | ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **1 — Unlock gate + admin queue**                 | Manage-PG request, admin approve/reject, operator listing-detail panel. Payment shell table only. | 0055         | `pg-operations.module.ts`, `pg-manage-request.{controller,service}.ts`, `pg-admin-manage.controller.ts`, `shared-types/pg-operations.ts`, `pg-operations-api.ts`, `PgManageRequestPanel.tsx`, `ManagePgRequestsTab.tsx` |
| **2 — Layout + bed grid + occupancy**             | Generate/save layout, bed-status actions, occupancy dashboard.                                    | 0056, 0057   | `pg-layout.service.ts`, `pg-occupancy.service.ts`, `pg-property-ops.controller.ts`, `properties/[propertyId]/{page,layout/page}.tsx`, `PgBedGrid`, `PgLayoutBuilder`, `PgOccupancySummary`                              |
| **3 — Assignments + notice/move-out**             | Occupant records, reserve/move-in, phone→user link, move-out state machine, notifications.        | (0057)       | `pg-bed-assignment.service.ts`, `pg-assignment.controller.ts`, `tenants/page.tsx`, `PgAssignmentDrawer`, notification types                                                                                             |
| **4 — Tenant portal (My Stay + Notice/Move-out)** | Resident dashboard, notice, move-out accept/reject.                                               | —            | `pg-residence.{controller,service}.ts`, `tenant/pg-residence/page.tsx`, tenant dashboard card                                                                                                                           |
| **5 — Maintenance**                               | Tickets + comments + status, operator & tenant sides.                                             | 0058         | `pg-maintenance.{controller,service}.ts`, `maintenance/page.tsx`, maintenance photo namespace                                                                                                                           |
| **6 — Deferred**                                  | Rent ledger, food opt-out, Manage-PG Razorpay checkout (operator-side payment).                   | 0059, 0060   | rent/food services + UI, `pg-manage-checkout.service.ts`                                                                                                                                                                |

MVP2 = Phases 1–3. MVP3 first cut = Phases 4–5. Realistic scope for the working window is **Phases 1–3 solid**, with 4–5 as the stretch; 6 is explicitly later.

---

## 11. Testing (per phase, against local Postgres)

Integration tests model on `apps/api/src/modules/admin/__tests__/pg-admin.controller.integration.test.ts` (real DB). Unit tests cover state machines.

- **P1:** publish does **not** auto-create a request; request → pending; second pending rejected by unique index; admin approve sets `manage_enabled`+`layout_status`; reject leaves property unmanaged; operator can't request on a listing they don't own; admin-only queue access.
- **P2:** generate produces correct room/bed counts+labels from room types+sharing defaults; save persists rooms/beds; edit preserves history and marks removed beds `inactive`; occupancy counts correct; ops routes 403 without `manage_enabled`.
- **P3:** `uq_pg_active_assignment_per_bed` and `uq_pg_active_assignment_per_tenant` reject doubles; reserve→move-in transitions; `occupant_phone_e164` matches existing user → `tenant_user_id`; full notice/move-out machine; events written.
- **P4:** portal appears only for a mapped tenant (by user id or phone); strict scoping; no other-occupant leakage; notice/move-out from tenant side.
- **P5:** maintenance status/comment workflow; tenant sees only own tickets.
- **Regression gates (unchanged behavior):** `pnpm --filter @cribliv/api test`, public `/v1/pg/*` search/detail, admin review/go-live, `pnpm build && pnpm typecheck && pnpm lint`.
- **Web:** Playwright E2E for the manage-state panel, layout defaults, bed-grid actions, tenant portal visibility, maintenance form.

---

## 12. Verification (end-to-end, before claiming done)

1. `docker compose -f infra/docker-compose.yml up -d && pnpm db:migrate && pnpm db:seed` (local DB, migrations 0055→0058 apply clean; run the paired rollbacks once to confirm reversibility).
2. `pnpm dev`; sign in as seeded operator (`+919999999901`).
3. **P1:** open a listing → Request Manage PG → sign in as admin (`+919999999903`) → approve → operator sees Open Manage PG.
4. **P2:** open ops workspace → generate layout → review → save → bed grid + occupancy render; block/vacant a bed.
5. **P3:** reserve then move-in an occupant (use a phone that is a seeded tenant to prove user linking); serve notice; operator move-out request → confirm; watch bed return to vacant.
6. **P4:** sign in as that tenant (`+919999999902`) → `/tenant/dashboard` shows the residence card → portal shows My Stay + notice countdown; tenant raises move-out; operator accepts.
7. **P5:** tenant files a maintenance ticket → operator triages/comments/closes.
8. Confirm public `/pg/*` listing pages and admin review are **unchanged**; run the full regression gates green (report exact pass/fail counts).
9. Only after all in-scope phases pass locally + review: migrate the production Azure DB in a controlled deploy.

---

## 13. Out of scope / deferred

Public exact bed vacancy; direct rent collection & receipts (rent ledger is read-only history when built); automatic food-billing adjustment; staff management; rent-agreement integration; WhatsApp automation beyond best-effort; multi-listing per managed property; dashboard-only PG (no listing) — the schema doesn't block it later; exposing other occupants to a tenant.

---

## 14. Risks & mitigations

- **`ALTER TYPE … ADD VALUE` in a transaction** → isolated in its own migration (0056), value unused until 0057. ✓
- **Denormalized `manage_enabled` drift** → written only in the same transaction as request approval; the approved `pg_manage_requests` row is authoritative; a test asserts they agree.
- **Maintenance photo scoping** → the current presign is `listingId`-scoped; add a property-scoped variant rather than reuse blindly.
- **Public regression** → no changes to public `/pg/*` contracts or `PgListingPayload`; ops link lives on `pg_properties`/new tables only.
- **Scope vs. window** → phases are independently shippable; if the window closes after Phase 3, MVP2 still ships coherently.
- **Two bed-status concepts** → we extend the existing `pg_bed_status` (add `inactive`) instead of a second enum, avoiding divergence.
