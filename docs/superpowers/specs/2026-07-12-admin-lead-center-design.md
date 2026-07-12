# Admin Lead Center — Design Spec

- **Date:** 2026-07-12
- **Status:** Approved (brainstorming → ready for implementation plan)
- **Branch (proposed):** `feat/admin-lead-center`
- **Modules:** `apps/api/src/modules/leads`, `apps/api/src/modules/notifications`, `apps/api/src/worker`, `apps/web/components/admin`

---

## 1. Summary

Give admins a single **god-view command center** over every lead across all owners and PG operators — both to *watch and act* (the operational job) and to *understand* (the analytics job). One new admin tab, **Lead Center**, with three surfaces behind one shell:

1. **Live board** — every in-flight lead across the whole platform: **who requested it** (the seeker, full number for admin), **which owner/operator** owns it, **whether the owner has called yet** (`called_at` / `called_by`), and a **live countdown to the auto-refund** (`response_deadline_at`). So the team can step in and call the seeker *before* the credit refunds and the connection is lost.
2. **Analytics** — the lead/callback money funnel plus the upstream engagement funnel (searches → views → signups → callbacks → calls), volume trends, response/refund rates, and a per-owner/operator rollup — i.e. the owner-side analytics owners see, aggregated for admin.
3. **Per-owner/operator drill-down** — click any owner to see their analytics *exactly as they see it* (the simple lead funnel for `owner`, the rich `PgDashboardData` for `pg_operator`), plus their in-flight leads and response performance.

Admin can act on any lead: **call the seeker and mark it handled** (stops the refund clock), **nudge the owner** (WhatsApp + SMS reminder), and **manually refund** the seeker early. Separately, the immediate **new-lead alert to the owner** (already sent on WhatsApp) is extended to **also send SMS**.

Almost all data already exists (`leads`, `contact_unlocks`, `lead_events`, `wallet_transactions`, owner-health, `PgDashboardData`). This spec surfaces and rolls it up for admin, adds three admin actions, and adds one genuinely new capability: **SMS as a notification channel** (today the platform is WhatsApp-only).

## 2. Goal & business context

- Cribliv's monetization is the **callback-guarantee model** ([[lead-monetization-program]], spec `2026-07-10-lead-monetization-design.md`): a seeker spends a credit to request a callback; the owner (or the Cribliv team) must call within **24 hours** or the credit auto-refunds. The team already does assisted calling; this center points that muscle at every at-risk lead, not just the last-6-hours rescue slice that exists today.
- The 2026-05-02 admin rebuild explicitly deferred *"Owner-side analytics in admin — different audience."* This spec delivers that, unified with the operational layer.
- **Why it matters to admin:** admin can see, in one place, exactly what's happening on the money path — how much demand is coming in (callbacks requested), whether owners are converting it (unlock + call), where the promise is at risk (uncalled + expiring), and which owners are unresponsive (rescue/refund rates) — and act on each of those without leaving the page.

## 3. What already exists (build on, don't duplicate)

**Data model (all implemented):**
- `leads`: `access_state` (`free|locked|unlocked|expired`), `called_at`, `called_by` (`owner|team`), `call_deadline_at`, `unlocked_at`, `tenant_confirmed_at`, `disputed_at`, plus CRM `status`, `owner_notes`, `tenant_phone_masked`. Real seeker phone is **never** stored on the lead — always joined live from `users` (`leads.service.ts:127-131`).
- `contact_unlocks`: **the refund timer** — `response_deadline_at` (now + 24h under `ff_callback_leads`, else 12h), `owner_response_status` (`pending|responded|timeout_refunded`), `owner_responded_at`, `unlock_status`, `source`.
- `lead_events`, `contact_events`: audit logs. `wallet_transactions`: the credit ledger (refunds are `+1` rows). `admin_actions`: admin audit.

**Admin infra:** `AdminShell`/`AdminSidebar` tab system, `DataTable`/`Drawer`/`StatCard`/`StatusPill`/`ConfirmDialog`/`EmptyState` primitives, `AreaChart`/`BarChart`/`SparklineChart`, owner-health scoring (Users tab), `admin/analytics/*`, `admin/ops/*`, `admin_actions` audit, `fetchApi`/`authHeaders` client conventions.

