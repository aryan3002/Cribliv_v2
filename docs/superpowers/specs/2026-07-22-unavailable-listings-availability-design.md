# Unavailable listings + "Notify when available" — design

Date: 2026-07-22
Status: Draft for review
Scope: Flats/houses only (PG excluded — PG already models availability at bed/room level)

## 1. Goal

Let a verified home be marked **"not available right now"** — from **both** the owner
dashboard and the admin portal — without deleting or hiding it. An unavailable listing:

1. Stays live and browsable (keeps its SEO/detail value).
2. Shows a distinct, calm "not available" UI instead of the callback CTA.
3. Offers a **"Notify when available"** button (guests too, via OTP) that captures the
   seeker's phone as a **waitlist lead**.
4. Still appears in search, but **sorted to the very bottom**, under a divider.
5. Surfaces its waitlist to admins as **leads with phone numbers** (owners see only the count).

This is as much a **demand sensor** as a UX nicety: an unavailable-but-listed home keeps
collecting real, phone-verified demand that admins can act on when it frees up.

## 2. The core decision: availability is a _flag_, not a lifecycle status

The existing `listing_status` enum is
`draft | pending_review | active | rejected | paused | archived`
(`infra/migrations/0001_init.sql:35`). Two existing states look tempting but are wrong here:

- **`paused`** _hides_ a listing — search hard-excludes it (`WHERE l.status = 'active'`,
  `apps/api/src/modules/search/search.service.ts:405`) and the detail API 404s/GONEs it
  (`apps/api/src/modules/listings/listings.controller.ts:162,270`). It is also the
  **fraud auto-takedown** state (`apps/api/src/modules/fraud/fraud.service.ts:60,78,167`),
  so making paused listings publicly visible would expose fraud-flagged homes. Unusable.
- Adding a **new status value** (e.g. `unavailable`) would force edits to `status = 'active'`
  in ~8 scattered queries (search, map, similar, pricing-intel, ranking, worker, detail),
  each with different intent — a large, error-prone blast radius.

**Decision:** add a boolean **`is_available`** column, independent of `status`. An unavailable
listing is `status = 'active' AND is_available = false`. Because it stays `active`, it **passes
every existing gate unchanged** — search still selects it, the detail API still serves it — and
the only deliberate behavior changes are:

