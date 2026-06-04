# Admin PG Command Center — Design Spec

**Date:** 2026-06-04
**Status:** Approved (brainstorming → ready for implementation plan)
**Author:** Claude (Opus) + owner
**Module:** `apps/api/src/modules/admin`, `apps/web/components/admin`, `apps/api/src/modules/pg-operator`

---

## 1. Goal

Build the admin-side analytics + management layer for the PG operator module (V1 backend is done). Three capabilities:

1. **Expanded admin PG dashboard** — the current PG funnel tab shows only listing funnel + quality + voice. Add the missing supply/demand/operator picture, consolidated.
2. **PG Properties management** — a new admin-only section listing every PG property with status/owner/locality, drill-in detail pages with full edit (name, status, locality, geocoding), full owner details, and controls to mask analytics shown to the operator.
3. **Per-property analytics** — full funnel + engagement metrics for each individual property, admin-side.

All surfaces are admin-only (the entire `AdminController` is already `@UseGuards(AuthGuard, RolesGuard) @Roles("admin")`).

## 2. Non-negotiable principle: masking is non-destructive

The "cut analytics" control is a **read-time presentation filter on the operator's dashboard only**. It MUST NOT stop, alter, or delete data collection.

- Events keep flowing into `pg_search_events`, `listing_events`, `leads`, `pg_listing_funnel_events`, `listing_scores` regardless of override state.
- Admin always reads the real, unmasked analytics.
- When the admin turns the override **off**, the operator immediately sees the complete history — from the listing's first day through the present — with zero backfill. Nothing was lost; the numbers were only hidden.

This guarantee falls out of the architecture for free because masking is applied to the _assembled_ dashboard payload, never to the underlying event tables.

## 3. Architecture decisions

### 3.1 Masking mechanism (chosen: override table + mask-on-read)

New table `pg_analytics_overrides`. The operator dashboard service applies masking to the already-assembled `PgDashboardData` immediately before writing it to its existing 60s in-memory cache.

- **Cost:** +1 lightweight query per cache-miss (≤ once / 60s / operator).
- **Isolation:** the operator analytics pipeline (`PgAnalyticsService`, `PgFunnelService`, `PgDashboardService` reads) is untouched. Admin owns the override table.
- **Reversible + auditable:** `active` boolean toggles without losing history; every change is logged to `admin_actions`.

Rejected alternatives: boolean flags on `pg_properties`/`users` (pollutes domain tables, no audit, no per-metric path); frozen snapshot table (overkill, YAGNI).

### 3.2 Override granularity

Two levels (per approved decision):

- **Operator-global kill** — one row with `pg_property_id IS NULL`. Zeroes ALL analytics for that operator across every PG.
- **Per-PG cutoff** — one row per `(operator_id, pg_property_id)`. Zeroes only that property's listings; operator's other PGs stay live.

Per-metric cutoff is explicitly **out of scope** (YAGNI).

### 3.3 Masking semantics on `PgDashboardData`

Add `analytics_status: 'live' | 'restricted'` to `PgDashboardData` (shared-types).

- **Global override active** → `analytics_status = 'restricted'`; zero `portfolio`, `trend_30d`, every `listing_health` metric, and `search_insights`.
- **Per-PG override active** → zero metrics only for `listing_health` rows whose `pg_property_id` is in the cut set; recompute `portfolio` and `trend_30d` from the surviving listings; set `analytics_status = 'restricted'` if any property is cut.
- Operator UI renders zeros plus a neutral banner: "Analytics temporarily under review." (No language implying a bug or a permanent state.)

To map listings → properties, `ListingsSlice.listOperatorListings` must additionally return `pg_property_id` per listing.

### 3.4 Edit propagation

Admin edits to a property's locality (`city_id`/`locality_id`) or geocoding (`lat`/`lng`) propagate, in a single DB transaction, to:

- `pg_properties` (the property record), and
- `listing_locations` for every listing where `listings.pg_property_id = :id` (`city_id`, `locality_id`, `lat`, `lng`).

`display_name`, `internal_code`, `status`, `total_floors` update `pg_properties` only. All edits write an `admin_actions` audit row with before/after state.

