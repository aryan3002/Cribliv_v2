# Admin Dashboard — Full Rebuild Spec

**Date:** 2026-05-02
**Scope:** Replace the current 1969-line `apps/web/app/[locale]/admin/page.tsx` with a properly-architected dashboard. Add 4 new high-leverage features. Restyle all existing tabs to a Stripe/Vercel-grade aesthetic. Build the supporting backend.

## Why

Today's admin is a single 80 KB client component with inline render functions, no charts, no realtime, no health scoring, and no operator power tools. Reviewing listings or chasing fraud requires multiple tab switches and there's no "god view" — no way to glance at the system and know if it's healthy. We need an operator-grade dashboard that surfaces signal, lets one admin do the work of three, and matches Cribliv's production-grade standards.

## Aesthetic — Stripe / Vercel dense + clean

- **Density first**: 36–44px row heights, 12–16px padding, real data tables (not card lists) for everything that's a list.
- **Restrained color**: Brand blue stays for primary actions and active states. Status colors (`--trust` green, `--warning` amber, `--danger` red, `--accent` coral) ONLY on status pills and metric deltas — not on backgrounds.
- **Typography**: Manrope display for KPI numbers and section titles, Inter for everything else, JetBrains Mono for IDs / amounts.
- **Spacing rhythm**: All gaps on the existing 8pt scale (`--space-*`). No magic numbers.
- **Motion**: 160-220ms cubic-bezier transitions on hover/focus. No marketing-style scroll animations. Tasteful number-tick animations on metric updates.
- **Charts**: `recharts` (lightweight, ~52 KB, tree-shakable). Sparklines, area charts, bar charts. Strict 2-color limit per chart.
- **No dark mode this PR** (would double the design surface; ship light first, add dark in a follow-up).

## File / component architecture

```
apps/web/
├── app/[locale]/admin/page.tsx                  # Thin shell: auth guard, layout, route to tabs
├── components/admin/
│   ├── shell/
│   │   ├── AdminShell.tsx                       # Sidebar + topbar + content slot
│   │   ├── AdminSidebar.tsx                     # Tab nav + counts
│   │   ├── AdminTopbar.tsx                      # Search, refresh, last-refreshed, env badge
│   │   └── CommandPalette.tsx                   # Cmd+K — jump to user, listing, action
│   ├── primitives/
│   │   ├── StatCard.tsx                         # KPI tile with delta + sparkline
│   │   ├── DataTable.tsx                        # Sortable, paginatable, keyboard-nav table
│   │   ├── StatusPill.tsx                       # Color-coded status badge
│   │   ├── SectionCard.tsx                      # Titled card container
│   │   ├── EmptyState.tsx                       # Reusable empty-state pattern
│   │   ├── Drawer.tsx                           # Right-side slide-over for detail views
│   │   └── ConfirmDialog.tsx                    # Destructive action confirmation
│   ├── charts/
│   │   ├── SparklineChart.tsx                   # 60-pt line, no axes, sits inside StatCard
│   │   ├── AreaChart.tsx                        # Wrapped recharts area chart with brand styling
│   │   └── BarChart.tsx                         # Wrapped recharts vertical bars
│   ├── tabs/
│   │   ├── LiveOpsTab.tsx                       # NEW — real-time-ish ops dashboard
│   │   ├── OverviewTab.tsx                      # Restyled — funnel + cohorts
│   │   ├── ListingReviewTab.tsx                 # Restyled — pending review queue
│   │   ├── VerificationTab.tsx                  # Restyled — verification queue
│   │   ├── CrmTab.tsx                           # Restyled — leads pipeline
│   │   ├── UsersTab.tsx                         # Restyled — table + Owner Health Score column
│   │   ├── RevenueTab.tsx                       # NEW — revenue attribution
│   │   ├── FraudTab.tsx                         # NEW — fraud intelligence feed
│   │   └── SystemTab.tsx                        # Pulled out of accordion — full page
│   ├── owner-health/
│   │   ├── HealthBadge.tsx                      # Shows score 0–100 with letter grade
│   │   └── HealthDrawer.tsx                     # Drilldown into one owner's metrics
│   └── admin.css                                # Scoped styles (admin-* classes)
└── lib/admin/
    ├── api.ts                                   # Re-export of existing admin-api.ts + new endpoints
    ├── owner-health.ts                          # Pure score calculation (server returns components)
    ├── format.ts                                # money, dates, percentages, deltas
    └── command-palette-actions.ts               # registry of Cmd+K targets
```

