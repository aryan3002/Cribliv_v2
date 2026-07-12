# Admin Lead Center — Slice 3 (Analytics + Drill-down) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Add the admin lead **analytics** layer — an aggregate lead funnel + engagement funnel + response/refund rates + a per-owner/operator rollup (`GET /admin/leads/analytics`), a per-owner drill-down (`GET /admin/leads/by-owner/:id`), and wire real owner-health scores into the board rows Slice 1 left as `null`.

**Architecture:** All new work lives on `AdminLeadOpsService` + `AdminLeadsController` (no new module deps). Owner-health uses the **pure** `computeOwnerHealth` function imported from the admin module. The per-owner drill-down is lead-centric (funnel + in-flight leads + response metrics); it does NOT embed the PG operator dashboard (that would create a circular module dependency, and admin already has PG analytics in its PG tabs) — the web slice links operators to the existing PG Properties tab.

**Tech Stack:** NestJS (`apps/api`), raw SQL via `DatabaseService`, Postgres, Vitest, `@cribliv/shared-types`.

## Global Constraints

- **Builds on Slices 1+2** (branch `claude/lead-analytics-dashboards-7449c3`, PR #70). `AdminLeadOpsService` constructor is `(DatabaseService, NotificationService)` — do NOT change it (no new injected deps needed).
- **No new module deps / no migration.** Import the pure `computeOwnerHealth` from `../../admin/owner-health.calculator` (a plain function, not an injectable). All analytics read existing tables.
- **No database available** — DB integration tests are WRITTEN but self-skip (`describe.runIf(!!process.env.TEST_DATABASE_URL)`); gate is `pnpm --filter @cribliv/api typecheck` (clean) + the full non-DB suite. Pure-logic tasks get real unit tests.
- **Dual-mode + flag gate:** every method calls `this.ensureEnabled()` (throws `feature_disabled` when `ff_admin_lead_center` off) then guards `this.database.isEnabled()` (empty result when off), mirroring `getBoard`.
- **Admin routes** class-guarded on `AdminLeadsController`; responses via `ok(...)`.
- **Range param:** analytics endpoints take `?range=` validated against the same allowlist as the board (`7 days`/`30 days`/`90 days`, default `30 days`). Reuse the allowlist guard.
- **Tests:** `.test.ts`; DB integration in `apps/api/test/*.integration.test.ts` (raw-`pg`, self-skip, ordered cleanup incl. `admin_actions` before `users`, and set `process.env.FF_ADMIN_LEAD_CENTER='true'` in `beforeAll`). Unit tests in `src/**/__tests__/`.
- **Commits:** conventional; `lint-staged` installed; end with `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.

## Schema facts (verified)

- `pg_search_events(query, city, created_at)` — searches. `listing_events(event_type, created_at)` — `event_type='view'` for views (plain text col). `users.created_at` — signups. `contact_unlocks(created_at, owner_response_status, unlock_status, updated_at, owner_responded_at, response_deadline_at)`. `leads(created_at, status, access_state, called_at, called_by, unlocked_at, disputed_at, call_deadline_at, owner_user_id)`. `lead_status` = `new|contacted|visit_scheduled|deal_done|lost`.
- `computeOwnerHealth(inputs)` (pure, `apps/api/src/modules/admin/owner-health.calculator.ts`): inputs `{listings_active, listings_paused, avg_response_minutes|null, unlocks_60d, deals_done_60d, days_since_last_login|null, report_count}` → `{score, grade:'A'|'B'|'C'|'D'|'F', components}`.
- The owner-health input CTE to adapt lives in `apps/api/src/modules/admin/admin-owner-health.service.ts` (~lines 66-111).

---

## File Structure

- `packages/shared-types/src/admin-leads.ts` — add analytics + drill-down DTOs.
- `apps/api/src/modules/leads/admin-lead-ops.service.ts` — add `ownerHealthByIds`, wire health into `getBoard`, add `getAnalytics`, `getOwnerDetail`.
- `apps/api/src/modules/leads/admin-leads.controller.ts` — add `GET /analytics`, `GET /by-owner/:id`.
- Tests: `src/modules/leads/__tests__/owner-health-map.test.ts` (unit, runs); `test/admin-lead-analytics.integration.test.ts` (self-skip).

---

### Task 1: Shared-types for analytics + drill-down

**Files:** Modify `packages/shared-types/src/admin-leads.ts`.

- [ ] **Step 1: Add the DTOs** (append to `admin-leads.ts`):

```ts
export interface AdminLeadFunnel {
  callbacks_requested: number;
  leads_created: number;
  leads_unlocked: number;
  leads_called: number;
  deals_done: number;
  leads_refunded: number;
  leads_disputed: number;
}
export interface AdminLeadEngagementFunnel {
  searches: number;
  listing_views: number;
  signups: number;
  callbacks_requested: number;
  calls_made: number;
}
export interface AdminLeadRates {
  median_response_minutes: number | null;
  called_within_24h_rate: number;
  team_rescue_rate: number;
  refund_rate: number;
  dispute_rate: number;
}
export interface AdminLeadTrendPoint {
  day: string;
  callbacks: number;
  unlocked: number;
  called: number;
  refunded: number;
}
export interface AdminLeadOwnerRollupRow {
  owner_user_id: string;
  name: string;
  role: "owner" | "pg_operator";
  leads: number;
  called: number;
  called_rate: number;
  median_response_minutes: number | null;
  refund_rate: number;
  health_score: number | null;
  health_grade: "A" | "B" | "C" | "D" | "F" | null;
}
export interface AdminLeadAnalytics {
  range: string;
  generated_at: string;
  funnel: AdminLeadFunnel;
  engagement: AdminLeadEngagementFunnel;
  rates: AdminLeadRates;
  trend: AdminLeadTrendPoint[];
  by_owner: AdminLeadOwnerRollupRow[];
}
export interface AdminLeadOwnerFunnel {
  new: number;
  contacted: number;
  visit_scheduled: number;
  deal_done: number;
  lost: number;
  total: number;
}
export interface AdminLeadOwnerDetail {
  owner_user_id: string;
  name: string;
  role: "owner" | "pg_operator";
  phone_masked: string;
  health_score: number | null;
  health_grade: "A" | "B" | "C" | "D" | "F" | null;
  funnel: AdminLeadOwnerFunnel;
  rates: AdminLeadRates;
  in_flight: AdminLeadBoardRow[];
}
```

- [ ] **Step 2:** `pnpm --filter @cribliv/shared-types build` — clean.
- [ ] **Step 3:** Commit `feat(shared-types): admin lead analytics + drill-down DTOs`.

---

### Task 2: Owner-health wiring into board rows

**Files:** Modify `admin-lead-ops.service.ts`; Test `src/modules/leads/__tests__/owner-health-map.test.ts`.

**Interfaces:** Produces `AdminLeadOpsService.ownerHealthByIds(ids: string[]): Promise<Map<string, { score: number; grade: "A"|"B"|"C"|"D"|"F" }>>`.

- [ ] **Step 1: Implement `ownerHealthByIds`.** READ `apps/api/src/modules/admin/admin-owner-health.service.ts` (~lines 66-111) for the per-owner input CTE; adapt it into a private method here that adds `WHERE o.id = ANY($1::uuid[])` on the owners CTE, and map each row through the imported pure `computeOwnerHealth`. Add the import `import { computeOwnerHealth } from "../../admin/owner-health.calculator";`. Shape:

```ts
  async ownerHealthByIds(ids: string[]): Promise<Map<string, { score: number; grade: "A" | "B" | "C" | "D" | "F" }>> {
    const out = new Map<string, { score: number; grade: "A" | "B" | "C" | "D" | "F" }>();
    if (!ids.length || !this.database.isEnabled()) return out;
    const result = await this.database.query</* the CTE row shape: owner_user_id + the computeOwnerHealth inputs */ any>(
      `/* adapted CTE from admin-owner-health.service.ts with WHERE o.id = ANY($1::uuid[]) */`,
      [ids]
    );
    for (const r of result.rows) {
      const h = computeOwnerHealth({
        listings_active: Number(r.listings_active ?? 0),
        listings_paused: Number(r.listings_paused ?? 0),
        avg_response_minutes: r.avg_response_minutes === null ? null : Number(r.avg_response_minutes),
        unlocks_60d: Number(r.unlocks_60d ?? 0),
        deals_done_60d: Number(r.deals_done_60d ?? 0),
        days_since_last_login: r.days_since_last_login === null ? null : Number(r.days_since_last_login),
        report_count: Number(r.report_count ?? 0)
      });
      out.set(r.owner_user_id, { score: h.score, grade: h.grade });
    }
    return out;
  }
```

- [ ] **Step 2: Wire into `getBoard`.** After building `rows` but before returning, collect distinct `owner.user_id`s, call `ownerHealthByIds`, and set each row's `owner.health_score`/`health_grade` from the map (leave `null` when absent). Replace the Slice-1 `health_score: null, health_grade: null` with values looked up post-map (restructure: build rows, then `const health = await this.ownerHealthByIds([...new Set(rows.map(r=>r.owner.user_id))]); rows.forEach(r => { const h = health.get(r.owner.user_id); r.owner.health_score = h?.score ?? null; r.owner.health_grade = h?.grade ?? null; });`).

- [ ] **Step 3: Unit test the mapping** (`owner-health-map.test.ts`, runs, no DB). Test that `computeOwnerHealth` maps representative input rows to sane score/grade (a healthy owner → high score/A-ish; a bad owner → low). This characterizes the pure mapping used by `ownerHealthByIds`. (The DB CTE itself is covered by the analytics integration test in Task 3.)

- [ ] **Step 4:** typecheck clean; unit test passes. Commit `feat(api): wire owner health scores into admin lead board rows`.

---

### Task 3: `getAnalytics` + `GET /admin/leads/analytics`

**Files:** Modify `admin-lead-ops.service.ts`, `admin-leads.controller.ts`; Test `test/admin-lead-analytics.integration.test.ts`.

**Interfaces:** Produces `AdminLeadOpsService.getAnalytics(range: string): Promise<AdminLeadAnalytics>`.

- [ ] **Step 1: Write the failing integration test** (`admin-lead-analytics.integration.test.ts`, raw-`pg`, self-skips; set `FF_ADMIN_LEAD_CENTER='true'`). Seed a small scenario (owner, seeker, listing, a couple leads incl. one called + one refunded, a contact_unlock, a listing_events 'view', a pg_search_events row, ) and assert `getAnalytics("30 days")` returns a `funnel` with `callbacks_requested>=1`, an `engagement` with `searches>=1`/`listing_views>=1`/`signups>=1`, `rates` present, `trend` a non-empty array, and `by_owner` containing the seeded owner with `leads>=1`.

- [ ] **Step 2: Implement `getAnalytics`.** `ensureEnabled()` + dual-mode (empty AdminLeadAnalytics when DB off). Validate `range` against the allowlist (`7 days`/`30 days`/`90 days`, default `30 days`). Run these (batched via `Promise.all`):
  - **funnel** (one query):

```sql
SELECT
  (SELECT count(*) FROM contact_unlocks WHERE created_at >= now() - $1::interval)::int AS callbacks_requested,
  (SELECT count(*) FROM leads WHERE created_at >= now() - $1::interval)::int AS leads_created,
  (SELECT count(*) FROM leads WHERE unlocked_at IS NOT NULL AND unlocked_at >= now() - $1::interval)::int AS leads_unlocked,
  (SELECT count(*) FROM leads WHERE called_at IS NOT NULL AND called_at >= now() - $1::interval)::int AS leads_called,
  (SELECT count(*) FROM leads WHERE status='deal_done' AND status_changed_at >= now() - $1::interval)::int AS deals_done,
  (SELECT count(*) FROM contact_unlocks WHERE unlock_status='refunded' AND updated_at >= now() - $1::interval)::int AS leads_refunded,
  (SELECT count(*) FROM leads WHERE disputed_at IS NOT NULL AND disputed_at >= now() - $1::interval)::int AS leads_disputed
```

- **engagement** (one query):

```sql
SELECT
  (SELECT count(*) FROM pg_search_events WHERE created_at >= now() - $1::interval)::int AS searches,
  (SELECT count(*) FROM listing_events WHERE event_type='view' AND created_at >= now() - $1::interval)::int AS listing_views,
  (SELECT count(*) FROM users WHERE created_at >= now() - $1::interval)::int AS signups,
  (SELECT count(*) FROM contact_unlocks WHERE created_at >= now() - $1::interval)::int AS callbacks_requested,
  (SELECT count(*) FROM leads WHERE called_at IS NOT NULL AND called_at >= now() - $1::interval)::int AS calls_made
```

- **rates** (one query over leads/contact_unlocks in range):

```sql
SELECT
  percentile_cont(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (called_at - created_at))/60)
    FILTER (WHERE called_at IS NOT NULL) AS median_response_minutes,
  COALESCE(avg(CASE WHEN called_at IS NOT NULL THEN 1 ELSE 0 END)
    FILTER (WHERE call_deadline_at IS NOT NULL), 0)::float AS called_within_24h_rate,
  COALESCE(avg(CASE WHEN called_by='team' THEN 1 ELSE 0 END) FILTER (WHERE called_at IS NOT NULL), 0)::float AS team_rescue_rate,
  COALESCE(avg(CASE WHEN disputed_at IS NOT NULL THEN 1 ELSE 0 END) FILTER (WHERE called_at IS NOT NULL), 0)::float AS dispute_rate
