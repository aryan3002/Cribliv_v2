# Maintenance Ops V2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a production-grade PG maintenance operations system with persisted SLA, structured location, dense queue + kanban, internal notes, immutable timeline, resolution records, auto-close, tenant historical read access, and basic analytics.

**Architecture:** Evolve the existing `pg_maintenance_requests` and `pg_maintenance_comments` baseline from `0061_pg_maintenance.sql`; do not replace it. Add normalized columns, enums, lookup categories, and a dedicated `pg_maintenance_events` audit/timeline table so queue filtering, SLA sweeps, analytics, access rules, and historical display use real persisted data rather than inferred JSON state. Split the current frontend maintenance workspace into focused tenant/operator/detail/timeline/resolution units instead of expanding one large component.

**Tech Stack:** NestJS modular monolith, Postgres raw SQL migrations, `pg` transactions, Next.js 14 App Router, React, TypeScript, Vitest integration/unit tests, Playwright only if final browser proof is requested, Azure Blob photo upload flow already under `pg-maintenance/<propertyId>/<requestId>/...`.

## Global Constraints

- Current migration baseline after master sync is `0058_pg_manage_requests.sql`, `0059_pg_bed_status_inactive.sql`, `0060_pg_bed_operations.sql`, and `0061_pg_maintenance.sql`; Maintenance Ops V2 must start at `0062_pg_maintenance_ops_v2.sql`.
- Do not revert or renumber the user's current migration changes; treat the deleted old `0055`-`0058` PG migration files and new `0058`-`0061` files as owner-managed worktree changes.
- No new staff, vendor, or assignment roles. Maintenance ownership is property/operator-owned only.
- Priority is auto-selected from category by default and can be overridden by the operator with persisted actor, timestamp, and reason.
- SLA timings are exact: emergency 4h, high 24h, normal 72h, low 168h.
- Tenant location options are exact: `bed`, `room`, `floor`, `common_area`, `property_wide`, `other`.
- Common area options are exact: kitchen, common_bathroom, lift, stairs, corridor, terrace, laundry, parking, reception, mess_food_area, water_tank_motor, wifi_router, security_cctv, other.
- Operator queue must support both dense list and kanban views; default sort is SLA due first, then newest.
- Internal notes are operator-only and must not be stored as public comments.
- Timeline events are immutable persisted rows and must be written in the same transaction as their source mutation.
- Resolution requires a non-empty note and a required chargeable-damage boolean; fix photos and cost are optional; cost must be non-negative when present.
- Resolved tickets auto-close after 72h unless tenant comments or reopens before the deadline.
- Tenant historical access is read-only for 6 months after move-out; tenants cannot create common-area tickets after move-out.
- Operator maintenance records are retained forever for managed properties; do not add TTL deletion.
- Existing photo constraints remain: JPG/PNG/WebP, max 6 photos per ticket/comment/resolution upload action, max 10 MB per photo.
- All DB-backed services must keep the repository's dual-mode pattern: reads may return typed-empty when DB is disabled, writes throw `operations_requires_db`.
- Use `rtk corepack pnpm ...` or `rtk env DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5433/cribliv_v2 PATH=/opt/homebrew/bin:$PATH corepack pnpm ...` for verification, matching the repo's current tooling.

---

## Current Repository State To Preserve

The user has already updated prior PG migrations to align with `master`.

Current relevant migration files:

- `infra/migrations/0058_pg_manage_requests.sql`
- `infra/migrations/0058_pg_manage_requests.rollback.sql`
- `infra/migrations/0059_pg_bed_status_inactive.sql`
- `infra/migrations/0059_pg_bed_status_inactive.rollback.sql`
- `infra/migrations/0060_pg_bed_operations.sql`
- `infra/migrations/0060_pg_bed_operations.rollback.sql`
- `infra/migrations/0061_pg_maintenance.sql`
- `infra/migrations/0061_pg_maintenance.rollback.sql`

The next migration pair for this plan is:

- Create: `infra/migrations/0062_pg_maintenance_ops_v2.sql`
- Create: `infra/migrations/0062_pg_maintenance_ops_v2.rollback.sql`

Do not edit `0061_pg_maintenance.sql` unless the owner explicitly asks. V2 must be additive over it.

## File Structure

### Database

- Create `infra/migrations/0062_pg_maintenance_ops_v2.sql`
  - Adds enums, categories table, request columns, event table, indexes, backfill, and constraints.
- Create `infra/migrations/0062_pg_maintenance_ops_v2.rollback.sql`
  - Drops new indexes/table/columns/types in safe reverse order.

### Shared Types

- Modify `packages/shared-types/src/pg-operations.ts`
  - Add priority, category, location, SLA, timeline, internal note, resolution, analytics, filters, queue row, and detail response contracts.
- Modify `packages/shared-types/src/index.ts` only if exports need adjustment.

### API Backend

- Modify `apps/api/src/modules/pg-operations/services/pg-maintenance.service.ts`
  - Keep existing service name but split private helpers by responsibility.
  - Add transaction helper like `PgBedAssignmentService.transaction()`.
  - Add category/SLA/location validation, queue queries, detail fetch, priority override, resolution, internal notes, reopen, analytics, historical access, and auto-close support.
- Modify `apps/api/src/modules/pg-operations/pg-maintenance.controller.ts`
  - Add operator detail, queue filters, resolve, internal note, timeline, analytics, and priority override routes.
- Modify `apps/api/src/modules/pg-operations/pg-residence.controller.ts`
  - Add tenant scoped list with `scope=current|history|all`, detail, reopen, and historical read guards.
- Modify `apps/api/src/modules/pg-operations/services/pg-bed-assignment.service.ts`
  - Use real overdue count from maintenance summary once SLA exists.
- Modify `apps/api/src/worker/worker.ts`
  - Register maintenance auto-close sweep.
- Create `apps/api/src/worker/maintenance-sweeps.ts`
  - Isolate auto-close transaction logic from worker bootstrap.
- Modify `apps/api/src/modules/pg-operations/__tests__/maintenance.integration.test.ts`
  - Extend existing integration coverage instead of creating detached tests.
- Create `apps/api/src/modules/pg-operations/__tests__/maintenance-v2.integration.test.ts`
  - Use if the existing test file grows too large; keep v2 queue/history/analytics tests focused.
- Modify `apps/api/src/modules/pg-operations/__tests__/assignment.integration.test.ts`
  - Update bed detail maintenance summary expectations.

### Web API Client

- Modify `apps/web/lib/pg-operations-api.ts`
  - Add queue filters, detail, categories, internal notes, resolution, reopen, analytics, and timeline clients.
- Modify `apps/web/lib/__tests__/pg-operations-api.test.ts`
  - Cover new endpoints and query serialization.

### Frontend Components

Create focused files under `apps/web/components/pg-operator/ops/maintenance/`:

- `maintenance-constants.ts`
  - Frontend category/common-area labels only; canonical values still come from shared types/API.
- `maintenance-formatters.ts`
  - SLA countdown, priority labels, location labels, cost formatting.
- `MaintenanceCreateForm.tsx`
  - Tenant guided create flow.
- `MaintenanceQueueFilters.tsx`
  - Operator dense list filters.
- `MaintenanceQueueList.tsx`
  - Operator dense table/list.
- `MaintenanceKanban.tsx`
  - Operator kanban view with valid transition affordances.
- `MaintenanceTicketDetail.tsx`
  - Canonical ticket detail for operator and tenant.
- `MaintenanceTimeline.tsx`
  - Public/internal event rendering based on mode.
- `MaintenanceInternalNotes.tsx`
  - Operator-only notes composer/list.
- `MaintenanceResolutionSheet.tsx`
  - Required resolution note, chargeable flag, optional cost/photos.
- `MaintenanceAnalyticsStrip.tsx`
  - Open/overdue/due-today/waiting/resolved-pending-close/closed-this-month counts.
- `useMaintenancePhotoUpload.ts`
  - Reusable presign/upload/complete flow for ticket, comment, and fix photos.
