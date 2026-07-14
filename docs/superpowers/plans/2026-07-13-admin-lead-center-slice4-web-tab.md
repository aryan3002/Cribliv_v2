# Admin Lead Center — Slice 4 (Web Lead Center Tab) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Build the admin **Lead Center** web tab — the visible UI over Slices 1–3: a live ops board (KPI cards, filters, table with a ticking refund countdown, row actions, a detail-drawer timeline) and an analytics sub-view (funnel/engagement charts + per-owner rollup with drill-down). Mirrors the existing admin design system exactly (no new design language).

**Architecture:** One new tab component `LeadCenterTab` with a **Board | Analytics** segmented control, backed by new typed client functions in `lib/admin-api.ts`. It follows the `RentAgreementsTab` template (KPI `StatCard`s + charts + filtered `DataTable` + row-click→`Drawer` with a second fetch). New client fns return the **snake_case `@cribliv/shared-types` DTOs directly** (single source of truth — the API already emits these shapes; avoids camelCase-mapping drift for these rich nested types). Live countdown is a small `useCountdown` hook (1s tick) driven by the server's `seconds_remaining` + `generated_at`.

**Tech Stack:** Next.js 14 (App Router) admin SPA, React, `recharts` (via the wrapped chart primitives), `@cribliv/shared-types`, Vitest + `@testing-library/react` (jsdom), Playwright (E2E, written for CI).

## Global Constraints