### 3.5 Audit + enums

Reuse the existing `admin_actions(admin_user_id, target_type, target_id, action, reason, before_state, after_state)` table. Add enum values:

- `admin_target_type` += `'pg_property'`
- `admin_action_type` += `'edit_pg_property'`, `'set_analytics_override'`, `'clear_analytics_override'`

(`ALTER TYPE ... ADD VALUE IF NOT EXISTS`, in its own migration step — cannot share a transaction with usage.)

### 3.6 Navigation

New "PG Properties" entry in `AdminSidebar` (`AdminTab` union + `TAB_TITLES`). Routes to a list view; row click opens the property detail view. The existing "PG Listings" tab stays as the (now expanded) funnel/overview dashboard.

## 4. Data model

```sql
-- migration: 0037_pg_analytics_overrides.sql (+ 0037_..._rollback.sql)
ALTER TYPE admin_target_type ADD VALUE IF NOT EXISTS 'pg_property';
ALTER TYPE admin_action_type ADD VALUE IF NOT EXISTS 'edit_pg_property';
ALTER TYPE admin_action_type ADD VALUE IF NOT EXISTS 'set_analytics_override';
ALTER TYPE admin_action_type ADD VALUE IF NOT EXISTS 'clear_analytics_override';

CREATE TABLE IF NOT EXISTS pg_analytics_overrides (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  operator_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  pg_property_id uuid REFERENCES pg_properties(id) ON DELETE CASCADE,  -- NULL = operator-global
  active         boolean NOT NULL DEFAULT true,
  reason         text,
  created_by     uuid NOT NULL REFERENCES users(id),
  updated_by     uuid REFERENCES users(id),
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

-- one global row per operator
CREATE UNIQUE INDEX IF NOT EXISTS uq_pg_override_global
  ON pg_analytics_overrides(operator_id) WHERE pg_property_id IS NULL;
-- one row per (operator, property)
CREATE UNIQUE INDEX IF NOT EXISTS uq_pg_override_property
  ON pg_analytics_overrides(operator_id, pg_property_id) WHERE pg_property_id IS NOT NULL;
-- fast read-path lookup for active overrides by operator
CREATE INDEX IF NOT EXISTS idx_pg_override_operator_active
  ON pg_analytics_overrides(operator_id) WHERE active = true;
```

A rollback migration drops the table and the index (enum values are left in place — additive, harmless).

## 5. Backend components

### 5.1 `PgAnalyticsOverrideService` (new, `modules/admin/`)

- `getActiveForOperator(operatorId): Promise<{ global: boolean; pgPropertyIds: Set<string> }>` — single query, used by the operator dashboard read path. Returns empty when DB disabled.
- `set(adminId, operatorId, { pgPropertyId | null }, reason): upsert active=true` + `admin_actions` log.
- `clear(adminId, operatorId, { pgPropertyId | null }, reason): set active=false` + log.
- `listForOperator(operatorId)` — admin read for the detail page toggle state.

### 5.2 `PgDashboardService` (modify, `modules/pg-operator/`)