- `MaintenanceWorkspace.tsx`
  - Convert existing component into orchestrator that composes the new units.
- `MaintenanceWorkspace.module.css`
  - Keep or split styles into `maintenance/*.module.css` only if component styles become unwieldy.

Modify route files:

- `apps/web/app/[locale]/pg-operator/properties/[propertyId]/maintenance/page.tsx`
  - Fetch queue rows, categories, analytics.
- `apps/web/app/[locale]/tenant/pg-residence/page.tsx`
  - Fetch current and historical maintenance when no active residence exists.
- `apps/web/app/[locale]/tenant/pg-residence/PgResidenceClient.tsx`
  - Add Past Stays maintenance section and pass read-only state.

Frontend tests:

- Modify `apps/web/components/pg-operator/ops/__tests__/MaintenanceWorkspace.test.tsx`
  - Keep existing v1 regressions while new child components are introduced.
- Create `apps/web/components/pg-operator/ops/maintenance/__tests__/MaintenanceCreateForm.test.tsx`
- Create `apps/web/components/pg-operator/ops/maintenance/__tests__/MaintenanceQueueList.test.tsx`
- Create `apps/web/components/pg-operator/ops/maintenance/__tests__/MaintenanceKanban.test.tsx`
- Create `apps/web/components/pg-operator/ops/maintenance/__tests__/MaintenanceResolutionSheet.test.tsx`
- Create `apps/web/components/pg-operator/ops/maintenance/__tests__/MaintenanceTimeline.test.tsx`

---

## Interfaces To Produce

Add or update these shared types in `packages/shared-types/src/pg-operations.ts`.

```ts
export type PgMaintenancePriority = "emergency" | "high" | "normal" | "low";

export type PgMaintenancePrioritySource = "category_default" | "operator_override" | "backfill";

export type PgMaintenanceLocationKind =
  | "bed"
  | "room"
  | "floor"
  | "common_area"
  | "property_wide"
  | "other";

export type PgMaintenanceCommonArea =
  | "kitchen"
  | "common_bathroom"
  | "lift"
  | "stairs"
  | "corridor"
  | "terrace"
  | "laundry"
  | "parking"
  | "reception"
  | "mess_food_area"
  | "water_tank_motor"
  | "wifi_router"
  | "security_cctv"
  | "other";

export type PgMaintenanceEventType =
  | "created"
  | "status_changed"
  | "priority_set"
  | "priority_overridden"
  | "comment_added"
  | "internal_note_added"
  | "photo_added"
  | "resolution_recorded"
  | "reopened"
  | "auto_closed"
  | "cancelled";

export type PgMaintenanceEventVisibility = "public" | "operator_internal";

export interface PgMaintenanceCategory {
  slug: string;
  display_name: string;
  default_priority: PgMaintenancePriority;
  active: boolean;
  sort_order: number;
}

export interface PgMaintenanceLocationInput {
  kind: PgMaintenanceLocationKind;
  room_id?: string;
  bed_id?: string;
  floor?: number;
  common_area?: PgMaintenanceCommonArea;
  detail?: string;
}

export interface PgMaintenanceLocationSnapshot {
  kind: PgMaintenanceLocationKind;
  property_name: string | null;
  room_number: string | null;
  room_label: string | null;
  floor: number | null;
  bed_label: string | null;
  common_area: PgMaintenanceCommonArea | null;
  detail: string | null;
}

export interface PgMaintenanceTimelineEvent {
  id: string;
  request_id: string;
  event_type: PgMaintenanceEventType;
  visibility: PgMaintenanceEventVisibility;
  actor_user_id: string | null;
  actor_role: "tenant" | "pg_operator" | "admin" | "system";
  from_status: PgMaintenanceStatus | null;
  to_status: PgMaintenanceStatus | null;
  payload: Record<string, unknown>;
  created_at: string;
}

export interface PgMaintenanceResolutionInput {
  note: string;
  fix_photo_paths?: string[];
  cost_paise?: number | null;
  chargeable_damage: boolean;
}

export interface PgMaintenanceInternalNoteInput {
  body: string;
  attachments?: string[];
}

export interface PgMaintenancePriorityOverrideInput {
  priority: PgMaintenancePriority;
  reason: string;
}

export interface PgMaintenanceQueueFilters {
  status?: PgMaintenanceStatus | "all";
  priority?: PgMaintenancePriority;
  sla_state?: "overdue" | "due_today" | "on_track";
  category_slug?: string;
  location_kind?: PgMaintenanceLocationKind;
  common_area?: PgMaintenanceCommonArea;
  floor?: number;
  room_id?: string;
  bed_id?: string;
  tenant_query?: string;
  chargeable_damage?: boolean;
  include_closed?: boolean;
  date_from?: string;
  date_to?: string;
  view?: "list" | "kanban";
}

export interface PgMaintenanceAnalytics {
  open: number;
  overdue: number;
  due_today: number;
  waiting_on_tenant: number;
  resolved_pending_close: number;
  closed_this_month: number;
  by_category: Array<{ category_slug: string; display_name: string; count: number }>;
}
```

---

## Task 1: Migration 0062, Backfill, And Rollback

**Files:**

- Create: `infra/migrations/0062_pg_maintenance_ops_v2.sql`
- Create: `infra/migrations/0062_pg_maintenance_ops_v2.rollback.sql`
- Test: migration round trip with local DB

**Interfaces:**

- Produces persisted columns and tables consumed by all later tasks.
- Existing `0061_pg_maintenance.sql` remains the baseline.

- [ ] **Step 1: Write the migration with enums and categories**

Add enum creation blocks using this exact value set:

```sql
DO $$ BEGIN
  CREATE TYPE pg_maintenance_priority AS ENUM ('emergency','high','normal','low');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE pg_maintenance_location_kind AS ENUM
    ('bed','room','floor','common_area','property_wide','other');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE pg_maintenance_common_area AS ENUM
    ('kitchen','common_bathroom','lift','stairs','corridor','terrace','laundry','parking',
     'reception','mess_food_area','water_tank_motor','wifi_router','security_cctv','other');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE pg_maintenance_event_type AS ENUM
    ('created','status_changed','priority_set','priority_overridden','comment_added',
     'internal_note_added','photo_added','resolution_recorded','reopened','auto_closed','cancelled');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE pg_maintenance_event_visibility AS ENUM ('public','operator_internal');
EXCEPTION WHEN duplicate_object THEN null; END $$;

CREATE TABLE IF NOT EXISTS pg_maintenance_categories (
  slug text PRIMARY KEY,
  display_name text NOT NULL,
  default_priority pg_maintenance_priority NOT NULL,
  active boolean NOT NULL DEFAULT true,
  sort_order smallint NOT NULL DEFAULT 100,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS set_updated_at ON pg_maintenance_categories;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON pg_maintenance_categories
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();
```

- [ ] **Step 2: Seed categories idempotently**

Use this exact seed set; later product changes can edit rows, but this plan needs deterministic defaults:

```sql
INSERT INTO pg_maintenance_categories (slug, display_name, default_priority, sort_order) VALUES
  ('plumbing', 'Plumbing', 'high', 10),
  ('electrical', 'Electrical', 'emergency', 20),
  ('internet_wifi', 'Internet/Wi-Fi', 'high', 30),
  ('appliance', 'Appliance', 'normal', 40),
  ('furniture', 'Furniture', 'normal', 50),
  ('cleaning', 'Cleaning', 'normal', 60),
  ('pest_control', 'Pest control', 'normal', 70),
  ('water_supply', 'Water supply', 'emergency', 80),
  ('power_backup', 'Power backup', 'high', 90),
  ('food_mess', 'Food/Mess', 'normal', 100),
  ('security', 'Security', 'emergency', 110),
  ('room_access_keys', 'Room access/keys', 'high', 120),
  ('noise_roommate', 'Noise/roommate', 'low', 130),
  ('billing', 'Billing', 'low', 140),
  ('other', 'Other', 'normal', 150)
ON CONFLICT (slug) DO UPDATE
  SET display_name = EXCLUDED.display_name,
      default_priority = EXCLUDED.default_priority,
      sort_order = EXCLUDED.sort_order,
      active = true;
```