- **Builds on Slices 1–3** (branch `claude/lead-analytics-dashboards-7449c3`, PR #70). The API endpoints exist: `GET /admin/leads/board`, `/analytics`, `/by-owner/:id`, `/:id/timeline`; `POST /:id/team-called`, `/:id/nudge-owner`, `/:id/refund`. All admin-guarded, all return `{ data: ... }` (unwrapped by `fetchApi`). Ships behind `ff_admin_lead_center` server-side; the tab is always mounted client-side but the endpoints 403/`feature_disabled` when off — handle that gracefully (empty state, not a crash).
- **No running app/DB in this environment.** Verification is `pnpm --filter @cribliv/web typecheck` (clean) + `pnpm --filter @cribliv/web build` (succeeds) + Vitest component render tests (jsdom, mocking the api module). Playwright E2E is WRITTEN but not run here (needs the app+DB; runs in CI).
- **Mirror the existing admin design system.** Reuse `components/admin/primitives/*` (`DataTable`, `StatCard`, `StatusPill`, `Drawer`, `ConfirmDialog`, `EmptyState`, `SectionCard`), `components/admin/charts/*` (`AreaChart`, `BarChart`), `lib/admin/format.ts`, and `admin.css` classes (`admin-main__section`, `admin-page-title`, `admin-stat-grid`, `admin-chip`, `admin-input`, `admin-btn`, `admin-btn--ghost`/`--primary`/`--danger`). **Do NOT add a new design language or new global CSS beyond a couple of scoped `admin-*` classes if truly needed.** Follow `RentAgreementsTab.tsx` for structure.
- **admin-api convention:** `authHeaders(accessToken)`, `fetchApi<T>(path, init)`, `buildSearchQuery(params)` from `./api`. New client fns take `accessToken` as the first arg.
- **Tab wiring is exhaustiveness-checked** (three spots must all change or it won't compile): the `AdminTab` union (`AdminSidebar.tsx`), `TAB_TITLES` (`AdminShell.tsx`, a `Record<AdminTab,string>`), and the `switch(tab)` in `AdminShell.tsx`. Add `"lead-center"` to all three. Sidebar nav item goes in the `work` array (`{ id:"lead-center", label:"Lead Center", icon:<PhoneCall or similar lucide icon>, count: counts["lead-center"] }`).
- **Props contract:** `interface Props { accessToken: string; onCountChange?: (count: number) => void; onToast: (message: string, tone?: "trust"|"warn"|"danger") => void; }` (matches `CrmTab`/`UsersTab`). Report the **uncalled** counter via `onCountChange` (a red badge = leads needing attention).
- **Commits:** conventional; `lint-staged` installed; end with `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.

## Reference files (read these)

- Exemplar tab: `apps/web/components/admin/tabs/RentAgreementsTab.tsx` (KPI+charts+table+detail-drawer). Polling: `tabs/LiveOpsTab.tsx` (30s `setInterval` + cleanup). Simple fetch+count: `tabs/CrmTab.tsx`.
- Primitives/charts prop shapes + admin-api conventions + `format.ts` helpers: as surveyed in the Slice 4 research (see the design spec §10 and the web-infra research). `DataTable` `Column<T>` = `{ key, header, render, sortValue?, width?, align? }`; `StatCard` = `{ label, value, delta?, spark?, tone? }`; `Drawer` = `{ open, onClose, title?, subtitle?, children, footer? }`; `ConfirmDialog` = `{ open, title, body, confirmLabel?, destructive?, onConfirm, onCancel, busy? }`; `AreaChart`/`BarChart` = `{ data, xKey, yKey, height?, color?, tooltipFormatter? }`.

---

## File Structure

- `apps/web/lib/admin-api.ts` — add 7 client fns (board/analytics/by-owner/timeline reads + team-called/nudge/refund actions).
- `apps/web/components/admin/lead-center/LeadCenterTab.tsx` — shell + Board|Analytics segmented control + polling.
- `apps/web/components/admin/lead-center/LeadBoard.tsx` — KPI cards + filters + table + countdown + row actions.
- `apps/web/components/admin/lead-center/LeadCountdown.tsx` — `useCountdown` + display.
- `apps/web/components/admin/lead-center/LeadDrawer.tsx` — per-lead timeline + actions.
- `apps/web/components/admin/lead-center/LeadAnalytics.tsx` — KPI + charts + rollup table.
- `apps/web/components/admin/lead-center/OwnerDrillDrawer.tsx` — per-owner drill-down.
- `apps/web/components/admin/shell/AdminSidebar.tsx` + `AdminShell.tsx` — register the tab.
- Tests: `apps/web/components/admin/lead-center/__tests__/LeadCenterTab.test.tsx` (render, mock api); `apps/web/tests/admin-lead-center.spec.ts` (Playwright, for CI).

---

### Task 1: admin-api client functions

**Files:** Modify `apps/web/lib/admin-api.ts`.

- [ ] **Step 1:** Add these fns (import the DTOs from `@cribliv/shared-types`; use `authHeaders` + `buildSearchQuery`). Types come straight from shared-types — no camelCase mapping.

```ts
import type {
  AdminLeadBoardResponse,
  AdminLeadBoardFilter,
  AdminLeadAnalytics,
  AdminLeadOwnerDetail,
  AdminLeadTimelineResponse
} from "@cribliv/shared-types";

export interface AdminLeadBoardParams {
  filter?: AdminLeadBoardFilter;
  owner_id?: string;
  state?: string;
  status?: string;
  q?: string;
  range?: string;
  page?: number;
  page_size?: number;
}
export async function fetchAdminLeadBoard(accessToken: string, params: AdminLeadBoardParams = {}) {
  const qs = buildSearchQuery(params as Record<string, unknown>);
  return fetchApi<AdminLeadBoardResponse>(`/admin/leads/board${qs ? `?${qs}` : ""}`, {
    headers: authHeaders(accessToken)
  });
}
export async function fetchAdminLeadAnalytics(accessToken: string, range = "30 days") {
  const qs = buildSearchQuery({ range });
  return fetchApi<AdminLeadAnalytics>(`/admin/leads/analytics${qs ? `?${qs}` : ""}`, {
    headers: authHeaders(accessToken)
  });
}
export async function fetchAdminLeadByOwner(
  accessToken: string,
  ownerId: string,
  range = "30 days"
) {
  const qs = buildSearchQuery({ range });
  return fetchApi<AdminLeadOwnerDetail>(`/admin/leads/by-owner/${ownerId}${qs ? `?${qs}` : ""}`, {
    headers: authHeaders(accessToken)
  });
}
export async function fetchAdminLeadTimeline(accessToken: string, leadId: string) {
  return fetchApi<AdminLeadTimelineResponse>(`/admin/leads/${leadId}/timeline`, {
    headers: authHeaders(accessToken)
  });
}
export async function markAdminLeadTeamCalled(accessToken: string, leadId: string) {
  return fetchApi<{ lead_id: string; called_at: string; called_by: string }>(
    `/admin/leads/${leadId}/team-called`,
    { method: "POST", headers: authHeaders(accessToken) }
  );
}
export async function nudgeAdminLeadOwner(accessToken: string, leadId: string) {
  return fetchApi<{ lead_id: string; nudged: boolean }>(`/admin/leads/${leadId}/nudge-owner`, {
    method: "POST",
    headers: authHeaders(accessToken)
  });
}
export async function refundAdminLead(accessToken: string, leadId: string, reason: string) {
  return fetchApi<{ lead_id: string; refunded: boolean; refund_txn_id: string | null }>(
    `/admin/leads/${leadId}/refund`,
    { method: "POST", headers: authHeaders(accessToken), body: JSON.stringify({ reason }) }
  );
}
```

- [ ] **Step 2:** `pnpm --filter @cribliv/web typecheck` clean. Commit `feat(web): admin lead center api client functions`.

---

### Task 2: Tab registration + `LeadCenterTab` shell + `LeadBoard`

**Files:** `AdminSidebar.tsx`, `AdminShell.tsx`, `lead-center/LeadCenterTab.tsx`, `lead-center/LeadBoard.tsx`, `lead-center/LeadCountdown.tsx`.

- [ ] **Step 1: Register the tab.** In `AdminSidebar.tsx`: add `"lead-center"` to the `AdminTab` union; push `{ id: "lead-center", label: "Lead Center", icon: PhoneCall, count: counts["lead-center"] }` into the `work` array (import `PhoneCall` from `lucide-react`). In `AdminShell.tsx`: add `"lead-center": "Lead Center"` to `TAB_TITLES`; import `LeadCenterTab`; add `case "lead-center": return <LeadCenterTab key={\`lc-${k}\`} accessToken={accessToken} onCountChange={handleCount("lead-center")} onToast={push} />;`.

- [ ] **Step 2: `LeadCountdown.tsx`** — a `useCountdown` hook + display. It takes `secondsRemaining: number | null` and a `generatedAt: string`, computes the live remaining seconds as `Math.max(0, secondsRemaining - (Date.now() - Date.parse(generatedAt))/1000)`, ticks every 1s via `useEffect`+`setInterval` (cleanup on unmount), and renders `23h 12m` / `5m 03s` with a tone class: green (`admin-countdown--ok`) default, amber (`--warn`) when `< 6h`, red (`--danger`) when `< 1h`, and `—` when `secondsRemaining` is null, `Refunded`/`Expired` when 0. (Add the three scoped `admin-countdown--*` colour classes to `admin.css`.)

- [ ] **Step 3: `LeadBoard.tsx`** — mirror `RentAgreementsTab`'s render order:
  - **KPI strip** (`admin-stat-grid` of `StatCard`s) from `counters`: In-flight, Uncalled (tone `warn`), Expiring <6h (tone `danger`), Refunded today, Expired today.
  - **Filter chips** (`admin-chip`, `aria-pressed`): All / Uncalled (`needs_call`) / Expiring <6h (`expiring_6h`) / Called / Refunded today — plus a search `admin-input` (debounced 300ms → `q`) and an owner-id note (drill-down sets it).
  - **`DataTable`** of `AdminLeadBoardRow` with columns: **Seeker** (`row.seeker.name` + a `tel:` link on `row.seeker.phone_e164`), **Owner** (`row.owner.name` + `StatusPill` of `health_grade` when present), **Listing** (`row.listing_title` + `row.city`), **State** (`StatusPill status={row.access_state}`), **Called?** (✓ owner / ✓ team / ✗ Not called — from `called_at`/`called_by`), **Refund in** (`<LeadCountdown secondsRemaining={row.seconds_remaining} generatedAt={data.generated_at} />`), **Created** (`formatRelativeTime(row.created_at)`), **Actions** (a row menu — implemented in Task 3). `rowKey={r => r.lead_id}`, `onRowClick` opens the detail drawer (Task 3).
  - Manual pager (Prev/Next `admin-btn--ghost`) using `data.total` + page size.
  - Report `counters.uncalled` via `onCountChange`.
  - Fetch via `fetchAdminLeadBoard(accessToken, { filter, q, page })`, with the `LiveOpsTab` polling pattern (30s `setInterval` + `cancelled` guard + cleanup) and a debounced refetch on filter/search change. Handle `ApiError` with `code==='feature_disabled'` → show an `EmptyState` ("Lead Center is disabled — enable ff_admin_lead_center") instead of a toast-spam loop.

- [ ] **Step 4: `LeadCenterTab.tsx`** — shell: a segmented control (two `admin-chip`/tab buttons **Board** | **Analytics**), renders `<LeadBoard .../>` or `<LeadAnalytics .../>` (Analytics stubbed until Task 4 — render a placeholder `EmptyState` so this task builds). Threads `accessToken`/`onToast`/`onCountChange` down.

- [ ] **Step 5:** `pnpm --filter @cribliv/web typecheck` clean; `pnpm --filter @cribliv/web build` succeeds. Commit `feat(web): lead center tab shell + live board + countdown`.

---

### Task 3: Row actions + `LeadDrawer`

**Files:** `lead-center/LeadBoard.tsx` (wire actions), `lead-center/LeadDrawer.tsx`.

- [ ] **Step 1: Row actions** on each board row (and inside the drawer footer):
  - **Call seeker → mark handled:** an `<a href={\`tel:${row.seeker.phone_e164}\`}>`plus a "Mark handled" button that calls`markAdminLeadTeamCalled`then refetches;`onToast("Marked as called", "trust")`; handle 409 `already_called`→`onToast(..., "warn")`.
  - **Nudge owner:** button → `nudgeAdminLeadOwner`; toast `nudged ? "Owner nudged" : "Already nudged recently / owner unreachable"`.
  - **Refund:** button → `ConfirmDialog` ("Refund 1 credit to the seeker? Stops the guarantee clock and expires a locked lead.") → `refundAdminLead(accessToken, leadId, reason)` on confirm; toast; refetch. Handle 409 `already_responded`/`already_refunded` gracefully.
  - Use optimistic-refetch (not optimistic mutation) — after any action, re-run the board fetch.

- [ ] **Step 2: `LeadDrawer.tsx`** — opened on row click. `<Drawer open title={row.seeker.name} subtitle={row.listing_title}>`; on open, `fetchAdminLeadTimeline(accessToken, leadId)` and render the events as a vertical timeline (`event.at` via `formatRelativeTime`, `event.source` badge, `event.kind`, `event.actor`, `event.detail`). Footer: the same three actions. Loading/empty states.

- [ ] **Step 3:** typecheck + build clean. Commit `feat(web): lead center row actions + detail-drawer timeline`.

---

### Task 4: `LeadAnalytics` + `OwnerDrillDrawer`

**Files:** `lead-center/LeadAnalytics.tsx`, `lead-center/OwnerDrillDrawer.tsx`, wire into `LeadCenterTab`.

- [ ] **Step 1: `LeadAnalytics.tsx`** — fetch `fetchAdminLeadAnalytics(accessToken, range)` on `[accessToken, range]` (range chips 7/30/90 days). Render:
  - **KPI row** (`admin-stat-grid` `StatCard`s) from `funnel`/`rates`: Callbacks requested, Leads called, Deals done, Refund rate (`formatPct(rates.refund_rate)`), Team-rescue rate.
  - **Trend** `AreaChart` — `data={analytics.trend}` `xKey="day" yKey="called"` (or a small channel toggle). Wrap in `SectionCard title="Daily lead activity"`.
  - **Engagement funnel** `BarChart` — `data` = `[{step:'Searches',n:engagement.searches},{step:'Views',n:engagement.listing_views},{step:'Signups',n:engagement.signups},{step:'Callbacks',n:engagement.callbacks_requested},{step:'Calls',n:engagement.calls_made}]`, `xKey="step" yKey="n"`. `SectionCard title="Engagement funnel"`.
  - **Per-owner rollup** `DataTable` of `by_owner`: Owner (name + `StatusPill` health_grade), Role, Leads, Called rate (`formatPct(called_rate)`), Median response (`formatMinutes(median_response_minutes ?? 0)`), Refund rate, Health (score). `onRowClick` → open `OwnerDrillDrawer`. **Label the "Leads/funnel" column context as lifetime where the drill-down funnel is lifetime** (Slice-3 review note: owner-detail funnel is all-time, rates are range-scoped).

- [ ] **Step 2: `OwnerDrillDrawer.tsx`** — `<Drawer>` opened from a rollup row; `fetchAdminLeadByOwner(accessToken, ownerId, range)`; render the owner header (name/role/health), the lifetime funnel (small `StatCard`s or a `BarChart`, **labelled "Lifetime pipeline"**), range-scoped rates, and the `in_flight` leads as a compact list (reuse the board row rendering or a simple list). For a `pg_operator` owner, show a note/link: "Full PG analytics → PG Listings tab" (do NOT embed PG dashboard data).

- [ ] **Step 3:** Wire `LeadAnalytics` into `LeadCenterTab`'s Analytics branch (replace the Task-2 placeholder). typecheck + build clean. Commit `feat(web): lead center analytics + per-owner drill-down`.

---

### Task 5: Verification + tests

**Files:** `lead-center/__tests__/LeadCenterTab.test.tsx`, `apps/web/tests/admin-lead-center.spec.ts`.

- [ ] **Step 1: Component render test** (Vitest + `@testing-library/react`, jsdom). Mock `../../../lib/admin-api` (vi.mock) so `fetchAdminLeadBoard` resolves a small `AdminLeadBoardResponse` (1 row, counters). Render `<LeadCenterTab accessToken="t" onToast={()=>{}} />`; assert the seeker name renders, a KPI label ("Uncalled") renders, and switching to Analytics (mock `fetchAdminLeadAnalytics`) renders a chart section title. This runs in CI and locally.
- [ ] **Step 2: Playwright E2E** (`admin-lead-center.spec.ts`) written for CI — seed an admin session (mirror `admin-decisions.spec.ts`), navigate to the admin dashboard, open the Lead Center tab, assert the board table + KPI cards render, open a row drawer. Guard with the same env/flag pattern the callback-lead E2E uses (`FF_ADMIN_LEAD_CENTER`); it self-skips without the app+DB.
- [ ] **Step 3: Final gates:** `pnpm --filter @cribliv/web typecheck` clean; `pnpm --filter @cribliv/web build` succeeds; `pnpm --filter @cribliv/web test` (the render test passes; pre-existing quarantined suites unaffected). Commit `test(web): lead center render test + e2e spec`.

---

## Slice 4 Definition of Done

- A `lead-center` admin tab renders the live board (KPI cards, filters, table, ticking countdown, row actions, detail-drawer timeline) and the analytics sub-view (funnel/engagement charts + per-owner rollup + drill-down).
- New `admin-api.ts` client fns typed via `@cribliv/shared-types`.
- `pnpm --filter @cribliv/web typecheck` clean; `pnpm --filter @cribliv/web build` succeeds; the render test passes.
- E2E spec written (CI).

## Notes / carry-forward

- The board/analytics can only be seen live once `ff_admin_lead_center` is on AND a healthy app+DB is running — verify visually in CI/staging.
- Slice 5 (verify) folds in the Slice-3 polish Minors (uppercase-UUID health lookup, `called_within_24h_rate` rename) and a full cross-slice typecheck/build/test sweep.