FROM leads WHERE created_at >= now() - $1::interval
```

    plus refund_rate from a second small query: `SELECT COALESCE(avg(CASE WHEN unlock_status='refunded' THEN 1 ELSE 0 END),0)::float AS refund_rate FROM contact_unlocks WHERE created_at >= now() - $1::interval`. (Round median to an int or leave float; type is `number|null`.)

- **trend** (daily buckets):

```sql
SELECT to_char(d::date,'YYYY-MM-DD') AS day,
  (SELECT count(*) FROM contact_unlocks c WHERE c.created_at::date = d::date)::int AS callbacks,
  (SELECT count(*) FROM leads l WHERE l.unlocked_at::date = d::date)::int AS unlocked,
  (SELECT count(*) FROM leads l WHERE l.called_at::date = d::date)::int AS called,
  (SELECT count(*) FROM contact_unlocks c WHERE c.unlock_status='refunded' AND c.updated_at::date = d::date)::int AS refunded
FROM generate_series(now() - $1::interval, now(), interval '1 day') d
ORDER BY day ASC
```

- **by_owner rollup** (GROUP BY owner):

```sql
SELECT ld.owner_user_id::text AS owner_user_id,
       COALESCE(o.full_name,'Owner') AS name, o.role::text AS role,
       count(*)::int AS leads,
       count(*) FILTER (WHERE ld.called_at IS NOT NULL)::int AS called,
       percentile_cont(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (ld.called_at - ld.created_at))/60)
         FILTER (WHERE ld.called_at IS NOT NULL) AS median_response_minutes