- [ ] **Step 3: Add request columns**

Add columns with nullable data first, then backfill, then add constraints where safe:

```sql
ALTER TABLE pg_maintenance_requests
  ADD COLUMN IF NOT EXISTS category_slug text REFERENCES pg_maintenance_categories(slug),
  ADD COLUMN IF NOT EXISTS category_label_snapshot text,
  ADD COLUMN IF NOT EXISTS location_kind pg_maintenance_location_kind,
  ADD COLUMN IF NOT EXISTS room_id uuid REFERENCES pg_rooms(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS bed_id uuid REFERENCES pg_beds(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS floor smallint,
  ADD COLUMN IF NOT EXISTS common_area pg_maintenance_common_area,
  ADD COLUMN IF NOT EXISTS location_detail text,
  ADD COLUMN IF NOT EXISTS location_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS priority_v2 pg_maintenance_priority,
  ADD COLUMN IF NOT EXISTS priority_source text NOT NULL DEFAULT 'category_default',
  ADD COLUMN IF NOT EXISTS priority_overridden_by uuid REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS priority_overridden_at timestamptz,
  ADD COLUMN IF NOT EXISTS priority_override_reason text,
  ADD COLUMN IF NOT EXISTS sla_hours smallint,
  ADD COLUMN IF NOT EXISTS sla_due_at timestamptz,
  ADD COLUMN IF NOT EXISTS resolved_at timestamptz,
  ADD COLUMN IF NOT EXISTS resolved_by_user_id uuid REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS resolution_note text,
  ADD COLUMN IF NOT EXISTS fix_photo_paths jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS resolution_cost_paise bigint,
  ADD COLUMN IF NOT EXISTS chargeable_damage boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS auto_close_after timestamptz,
  ADD COLUMN IF NOT EXISTS auto_closed_at timestamptz,
  ADD COLUMN IF NOT EXISTS reopened_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_tenant_activity_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_operator_activity_at timestamptz;
```

- [ ] **Step 4: Add timeline table**

Use `actor_role text` with a CHECK instead of referencing a missing enum:

```sql
CREATE TABLE IF NOT EXISTS pg_maintenance_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL REFERENCES pg_maintenance_requests(id) ON DELETE CASCADE,
  event_type pg_maintenance_event_type NOT NULL,
  visibility pg_maintenance_event_visibility NOT NULL DEFAULT 'public',
  actor_user_id uuid REFERENCES users(id),
  actor_role text NOT NULL CHECK (actor_role IN ('tenant','pg_operator','admin','system')),
  from_status text,
  to_status text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
```

- [ ] **Step 5: Backfill category, priority, SLA, location, and resolution**

Use SQL functions/CASE expressions in the migration so existing data becomes queryable immediately:

```sql
UPDATE pg_maintenance_requests r
SET category_slug = COALESCE(c.slug, 'other'),
    category_label_snapshot = r.category
FROM pg_maintenance_categories c
WHERE lower(regexp_replace(r.category, '[^a-zA-Z0-9]+', '_', 'g')) = c.slug
  AND r.category_slug IS NULL;

UPDATE pg_maintenance_requests
SET category_slug = 'other',
    category_label_snapshot = category
WHERE category_slug IS NULL;

UPDATE pg_maintenance_requests r
SET priority_v2 = c.default_priority,
    priority_source = 'backfill'
FROM pg_maintenance_categories c
WHERE r.category_slug = c.slug
  AND r.priority_v2 IS NULL;

UPDATE pg_maintenance_requests
SET sla_hours = CASE priority_v2
  WHEN 'emergency' THEN 4
  WHEN 'high' THEN 24
  WHEN 'normal' THEN 72
  WHEN 'low' THEN 168
END
WHERE sla_hours IS NULL;

UPDATE pg_maintenance_requests
SET sla_due_at = created_at + (sla_hours || ' hours')::interval
WHERE sla_due_at IS NULL;
```

For location backfill, join assignments, beds, and rooms:

```sql
UPDATE pg_maintenance_requests r
SET location_kind = CASE WHEN b.id IS NOT NULL THEN 'bed'::pg_maintenance_location_kind ELSE 'property_wide'::pg_maintenance_location_kind END,
    room_id = rm.id,
    bed_id = b.id,
    floor = rm.floor,
    location_snapshot = jsonb_build_object(
      'kind', CASE WHEN b.id IS NOT NULL THEN 'bed' ELSE 'property_wide' END,
      'property_name', p.display_name,
      'room_number', rm.room_number,
      'room_label', rm.display_label,
      'floor', rm.floor,
      'bed_label', b.bed_label,
      'common_area', null,
      'detail', null
    )
FROM pg_properties p
LEFT JOIN pg_bed_assignments a ON a.id = r.assignment_id
LEFT JOIN pg_beds b ON b.id = a.bed_id
LEFT JOIN pg_rooms rm ON rm.id = b.room_id
WHERE p.id = r.pg_property_id
  AND r.location_kind IS NULL;
```

Backfill resolved/closed records:

```sql
UPDATE pg_maintenance_requests
SET resolved_at = COALESCE(closed_at, updated_at),
    resolution_note = COALESCE(resolution_note, 'Backfilled from Maintenance v1'),
    auto_close_after = NULL
WHERE status IN ('resolved','closed')
  AND resolved_at IS NULL;
```

- [ ] **Step 6: Add constraints and indexes**

Add constraints after backfill:

```sql
ALTER TABLE pg_maintenance_requests
  ALTER COLUMN category_slug SET NOT NULL,
  ALTER COLUMN category_label_snapshot SET NOT NULL,
  ALTER COLUMN location_kind SET NOT NULL,
  ALTER COLUMN priority_v2 SET NOT NULL,
  ALTER COLUMN sla_hours SET NOT NULL,
  ALTER COLUMN sla_due_at SET NOT NULL;

ALTER TABLE pg_maintenance_requests
  ADD CONSTRAINT pg_maint_resolution_cost_nonnegative
    CHECK (resolution_cost_paise IS NULL OR resolution_cost_paise >= 0),
  ADD CONSTRAINT pg_maint_sla_hours_positive
    CHECK (sla_hours IN (4, 24, 72, 168)),
  ADD CONSTRAINT pg_maint_location_required
    CHECK (
      (location_kind = 'bed' AND bed_id IS NOT NULL)
      OR (location_kind = 'room' AND room_id IS NOT NULL)
      OR (location_kind = 'floor' AND floor IS NOT NULL)
      OR (location_kind = 'common_area' AND common_area IS NOT NULL)
      OR (location_kind = 'property_wide')
      OR (location_kind = 'other' AND nullif(trim(location_detail), '') IS NOT NULL)
    );
```

Add indexes:

```sql
CREATE INDEX IF NOT EXISTS idx_pg_maint_queue
  ON pg_maintenance_requests(pg_property_id, status, priority_v2, sla_due_at)
  WHERE status IN ('open','in_progress','waiting_on_tenant','resolved');

CREATE INDEX IF NOT EXISTS idx_pg_maint_due_sweep
  ON pg_maintenance_requests(sla_due_at)
  WHERE status IN ('open','in_progress','waiting_on_tenant');

CREATE INDEX IF NOT EXISTS idx_pg_maint_auto_close_sweep
  ON pg_maintenance_requests(auto_close_after)
  WHERE status = 'resolved';

CREATE INDEX IF NOT EXISTS idx_pg_maint_assignment_created
  ON pg_maintenance_requests(assignment_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_pg_maint_bed_status
  ON pg_maintenance_requests(pg_property_id, bed_id, status, created_at DESC)
  WHERE bed_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_pg_maint_category_status
  ON pg_maintenance_requests(pg_property_id, category_slug, status);

CREATE INDEX IF NOT EXISTS idx_pg_maint_common_area
  ON pg_maintenance_requests(pg_property_id, common_area, status)
  WHERE location_kind = 'common_area';

CREATE INDEX IF NOT EXISTS idx_pg_maint_events_request
  ON pg_maintenance_events(request_id, created_at, id);

CREATE INDEX IF NOT EXISTS idx_pg_assignments_tenant_history
  ON pg_bed_assignments(tenant_user_id, move_out_date DESC)
  WHERE status = 'moved_out';
```