The current `apps/web/lib/admin-api.ts` keeps its existing exports. New functions get added there, not in a parallel file.

## Backend — new endpoints + 1 migration

### Migration

**File:** `apps/api/db/migrations/<next>_add_users_last_login_at.sql`

```sql
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_users_last_login_at ON users(last_login_at);
```

Update `apps/api/src/modules/auth/auth.service.ts` `verifyOtp` flow to write `last_login_at = now()` on every successful verification. Update `apps/api/src/modules/admin/admin.service.ts` to read it.

### Endpoints (added to `AdminController`)

All `GET`, all admin-role-guarded, all return JSON wrapped in `{ data: ... }`.

1. **`GET /admin/ops/live`** — Live ops counters
   - Returns: `{ leads_24h, unlocks_today, fraud_open, verifications_pending, listings_pending_review, online_voice_sessions }`
   - Internally: 6 small COUNT queries.

2. **`GET /admin/owners/health?limit=50&offset=0&sort=score_desc`** — Owner health table
   - Returns: `{ items: [{ owner_user_id, phone, name, listings_active, listings_paused, avg_response_minutes, deal_done_rate, last_login_at, report_count, score }], total }`
   - `score` is computed server-side: 0–100, components weighted in `apps/api/src/modules/admin/owner-health.calculator.ts`.

3. **`GET /admin/revenue/attribution?range=30d&group_by=day|city|listing_type`** — Revenue rollups
   - Returns: `{ buckets: [{ key, revenue_paise, order_count }], total_revenue_paise, total_orders }`
   - Internally: pivot on `payment_orders` joined to `listing_boosts` → `listings.city/listing_type`.

4. **`GET /admin/revenue/cohorts?months=6`** — Owner LTV cohorts
   - Returns: `{ cohorts: [{ cohort_month, owners_count, total_revenue_paise, avg_ltv_paise, churn_30d_count }] }`
   - Cohort by `users.created_at` truncated to month.

5. **`GET /admin/fraud/feed?limit=50`** — Fraud intelligence feed
   - Returns: `{ items: [{ kind, severity, summary, evidence: {...}, related_ids: [...], detected_at }] }`
   - Includes both raw `fraud_flags` rows and synthesized signals (multi-listing-from-one-phone-in-24h, listing-with-3+-reports-this-week, owner-inactive-60d-with-active-listings).

All five endpoints are pure read; no schema mutations beyond the migration.

## New / refreshed tabs in detail

### Live Ops Dashboard (NEW, default landing tab)

Top: 6 large `StatCard`s with sparklines (60-min trend) — leads/24h, unlocks today, fraud open, verifications pending, listings pending review, voice sessions live.

Middle: 2-column split.

- Left: `AreaChart` of unlocks-per-hour over last 24h.
- Right: latest 8 fraud signals (compact list, click → opens detail drawer).

Bottom: "Action queue" — three buttons that route to the next pending review / verification / fraud flag with the shortcut key shown next to each.

Polls `GET /admin/ops/live` every 30 seconds. Last-refreshed shown in topbar.

### Owner Health (in Users tab)

Adds a column to the user table (only for owner-role rows): `<HealthBadge score={user.health_score} />` rendered as `83 · B+` with a colored dot. Click the badge → `<HealthDrawer>` opens with:

- Score breakdown (5 components, each with weight + value)
- Mini sparklines of last 30d response time, last 30d unlocks, deal-done rate
- Quick actions: send reminder SMS (stub), pause listings, adjust wallet

Score formula (server-side, in `owner-health.calculator.ts`):

```
listings_health    = 100 * (active / max(active + paused, 1))            weight 0.25
response_health    = clamp(100 - avg_response_minutes / 2, 0, 100)       weight 0.30
deal_health        = 100 * (deals_done_60d / max(unlocks_60d, 1))        weight 0.25
freshness_health   = clamp(100 - days_since_last_login * 2, 0, 100)      weight 0.10
trust_health       = clamp(100 - report_count * 20, 0, 100)              weight 0.10

score = round(weighted sum)
```

