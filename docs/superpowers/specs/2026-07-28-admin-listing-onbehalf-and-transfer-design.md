# Admin listing create-on-behalf and ownership transfer

**Date:** 2026-07-28
**Status:** Approved, ready for planning

## Problem

Field workers onboard properties for owners who will not install anything or complete a signup
themselves. Today the only way to do that is for the worker to create the listing from their own
owner account, which permanently binds the property to the wrong person.

Two separate columns bind a listing to a human, and nothing in the product can change either one
after creation:

- `listings.owner_user_id` (`infra/migrations/0001_init.sql:224`) controls the owner dashboard
  (`owner.service.ts:80`, `:188`), edit/pause/availability rights (`:589`, `:806`, `:927`), which
  account new leads are routed to (`contacts.service.ts:152-156`), and the public "Listed by X"
  name and member-since year (`listings.controller.ts:174`, `:271`).
- `listings.contact_phone_encrypted` is the number a tenant actually receives after spending a
  credit (`contacts.service.ts:258`, `:305`). It is written once at creation from the _creating_
  user's `phone_e164` (`owner.service.ts:427`) and no UI ever updates it — the owner edit statement
  at `owner.service.ts:602` does not touch the column. Despite the name the value is plaintext;
  the only real encryption in the codebase is PAN
  (`modules/rent-agreement/crypto/pan.crypto.ts`).

These two must always move together. Changing only `owner_user_id` produces a listing whose masked
phone preview shows the new owner (that reveal reads `users.phone_e164` via the join at
`listings.controller.ts:153`, `:205`) while every paid unlock still hands out the worker's number —
a tenant spends a credit and calls the wrong person.

There is no transfer capability anywhere. `admin-homes.controller.ts` exposes only list, detail,
availability-status and waitlist. `POST /admin/users` (`admin.controller.ts:867`) already upserts a
user by phone, so half the primitive exists but nothing uses it for listings.

Separately, an admin-role worker cannot reach the listing wizard at all: `/[locale]/owner/*` is
gated to `roles: ["owner"]` (`apps/web/middleware.ts:28`) and the API is `@Roles("owner")`
(`owner.controller.ts:29`).

## Goal

A worker logs into the admin portal, creates a listing through the existing wizard, enters the
owner's phone number, and publishes. The listing arrives in review already owned by that owner,
with that owner's number as the callback number. Separately, any existing mis-assigned listing can
be transferred to its real owner from the admin UI.

The owner then logs in with their phone, is granted the `owner` role automatically
(`auth.service.ts:737`), and sees their property.

This design depends on that immediate grant. The code comment above it
(`auth.service.ts:734-736`) describes the immediate path as a local-development convenience and
says production "should" use a pending-approval flow — but immediate grant is what actually runs in
production today, and the handover story breaks if that ever changes. Anyone swapping in an
approval flow must also give transferred-to owners a way through it.

## Non-goals

- **PG listings.** PG ownership spans `pg_listings.operator_user_id`, `pg_properties.operator_id`
  and the underlying `listings` row, and `infra/migrations/0031_pg_operator_v1.sql:27` has an
  exclusion constraint permitting only one primary property per operator, so a PG transfer can hard
  fail on conflict. Flat/house only for v1.
- **Owner consent flow.** Transfer is a unilateral admin action. Ops tells the owner to log in.
- **Notifications on transfer.** WhatsApp is not live and D7 carries OTP only; the owner is told
  out of band.
- **A restricted staff role.** See Accepted risks.

## Decisions

| Decision                                                                        | Rationale                                                                                                                                                                                                                                                                                                                 |
| ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Reuse the existing wizard rather than build an admin form                       | The wizard is a 1081-line orchestrator over six steps with voice navigation, AI photo extraction, Azure blob upload and geo picking (`apps/web/app/[locale]/owner/listings/new/page.tsx`). A second implementation would be weeks of duplicated work and two flows to maintain.                                           |
| Create-then-transfer at publish, not on-behalf-of headers or impersonation      | Keeps the ownership change in exactly one tested code path shared with the standalone fix. A header would have to be threaded through five-plus owner endpoints where a miss writes silently under the wrong owner; an impersonation token would attribute the worker's actions to the owner and destroy the audit trail. |
| Flat/house only                                                                 | Covers the actual inventory and keeps the transfer to one table and two columns.                                                                                                                                                                                                                                          |
| Inherited leads move with the listing but are exempt from the free-lead counter | Owners need enquiry history, but `leads.service.ts:110` counts leads per owner lifetime to decide the first-two-free perk, so inheriting two or more would silently lock a new owner's first real lead.                                                                                                                   |
| Transfer does not reset `verification_status`                                   | The badge describes the property, is read from the listing (`apps/web/app/[locale]/listing/[listingId]/page.tsx:210`), and the listing already passed admin review. Resetting would pull live listings out of search on every handover.                                                                                   |
| Workers use the existing `admin` role                                           | User's explicit decision. See Accepted risks.                                                                                                                                                                                                                                                                             |