- [ ] **Step 7: Insert synthetic events**

```sql
INSERT INTO pg_maintenance_events (request_id, event_type, visibility, actor_user_id, actor_role, to_status, payload, created_at)
SELECT r.id, 'created', 'public', r.created_by_user_id, 'tenant', r.status::text,
       jsonb_build_object('category_slug', r.category_slug, 'priority', r.priority_v2),
       r.created_at
FROM pg_maintenance_requests r
WHERE NOT EXISTS (
  SELECT 1 FROM pg_maintenance_events e
  WHERE e.request_id = r.id AND e.event_type = 'created'
);

INSERT INTO pg_maintenance_events (request_id, event_type, visibility, actor_user_id, actor_role, payload, created_at)
SELECT c.request_id, 'comment_added', 'public', c.author_user_id, c.author_role,
       jsonb_build_object('comment_id', c.id, 'attachments', c.attachments),
       c.created_at
FROM pg_maintenance_comments c
WHERE NOT EXISTS (
  SELECT 1 FROM pg_maintenance_events e
  WHERE e.event_type = 'comment_added'
    AND e.payload->>'comment_id' = c.id::text
);
```

- [ ] **Step 8: Write rollback**

Rollback must remove new data surfaces in reverse order:

```sql
DROP INDEX IF EXISTS idx_pg_assignments_tenant_history;
DROP INDEX IF EXISTS idx_pg_maint_events_request;
DROP INDEX IF EXISTS idx_pg_maint_common_area;
DROP INDEX IF EXISTS idx_pg_maint_category_status;
DROP INDEX IF EXISTS idx_pg_maint_bed_status;
DROP INDEX IF EXISTS idx_pg_maint_assignment_created;
DROP INDEX IF EXISTS idx_pg_maint_auto_close_sweep;
DROP INDEX IF EXISTS idx_pg_maint_due_sweep;
DROP INDEX IF EXISTS idx_pg_maint_queue;

DROP TABLE IF EXISTS pg_maintenance_events;
DROP TRIGGER IF EXISTS set_updated_at ON pg_maintenance_categories;
DROP TABLE IF EXISTS pg_maintenance_categories;

ALTER TABLE pg_maintenance_requests
  DROP COLUMN IF EXISTS reopened_at,
  DROP COLUMN IF EXISTS auto_closed_at,
  DROP COLUMN IF EXISTS auto_close_after,
  DROP COLUMN IF EXISTS last_operator_activity_at,
  DROP COLUMN IF EXISTS last_tenant_activity_at,
  DROP COLUMN IF EXISTS chargeable_damage,
  DROP COLUMN IF EXISTS resolution_cost_paise,
  DROP COLUMN IF EXISTS fix_photo_paths,
  DROP COLUMN IF EXISTS resolution_note,
  DROP COLUMN IF EXISTS resolved_by_user_id,
  DROP COLUMN IF EXISTS resolved_at,
  DROP COLUMN IF EXISTS sla_due_at,
  DROP COLUMN IF EXISTS sla_hours,
  DROP COLUMN IF EXISTS priority_override_reason,
  DROP COLUMN IF EXISTS priority_overridden_at,
  DROP COLUMN IF EXISTS priority_overridden_by,
  DROP COLUMN IF EXISTS priority_source,
  DROP COLUMN IF EXISTS priority_v2,
  DROP COLUMN IF EXISTS location_snapshot,
  DROP COLUMN IF EXISTS location_detail,
  DROP COLUMN IF EXISTS common_area,
  DROP COLUMN IF EXISTS floor,
  DROP COLUMN IF EXISTS bed_id,
  DROP COLUMN IF EXISTS room_id,
  DROP COLUMN IF EXISTS location_kind,
  DROP COLUMN IF EXISTS category_label_snapshot,
  DROP COLUMN IF EXISTS category_slug;

DROP TYPE IF EXISTS pg_maintenance_event_visibility;
DROP TYPE IF EXISTS pg_maintenance_event_type;
DROP TYPE IF EXISTS pg_maintenance_common_area;
DROP TYPE IF EXISTS pg_maintenance_location_kind;
DROP TYPE IF EXISTS pg_maintenance_priority;
```

- [ ] **Step 9: Verify migration round trip**

Run:

```bash
rtk env DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5433/cribliv_v2 PATH=/opt/homebrew/bin:$PATH corepack pnpm db:migrate
```

Expected: migration `0062_pg_maintenance_ops_v2.sql` applies with no errors.

Then run rollback manually only if the repo migration runner supports targeted rollback; otherwise verify rollback SQL with a disposable DB. Do not run destructive rollback against a shared local DB containing work-in-progress data.

- [ ] **Step 10: Commit**

```bash
git add infra/migrations/0062_pg_maintenance_ops_v2.sql infra/migrations/0062_pg_maintenance_ops_v2.rollback.sql
git commit -m "feat(pg-ops): add maintenance ops v2 schema"
```

---

## Task 2: Shared Types And Contract Tests

**Files:**

- Modify: `packages/shared-types/src/pg-operations.ts`
- Modify: `apps/web/lib/__tests__/pg-operations-api.test.ts`
- Modify: `apps/web/lib/pg-operations-api.ts` only for type imports if needed

**Interfaces:**

- Consumes DB concepts from Task 1.
- Produces TypeScript contracts used by API and web tasks.

- [ ] **Step 1: Add failing type-level API client tests**

In `apps/web/lib/__tests__/pg-operations-api.test.ts`, add tests that expect these API client functions to exist later:

```ts
fetchMaintenanceCategories("token-1");
getMaintenanceTicket("property-1", "ticket-1", "token-1");
listPropertyMaintenance("property-1", "token-1", {
  status: "open",
  priority: "high",
  sla_state: "overdue",
  category_slug: "plumbing",
  location_kind: "common_area",
  common_area: "lift",
  floor: 3,
  tenant_query: "Ravi",
  include_closed: false
});
resolveMaintenanceTicket(
  "property-1",
  "ticket-1",
  { note: "Fixed tap", chargeable_damage: false, cost_paise: null },
  "token-1",
  "idem-1"
);
addMaintenanceInternalNote(
  "property-1",
  "ticket-1",
  { body: "Call plumber again if this repeats." },
  "token-1",
  "idem-2"
);
reopenResidenceMaintenance("ticket-1", { body: "Still leaking." }, "token-1", "idem-3");
fetchMaintenanceAnalytics("property-1", "token-1");
```

Run:

```bash
rtk corepack pnpm --filter @cribliv/web test -- pg-operations-api.test.ts
```

Expected: FAIL with missing exports.

- [ ] **Step 2: Add shared type definitions**

Add the interfaces listed in the "Interfaces To Produce" section. Also extend `PgMaintenanceRequest`:

```ts
export interface PgMaintenanceRequest {
  id: string;
  pg_property_id: string;
  assignment_id: string | null;
  created_by_user_id: string | null;
  category: string;
  category_slug: string;
  category_label_snapshot: string;
  description: string;
  photo_paths: string[];
  photo_urls: string[];
  status: PgMaintenanceStatus;
  priority: string | null;
  priority_v2: PgMaintenancePriority;
  priority_source: PgMaintenancePrioritySource;
  sla_hours: number;
  sla_due_at: string;
  is_overdue: boolean;
  closed_at: string | null;
  resolved_at: string | null;
  resolution_note: string | null;
  fix_photo_paths: string[];
  fix_photo_urls: string[];
  resolution_cost_paise: number | null;
  chargeable_damage: boolean;
  auto_close_after: string | null;
  location: PgMaintenanceLocation | null;
  location_snapshot: PgMaintenanceLocationSnapshot;
  comments: PgMaintenanceComment[];
  timeline?: PgMaintenanceTimelineEvent[];
  created_at: string;
  updated_at: string;
}
```