- Inject an override lookup (via a thin adapter so the pg-operator module doesn't depend on admin). Add an `OverridesSlice { getActiveForOperator(operatorId) }`, wired in `pg-operator.module.ts` to `PgAnalyticsOverrideService`.
- After assembling `data` and before caching, call a pure `applyMasking(data, overrides)` helper. Pure function → trivially unit-testable.
- `ListingsSlice` rows gain `pg_property_id`.

### 5.3 `PgAdminPropertiesService` (new, `modules/admin/`)

- `listProperties({ q?, status?, city?, page, pageSize })` — lightweight paginated list: property + owner (name, masked phone) + city/locality + status + live-listing status + 7d lead count + cut-state. One batched query.
- `getProperty(id)` — full detail: property fields + owner full details + linked listing summary + override state.
- `updateProperty(adminId, id, patch)` — transactional update + propagation (§3.4) + audit.
- `getPropertyAnalytics(id, days)` — per-property funnel/engagement aggregate (one query grouped by property), reusing the event sources.

### 5.4 `PgAdminAnalyticsService` / `AdminAnalyticsService` (extend)

Add a consolidated PG overview read (supply + demand + operators), batched via `Promise.all` mirroring `PgFunnelService.getAnalytics`:

- Supply: counts by `pg_property_status`; total beds and vacancy rate from `pg_beds`; avg starting rent; gender-policy mix from `pg_details`.
- Distribution: PG count by city/locality.
- Operators: total operators, operators with 0 live listings.
- Demand: top queries + zero-result queries across all PG cities (from `pg_search_events`).
- Keep existing funnel/quality/voice/score-health.

Gated by the existing `ff_pg_admin_analytics` flag.

### 5.5 Endpoints (`AdminController`, all `@Roles("admin")`)

```
GET   /admin/pg/overview?days=         → expanded PG dashboard aggregate
GET   /admin/pg/properties?q&status&city&page&pageSize → list
GET   /admin/pg/properties/:id         → detail (property + owner + listing + overrides)
GET   /admin/pg/properties/:id/analytics?days= → per-property analytics
PATCH /admin/pg/properties/:id         → edit (propagating) + audit
POST  /admin/pg/properties/:id/override        → set { scope: 'global'|'property', reason }
DELETE/admin/pg/properties/:id/override        → clear { scope, reason }
```

Literal sub-paths declared before any `:id` param routes (existing controller convention).

## 6. Frontend components (`apps/web/components/admin`)

- `AdminSidebar` + `AdminShell`: add `pg-properties` tab.
- `tabs/PgPropertiesTab.tsx` — list page using existing `DataTable`, `StatusPill`, search/filter chips; row → detail.
- `pg-properties/PgPropertyDetail.tsx` — detail view with four panels:
  1. **Analytics** — reuse `AreaChart`/`BarChart`/`StatCard`/`SparklineChart` for per-property metrics.
  2. **Edit** — form (name, status, internal_code, locality select, lat/lng, total_floors); `ConfirmDialog` on save; toast on success/error.
  3. **Owner** — read-only owner card.
  4. **Visibility** — two toggles (operator-global, this-PG) with a reason input; `ConfirmDialog`; toast.
- Expanded `tabs/PgListingsTab.tsx` — add supply/demand/operator panels alongside the existing funnel/quality/voice.
- `lib/admin-api.ts` — typed client fns for the new endpoints.

Follow existing admin design system (`admin.css`, primitives). No new design language.

## 7. Performance posture

- Two-tier reads: list = lightweight summary; full per-property analytics only on drill-in.
- Every multi-metric read is batched (`Promise.all` or single CTE) — no per-row loops, no N+1.
- Masking piggybacks the operator's existing 60s cache: +1 query/min/operator worst case.
- All new list endpoints paginated.

## 8. Testing (TDD, red-green-refactor)

Unit:

- `applyMasking` pure helper: none / global / per-PG / mixed; portfolio + trend recompute from survivors; `analytics_status` flag.
- `PgAnalyticsOverrideService`: set/clear/upsert idempotency; global vs property uniqueness; audit row written.
- `PgAdminPropertiesService.updateProperty`: propagation to `listing_locations` in a transaction; non-locality edits don't touch listings; audit before/after.
- `getPropertyAnalytics` aggregation correctness.
- Expanded overview aggregate.

Integration:

- Each new endpoint: 200 happy path, `@Roles("admin")` rejection for non-admin, feature-flag gating where applicable.

Frontend:

- Extend `__tests__/PgAnalyticsComponents.test.tsx` patterns for the new panels (render + masked-state rendering).

## 9. Out of scope

- Per-metric masking.
- Editing owner/user records from the PG detail page (stays in the Users tab).
- Multi-property operator UX beyond what the existing schema/V1 guard already allow.

## 10. Phasing

1. **Backend** — migration, shared-types, override service, dashboard masking, properties service, expanded analytics, endpoints. All TDD.
2. **Frontend** — list page, detail page (4 panels), expanded PG overview, api client.
3. **Verify** — full test suite green; manual smoke of mask/unmask round-trip and edit propagation.