## Part 1 — Transfer core

A new `admin-listing-transfer.service.ts` under `apps/api/src/modules/admin/` exporting one
function that runs entirely in a single transaction, with the listing row taken `FOR UPDATE` so two
concurrent admins cannot race.

1. **Resolve the owner.** Upsert `users` by `phone_e164`, reusing the `INSERT … ON CONFLICT
(phone_e164)` pattern proven in `POST /admin/users` (`admin.controller.ts:867`). Promote
   `tenant` → `owner`; leave an existing `owner`/`pg_operator` unchanged; refuse when the target is
   an `admin` (admins are blocked from `/owner/*` by middleware and would never see the listing).
   Set `full_name` only when currently null or empty, so a transfer never overwrites a name the
   owner set themselves.
2. **Guard.** Listing exists and is `listing_type = 'flat_house'`. If it is already owned by the
   target, return success without writing — a retry or double-click must be safe.
3. **Move both columns together.** `owner_user_id` and `contact_phone_encrypted = <owner phone>`.
4. **Move the leads.** `UPDATE leads SET owner_user_id = <new>, transferred_at = now() WHERE
listing_id = $1`.
5. **Audit.** Insert into `admin_actions` (`infra/migrations/0001_init.sql:363`) with
   `target_type = 'listing'`, `action = 'transfer_owner'`, and before/after state carrying the
   from/to user ids, the target phone and the leads-moved count.

   > **Corrected during planning.** An earlier draft of this spec specified `audit_logs`. That
   > table exists in the schema but nothing in the API writes to it — the codebase's real admin
   > audit mechanism is `admin_actions`, used in 8+ places (`admin-homes.service.ts:601`,
   > `pg-admin-properties.service.ts:468`, `admin-lead-ops.service.ts:564`) and read back by the
   > admin home workspace's Activity tab (`admin-homes.service.ts:972`). Using it means a transfer
   > shows up in that Activity tab for free. `action` needs a new enum value, `'transfer_owner'`,
   > added in the same migration.

### Phone normalisation

Workers type on phones and will enter `99567 29103`, `099567…`, `+91 99567 29103`. Strip
whitespace and a leading zero, prepend `+91` to a bare ten digits, _then_ apply the existing
`/^\+91\d{10}$/` check from `admin.controller.ts:873`. Without this the feature feels broken to its
heaviest users.

## Part 2 — Create-on-behalf

### Wizard extraction

The wizard's step components are already a reusable module (`apps/web/components/listing-wizard`);
the orchestrator that composes them is not. Extract it to
`components/listing-wizard/ListingWizard.tsx` taking `mode: "owner" | "admin"`, leaving both route
files as thin wrappers. This lands as its own commit with existing wizard tests green before
anything is built on top. The file is well past a comfortable editing size and we need two mount
points, so the extraction is load-bearing rather than incidental cleanup.

### Admin mount

A new sidebar entry rendering the wizard in a tab, matching the existing tab-driven shell
(`AdminSidebar.tsx:66-90`) — `AdminHomeWorkspace` already establishes the full-workspace-inside-a-tab
pattern, and a separate route would be the only non-tab surface in admin. The sessionStorage draft
key (`cribliv:wizard-draft`) gains an `:admin` suffix so an admin draft cannot collide with an
owner-side one.

Owner phone (required) and name (optional) are collected on the **Review** step in admin mode only:
it is the last screen before publish, which is when the data is needed, and it leaves the shared
`STEPS` array untouched for owner mode.

### API

Relax the eight endpoints the wizard calls — `POST listings`, `PATCH listings/:id`,
`photos/presign`, `photos/complete`, `photos/reorder`, `submit`, `generate-content`,
`capture/extract` — from `@Roles("owner")` to `@Roles("owner", "admin")`.

This grants no lateral access: every one of those service methods already scopes its queries by
`owner_user_id = req.user.id`, so an admin reaches their own drafts and nothing else.