- [ ] **Step 3: Build shared types**

Run:

```bash
rtk corepack pnpm --filter @cribliv/shared-types build
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/shared-types/src/pg-operations.ts apps/web/lib/__tests__/pg-operations-api.test.ts
git commit -m "feat(pg-ops): define maintenance ops v2 contracts"
```

---

## Task 3: Backend Mapping, Validation, And Category/SLA Helpers

**Files:**

- Modify: `apps/api/src/modules/pg-operations/services/pg-maintenance.service.ts`
- Test: `apps/api/src/modules/pg-operations/__tests__/maintenance.integration.test.ts`

**Interfaces:**

- Consumes shared types from Task 2 and schema from Task 1.
- Produces helper methods used by create, queue, resolution, and analytics tasks.

- [ ] **Step 1: Write failing integration tests for create metadata**

Add a test that creates a tenant ticket with:

```json
{
  "category_slug": "plumbing",
  "description": "The washroom tap is leaking badly.",
  "location": { "kind": "common_area", "common_area": "common_bathroom" }
}
```

Expected response includes:

```ts
expect(response.body.data).toMatchObject({
  category_slug: "plumbing",
  category_label_snapshot: "Plumbing",
  priority_v2: "high",
  sla_hours: 24,
  location_snapshot: expect.objectContaining({
    kind: "common_area",
    common_area: "common_bathroom"
  })
});
expect(new Date(response.body.data.sla_due_at).getTime()).toBeGreaterThan(
  new Date(response.body.data.created_at).getTime()
);
```

Run:

```bash
rtk env DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5433/cribliv_v2 PATH=/opt/homebrew/bin:$PATH corepack pnpm --filter @cribliv/api test -- maintenance.integration.test.ts
```

Expected: FAIL because v2 create metadata is not implemented.

- [ ] **Step 2: Add helpers**

In `PgMaintenanceService`, add:

```ts
private priorityHours(priority: PgMaintenancePriority): number {
  return priority === "emergency" ? 4 : priority === "high" ? 24 : priority === "normal" ? 72 : 168;
}

private async categoryBySlug(slug: unknown): Promise<PgMaintenanceCategory> {
  const cleaned = cleanRequired(slug, "maintenance_category_required");
  const result = await this.db.query<CategoryRow>(
    `SELECT slug, display_name, default_priority::text AS default_priority, active, sort_order
       FROM pg_maintenance_categories
      WHERE slug = $1 AND active = true
      LIMIT 1`,
    [cleaned]
  );
  if (!result.rows[0]) throw new BadRequestException({ code: "invalid_maintenance_category" });
  return toCategory(result.rows[0]);
}
```

Add `validateLocationInput(propertyId, residence, input)` that verifies property ownership of `room_id`/`bed_id`, required fields, and returns both normalized fields and snapshot.

- [ ] **Step 3: Update row mapping**

Extend `MaintenanceRow`, `toRequest()`, `toLocation()`, and SQL SELECT lists to include every v2 column. Keep old `category` and `priority` in responses for compatibility, but prefer `category_slug` and `priority_v2`.

- [ ] **Step 4: Run focused API test**

Run the same integration command.

Expected: PASS for the new create metadata test and existing maintenance tests.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/pg-operations/services/pg-maintenance.service.ts apps/api/src/modules/pg-operations/__tests__/maintenance.integration.test.ts
git commit -m "feat(pg-ops): map maintenance category sla and location"
```

---

## Task 4: Backend Tenant Create, Historical Access, And Reopen

**Files:**

- Modify: `apps/api/src/modules/pg-operations/services/pg-maintenance.service.ts`
- Modify: `apps/api/src/modules/pg-operations/pg-residence.controller.ts`
- Test: `apps/api/src/modules/pg-operations/__tests__/maintenance.integration.test.ts`

**Interfaces:**

- Consumes validation helpers from Task 3.
- Produces tenant create/list/detail/reopen behavior used by frontend tenant flow.

- [ ] **Step 1: Write failing tests**

Cover:

1. Current tenant can create bed/room/floor/common-area/property-wide/other tickets.
2. Moved-out tenant can read tickets for 6 months after `move_out_date`.
3. Moved-out tenant cannot create new tickets.
4. Tenant can reopen a `resolved` ticket before `auto_close_after`.
5. Tenant cannot reopen `closed` or expired historical tickets.

Use explicit expectations:

```ts
await request(app.getHttpServer())
  .post(`/v1/tenant/pg-residence/maintenance/${ticketId}/reopen`)
  .set("x-test-identity", "tenant")
  .set("Idempotency-Key", randomUUID())
  .send({ body: "Still leaking." })
  .expect(201)
  .expect(({ body }) => {
    expect(body.data.status).toBe("in_progress");
    expect(body.data.auto_close_after).toBeNull();
  });