- Search **ORDER BY** gains a leading "available first" term (sink, don't drop).
- The detail CTA + search card **read `is_available`** and render the unavailable variant.
- Owner/admin get a toggle that writes the flag.
- A new waitlist table + endpoints capture "notify me" signups.

This is the smallest correct change and keeps `paused`/fraud semantics intact.

### Naming (avoid the existing "availability" clash)

The **existing owner pause toggle** is already (confusingly) called "availability":
`AvailabilityToggle` → `PATCH /owner/listings/:id/availability` (active↔paused), gated by
`ff_availability_toggle_enabled`. To keep the two concepts clearly separate:

| Concept                   | Meaning                                   | Owner UI label                             | Endpoint                                                                              | Flag                                        |
| ------------------------- | ----------------------------------------- | ------------------------------------------ | ------------------------------------------------------------------------------------- | ------------------------------------------- |
| **Visibility** (existing) | Live vs Paused (fully hidden)             | "Visibility · Live / Paused"               | `PATCH /owner/listings/:id/visibility` `{ visible }` _(renamed from `/availability`)_ | `ff_availability_toggle_enabled` (existing) |
| **Availability** (new)    | Available vs Not available (listed, sunk) | "Availability · Available / Not available" | `PATCH /owner/listings/:id/availability` `{ available }`                              | `ff_unavailable_listings` (new)             |

**Recommended:** rename the existing pause route/client/component from "availability" to
"visibility" so endpoint names match the new UI labels. It touches ~4 files + tests
(`owner.controller.ts`, `owner-api.ts` `toggleListingAvailability`, `availability-toggle.tsx`,
existing tests) and is low-risk (gated, default-off).
**Fallback** (if we'd rather not touch the existing endpoint): leave `/availability` as pause
and name the new route `/owner/listings/:id/availability-status`. The rest of the design is
identical. This doc assumes the recommended rename.

## 3. Feature flag

New flag `ff_unavailable_listings` (env `FF_UNAVAILABLE_LISTINGS`), default **OFF**, added to
`apps/api/src/config/feature-flags.ts` (interface + defaults + `readFeatureFlags`). Web side uses
`useFlag("ff_unavailable_listings")` (`apps/web/lib/feature-flags.ts`, checks
`NEXT_PUBLIC_FF_UNAVAILABLE_LISTINGS` or PostHog).

When OFF: no toggles rendered, no notify UI, search sort unchanged, and `is_available` is ignored
end-to-end (every listing treated as available). The DB column and the leading sort term are inert
until a listing is actually marked unavailable, which can only happen through the flagged UI.

## 4. Data model — migration `0067_listing_availability.sql` (+ `.rollback.sql`)

```sql
-- Availability flag (independent of listing_status; only meaningful for status='active')
ALTER TABLE listings
  ADD COLUMN is_available boolean NOT NULL DEFAULT true,
  ADD COLUMN became_unavailable_at timestamptz,
  ADD COLUMN availability_source text;   -- 'owner' | 'admin' | null

-- Partial index to keep the "available first" sort + waitlist lookups cheap
CREATE INDEX idx_listings_is_available_active
  ON listings (is_available)
  WHERE status = 'active';

-- Waitlist / "notify when available" signups
CREATE TABLE listing_availability_alerts (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id    uuid NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
  user_id       uuid REFERENCES users(id) ON DELETE SET NULL,
  phone         text NOT NULL,
  locale        text,
  status        text NOT NULL DEFAULT 'waiting',  -- 'waiting' | 'ready' | 'notified' | 'cancelled'
  created_at    timestamptz NOT NULL DEFAULT now(),
  ready_at      timestamptz,      -- set when the listing flips back to available
  notified_at   timestamptz,      -- set when the "it's back" message actually sends
  UNIQUE (listing_id, phone)
);
CREATE INDEX idx_avail_alerts_listing ON listing_availability_alerts (listing_id);
CREATE INDEX idx_avail_alerts_status  ON listing_availability_alerts (status);
```

Notes:

- `UNIQUE (listing_id, phone)` makes "notify me" idempotent (re-tap = "you're already on the list").
- `admin_action_type` enum gains `availability_change` (for the admin audit trail; see §5.3).
  This is a second small enum ALTER in the same migration.

### In-memory (dual-mode) parity — required by CLAUDE.md

`DatabaseService.isEnabled()` must have a matching code path. In `AppStateService`
(`apps/api/src/common/app-state.service.ts`): add `is_available` (default true) to the in-memory
listing shape and an in-memory `availabilityAlerts` array, so the API still boots and behaves
without Postgres.

## 5. API changes (`apps/api`)

### 5.1 Owner — write the flag

- `owner.controller.ts`: new `@Patch("listings/:listing_id/availability")` → `setAvailability`,
  body `{ available: boolean }`. (And rename the existing pause route to `/visibility` per §2.)
- `owner.service.ts`: new `setAvailability(userId, listingId, available)` — ownership-scoped
  `UPDATE listings SET is_available=$3, became_unavailable_at = CASE WHEN $3 THEN NULL ELSE now() END,
availability_source='owner', updated_at=now() WHERE id=$1 AND owner_user_id=$2 AND status='active'
AND listing_type='flat_house' RETURNING id, is_available` (mirror the existing `toggleAvailability`
  pattern at `owner.service.ts:849-884`). Guard `flat_house` only.
- `listOwnerListings` / `getOwnerListing`: include `is_available` and `waitlist_count`
  (count of `listing_availability_alerts` where status in ('waiting','ready')). Count only — owners
  never get the phone numbers.

### 5.2 Notify waitlist — new module `apps/api/src/modules/availability-alerts/`

- `POST /listings/:listing_id/availability-alerts` — join the waitlist. `AuthGuard` (any signed-in
  user). Guests reach it via the existing OTP flow (`/auth/otp/send` → `/auth/otp/verify` returns an
  `acc_` token), exactly like contact-unlock. Reads phone from `request.user`; upserts on
  `(listing_id, phone)`. Returns `{ status: 'waiting', already_on_list: boolean }`.
- `DELETE /listings/:listing_id/availability-alerts` — leave the waitlist (optional, low priority).
- `GET /tenant/availability-alerts` — "homes I'm waiting on" (optional; powers the "you're on the
  list" state on the detail page).
- Follows the `alerts` (saved-search) module shape (`apps/api/src/modules/alerts/`).

### 5.3 Admin — toggle + read leads (in the Verified Homes surface)

- `admin-homes.controller.ts`: new `PATCH /admin/homes/:listing_id/availability`
  `{ available, reason? }` and `GET /admin/homes/:listing_id/waitlist`.
- `admin-homes.service.ts` (currently read-only): add `setAvailability(...)` (same UPDATE as owner but
  `availability_source='admin'`, no owner scoping) writing an `admin_actions` row with
  `action='availability_change'` (audit parity with the decision flow at `admin.controller.ts:224`);
  add `listWaitlist(listingId)` returning `{ phone, created_at, user_id, status }[]`.
- `admin-api.ts`: `setAdminHomeAvailability`, `fetchAdminHomeWaitlist`.

### 5.4 Search — sink, don't drop

- `search.service.ts`: **no WHERE change** (unavailable rows are `status='active'`, already selected).
  Prepend a leading term to **every** `orderBy` branch (`search.service.ts:573-583`, applied at `:659`):
  `CASE WHEN l.is_available THEN 0 ELSE 1 END ASC, <existing order…>`. Mirror in the in-memory fallback
  sort (`search.service.ts:790-800`). The term is inert when nothing is unavailable.
- Add `is_available` to the search result item DTO (so the card can badge it).
- **Similar listings** (`search.service.ts:990,1072`): add `AND l.is_available` — don't recommend a
  taken home as an alternative.
- Map / pricing-intel / locality counts: **unchanged** (unavailable homes still count as live inventory —
  desirable, keeps SEO counts honest). Optional future: dim unavailable map pins.

### 5.5 Detail payload

- `listings.controller.ts` already serves `status='active'`, so unavailable listings render with **no
  serving change**. Just include `is_available` (and optionally `waitlist_count`) in the detail payload
  so the panel can switch modes.

### 5.6 Worker — capture-now, deliver-later

- When a listing flips `is_available` false→true, set its waiting alerts to `status='ready', ready_at=now()`
  (a small hook in the owner/admin service, or a worker sweep in `apps/api/src/worker/worker.ts`).
- **Actual delivery of the "it's back" message is deferred** (no live broadcast channel: WhatsApp API not
  live, D7 is OTP-only). `ready` alerts are surfaced to admins to action manually (call/export). The
  automated send is a future slice, gated on a live channel; it will flip `ready → notified`.

## 6. Web changes (`apps/web`)

### 6.1 Listing detail — Option A "calm swap" (approved)

`apps/web/components/unlock-contact-panel.tsx` + `app/[locale]/listing/[listingId]/page.tsx`:

- When `is_available === false` (and flag on): render the **calm-swap** variant —
  - amber "Not available right now" status chip at the top of the action card;
  - keep price + specs visible (muted);
  - replace "Request Callback" with primary **"Notify when available"** (`ti-bell`) that runs the
    existing OTP flow, then `POST …/availability-alerts`;
  - waitlist social proof line ("14 people are waiting for this home");
  - reassurance microcopy: "We'll text you the moment it's back. No spam.";
  - keep "Save".
  - Success state: "You're on the list — we'll notify you when it's available."
  - If the seeker is already on the list: show "You're on the waitlist" instead of the button.
- Swap the **mobile CTA bar** ("View Contact", `page.tsx:643-659`) to "Notify when available" too.
- Add an "Unavailable" header badge alongside the existing Verified/Type badges (`page.tsx:278-289`).

### 6.2 Search results — dimmed + "currently unavailable" section (approved)

`app/[locale]/search/page.tsx` + `apps/web/components/listing-card.tsx`:

- Card reads `is_available`; when false → grayscale/dimmed image, amber **"Unavailable"** badge, and an
  inline **"Notify me"** button (opens the same OTP → waitlist flow). Ensure the notify action stays
  usable even inside the guest-gated/blurred zone (`page.tsx:411-433`).
- The page renders a **"Currently unavailable · get notified when they're back"** divider before the first
  unavailable card. Because the API sorts available-first, this boundary naturally falls at the tail of the
  result set (last page(s)). The divider renders only when the current page contains unavailable items.

### 6.3 Owner dashboard — two clearly-labeled controls (approved)

`apps/web/components/owner/listing-card-luxe.tsx`:

- Relabel the existing toggle to **"Visibility · Live / Paused"** (helper: "Paused hides it from search
  completely"). (Component/endpoint rename per §2.)
- Add a new **"Availability · Available / Not available"** toggle (new `AvailabilityToggle`, calling
  `setListingAvailability` → `PATCH /owner/listings/:id/availability`), helper: "Stays listed, sinks in
  search, collects notify sign-ups." Optimistic UI + revert-on-error, mirroring the existing toggle.
- Show a demand nudge when `waitlist_count > 0`: "14 people want to be notified when this is available"
  (count only, no numbers). Only for `flat_house`.

### 6.4 Admin — Verified Homes workspace

`apps/web/components/admin/homes/AdminHomeWorkspace.tsx`:

- Add an **availability toggle** (reuse the toggle+confirm+reason pattern from
  `components/admin/pg-properties/VisibilityControls.tsx`) calling `setAdminHomeAvailability`.
- Add a **waitlist leads panel**: count badge + rows of `phone · joined · guest/logged-in` with a
  **Call** action and **"View all · export CSV"** (`fetchAdminHomeWaitlist`). Admins see phone numbers.

### 6.5 Copy / i18n

Add strings to `apps/web/lib/i18n.ts` (en + hi): "Not available right now", "Notify when available",
"Notify me", "You're on the list", "N people are waiting", "Currently unavailable", "Available",
"Not available", "Visibility", "Live", "Paused", reassurance + success lines.

## 7. Analytics

`trackEvent` (PostHog): `availability_marked` (`{ listing_id, available, source }`),
`notify_requested` (`{ listing_id, is_guest }`), `waitlist_joined`, `waitlist_lead_viewed` (admin).

## 8. Edge cases

- **Paused + unavailable:** independent flags. A paused listing is hidden regardless of `is_available`;
  the availability toggle is only offered for `status='active'`.
- **Flip back to available:** detail reverts to Request Callback; search un-sinks; waiting alerts → `ready`.
- **Duplicate notify:** unique constraint → idempotent, friendly "already on the list".
- **Guest gating in search:** the inline "Notify me" must remain tappable in the blurred zone.
- **PG:** out of scope — toggles/flag only exposed for `listing_type='flat_house'`.
- **Non-active listings (draft/rejected/archived):** availability toggle hidden.

## 9. Out of scope (explicit)

- Automated "it's available again" message delivery (deferred until a live broadcast channel exists).
- PG whole-property availability (bed/room model already covers it).
- A platform-wide admin waitlist roll-up (per-listing view ships first; roll-up can align with
  `ff_admin_lead_center` later).
- Dimmed unavailable map pins.

## 10. Testing

- **API (vitest):** migration up/down; `setAvailability` ownership + `flat_house` guard + status guard;
  admin toggle audit row; waitlist upsert idempotency + guest OTP path; search sort places unavailable
  last across pages and sort modes; flag-off = no behavior change; in-memory (DB-disabled) parity.
- **Web:** owner two-toggle labels + optimistic revert; detail calm-swap CTA + OTP→waitlist success/
  already-on-list; search dimmed card + divider + inline notify; admin waitlist panel renders numbers;
  flag-off hides everything.

## 11. Rollout

1. Migration `0067` (prod run by user — sandbox writes are blocked).
2. Ship behind `ff_unavailable_listings` OFF.
3. Enable in staging; verify owner + admin toggles, detail swap, search sink, waitlist capture.
4. Enable in prod; watch `availability_marked` / `notify_requested`.
5. Follow-up slice: wire automated waitlist delivery when a channel goes live.

## 12. Files touched (index)

- Migration: `infra/migrations/0067_listing_availability.sql` (+ rollback)
- API: `config/feature-flags.ts`; `modules/owner/{owner.controller.ts,owner.service.ts}`;
  new `modules/availability-alerts/*`; `modules/admin/{admin-homes.controller.ts,admin-homes.service.ts}`;
  `modules/search/search.service.ts`; `modules/listings/listings.controller.ts`;
  `common/app-state.service.ts`; `worker/worker.ts`
- Shared types: `packages/shared-types/src/{types.ts,admin-homes.ts}` (add `is_available`,
  `waitlist_count`, alert + waitlist DTOs)
- Web: `lib/{feature-flags.ts,owner-api.ts,admin-api.ts,api.ts,i18n.ts}`;
  `components/unlock-contact-panel.tsx`; `components/listing-card.tsx`;
  `app/[locale]/listing/[listingId]/page.tsx`; `app/[locale]/search/page.tsx`;
  `components/owner/{listing-card-luxe.tsx,availability-toggle.tsx}`;
  `components/admin/homes/AdminHomeWorkspace.tsx`; new notify component