**Publish is one endpoint.** `POST /admin/homes/:listing_id/publish-on-behalf` with body
`{ phone_e164, full_name? }` runs transfer _and_ submit in a single transaction. This is required
rather than preferred: `submitListing()` is scoped to `owner_user_id` (`owner.service.ts:806`), so
once the transfer lands the admin is no longer the owner and a separate submit call would fail.

## Data changes

Migration **0069** (0068 is the current head):

```sql
ALTER TABLE leads ADD COLUMN IF NOT EXISTS transferred_at timestamptz;
ALTER TYPE admin_action_type ADD VALUE IF NOT EXISTS 'transfer_owner';
```

The free-lead check at `leads.service.ts:110` gains `AND transferred_at IS NULL`, so inherited
leads do not consume the new owner's two free ones. The rollback drops the column; Postgres cannot
remove an enum value, so `'transfer_owner'` remains behind harmlessly.

No other schema change. Both transfer columns already exist.

## API surface

| Method | Path                                         | Body                         | Notes                                |
| ------ | -------------------------------------------- | ---------------------------- | ------------------------------------ |
| `POST` | `/admin/homes/:listing_id/transfer`          | `{ phone_e164, full_name? }` | Standalone fix for existing listings |
| `POST` | `/admin/homes/:listing_id/publish-on-behalf` | `{ phone_e164, full_name? }` | Transfer + submit, atomic            |

Both inherit `@Roles("admin")` from the admin controller class (`admin.controller.ts:61`).

## UI surface

- **Transfer action** in `HomeOwnerTab.tsx`, which already renders owner id, name, phone, role and
  last-login. A modal takes phone and name and states plainly what will move before confirming.
- **Add Listing tab** rendering `ListingWizard` in admin mode, and listing the worker's own
  unfinished drafts so they can resume or discard them.

## Error handling

| Condition                          | Response                       |
| ---------------------------------- | ------------------------------ |
| Target phone is an `admin` account | `400 cannot_transfer_to_admin` |
| Target user `is_blocked`           | `400 target_blocked`           |
| `listing_type = 'pg'`              | `400 pg_not_supported`         |
| Listing missing                    | `404 listing_not_found`        |
| Phone fails normalisation          | `400 invalid_phone`            |
| Already owned by target            | `200`, no write                |

Transferring an already-live listing is supported and expected; it stays live and changes hands.

## Testing

Integration tests for the transfer service: happy path, idempotent repeat, each refusal above,
leads moved with `transferred_at` set, audit row written. A unit test proving an owner holding three
inherited leads still gets `free` on their first organic lead. Web unit tests for the modal and
Review-step validation. E2E covering create → publish-on-behalf → listing appears under the owner.

**Corrected during planning:** an earlier draft assumed these would all skip in CI for want of
`TEST_DATABASE_URL`. That is true only of tests needing a live database. The established pattern in
`admin-homes-availability.test.ts:181` and `pg-description-write.test.ts:18` mocks
`DatabaseService.query`/`getClient` with `vi.fn()`, asserting SQL shape and parameters without
Postgres — so the transfer service's DB path, including the both-columns-move-together guarantee,
**does** get real CI coverage. Only the Playwright E2E needs a live database and stays a local gate.

Still true regardless: never run the full API suite against a live database — migration 0045's
rollback drops `keyword_rankings` and `seo_indexing_queue`. Run targeted files.

## Accepted risks

**Workers get the full `admin` role.** The entire admin controller is one flat `@Roles("admin")`
gate (`admin.controller.ts:61`), so every worker can adjust wallet credits (`POST wallet/adjust`),
change any user's role (`PATCH users/:user_id/role`), and read full revenue and fraud feeds. A
scoped `field_agent` role was proposed and declined in favour of shipping speed. Revisit if the
worker count grows beyond a small trusted group.

**Abandoned drafts accumulate** under worker accounts when a wizard run is never finished. Drafts
are never public, and the Add Listing tab surfacing them mitigates it.

## Already done

The immediate case that prompted this work is closed. Listing
`ad204234-4b39-4228-8b49-3b9e91113e16` (3RK, Vrindavan Yojana Sec-6, Lucknow) was transferred
manually on 2026-07-28 from Adarsh Tripathi (`+918800826659`) to Akash Rai (`+919956729103`), both
columns moved together, verified by before/after query. The listing had zero leads, so no history
needed moving.

## Follow-ups

- PG transfer, once the flat/house pattern is proven.
- A scoped staff role, if worker headcount grows.
- Unrelated data issue noticed on the transferred listing: its title says `3RK` while its property
  data says `3 BHK · semi_furnished`. Titles are what tenants read; `bhk` is what filters match on.