```

- [ ] **Step 2: Replace current-only tenant access**

Add:

```ts
private async residenceAssignmentsForMaintenance(userId: string, scope: "current" | "history" | "all") {
  // current: active/reserved/notice/move-out-pending statuses
  // history: moved_out where move_out_date >= current_date - interval '6 months'
  // all: union current + eligible history
}
```

Do not use phone fallback for historical rows unless tenant_user_id is null and phone matches the authenticated user. Prefer `tenant_user_id`.

- [ ] **Step 3: Implement tenant scoped list/detail**

Add service methods:

```ts
async listForResidence(tenantUserId: string, scope: "current" | "history" | "all" = "current"): Promise<PgMaintenanceRequest[]>
async getForTenant(tenantUserId: string, requestId: string): Promise<PgMaintenanceRequest>
```

Historical rows are read-only; response should include a boolean such as `tenant_can_mutate` if added to shared types, or frontend can infer from `access_scope`.

- [ ] **Step 4: Implement tenant reopen**

Add:

```ts
async reopenByTenant(callerUserId: string, requestId: string, body: unknown, idempotencyKey: string): Promise<PgMaintenanceRequest>
```

Transaction rules:

- Lock request `FOR UPDATE`.
- Verify tenant current access, not historical.
- Require current status `resolved`.
- Require `auto_close_after > now()`.
- Set status `in_progress`, `auto_close_after = NULL`, `reopened_at = now()`.
- Insert public comment when body/photos present.
- Insert `reopened` event and `comment_added` event in same transaction.

- [ ] **Step 5: Wire controller**

Add:

```ts
@Get("maintenance/:id")
@Post("maintenance/:id/reopen")
```

Keep existing `GET maintenance` but accept `scope`.

- [ ] **Step 6: Run tests**

Run:

```bash
rtk env DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5433/cribliv_v2 PATH=/opt/homebrew/bin:$PATH corepack pnpm --filter @cribliv/api test -- maintenance.integration.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/modules/pg-operations/services/pg-maintenance.service.ts apps/api/src/modules/pg-operations/pg-residence.controller.ts apps/api/src/modules/pg-operations/__tests__/maintenance.integration.test.ts
git commit -m "feat(pg-ops): support maintenance tenant history and reopen"
```

---

## Task 5: Backend Operator Queue, Detail, Priority Override, Internal Notes, Timeline

**Files:**

- Modify: `apps/api/src/modules/pg-operations/services/pg-maintenance.service.ts`
- Modify: `apps/api/src/modules/pg-operations/pg-maintenance.controller.ts`
- Test: `apps/api/src/modules/pg-operations/__tests__/maintenance-v2.integration.test.ts`

**Interfaces:**

- Produces operator queue and ticket detail API used by list/kanban/detail frontend.

- [ ] **Step 1: Write failing queue/filter tests**

Create tests for:

- `GET /v1/pg-operator/properties/:propertyId/maintenance?priority=high&sla_state=overdue`
- `category_slug`
- `location_kind`
- `common_area`
- `floor`
- `tenant_query`
- `include_closed=false`

Expected: only matching rows returned, sorted by `sla_due_at ASC NULLS LAST, created_at DESC`.

- [ ] **Step 2: Implement queue query**

Add `listForProperty(operatorId, propertyId, filters)` support for all filters. It should return summary rows without loading full comments/timeline. If keeping `PgMaintenanceRequest[]`, set `comments: []` for queue rows and load comments in detail endpoint.

- [ ] **Step 3: Add detail endpoint**

Add:

```ts
async getForOperator(operatorId: string, propertyId: string, requestId: string): Promise<PgMaintenanceRequest>
async timelineForOperator(operatorId: string, propertyId: string, requestId: string): Promise<PgMaintenanceTimelineEvent[]>
```

Operator detail includes public and internal events. Tenant detail must only include public events.

- [ ] **Step 4: Write failing priority override tests**

Test:

```ts
POST /v1/pg-operator/properties/:propertyId/maintenance/:id/priority
{ "priority": "emergency", "reason": "Water entering electrical panel" }
```

Expected:

- `priority_v2 = emergency`
- `sla_hours = 4`
- `sla_due_at` recomputed from `created_at + 4 hours`
- override actor/time/reason persisted
- `priority_overridden` event inserted

- [ ] **Step 5: Implement priority override**

Do in a transaction with `FOR UPDATE`. Recompute SLA based on existing `created_at`, not current time, so overdue semantics remain consistent.

- [ ] **Step 6: Write failing internal note tests**

Operator can add internal note. Tenant timeline/detail does not include it.

Expected event:

```ts
expect(operatorTimeline).toContainEqual(
  expect.objectContaining({
    event_type: "internal_note_added",
    visibility: "operator_internal",
    payload: expect.objectContaining({ body: "Call plumber again if this repeats." })
  })
);
expect(tenantTimeline.some((event) => event.event_type === "internal_note_added")).toBe(false);
```

- [ ] **Step 7: Implement internal notes**

Add route:

```text
POST /v1/pg-operator/properties/:propertyId/maintenance/:id/internal-notes
```

Body: `PgMaintenanceInternalNoteInput`. Validate body or attachments. Attachments must use existing maintenance blob validation and max 6.

- [ ] **Step 8: Run tests and commit**

```bash
rtk env DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5433/cribliv_v2 PATH=/opt/homebrew/bin:$PATH corepack pnpm --filter @cribliv/api test -- maintenance-v2.integration.test.ts maintenance.integration.test.ts
git add apps/api/src/modules/pg-operations/services/pg-maintenance.service.ts apps/api/src/modules/pg-operations/pg-maintenance.controller.ts apps/api/src/modules/pg-operations/__tests__/maintenance-v2.integration.test.ts
git commit -m "feat(pg-ops): add maintenance queue timeline and notes"
```

---

## Task 6: Backend Resolution, Auto-Close Worker, Analytics, And Bed Summary

**Files:**

- Modify: `apps/api/src/modules/pg-operations/services/pg-maintenance.service.ts`
- Modify: `apps/api/src/modules/pg-operations/pg-maintenance.controller.ts`
- Modify: `apps/api/src/modules/pg-operations/services/pg-bed-assignment.service.ts`
- Create: `apps/api/src/worker/maintenance-sweeps.ts`
- Modify: `apps/api/src/worker/worker.ts`
- Test: `apps/api/src/modules/pg-operations/__tests__/maintenance-v2.integration.test.ts`
- Test: `apps/api/src/modules/pg-operations/__tests__/assignment.integration.test.ts`

**Interfaces:**

- Produces resolution API, auto-close sweep, analytics, and real overdue summary counts.

- [ ] **Step 1: Write failing resolution tests**

Test:

```ts
await request(app.getHttpServer())
  .post(`/v1/pg-operator/properties/${propertyId}/maintenance/${ticketId}/resolve`)
  .set("x-test-identity", "operator")
  .set("Idempotency-Key", randomUUID())
  .send({
    note: "Replaced the tap washer.",
    fix_photo_paths: [],
    cost_paise: null,
    chargeable_damage: false
  })
  .expect(201)
  .expect(({ body }) => {
    expect(body.data.status).toBe("resolved");
    expect(body.data.resolution_note).toBe("Replaced the tap washer.");
    expect(body.data.auto_close_after).toEqual(expect.any(String));
  });
```

Also test 400 for empty note, negative cost, and missing `chargeable_damage`.

- [ ] **Step 2: Implement resolution**

Transaction:

- Lock request.
- Verify operator ownership.
- Require transition to `resolved` from `in_progress` or `waiting_on_tenant`.
- Validate note/cost/chargeable flag/fix photos.
- Validate fix photo blob paths under same request.
- Set status/resolution fields/auto-close deadline.
- Insert `resolution_recorded` event and `status_changed` event.

- [ ] **Step 3: Write failing auto-close tests**

Unit/integration test `autoCloseResolvedMaintenance(db)`:

- Seed resolved ticket with `auto_close_after <= now()`.
- Run sweep.
- Expect status `closed`, `closed_at`, `auto_closed_at`, and `auto_closed` event.
- Run sweep again.
- Expect no duplicate event.

- [ ] **Step 4: Implement worker sweep**

Create `maintenance-sweeps.ts`:

```ts
export async function autoCloseResolvedMaintenance(db: DatabaseService): Promise<number> {
  // transaction; SELECT ... FOR UPDATE SKIP LOCKED; update rows; insert events; return count
}
```

Wire into `apps/api/src/worker/worker.ts` with the repo's existing sweep cadence pattern.

- [ ] **Step 5: Write failing analytics tests**

Endpoint:

```text
GET /v1/pg-operator/properties/:propertyId/maintenance/analytics
```

Expected response:

```ts
{
  open: 2,
  overdue: 1,
  due_today: 1,
  waiting_on_tenant: 1,
  resolved_pending_close: 1,
  closed_this_month: 1,
  by_category: [{ category_slug: "plumbing", display_name: "Plumbing", count: 2 }]
}
```

- [ ] **Step 6: Implement analytics and bed summary**

`summaryForBed()` returns:

- `open_items`: open/in_progress/waiting_on_tenant
- `overdue_items`: open/in_progress/waiting_on_tenant with `sla_due_at < now()`

- [ ] **Step 7: Run tests and commit**

```bash
rtk env DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5433/cribliv_v2 PATH=/opt/homebrew/bin:$PATH corepack pnpm --filter @cribliv/api test -- maintenance-v2.integration.test.ts maintenance.integration.test.ts assignment.integration.test.ts
git add apps/api/src/modules/pg-operations/services/pg-maintenance.service.ts apps/api/src/modules/pg-operations/pg-maintenance.controller.ts apps/api/src/modules/pg-operations/services/pg-bed-assignment.service.ts apps/api/src/worker/maintenance-sweeps.ts apps/api/src/worker/worker.ts apps/api/src/modules/pg-operations/__tests__/maintenance-v2.integration.test.ts apps/api/src/modules/pg-operations/__tests__/assignment.integration.test.ts
git commit -m "feat(pg-ops): add maintenance resolution sla analytics"
```

---

## Task 7: Web API Client

**Files:**

- Modify: `apps/web/lib/pg-operations-api.ts`
- Modify: `apps/web/lib/__tests__/pg-operations-api.test.ts`

**Interfaces:**

- Consumes backend routes from Tasks 4-6.
- Produces functions used by frontend components.

- [ ] **Step 1: Confirm failing tests from Task 2**

Run:

```bash
rtk corepack pnpm --filter @cribliv/web test -- pg-operations-api.test.ts
```

Expected: FAIL until new client functions exist.

- [ ] **Step 2: Add query serialization**

Add `maintenanceQueueQuery(filters: PgMaintenanceQueueFilters): string` that serializes only defined values:

```ts
if (filters.priority) query.set("priority", filters.priority);
if (filters.sla_state) query.set("sla_state", filters.sla_state);
if (filters.include_closed !== undefined)
  query.set("include_closed", String(filters.include_closed));