**Lead endpoints (extend these):** `admin-leads.controller.ts` (`@Controller("admin/leads")`, `@Roles("admin")`) currently holds only `GET rescue-queue` (uncalled leads within 6h of deadline) and `POST :id/team-called`. Owner side has `GET owner/leads`, `GET owner/leads/stats`, unlock, call-click. PG side has the rich `GET pg-operator/dashboard` → `PgDashboardData`.

**Notifications:** `NotificationService.send({ type, recipientUserId, payload, mode })` — **WhatsApp-only, single channel** (`notification.service.ts`). `owner.contact_unlocked` fires immediately on a new lead, WhatsApp only. There is **no SMS sender** anywhere (the D7 client is hardcoded to OTP).

**Refund routine:** `runRefundSweepDb` (`worker/callback-sweeps.ts:6-114`) performs the timeout refund. It does **not** notify the tenant. `disputeCallbackDb` (`contacts.service.ts:883-982`) is the tenant-dispute refund with a different `txn_type`.

## 4. Architecture decisions

### 4.1 One new tab, three surfaces (not scattered widgets)
A single `lead-center` tab in the **Operate** sidebar section (next to Live Ops), because the user wants a *center*, not features spread across Live Ops / Users / rescue. The three surfaces are sub-views inside it (a segmented control: **Board · Analytics**, with drill-down as a Drawer). The existing `leads` tab (sales CRM) is a different concept and is untouched.

### 4.2 Polling, not realtime
30–60s polling of the board/analytics endpoints (consistent with Live Ops; the 2026-05-02 spec deliberately rejected realtime pub/sub as unnecessary at this scale). Refund **countdowns tick client-side** between refetches from the server-provided deadline — no server load, no clock-skew games (server also returns `generated_at` and `seconds_remaining` so the client anchors correctly).