Letter grade: 90+ A, 80+ B, 70+ C, 60+ D, else F. Display color from grade.

### Revenue Attribution (NEW tab)

Top: 4 `StatCard`s — total revenue (range), order count, avg order value, MoM delta.

Middle: `AreaChart` of revenue per day (selectable range: 7d / 30d / 90d).

Bottom: 2-column split.

- Left: `BarChart` revenue by city (horizontal bars).
- Right: `BarChart` revenue by listing_type (flat / pg / single_room).

Below: cohort table (`DataTable`) — cohort month × owner count × total revenue × avg LTV × 30d churn count.

Range selector and group_by toggle wire directly to `GET /admin/revenue/attribution`.

### Fraud Intelligence Feed (NEW tab)

Vertical timeline (newest first) of synthesized + raw signals. Each item:

- Severity dot (red/amber/yellow)
- One-line summary ("3 listings from +91-XXXXXX in 24h — likely broker")
- Evidence chips (clickable → drawer)
- Quick actions: Review, Pause listing, Block phone, Dismiss

Filter chips at top: All / Multi-listing-burst / Multi-report / Inactive-owner / Raw-flags.

Polls `GET /admin/fraud/feed` every 60 seconds.

### Restyled existing tabs

- **Overview** → kept but moved to `OverviewTab.tsx`, charts replaced with recharts equivalents, KPI strip moves to topbar.
- **Listing Review** → table layout (was card list), with photo thumb + key fields per row, side drawer for details. Action buttons use `Drawer` footer instead of inline.
- **Verification** → same treatment, plus surface AI confidence + manual-review reason as table columns.
- **CRM** → kanban-board layout (5 columns matching pipeline stages) replacing the current bar visualization. Drag-and-drop deferred — for now, status dropdown per card.
- **Users** → real `DataTable` with phone search, role filter, sort, and pagination. Owner Health column for owner rows.

## Cmd+K command palette

Built on top of headless `cmdk` library. Triggers: `Cmd+K` (or `Ctrl+K` on Windows).

Action registry (`command-palette-actions.ts`):

- "Go to {tab}" — 9 actions, one per tab
- "Find user by phone…" — text input mode
- "Find listing by ID…" — text input mode
- "Refresh all" — triggers refetch
- "Adjust wallet for…" — opens system tab pre-filled
- "Toggle dark mode" — placeholder, disabled this PR

## New dependencies

Two additions to `apps/web/package.json`:

- **`recharts`** (~52 KB gz, tree-shakable) — for Sparkline, AreaChart, BarChart. No comparable alternative without writing charts from scratch.
- **`cmdk`** (~8 KB) — headless command palette. Used by Vercel, Linear, Raycast.

Both are MIT, well-maintained, and only ship in admin route chunks (lazy-loaded).

## Verification

1. `pnpm -C apps/web typecheck` clean (also `pnpm -C apps/api typecheck`).
2. `pnpm --filter @cribliv/web build` succeeds; admin route bundle size logged in this spec is `15.2 kB → ~25 kB First Load delta` post-rebuild — expected, recharts is the largest add.
3. Manual smoke test (`pnpm dev`, log in as admin):
   - Each of the 9 tabs loads without console errors.
   - Live Ops counters update after 30s poll.
   - Owner Health badge renders for at least one owner; drawer opens with breakdown.
   - Revenue chart renders with at least 7d of data.
   - Fraud feed shows existing fraud_flags rows + at least one synthesized signal.
   - Cmd+K opens, "Go to Users" navigates, palette closes on Esc.
4. Backend migration applies cleanly: `pnpm --filter @cribliv/api migration:run` then `migration:revert` then `:run` again.
5. Lighthouse on a populated admin page (won't formally score because of auth; spot-check console for errors and verify no CLS).

## What this spec deliberately does NOT include

- **Dark mode** — separate PR.
- **Drag-and-drop kanban** — status dropdown is good enough for now.
- **True realtime via Redis pub/sub** — 30/60s polling is plenty for admin work; revisit if it's actually a pain point.
- **Audit log viewer** — `admin_actions` table exists; surfacing it cleanly needs its own design pass.
- **Owner-side analytics in admin** — different audience.
- **Mobile admin layout** — admins use desktops; would compromise density on the bigger surface.
