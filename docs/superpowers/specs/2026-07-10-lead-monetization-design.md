# Lead Monetization — Design Spec

- **Date:** 2026-07-10
- **Status:** **Slices 1, 2, and 3 implemented** on `feat/lead-monetization` (see §14). Not yet dark-deployed or flag-flipped in production — see §17.
- **Branch:** `feat/lead-monetization`

## 1. Summary

Cribliv's monetization pivots to a **callback-guarantee lead model**:

- Tenants spend 1 credit to **request a callback** for a listing. The owner's phone number is **never revealed** to tenants.
- Cribliv promises: **"You'll get a call for this property within 24 hours — or your credit comes back automatically."** The caller is usually the owner, sometimes the Cribliv team. The promise belongs to the platform, and it must be the most trusted thing on the site.
- Each callback request creates a **lead** on the owner's dashboard with a live 24-hour countdown. The owner's **first 2 leads ever are free** (full tenant number visible). From lead #3 on, leads arrive **blurred**; the owner spends 1 lead-credit to unlock.
- Anonymous visitors see the first 6 listing cards normally; the rest are CSS-blurred (content stays in the HTML for SEO) with a "Sign up free — get 2 credits" overlay.
- New signups get a one-time **celebration animation** for their free credits (tenants: 2 callback credits; owners: first 2 leads free).

Almost all plumbing exists: wallets + ledger, contact-unlock flow with idempotency and refund sweep, the deliberate `402 payment_required` seam in `LeadsService.openLeadForOperator`, credit packs + UPI/Razorpay webhooks, and the `is_new_user` flag from OTP verify (currently discarded by the web layer). This spec repurposes that machinery rather than building new systems.

## 2. Business context

- Cribliv is a live (small) rental + PG business; v2 is the AI-native rebuild. Monetization switches from listing-side to **contact-unlock economics** on both sides of the marketplace.
- Both sides pay for the same successful connection (as on Naukri/matrimony platforms). The tenant side is refund-protected, which keeps it fair and builds trust.
- The Cribliv team already does assisted calling (sales/CRM module, `pg_sales_assist`); the team-rescue flow in this spec points that muscle at expiring leads.
- SEO constraint: the city-expansion pages and the ~mid-July 2026 domain cutover depend on anonymous crawlability. All guest gating in this spec is designed to keep gated content in the served HTML (no cloaking, no withheld inventory).

## 3. The model

### 3.1 Tenant flow — request a callback

1. On a listing page, the tenant taps **"Request callback"** (replaces "Unlock Number"). Guests are OTP-gated inline exactly as today.
2. The request debits 1 credit (existing idempotent wallet debit) and creates a `contact_unlocks` row (semantics now = callback request) plus a `leads` row for the owner. The 7-day dedup window and unique `(listing_id, tenant_user_id)` constraint stay.
3. The response contains **no owner phone**. The tenant sees the guarantee copy and a status timeline:
   - `Requested ✓ → Owner notified ✓ → Call on its way` — or `Refunded` at the deadline.
4. `response_deadline_at` = **24 hours** (changed from 12).
5. The tenant's "My callbacks" list shows every request with its live status, and surfaces the **"Did you get the call?"** prompt after a call is claimed (see §3.4).

Tenant-facing copy (EN; Hindi in Slice 2):

> **You'll get a call for this property within 24 hours.**
> If nobody calls, your credit comes back automatically. Guaranteed.

Never say "the owner will call" — the caller may be the Cribliv team.

### 3.2 Owner flow — leads, blur, unlock, call