FROM leads ld JOIN users o ON o.id = ld.owner_user_id
WHERE ld.created_at >= now() - $1::interval
GROUP BY ld.owner_user_id, o.full_name, o.role
ORDER BY leads DESC LIMIT 100
```

    Compute `called_rate = called/leads`; get `refund_rate` per owner from a small companion query (refunded unlocks / unlocks per owner) or set from a joined subquery; then merge `health_score`/`grade` via `ownerHealthByIds(ownerIds)`.

Assemble and return `{ range, generated_at: new Date().toISOString(), funnel, engagement, rates, trend, by_owner }`.

- [ ] **Step 3: Add the controller route:**

```ts
  @Get("analytics")
  async analytics(@Query("range") range?: string) {
    return ok(await this.ops.getAnalytics(range ?? "30 days"));
  }
```

(Declare it before the `:id/...` routes — literal path.)

- [ ] **Step 4:** Run the analytics integration test (self-skips), typecheck clean, full suite. Commit `feat(api): admin lead analytics endpoint (funnel + engagement + rates + rollup)`.

---

### Task 4: `getOwnerDetail` + `GET /admin/leads/by-owner/:id`

**Files:** Modify `admin-lead-ops.service.ts`, `admin-leads.controller.ts`; extend the analytics integration test with a drill-down case.

**Interfaces:** Produces `AdminLeadOpsService.getOwnerDetail(ownerId: string, range: string): Promise<AdminLeadOwnerDetail>`.

- [ ] **Step 1: Implement `getOwnerDetail`.** `ensureEnabled()` + dual-mode. Validate range. Gather:
  - owner header: `SELECT full_name, phone_e164, role FROM users WHERE id=$1` (404 if missing); mask phone via the existing `maskPhone` helper; health via `ownerHealthByIds([ownerId])`.
  - funnel: reuse the `getBoard` `LeadsService`-style status counts scoped to the owner (a `SELECT status::text, count(*) FROM leads WHERE owner_user_id=$1 GROUP BY status` → the `AdminLeadOwnerFunnel` shape).
  - rates: the same `rates` query as Task 3 but with `AND owner_user_id=$2` added.
  - in_flight: reuse `getBoard({ filter: "needs_call", ownerId, pageSize: 100 })` and take its `.rows` (this already returns `AdminLeadBoardRow[]`, including health for this owner).
    Return `AdminLeadOwnerDetail`.

- [ ] **Step 2: Controller route:**

```ts
  @Get("by-owner/:id")
  async byOwner(@Param("id") ownerId: string, @Query("range") range?: string) {
    return ok(await this.ops.getOwnerDetail(ownerId, range ?? "30 days"));
  }
```

(Literal `by-owner` segment before `:id/timeline` etc. — but note `by-owner/:id` and `:id/timeline` are distinct shapes; keep `board`/`analytics`/`rescue-queue`/`by-owner` literal routes grouped before the `:id/...` param routes.)

- [ ] **Step 3: Extend the integration test** with a `getOwnerDetail(ownerId,"30 days")` case asserting the owner header, a funnel with `total>=1`, and `in_flight` present.

- [ ] **Step 4:** self-skip + typecheck + full suite. Commit `feat(api): admin per-owner lead drill-down endpoint`.

---

## Slice 3 Definition of Done

- Board rows carry real `health_score`/`grade` (owner-health merged by id).
- `GET /admin/leads/analytics?range=` → funnel + engagement funnel + rates + daily trend + per-owner rollup.
- `GET /admin/leads/by-owner/:id?range=` → owner header + funnel + rates + in-flight leads.
- typecheck clean; unit test (owner-health map) passes; integration tests written (self-skip without DB).

## Deferred (Slice 4)

- Web Lead Center tab renders board + analytics + drill-down. For `pg_operator` owners, link to the existing admin PG Properties analytics rather than embedding `PgDashboardData` (avoids the module cycle).