### 4.3 New focused service, not more bloat in `LeadsService`
`LeadsService` is already large. Add `AdminLeadOpsService` (in the leads module, injected into `AdminLeadsController`) owning the board query, analytics aggregate, nudge, and manual-refund orchestration. It reuses `LeadsService.getLeadStats`/`getOwnerLeads`, `PgDashboardService`, owner-health, and `AdminAnalyticsService`. Keeps units small and independently testable (per brainstorming's isolation principle).

### 4.4 Shared refund routine — admin and the sweep must never diverge
Extract the per-unlock refund writes into a **plain, `client`-taking function** `refundUnlock(client, unlockId, opts)` (mirroring `LeadsService.markLeadCalled(client, …)`), because the worker runs **outside NestJS DI** (it builds a raw `pg.Pool`). Both the worker sweep and the admin manual-refund endpoint call it inside their own transaction, having already locked the row. This guarantees the admin refund produces byte-identical state to the auto-sweep — proven by a parity test. See §7.

### 4.5 Multi-channel notifications — SMS (D7) available first, WhatsApp joining
Today the platform is **WhatsApp-only in code** (`NotificationService` → `WhatsAppClient`), but per the owner the **WhatsApp Business API is still being provisioned** (not reliably live in prod yet), while **D7 SMS is available now** (it already sends OTPs). So the design treats WhatsApp and SMS as **independently gated channels** and assumes neither is always up. Add a per-type `channels` config; `send()` dispatches to every channel that is both configured for that type *and* currently enabled (WhatsApp gated on live WA creds; SMS gated on `SMS_PROVIDER=d7`). A new **D7 transactional-SMS client** — distinct from the endpoint-locked OTP client — reuses the existing D7 account. Net effect: the new-lead + nudge alerts can go live on **SMS first** and pick up WhatsApp automatically once its API lands, **no code change**. Indian transactional SMS still needs **DLT template registration** per message type, but the D7 sender/entity is already established from OTP, so this is template approval — not a new vendor. See §8.

### 4.6 Audit everything; reuse `admin_actions`
Every admin action (`team_called`, `nudge_owner`, `lead_manual_refund`) writes an `admin_actions` row and a `lead_events` row, surfaced in the lead's timeline drawer. New enum values via `ALTER TYPE … ADD VALUE IF NOT EXISTS` (target_type `lead`; actions `nudge_owner`, `lead_manual_refund`, `mark_team_called`).

## 5. Data model / migration

**Migration `<next>_admin_lead_center.sql`** (verify the next sequential number in `infra/migrations/` at implementation — ≥ 0055; latest known is the lead-monetization/geo-backfill series `0053`/`0054`). All additive; rollback file per convention.

```sql
-- 1) Audit enum values (each in its own statement; ADD VALUE cannot run in a txn with usage)
ALTER TYPE admin_target_type ADD VALUE IF NOT EXISTS 'lead';
ALTER TYPE admin_action_type ADD VALUE IF NOT EXISTS 'nudge_owner';
ALTER TYPE admin_action_type ADD VALUE IF NOT EXISTS 'lead_manual_refund';
ALTER TYPE admin_action_type ADD VALUE IF NOT EXISTS 'mark_team_called';

-- 2) Ledger attribution for admin-initiated refunds (distinct from the sweep's refund_no_response)
ALTER TYPE wallet_txn_type ADD VALUE IF NOT EXISTS 'refund_admin';

-- 3) Covering indexes for the board filters (the uncalled+deadline partial index already exists)
CREATE INDEX IF NOT EXISTS idx_leads_owner_created  ON leads(owner_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_leads_access_state   ON leads(access_state);
CREATE INDEX IF NOT EXISTS idx_leads_created_at     ON leads(created_at DESC);
```

**No new tables.** Nudge rate-limiting reuses a `lead_events` marker (`notes = 'admin_nudged_owner'` with a timestamp), the same dedup pattern the reminder sweep uses. `notification_log.channel` is already `text` allowing `'sms'` — no migration needed there.

## 6. Backend components & endpoints

All routes `/v1/admin/leads/*`, class-guarded `AuthGuard + RolesGuard + @Roles("admin")`, responses wrapped by `ok()`.

| Method | Route | Purpose |
|---|---|---|
| `GET` | `/board?filter&owner_id&state&status&range&q&page&page_size&sort` | The live ops table (see row shape below) + summary counters. `filter` presets: `all_in_flight` (default), `uncalled`, `expiring_6h` (= the old rescue query), `expired_today`, `refunded_today`. |
| `GET` | `/analytics?range=7d\|30d\|90d` | Aggregate funnel + engagement funnel + trends + response/refund rates + per-owner rollup (see §10). |
| `GET` | `/by-owner/:owner_id?range=` | Drill-down: the owner's own analytics + in-flight leads + response perf (see §10). |
| `GET` | `/:id/timeline` | Full event timeline for one lead (`lead_events` + `contact_events` + `admin_actions`), for the row drawer. |
| `POST` | `/:id/team-called` | **Exists** — mark handled (`called_by=team`), stops the clock. Extended to also write an `admin_actions` row (`mark_team_called`). |
| `POST` | `/:id/nudge-owner` | **New** — WhatsApp+SMS reminder to the owner; rate-limited (once per lead per 3h, `lead_events` dedup); writes `lead_events` + `admin_actions`. |
| `POST` | `/:id/refund` | **New** — early manual refund to the seeker; body `{ reason }`; calls the shared `refundUnlock` routine (§7) with `txn_type='refund_admin'`; writes `admin_actions`. |

The existing `GET rescue-queue` and its `getRescueQueue()` (which throws `feature_disabled` when `ff_callback_leads` is off) stay **as-is** for any current caller; the new `/board?filter=expiring_6h` supersedes it in the UI and is the one that degrades gracefully across the flag.

**Board row shape** (`AdminLeadBoardRow`, new in `packages/shared-types`, snake_case):
```ts
interface AdminLeadBoardRow {
  lead_id: string; listing_id: string; listing_title: string; city: string | null;
  owner: { user_id: string; name: string; phone_masked: string; role: "owner" | "pg_operator";
           health_score: number | null; health_grade: "A"|"B"|"C"|"D"|"F" | null };
  seeker: { user_id: string; name: string; phone_e164: string };   // admin sees full number
  access_state: "free" | "locked" | "unlocked" | "expired";
  status: LeadStatus;                                              // CRM funnel
  called_at: string | null; called_by: "owner" | "team" | null;
  response_deadline_at: string | null;                            // the refund timer
  seconds_remaining: number | null;                               // server-computed, client ticks
  refund_state: "pending" | "responded" | "refunded";             // from contact_unlocks
  source: string | null; created_at: string;
}
interface AdminLeadBoardResponse {
  rows: AdminLeadBoardRow[]; total: number; generated_at: string;
  counters: { in_flight: number; uncalled: number; expiring_6h: number;
              expired_today: number; refunded_today: number };
}
```
The board query is a **single batched query** (leads ⨝ listings ⨝ users[owner] ⨝ users[seeker] ⨝ contact_unlocks), paginated, using the new indexes — no N+1. Counters computed in the same round-trip (a `COUNT(*) FILTER (WHERE …)` block or a small parallel query). **Owner health** (`health_score`/`grade`) is a heavier multi-component aggregate, so it is *not* joined per-row: it's fetched in one batched lookup keyed by the page's distinct `owner_user_id`s (reusing the owner-health calculator), and left `null` if unavailable — the row shape already makes it nullable. Full seeker phone is admin-only and intentional (matches the existing rescue-queue behavior).

**Flag behavior:** `ff_callback_leads` **on** → full called/refund semantics (24h). **Off** → the board degrades to the legacy view (reads `contact_unlocks` `owner_response_status`/`response_deadline_at` at 12h; no `called_by`), clearly labeled; the analytics/engagement surfaces still render (they read `contact_unlocks`/`listing_events`/`pg_search_events` regardless). The whole tab additionally sits behind `ff_admin_lead_center` (default off) so it ships dark.

## 7. Shared refund routine (the careful extraction)

New plain module `apps/api/src/modules/contacts/refund-unlock.ts`:
```ts
// Assumes the caller opened a transaction AND locked the contact_unlocks row.
// Returns whether a refund actually happened (idempotent via the guarded UPDATE).
export async function refundUnlock(
  client: PoolClient,
  unlockId: string,
  opts: { txnType: "refund_no_response" | "refund_admin"; actorRole: "system" | "admin";
          expireLockedLead: boolean; metadata?: Record<string, unknown> }
): Promise<{ refunded: boolean; tenantUserId: string | null; refundTxnId: string | null }>
```
Body = exactly the sweep's per-unlock writes (`callback-sweeps.ts:35-100`): ensure wallet → `+1` balance → insert `wallet_transactions` (`credits_delta=1`, `reference_type='contact_unlock'`, `reference_id=unlockId`, `txn_type=opts.txnType`) → **guarded** `UPDATE contact_unlocks SET owner_response_status='timeout_refunded', unlock_status='refunded', refund_txn_id=… WHERE id=$1 AND owner_response_status='pending' AND unlock_status='active'` → only if `rowCount=1`: insert `contact_events` (`actor_role=opts.actorRole`, `event_type='refund_issued'`) and, if `expireLockedLead`, `UPDATE leads SET access_state='expired' WHERE contact_unlock_id=$1 AND access_state='locked'`.

- **Worker sweep** refactors to loop calling `refundUnlock(client, id, { txnType:'refund_no_response', actorRole:'system', expireLockedLead:true })` — keeping its batch `BEGIN/COMMIT` and `FOR UPDATE SKIP LOCKED` selection outside the helper.
- **Admin endpoint** opens its own txn, `SELECT … WHERE id=$1 FOR UPDATE` (plain lock, like `disputeCallbackDb`), guards (404 not-found; 409 `already_refunded` if `unlock_status != 'active'`; 409 `already_responded` if the owner already called — admin shouldn't refund a kept promise), then calls `refundUnlock(client, id, { txnType:'refund_admin', actorRole:'admin', expireLockedLead:true })`, writes `admin_actions`, commits.
- **Parity test** asserts both callers produce identical `contact_unlocks` / `wallet_transactions` / `leads` / `contact_events` effects (differing only in `txn_type` and `actor_role`).
- The helper does **no** notification (neither existing refund path does). Optional tenant "credit's back" WhatsApp is a caller concern; deferred (see §16).

## 8. Multi-channel notifications (WhatsApp + SMS)

**Goal:** (a) the immediate new-lead owner alert (`owner.contact_unlocked`) also goes out on SMS; (b) the new `owner.lead_nudge` (admin nudge) goes to both.

- **`notification.templates.ts`:** give each template entry an explicit `channels: ("whatsapp"|"sms")[]` and an `sms` body builder where applicable. Add type `owner.lead_nudge`. Set `owner.contact_unlocked.channels = ["whatsapp","sms"]`.
- **`notification.service.ts`:** `send()` iterates the type's `channels`. WhatsApp path unchanged. New SMS path (immediate → `SmsClient.send`; queued → enqueue `outbound_events` with `event_type='notification.sms.<type>'`). `notification_log` writes one row per channel (`channel` already supports `'sms'`).
- **New `apps/api/src/modules/notifications/sms.client.ts`** — a thin transactional-SMS client on the **D7 Networks Messaging API** (the owner's existing SMS vendor — already used for OTP), reusing the same D7 account/credentials but a different endpoint than the OTP client (which is endpoint-locked to `/verify/v1/otp/send-otp`). Registered in `notifications.module.ts`. Env: `SMS_PROVIDER` (`d7|mock`, default `mock`), `D7_SMS_*` (API token, DLT sender/entity + template IDs). `mock` logs and no-ops (dev/CI).
- **WhatsApp availability gate:** since the WA Business API is still being provisioned, `WhatsAppClient` dispatch is treated as best-effort and gated on live WA credentials; a WhatsApp failure never blocks the SMS send (and vice-versa) — `send()` attempts each configured+enabled channel independently and logs per-channel outcome to `notification_log`.
- **Worker:** `runOutboundDispatchDb` gains an `notification.sms.*` branch calling its own `SmsClient` instance (the worker builds vendor clients directly, like `WhatsAppClient`).
- **Copy (callback model):** new-lead → *"New Cribliv lead! {seeker} wants a callback for {listing}. Call within 24h or the lead expires. Open: {link}"*. Nudge → *"Reminder: your Cribliv lead {seeker} for {listing} is still uncalled — {hours}h left before it's refunded. Call now: {link}"*. Hindi variants alongside (i18n parity, matching the WhatsApp templates' `hi` convention).
- **External dependency (rollout gate, not code):** DLT-registered SMS templates per message type + `SMS_PROVIDER=d7` + D7 messaging creds (account/sender already exist from OTP). WhatsApp delivery additionally depends on the WA Business API being provisioned. Because `send()` degrades to whichever channel is live, alerts flow as soon as **either** D7 transactional SMS **or** WhatsApp is ready — and D7 SMS is the nearer of the two. Documented in §11.

## 9. Web — the Lead Center tab

**Registration (compile-forced, three spots):** add `"lead-center"` to the `AdminTab` union (`AdminSidebar.tsx:23-38`), a `{ id:"lead-center", label:"Lead Center", icon }` entry in the `operate` array, a `case "lead-center"` in `AdminShell.tsx`'s `view` switch, and a `TAB_TITLES["lead-center"]` entry. Optional Cmd+K entry in `CommandPalette.tsx`. The sidebar badge (`onCountChange`) reports the **uncalled** count — a red number that tells admin at a glance how many leads need attention.

**Components (`apps/web/components/admin/`):**
- `tabs/LeadCenterTab.tsx` — shell + segmented control (Board · Analytics), polling (30–60s), toast wiring.
- `lead-center/LeadBoard.tsx` — KPI strip (`StatCard` + sparkline: in-flight, uncalled, expiring <6h, refund rate) + preset filter chips + `DataTable` of `AdminLeadBoardRow`. Columns: **Seeker** (name + full phone, click-to-call `tel:`), **Owner** (name + `HealthBadge` → drill-down), Listing, **State** (`StatusPill`), **Called?** (✓ owner / ✓ team / ✗ not-called), **Refund countdown** (`LeadCountdown`), Created, Actions menu.
- `lead-center/LeadCountdown.tsx` — a `useCountdown(seconds_remaining, generated_at)` hook ticking every second; green → amber (<6h) → red (<1h) → "Refunded"/"Expired" after refetch.
- `lead-center/LeadRowActions.tsx` — Call-seeker→mark-handled, Nudge owner, Manual refund (each with `ConfirmDialog` where irreversible; optimistic update + toast; handles 409/410 "already resolved" by refetching).
- `lead-center/LeadDrawer.tsx` — `Drawer` with the full lead timeline (`GET /:id/timeline`) and the same actions.
- `lead-center/LeadAnalytics.tsx` — §10.
- `lead-center/OwnerDrillDrawer.tsx` — §10.
- `lib/admin-api.ts` — typed client fns (`fetchAdminLeadBoard`, `fetchAdminLeadAnalytics`, `fetchAdminLeadByOwner`, `fetchAdminLeadTimeline`, `nudgeAdminLeadOwner`, `refundAdminLead`, `markAdminLeadTeamCalled`) following the `authHeaders`/`fetchApi<T>` + snake_case-body convention, mapping rows to camelCase VMs.

Follow the existing admin design system (`admin.css`, primitives). No new design language. Desktop-only density (admins use desktops), matching the existing dashboard.

## 10. Analytics & per-owner drill-down

**`GET /admin/leads/analytics?range`** → `AdminLeadAnalytics`:
- **Funnel** (money path): `callbacks_requested`, `leads_created`, `leads_unlocked`, `leads_called`, `deals_done`, `leads_refunded`, `leads_disputed` — each with a WoW delta.
- **Engagement funnel** (the "what users are doing" breadth): `searches` (`pg_search_events` + listing search events), `listing_views` (`listing_events`), `signups` (`users.created_at`), `callbacks_requested`, `calls_made`. Reuses/extends `AdminAnalyticsService.getConversionFunnel`.
- **Response/refund rates:** `median_response_minutes` (lead created → `called_at`), `called_within_24h_rate`, `team_rescue_rate` (`called_by='team'` / all called), `refund_rate`, `dispute_rate`.
- **Trend:** daily `TrendPoint[]` (callbacks, unlocks, calls, refunds) over the range — `AreaChart`.
- **Per-owner/operator rollup:** `by_owner: [{ owner_user_id, name, role, leads, called, called_rate, median_response_min, unlock_rate, refund_rate, revenue_paise, health_score, health_grade }]` — sortable `DataTable`, batched (`Promise.all`), row → drill-down.

**`GET /admin/leads/by-owner/:owner_id?range`** → drill-down:
- `role='owner'` → their lead funnel exactly as they see it (`LeadsService.getLeadStats`) + their in-flight board subset + response perf.
- `role='pg_operator'` → the **full `PgDashboardData`** (`PgDashboardService.getDashboard`) — views, CTR, conversion, `trend_30d`, `search_insights` — the same numbers the operator sees (respecting the existing `analytics_status` masking is **not** applied here; admin always sees unmasked, per the PG command center principle). Plus in-flight leads + response perf.
- Rendered in `OwnerDrillDrawer.tsx`; the Users-tab `HealthBadge` links here too (unifying owner visibility). Quick actions: nudge all uncalled, adjust wallet, open owner-health.

## 11. Feature flags & rollout

| Flag / env | Default | Purpose |
|---|---|---|
| `ff_admin_lead_center` (`FF_ADMIN_LEAD_CENTER`) | off | The whole tab + endpoints. Ships dark; flip to reveal. Add to `FeatureFlags` interface, `defaultFeatureFlags`, and `readFeatureFlags()` (the standard three spots). |
| `ff_callback_leads` (existing) | off | When on, the board shows full 24h called/refund semantics; when off, the legacy 12h view. Not owned by this spec. |
| `SMS_PROVIDER` (`d7\|mock`) | `mock` | Turns real SMS on. `mock` = no-op/log. |
| `D7_SMS_*` | — | SMS credentials + DLT sender/template IDs. |

**Rollout order:** (1) ship dark behind `ff_admin_lead_center=off`; (2) flip on for admin — board/analytics work immediately against live data (richest once `ff_callback_leads` is on); (3) enable **D7 transactional SMS** (`SMS_PROVIDER=d7`) once its DLT templates are approved, and enable WhatsApp for these types once the WA Business API is provisioned — `send()` uses whichever channels are live, and D7 SMS is the one reachable first. **PostHog events:** `admin_lead_nudged`, `admin_lead_refunded`, `admin_lead_team_called`, `admin_lead_center_viewed`.

## 12. Error handling & edge cases

- **Race (fetch vs action):** lead refunded/expired/called between board fetch and action → endpoint returns 409/410; UI shows "already resolved" and refetches (no optimistic lie).
- **Manual refund of a `free`/`unlocked` lead:** refunds the seeker, lead keeps access (matches sweep semantics); `ConfirmDialog` explains. Refund when the owner already called (`owner_response_status='responded'`) → **409** (don't refund a kept promise); admin sees why.
- **Nudge rate-limit:** second nudge within 3h → 429 "already nudged recently" toast.
- **Flag off (`ff_callback_leads`):** board shows the legacy unlock view + a banner; called/refund columns show "—"; nudge/refund still function on `contact_unlocks`.
- **DB disabled:** `LeadsService` is DB-only → endpoints return empty; board shows `EmptyState`. Admin manual-refund requires DB (400 otherwise).
- **Clock skew:** countdowns anchor to server `seconds_remaining` + `generated_at`, not raw client `now()` vs a UTC string.
- **SMS in `mock`:** sends are logged, not delivered; no user-visible error; WhatsApp still delivers.

## 13. Testing (TDD, red-green-refactor)

**API (Vitest integration):**
- Board: filter presets (uncalled/expiring/expired/refunded), pagination, counters correctness, admin-role rejection, flag-on vs flag-off row shape.
- Analytics: funnel + engagement funnel + rates aggregation correctness; per-owner rollup mapping; range windows.
- Drill-down: owner funnel vs pg-operator `PgDashboardData` branch.
- Nudge: sends (mock), rate-limit (429 on second within window), `lead_events` + `admin_actions` written.
- Manual refund: happy path (credit +1, `refund_admin` txn, `contact_unlocks` flipped, locked lead expired, `admin_actions`); guards (409 already-refunded / already-responded); idempotency (double-submit refunds once).
- **`refundUnlock` parity test:** worker-sweep call and admin call produce identical DB state (modulo `txn_type`/`actor_role`).
- Notifications: `send()` fans out to both channels when `channels=["whatsapp","sms"]`; SMS `mock` no-ops; queued path enqueues `notification.sms.*`.

**Web (Playwright E2E):** admin opens Lead Center; board renders seeded in-flight leads with a ticking countdown; uncalled filter narrows; mark-handled stops the clock (row updates); nudge shows toast; manual-refund confirm → row → refunded; drill-down drawer opens with owner analytics. Test phones per `CLAUDE.md` (owner `+919999999901`, tenant `+919999999902`, admin `+919999999903`).

**Unit:** `useCountdown` thresholds/colors; per-owner rollup mapper; `applyMasking` unaffected (admin unmasked).

## 14. Build slices (each gets its own implementation plan)

1. **Backend core** — migration; `AdminLeadOpsService` (board + counters); board/timeline endpoints; shared-types; `refundUnlock` extraction + worker refactor + parity test; `team-called` audit. TDD.
2. **Actions** — `nudge-owner` (rate-limit + audit) and `refund` endpoints; multi-channel `NotificationService` + `SmsClient` (mock) + `owner.lead_nudge` + `owner.contact_unlocked` SMS; worker SMS branch. TDD.
3. **Analytics + drill-down** — `/analytics` and `/by-owner/:id` endpoints (engagement funnel, rates, rollup, PG drill-down). TDD.
4. **Web** — `LeadCenterTab` + board + countdown + actions + drawer + analytics + owner drill-drawer; `admin-api.ts` client fns; tab registration; badge. Playwright E2E.
5. **Verify & dark-ship** — full suite green; manual smoke (seeded DB) of board → nudge → mark-handled → manual-refund → drill-down; migration up/down/up; flag `ff_admin_lead_center=off` in prod.

## 15. Risks & accepted trade-offs

- **Both channels have external gates.** SMS (D7) waits on DLT template approval; WhatsApp waits on the WA Business API being provisioned. Code lands ready and sends on whichever is live first (D7 SMS is closest, since OTP already works). Accepted; flagged so it isn't a surprise.
- **Admin sees full seeker + owner phones.** Intended (admin role, matches today's rescue queue). No per-reveal audit (consistent with current behavior).
- **Polling, not realtime.** A lead could refund up to one poll interval before the board reflects it; countdowns tick live so the risk window is visible. Accepted at this scale.
- **Both refund paths still don't notify the tenant.** Out of scope to change here; noted as a future enhancement.
- **Board query breadth.** Mitigated by pagination + the new indexes + single batched query; revisit if lead volume grows large.

## 16. Out of scope (future)

- Notes + assign-to-teammate on a lead (the user deferred this).
- Tenant "your credit is back" notification on refund (both paths lack it today).
- Masked calling via telephony (Exotel/Twilio) — the bulletproof click-to-call upgrade.
- Automated delisting / nudge campaigns for chronically unresponsive owners (manual/ops signal only for now).
- Full raw event firehose per user/session (the user chose "lead + engagement", not everything).
- Mobile admin layout.