1. A new lead triggers an immediate WhatsApp/SMS notification to the owner (existing notification dispatch), and appears on the owner dashboard leads tab with a **countdown timer** ("expires in 23h 12m").
2. **First 2 leads free (lifetime, per owner):** at lead creation, if `COUNT(leads WHERE owner_user_id = X) < 2`, the lead is created with `access_state = 'free'` — full tenant number visible, "FREE" badge. No wallet involvement. This rule cannot be farmed (it's per owner, not per listing).
3. **Lead #3+:** `access_state = 'locked'`. The card shows tenant first name, masked phone (`XXX…1234`, already stored), the listing, budget/move-in details where available, and the timer — behind a blur, with **"Unlock for 1 credit."**
4. **Unlock** (`POST owner/leads/:id/unlock`, idempotent): debits 1 credit from the owner's wallet (`debit_lead_unlock` txn), sets `access_state = 'unlocked'`, reveals the full number (joined from `users` via `tenant_user_id` — never stored on the lead). Insufficient balance → `402 insufficient_credits` → inline **Buy lead-credits** panel.
5. **Call:** unlocked/free leads show a **"Call now"** button — opens the `tel:` dialer and logs the tap (`POST owner/leads/:id/call-click`): sets `called_at` (first tap wins), `called_by = 'owner'`. This stops the tenant's refund clock.
6. At 18h (~6h left) without a call: reminder notification to the owner ("Lead expiring in 6 hours").
7. **Expiry:** at 24h with no `called_at`, a still-`locked` lead becomes `expired` — greyed out, **never unlockable** ("Expired — respond faster next time"). Free/unlocked leads keep their access (the owner has the number) but the tenant is refunded (§3.5).

### 3.3 Team rescue — how the guarantee is kept

- Admin **rescue queue**: leads with `called_at IS NULL` and less than **6 hours** to deadline. Admins see the full tenant phone (admin role).
- A team member calls the tenant and marks **"Team called"** (`POST admin/leads/:id/team-called`): sets `called_at`, `called_by = 'team'`. The tenant's credit is consumed — the promise ("you get a call") was kept.
- The owner's side is untouched: if the lead was still locked, it still expires for the owner at 24h. Team rescue saves the tenant's experience, not the owner's lead.
- The rescue queue doubles as the **unresponsive-owner report**: owners who repeatedly force rescues are candidates for nudge campaigns or delisting. Manual/ops signal only — no automation in this spec.

### 3.4 Dispute — "Did you get the call?"

- After `called_at` is set (owner or team), the tenant sees a prompt on their callbacks list (plus a notification): **"Did you get a call about <listing>?"**
  - **Yes** → sets `tenant_confirmed_at`. Positive trust signal, nothing else changes.
  - **No** → immediate credit refund (`refund_lead_dispute` txn) and, when `called_by = 'owner'`, a `fraud_flags` row against the owner (reason `callback_dispute`). Team-call disputes refund without a flag (ops reviews internally).
- Dispute window: **72 hours** after `called_at`. Silence = the call stands.
- The owner's unlock credit is **never** refunded on dispute — they consumed the contact reveal.
- Dispute abuse by tenants (serial "nobody called") is handled manually via admin + flags at current scale. No automated countermeasures in v1.

### 3.5 Outcome matrix

| Scenario                                     | Tenant credit                        | Lead (owner side)                                   |
| -------------------------------------------- | ------------------------------------ | --------------------------------------------------- |
| Owner unlocks (or free) and calls within 24h | Consumed                             | `unlocked`/`free`, `called_by='owner'`              |
| Team calls (any lead state)                  | Consumed                             | Unchanged; locked leads still expire at 24h         |
| No call by 24h, lead still locked            | **Refunded** (`refund_no_response`)  | `expired`, never unlockable                         |
| Owner unlocked but never called by 24h       | **Refunded**                         | Stays `unlocked` (owner keeps number; credit spent) |
| Tenant disputes a claimed call (≤72h)        | **Refunded** (`refund_lead_dispute`) | Unchanged + fraud flag (owner claims only)          |
| Owner calls after refund already processed   | Refund stands                        | Owner keeps number; no reversal                     |

## 4. Economics

- **Tenant:** 1 credit per callback request. Signup grant of 2 credits stays exactly as implemented (`grant_signup +2` in `auth.service.ts`). Existing packs stay: `starter_10` ₹99 → 10, `growth_20` ₹199 → 20.
- **Owner:** 1 lead-credit per unlock. New packs in `CREDIT_PLANS` (placeholder pricing — tune before launch; NoBroker-tier competitors charge far more, so there is headroom):
  - `leads_5` — ₹299 → 5 lead-credits
  - `leads_15` — ₹699 → 15 lead-credits
- One `wallets` row per user as today. A user has a single role, so credits are unambiguous in practice (tenant credits = callbacks, owner credits = lead unlocks). `pg_operator` counts as owner-side everywhere.
- Owner packs are purchased through the existing `POST wallet/purchase-intents` → UPI deep-link/webhook path. Razorpay checkout widget is Slice 3.
- Migrated v1 owners (86-listing migration, PR #31) get first-2-free when their leads start arriving — a natural activation hook; no special handling needed.

## 5. Guest gating (SEO-safe)

- **Search & map:** the first **6** listing cards render normally; all further cards render **fully in the HTML but CSS-blurred**, with an overlay CTA: _"Sign up free — get 2 credits. Owners call you back within 24 hours."_ Clicking goes to the login/signup page.
- **Listing detail:** stays fully open (it is the SEO money page). For guests, the photo gallery blurs beyond the first photo; the callback CTA already OTP-gates.
- **No bot special-casing.** Content in the DOM + CSS blur is consistent for humans and crawlers (matches Google's flexible-sampling guidance; no cloaking risk). The blur is friction, not security — that is accepted.
- `N = 6` is a web-side constant; the whole behavior sits behind `NEXT_PUBLIC_FF_GUEST_GATING` (default **off**, PostHog-controllable) so it can be tuned or killed without a deploy.
- After enabling, watch Search Console (impressions/indexing on city/locality pages) against the pre-flag baseline, especially through the domain cutover.

## 6. Signup celebration

- The API already returns `is_new_user` from `POST /auth/otp/verify`; the web discards it. Thread it through NextAuth: `authorize` → JWT → session.
- On a new user's first landing, show a one-time **WelcomeCreditsModal**: confetti + a credit counter animating 0 → 2.
  - Tenant copy: _"You've got 2 free credits — request callbacks and get a call within 24 hours."_
  - Owner/pg_operator copy: _"Welcome! Your first 2 tenant leads are free."_
- Shown exactly once: consumed session flag + `localStorage` guard. No feature flag (it only fires on `is_new_user`).
- Pre-signup, the same benefit appears on the login page tabs and on every blurred-card overlay.
- Role changes after signup (tenant → owner) do not re-trigger the celebration.

## 7. Data model changes (migration `0053_lead_monetization.sql`)

`leads` — add columns:

| Column                | Type                                              | Notes                                                             |
| --------------------- | ------------------------------------------------- | ----------------------------------------------------------------- |
| `access_state`        | text CHECK (`free`,`locked`,`unlocked`,`expired`) | default `locked`; set `free` at creation for first-2              |
| `unlocked_at`         | timestamptz NULL                                  |                                                                   |
| `unlock_txn_id`       | uuid NULL FK → `wallet_transactions`              |                                                                   |
| `called_at`           | timestamptz NULL                                  | first claim wins                                                  |
| `called_by`           | text CHECK (`owner`,`team`) NULL                  |                                                                   |
| `call_deadline_at`    | timestamptz                                       | mirrors the unlock's `response_deadline_at` for dashboard queries |
| `tenant_confirmed_at` | timestamptz NULL                                  |                                                                   |
| `disputed_at`         | timestamptz NULL                                  |                                                                   |

- `wallet_transactions.txn_type`: add `debit_lead_unlock`, `refund_lead_dispute` to the enum/CHECK.
- `contact_unlocks`: no schema change; deadline constant moves 12h → 24h in code. Status values gain callback semantics (`awaiting_call` → claimed/refunded) — extend the existing status set only if the current values cannot express this; prefer reusing existing transitions.
- Real tenant phone is **never stored on the lead** — always joined from `users`.
- Rollback file `0053_….rollback.sql` as per repo convention.

## 8. API changes

All under `/v1`; internal API, no external consumers — response-shape changes are acceptable behind the flag.

| Endpoint                            | Change                                                                                                                                                                                                                                              |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST tenant/contact-unlocks`       | **Semantics change** (flag-gated): response drops `owner_contact.phone_e164`; returns `{ callback: { id, status, call_deadline_at, credits_remaining } }`. Flag off → old reveal behavior (kill switch).                                            |
| `GET tenant/callbacks`              | **New.** Tenant's callback requests with status timeline data.                                                                                                                                                                                      |
| `POST tenant/callbacks/:id/confirm` | **New.** Sets `tenant_confirmed_at`.                                                                                                                                                                                                                |
| `POST tenant/callbacks/:id/dispute` | **New.** 72h window; refund + flag per §3.4.                                                                                                                                                                                                        |
| `POST owner/leads/:id/unlock`       | **New** (roles `owner`,`pg_operator`; `Idempotency-Key` required). Wires the existing `402` seam (`openLeadForOperator`) to a real wallet debit. Mirrors `unlockContactDb`'s debit pattern. Errors: `402 insufficient_credits`, `410 lead_expired`. |
| `POST owner/leads/:id/call-click`   | **New.** Requires `access_state` in (`free`,`unlocked`). Sets `called_at`/`called_by='owner'`; returns `tel:` URI. Idempotent (first tap wins).                                                                                                     |
| `GET owner/leads`                   | Extended: include `access_state`, `call_deadline_at`, `called_at`; full tenant phone **only** when `free`/`unlocked`.                                                                                                                               |
| `GET admin/leads/rescue-queue`      | **New.** `called_at IS NULL AND call_deadline_at BETWEEN now() AND now() + 6h`. Full tenant phone (admin).                                                                                                                                          |
| `POST admin/leads/:id/team-called`  | **New.** Sets `called_at`/`called_by='team'`.                                                                                                                                                                                                       |

- `LeadsService` stays **DB-only** (its existing shape — returns empty without a DB). `ContactsService` keeps full dual-mode (`DatabaseService.isEnabled()` vs `AppStateService`); its in-memory path mirrors the new response shape.
- New shared DTOs in `packages/shared-types` (snake_case fields, string-literal unions, per existing convention): `LeadAccessState`, `CallbackStatus`, callback/lead response interfaces, extended `WalletTxnType`.

## 9. Web changes

- **`unlock-contact-panel.tsx` → callback request panel:** guarantee copy, no phone-reveal UI, status timeline, existing OTP gate and Buy Credits fallback stay. Old behavior preserved when the flag is off.
- **Tenant "My callbacks" view:** timeline per request (`Requested → Owner notified → Call on its way / Refunded`), dispute/confirm prompt after a claimed call.
- **Owner dashboard leads tab** (`components/owner/dashboard-client.tsx`): lead cards with FREE badge / blur + "Unlock for 1 credit" / unlocked + "Call now"; live countdown; expired state; inline buy-lead-credits panel (reuses purchase-intent flow with owner packs).
- **Guest gating:** shared `GuestGate` client wrapper over card grids (session check; content always SSR'd); photo-gallery gating on listing detail.
- **WelcomeCreditsModal** + `is_new_user` threading through `auth.config.ts` / `auth.ts`.
- **Copy sweep:** every "unlock number / contact owner" string in `lib/i18n.ts` (EN **and** HI) moves to callback language. Hindi strings are a Slice 2 acceptance criterion.

## 10. Worker changes (`apps/api/src/worker/worker.ts`)

- **Refund sweep** (`runRefundSweepDb`): deadline 24h; refund condition = deadline passed AND `called_at IS NULL`. On refund: tenant `+1 refund_no_response`, locked leads → `expired`, tenant notification ("your credit is back").
- **Reminder sweep (new):** owners with uncalled leads entering the last 6 hours get a WhatsApp/SMS reminder (once per lead).
- **New-lead dispatch:** immediate owner notification on lead creation (via existing notification/WhatsApp infra).

## 11. Feature flags & rollout

| Flag                         | Side                                        | Default                | Purpose                                                                                      |
| ---------------------------- | ------------------------------------------- | ---------------------- | -------------------------------------------------------------------------------------------- |
| `ff_callback_leads`          | API + web (`NEXT_PUBLIC_FF_CALLBACK_LEADS`) | off                    | The whole model pivot: response shape, 24h deadline, owner unlock, blur. Single kill switch. |
| `ff_guest_gating`            | web (`NEXT_PUBLIC_FF_GUEST_GATING`)         | off                    | Blur-after-6 for anonymous visitors.                                                         |
| `ff_lead_management_enabled` | API (existing)                              | off → **on at launch** | Owner leads tab.                                                                             |
| `ff_credit_purchase_enabled` | API (existing)                              | off → **on at launch** | Credit pack purchases.                                                                       |

Rollout: deploy dark → enable `ff_callback_leads` + `ff_lead_management_enabled` + `ff_credit_purchase_enabled` together → enable `ff_guest_gating` separately after a Search Console baseline. Monitor: refund rate, owner unlock conversion, dispute rate, rescue-queue depth, signup conversion from blurred cards.

## 12. Analytics (PostHog)

`callback_requested`, `lead_created_free`, `lead_unlocked`, `call_clicked`, `team_called`, `callback_refunded`, `callback_disputed`, `callback_confirmed`, `guest_gate_viewed`, `guest_gate_signup_clicked`, `welcome_credits_shown`, `lead_pack_purchased`.

## 13. Testing

- **API (Vitest integration):** callback request returns no phone + debits credit; idempotency replay; insufficient credits 402; first-2-free `access_state`; unlock debit + reveal + idempotency; unlock on expired → 410; call-click sets `called_at` once; refund sweep (no call → refund + expire; called → no refund; unlocked-but-uncalled → refund, access kept); dispute inside/outside 72h; team-called path; rescue-queue query bounds; flag-off preserves legacy reveal behavior.
- **Web (Playwright E2E):** guest sees 6 normal + blurred cards with CTA (flag on) and no gating (flag off); signup celebration fires once for a new user, never for returning; tenant callback flow shows timeline; owner dashboard blur → unlock → call with seeded DB; test phones: owner `+919999999901`, tenant `+919999999902`, admin `+919999999903`.
- **Worker:** sweep tests for the 24h refund + reminder windows.

## 14. Build slices (each gets its own implementation plan)

1. **Revenue core — Implemented.** Migration 0053, callback pivot (API + shared types), owner unlock + call-click, owner packs, worker sweeps + notifications, owner dashboard UI, tenant panel + callbacks list, admin rescue queue, flags, tests.
2. **Funnel — Implemented.** Guest gating (search/map/detail), welcome celebration, login-page + overlay benefit messaging, full Hindi copy.
3. **Purchase polish — Implemented.** Razorpay Checkout widget wired end-to-end (order creation → checkout signature confirm → webhook-only credit grant → status poll), UPI deep-link fallback when Checkout.js fails to load, role-aware pricing (`leads_5`/`leads_15` for owner+pg_operator, `starter_10`/`growth_20` for tenant), and owner pack upsell surfaces on every lead-monetization surface:
   - `LeadCreditBalanceBar` — persistent balance strip on the owner leads tab (visible when `ff_callback_leads && ff_credit_purchase_enabled`).
   - `LeadMonetizationControls` (`apps/web/components/owner/lead-monetization-controls.tsx`) — the single shared state machine (FREE badge, countdown, blur/unlock, Call now, expired message, inline buy-credits recovery on `402 insufficient_credits`) extracted out of `LeadCard` and reused by every lead-bearing surface: the owner list card (`LeadCard`), every owner Kanban card (`LeadKanban`), and the PG operator board (`PgLeadsBoard`, via a `PgDashboardLead → LeadVm` adapter). One component, one behavior, everywhere a lead can appear — the default owner board (Kanban) is not a lesser path than the secondary list view.
   - `PgDashboardLead` (packages/shared-types) gained `access_state`, `call_deadline_at`, `called_at`, `called_by`, `tenant_name`, `tenant_phone` — mapped straight through by `LeadsSliceAdapter.inboxForOperator` from fields `getOwnerLeads` already fetches (no new query). With `ff_callback_leads` on, the PG board uses the paid `owner/leads/:id/unlock` and `owner/leads/:id/call-click` endpoints (already `@Roles("owner","pg_operator")`) instead of the legacy `pg-operator/leads/:id/open` dev-reveal seam; with the flag off, `openPgLead()` behavior is unchanged.
   - E2E: `apps/web/tests/lead-credit-purchase.spec.ts` — locked lead → `402` → purchase dialog → mocked Razorpay Checkout → simulated `payment.captured` webhook → original unlock auto-retries with no second click; checkout dismissal leaves the balance untouched; UPI fallback produces a `upi://` link; flag off preserves legacy behavior with zero purchase UI.

## 15. Risks & accepted trade-offs

- **Late unlocks feel harsh:** owner pays at hour 23, calls at hour 25 — refund stands, owner keeps the number. Simple rule, occasionally unfair; accepted.
- **Blur is friction, not security:** content is in the DOM (deliberately, for SEO). Determined scrapers bypass it; accepted.
- **Both sides pay for one connection:** deliberate model choice; tenant side is refund-protected.
- **Team rescue costs ops time** and the owner still didn't pay; mitigated by the unresponsive-owner report.
- **Dispute abuse** handled manually at current scale.
- **SEO:** blur-in-DOM is the safe pattern, but guest gating still gets its own flag + Search Console monitoring through the domain cutover.
- **Copy surface is wide:** old "unlock number" language exists across EN + HI; a full sweep is in scope (Slices 1–2).

## 16. Out of scope (future)

- Masked calling via telephony (Exotel/Twilio) — the bulletproof upgrade to click-to-call.
- Subscription plans bundling monthly lead allowances (tables exist; not wired here).
- Listing-level "responds fast" badges from callback stats.
- Automated delisting of unresponsive owners.
- Tenant credit expiry / breakage rules.

## 17. Rollout — Razorpay Checkout (Slice 3)

**No deployment was performed by this implementation.** This section is the runbook for whoever flips the flags.

### Required credentials (Razorpay dashboard → API keys / webhooks)

| Env var                   | Where | Purpose                                                                                                                                                                                                            |
| ------------------------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `RAZORPAY_KEY_ID`         | API   | Live Orders API key ID (also the Checkout widget's public `key`).                                                                                                                                                  |
| `RAZORPAY_KEY_SECRET`     | API   | Live Orders API key secret. Signs order creation, checkout-signature verification, and (as a webhook-secret fallback) webhook verification.                                                                        |
| `RAZORPAY_WEBHOOK_SECRET` | API   | The **webhook-specific** secret configured in the Razorpay dashboard's webhook settings (recommended over reusing the account key secret).                                                                         |
| `PAYMENT_WEBHOOK_SECRET`  | API   | Provider-agnostic fallback webhook secret; either this or `RAZORPAY_WEBHOOK_SECRET` must be set for the razorpay webhook route to accept requests (`payments.util.ts: ensureWebhookSignature`).                    |
| `RAZORPAY_ORDERS_MODE`    | API   | `live` in production; `mock` for local/CI (generates `order_mock_*` IDs, no outbound call to Razorpay, and accepts `RAZORPAY_CHECKOUT_SECRET` for checkout-signature verification instead of the live key secret). |

### Razorpay dashboard configuration

- **Orders API mode:** `live` (`RAZORPAY_ORDERS_MODE=live`) — orders must be created server-side via `POST wallet/purchase-intents`, never client-side, so the amount can never be tampered with (closes the invalid-order-ID gap).
- **Automatic capture must be enabled** on the Razorpay account (Settings → Payment Capture → Automatic). This implementation never calls a separate capture API — it relies on `payment.captured` firing without a manual capture step.
- **Webhook URL:** `https://<api-host>/v1/webhooks/razorpay`.
- **Subscribed events:** `payment.captured` (grants credits, idempotent via `wallet_transactions(wallet_user_id, idempotency_key)` unique constraint) and `payment.failed` (marks the order `failed`; no credits, no side effects beyond status).
- Crediting is **webhook-only** — the Checkout success handler only confirms the checkout signature and moves the order to `authorized`; the wallet balance never changes until the webhook lands, and the same webhook event is deduplicated server-side (`payment_webhook_events(provider, provider_event_id)` unique constraint) so retried webhook deliveries can't double-credit.

### Dark-deployment order

1. **Credentials + webhook first:** set `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET` (or `PAYMENT_WEBHOOK_SECRET`), `RAZORPAY_ORDERS_MODE=live` on the API, and register the webhook URL + events in the Razorpay dashboard, **before** flipping any feature flag. This lets you verify the webhook is reachable (Razorpay's dashboard has a "test webhook" send) with zero user-facing effect, since `ff_credit_purchase_enabled` is still off.
2. **Then the API flags**, together: `FF_CALLBACK_LEADS=true` + `FF_LEAD_MANAGEMENT_ENABLED=true` + `FF_CREDIT_PURCHASE_ENABLED=true`. **`FF_CREDIT_PURCHASE_ENABLED` must flip in the same step as `FF_CALLBACK_LEADS`** — purchase-intent creation 403s while it's off (`readFeatureFlags().ff_credit_purchase_enabled` gate in the wallet module), so enabling callback leads without it stands up locked leads with no way to buy unlock credits.
3. **Then the web flags**, together: `NEXT_PUBLIC_FF_CALLBACK_LEADS=true` + `NEXT_PUBLIC_FF_CREDIT_PURCHASE_ENABLED=true`. Same pairing rule applies client-side — `NEXT_PUBLIC_FF_CREDIT_PURCHASE_ENABLED` gates `LeadCreditBalanceBar` and the buy-credits recovery panel inside `LeadMonetizationControls`; without it, a locked lead's `402 insufficient_credits` has no purchase surface to recover through.
4. `NEXT_PUBLIC_FF_GUEST_GATING` (Slice 2) is an independent flag — its rollout timing (after a Search Console baseline) is unaffected by this sequence.

### Verification before flip

- Send a test `payment.captured` webhook from the Razorpay dashboard and confirm a `200` + `payment_webhook_events` row with `signature_valid = true`.
- Purchase one credit pack end-to-end in staging with a real (small) payment before enabling for all owners.