```

- [ ] **Step 3: Add client functions**

Add:

```ts
export function fetchMaintenanceCategories(token?: string);
export function getMaintenanceTicket(propertyId: string, requestId: string, token?: string);
export function fetchMaintenanceTimeline(propertyId: string, requestId: string, token?: string);
export function overrideMaintenancePriority(
  propertyId: string,
  requestId: string,
  body: PgMaintenancePriorityOverrideInput,
  token: string | undefined,
  idempotencyKey: string
);
export function resolveMaintenanceTicket(
  propertyId: string,
  requestId: string,
  body: PgMaintenanceResolutionInput,
  token: string | undefined,
  idempotencyKey: string
);
export function addMaintenanceInternalNote(
  propertyId: string,
  requestId: string,
  body: PgMaintenanceInternalNoteInput,
  token: string | undefined,
  idempotencyKey: string
);
export function fetchMaintenanceAnalytics(propertyId: string, token?: string);
export function getResidenceMaintenanceTicket(requestId: string, token?: string);
export function reopenResidenceMaintenance(
  requestId: string,
  body: PgMaintenanceCommentInput,
  token: string | undefined,
  idempotencyKey: string
);
```

- [ ] **Step 4: Run tests and commit**

```bash
rtk corepack pnpm --filter @cribliv/web test -- pg-operations-api.test.ts
git add apps/web/lib/pg-operations-api.ts apps/web/lib/__tests__/pg-operations-api.test.ts
git commit -m "feat(pg-ops): add maintenance ops api client"
```

---

## Task 8: Frontend Component Split And Tenant Create Flow

**Files:**

- Create: `apps/web/components/pg-operator/ops/maintenance/maintenance-constants.ts`
- Create: `apps/web/components/pg-operator/ops/maintenance/maintenance-formatters.ts`
- Create: `apps/web/components/pg-operator/ops/maintenance/useMaintenancePhotoUpload.ts`
- Create: `apps/web/components/pg-operator/ops/maintenance/MaintenanceCreateForm.tsx`
- Modify: `apps/web/components/pg-operator/ops/MaintenanceWorkspace.tsx`
- Test: `apps/web/components/pg-operator/ops/maintenance/__tests__/MaintenanceCreateForm.test.tsx`

**Interfaces:**

- Consumes categories/location types from shared types and API client from Task 7.
- Produces guided tenant create UX.

- [ ] **Step 1: Write failing create form tests**

Test:

- Location kind required.
- Common area required when location kind is `common_area`.
- Other detail required when location kind is `other`.
- Category required.
- SLA hint displays `High · due in 24h` for plumbing.
- Photo upload calls existing presign/complete flow after create.

- [ ] **Step 2: Create constants and formatters**

Use exact labels:

```ts
export const COMMON_AREA_OPTIONS = [
  { value: "kitchen", label: "Kitchen" },
  { value: "common_bathroom", label: "Common bathroom" },
  { value: "lift", label: "Lift" },
  { value: "stairs", label: "Stairs" },
  { value: "corridor", label: "Corridor" },
  { value: "terrace", label: "Terrace" },
  { value: "laundry", label: "Laundry" },
  { value: "parking", label: "Parking" },
  { value: "reception", label: "Reception" },
  { value: "mess_food_area", label: "Mess/Food area" },
  { value: "water_tank_motor", label: "Water tank/motor" },
  { value: "wifi_router", label: "Wi-Fi/router" },
  { value: "security_cctv", label: "Security/CCTV" },
  { value: "other", label: "Other" }
] as const;
```

- [ ] **Step 3: Extract reusable upload hook**

Move upload logic from `MaintenanceWorkspace.tsx` into `useMaintenancePhotoUpload.ts` with:

```ts
export function useMaintenancePhotoUpload({
  mode,
  propertyId,
  token
}: UseMaintenancePhotoUploadInput): {
  addFiles(files: FileList | File[], existingCount: number): PendingMaintenancePhoto[];
  removePhoto(photos: PendingMaintenancePhoto[], clientUploadId: string): PendingMaintenancePhoto[];
  uploadForRequest(
    request: PgMaintenanceRequest,
    photos: PendingMaintenancePhoto[]
  ): Promise<PgMaintenanceRequest>;
  uploadForComment(
    request: PgMaintenanceRequest,
    photos: PendingMaintenancePhoto[]
  ): Promise<string[]>;
};
```

- [ ] **Step 4: Implement create form**

Props:

```ts
type MaintenanceCreateFormProps = {
  token: string;
  categories: PgMaintenanceCategory[];
  currentResidenceLocation: PgMaintenanceLocation | null;
  onCreated(request: PgMaintenanceRequest): void;
};
```

Submit body must include `category_slug`, `description`, and `location`.

- [ ] **Step 5: Integrate into workspace**

Replace tenant create block in `MaintenanceWorkspace.tsx` with `<MaintenanceCreateForm />`. Keep old tests green.

- [ ] **Step 6: Run tests and commit**

```bash
rtk corepack pnpm --filter @cribliv/web test -- MaintenanceCreateForm.test.tsx MaintenanceWorkspace.test.tsx
git add apps/web/components/pg-operator/ops/MaintenanceWorkspace.tsx apps/web/components/pg-operator/ops/maintenance
git commit -m "feat(pg-ops): add guided maintenance create flow"
```

---

## Task 9: Frontend Operator Queue List, Kanban, And Analytics

**Files:**

- Create: `apps/web/components/pg-operator/ops/maintenance/MaintenanceAnalyticsStrip.tsx`
- Create: `apps/web/components/pg-operator/ops/maintenance/MaintenanceQueueFilters.tsx`
- Create: `apps/web/components/pg-operator/ops/maintenance/MaintenanceQueueList.tsx`
- Create: `apps/web/components/pg-operator/ops/maintenance/MaintenanceKanban.tsx`
- Modify: `apps/web/app/[locale]/pg-operator/properties/[propertyId]/maintenance/page.tsx`
- Test: `apps/web/components/pg-operator/ops/maintenance/__tests__/MaintenanceQueueList.test.tsx`
- Test: `apps/web/components/pg-operator/ops/maintenance/__tests__/MaintenanceKanban.test.tsx`

**Interfaces:**

- Consumes API client from Task 7 and shared queue filters.
- Produces operator workbench with dense list and kanban.

- [ ] **Step 1: Write failing list tests**

Expect:

- Metrics strip renders counts.
- Filters call `listPropertyMaintenance` with chosen values.
- Default sort display says `SLA due first`.
- Row shows SLA, priority, status, category, location, tenant, last update.

- [ ] **Step 2: Write failing kanban tests**

Expect:

- Columns: Open, In progress, Waiting on tenant, Resolved.
- Cards show SLA and priority.
- Moving a card to Resolved opens resolution sheet instead of directly changing status.
- Invalid transition controls are disabled.

- [ ] **Step 3: Implement queue filters and list**

Use compact operational styling, not marketing cards. Keep filters dense and scannable.

- [ ] **Step 4: Implement kanban**

If drag/drop library is not already present, avoid adding a new dependency for this pass. Use column action menus/buttons for transitions first; drag/drop can be progressive enhancement later.

- [ ] **Step 5: Integrate route**

Route fetches:

- categories
- analytics
- initial queue rows

Route passes them into the workspace.

- [ ] **Step 6: Run tests and commit**

```bash
rtk corepack pnpm --filter @cribliv/web test -- MaintenanceQueueList.test.tsx MaintenanceKanban.test.tsx
git add apps/web/app/[locale]/pg-operator/properties/[propertyId]/maintenance/page.tsx apps/web/components/pg-operator/ops/maintenance
git commit -m "feat(pg-ops): add maintenance queue and kanban"
```

Quote bracketed route paths if running shell commands manually in zsh.

---

## Task 10: Frontend Detail, Timeline, Internal Notes, Resolution, And Tenant History

**Files:**

- Create: `apps/web/components/pg-operator/ops/maintenance/MaintenanceTicketDetail.tsx`
- Create: `apps/web/components/pg-operator/ops/maintenance/MaintenanceTimeline.tsx`
- Create: `apps/web/components/pg-operator/ops/maintenance/MaintenanceInternalNotes.tsx`
- Create: `apps/web/components/pg-operator/ops/maintenance/MaintenanceResolutionSheet.tsx`
- Modify: `apps/web/components/pg-operator/ops/MaintenanceWorkspace.tsx`
- Modify: `apps/web/app/[locale]/tenant/pg-residence/page.tsx`
- Modify: `apps/web/app/[locale]/tenant/pg-residence/PgResidenceClient.tsx`
- Test: `apps/web/components/pg-operator/ops/maintenance/__tests__/MaintenanceResolutionSheet.test.tsx`
- Test: `apps/web/components/pg-operator/ops/maintenance/__tests__/MaintenanceTimeline.test.tsx`

**Interfaces:**

- Consumes backend detail/timeline/resolve/internal-note/reopen APIs.
- Produces complete ticket lifecycle UX for operator and tenant.

- [ ] **Step 1: Write failing resolution sheet tests**

Expect:

- Empty note blocks submit.
- Negative cost blocks submit.
- Missing chargeable-damage boolean blocks submit.
- Valid submit calls `resolveMaintenanceTicket` with note, optional `cost_paise`, `chargeable_damage`, and uploaded fix photo paths.

- [ ] **Step 2: Write failing timeline tests**

Expect:

- Tenant mode hides `operator_internal` events.
- Operator mode shows internal notes.
- Resolution event renders note/cost/chargeable flag.
- Auto-close event renders as system event.

- [ ] **Step 3: Implement ticket detail**

Detail sections:

- Header: ID, status, priority, SLA countdown, category, location.
- Issue: description, original photos, location snapshot, tenant contact.
- Actions: Start work, Wait for tenant, Resolve, Close, Cancel, Override priority.
- Public thread.
- Operator-only internal notes.
- Timeline.
- Resolution card.

- [ ] **Step 4: Implement resolution sheet**

Use existing photo upload hook and resolution API.

- [ ] **Step 5: Implement tenant historical section**

When `initialResidence` is null, `PgResidenceClient` should show:

- No active PG residence.
- Past Stays maintenance section if historical tickets exist.
- Historical tickets are read-only.
- Expired state if API says history is no longer available.

`page.tsx` should fetch maintenance with `scope=all` even when no active residence exists.

- [ ] **Step 6: Run tests and commit**

```bash
rtk corepack pnpm --filter @cribliv/web test -- MaintenanceResolutionSheet.test.tsx MaintenanceTimeline.test.tsx MaintenanceWorkspace.test.tsx
git add apps/web/components/pg-operator/ops/MaintenanceWorkspace.tsx apps/web/components/pg-operator/ops/maintenance apps/web/app/[locale]/tenant/pg-residence/page.tsx apps/web/app/[locale]/tenant/pg-residence/PgResidenceClient.tsx
git commit -m "feat(pg-ops): add maintenance detail lifecycle"
```

---

## Task 11: Verification, Browser Proof, Docs Sync, And Final Review

**Files:**

- Modify: `docs/superpowers/prompts/phase-5-maintenance.md` only if the executed behavior differs from the current prompt.
- Modify: this plan file only if implementation discovers a plan correction.

**Interfaces:**

- Verifies all previous tasks integrate.

- [ ] **Step 1: Run shared build**

```bash
rtk corepack pnpm --filter @cribliv/shared-types build
```

Expected: PASS.

- [ ] **Step 2: Run API typecheck**

```bash
rtk corepack pnpm --filter @cribliv/api typecheck
```

Expected: PASS.

- [ ] **Step 3: Run web typecheck**

```bash
rtk corepack pnpm --filter @cribliv/web typecheck
```

Expected: PASS.

- [ ] **Step 4: Run API maintenance gates**

```bash
rtk env DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5433/cribliv_v2 PATH=/opt/homebrew/bin:$PATH corepack pnpm --filter @cribliv/api test -- maintenance.integration.test.ts maintenance-v2.integration.test.ts assignment.integration.test.ts
```

Expected: PASS.

- [ ] **Step 5: Run web maintenance gates**

```bash
rtk corepack pnpm --filter @cribliv/web test -- pg-operations-api.test.ts MaintenanceWorkspace.test.tsx MaintenanceCreateForm.test.tsx MaintenanceQueueList.test.tsx MaintenanceKanban.test.tsx MaintenanceResolutionSheet.test.tsx MaintenanceTimeline.test.tsx
```

Expected: PASS.

- [ ] **Step 6: Run lint**

```bash
rtk corepack pnpm --filter @cribliv/web lint
rtk corepack pnpm --filter @cribliv/api lint
```

Expected: PASS. Existing unrelated warnings in web lint may remain; new maintenance files should not add unhandled warnings.

- [ ] **Step 7: Manual browser proof**

Start app if needed:

```bash
rtk env PATH=/opt/homebrew/bin:$PATH corepack pnpm dev
```

Manual proof paths:

- Tenant raises common-area ticket with photos.
- Operator sees ticket in dense list and kanban.
- Operator overrides priority.
- Operator adds internal note; tenant cannot see it.
- Operator resolves with note, optional cost, chargeable flag, and fix photo.
- Tenant reopens before auto-close.
- Worker auto-closes a resolved ticket whose deadline has passed.
- Moved-out tenant sees historical read-only ticket for 6 months.

- [ ] **Step 8: Request code review**

Use `superpowers:requesting-code-review` after all checks pass. Ask reviewer to focus on:

- tenant access isolation
- operator property scoping
- internal note visibility
- migration/backfill safety
- transaction/event atomicity
- queue filter correctness
- auto-close idempotency

- [ ] **Step 9: Final commit**

If any docs or final review fixes are needed:

```bash
git add docs/superpowers/prompts/phase-5-maintenance.md docs/superpowers/plans/2026-07-14-maintenance-ops-v2-plan.md
git commit -m "docs(pg-ops): update maintenance ops v2 handoff"
```

---

## Self-Review Notes

- Spec coverage: user-approved choices 1, 3, 4, 5, 6, 7 are covered by Tasks 1-10.
- Migration numbering: plan uses `0062` because current worktree has `0061_pg_maintenance.sql` after master-aligned renumbering.
- No new roles: no staff/vendor role, no vendor portal, no assignee table.
- Data persistence: SLA, location, resolution, timeline, internal notes, analytics, and historical access all use persisted DB state.
- Existing photo upload namespace remains request-scoped under Blob and is reused for fix photos.
- Placeholder scan: this plan intentionally avoids incomplete placeholder language in implementation steps.
- Scope warning: this is a large pass across DB/API/web/worker. If execution risk is high, split at task boundaries and commit after each task exactly as written.

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-07-14-maintenance-ops-v2-plan.md`.

Two execution options:

1. **Subagent-Driven (recommended)** - dispatch a fresh subagent per task, review between tasks, fastest with this plan.
2. **Inline Execution** - execute tasks in this session using executing-plans, with checkpoints after each backend/frontend slice.

For the next session, start by reading:

1. `docs/superpowers/prompts/00-EXECUTION-CONTEXT.md`
2. `docs/superpowers/prompts/phase-5-maintenance.md`
3. `docs/superpowers/plans/2026-07-14-maintenance-ops-v2-plan.md`
4. `infra/migrations/0061_pg_maintenance.sql`
5. `apps/api/src/modules/pg-operations/services/pg-maintenance.service.ts`
6. `apps/web/components/pg-operator/ops/MaintenanceWorkspace.tsx`
