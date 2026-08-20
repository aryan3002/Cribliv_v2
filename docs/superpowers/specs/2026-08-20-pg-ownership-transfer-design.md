# PG listing ownership transfer

**Date:** 2026-08-20
**Status:** Approved, ready for planning
**Follows:** `docs/superpowers/specs/2026-07-28-admin-listing-onbehalf-and-transfer-design.md`

## Problem

An admin can transfer a flat/house listing to its real owner by typing a phone number
(admin → Verified Homes → property → Owner tab → "Transfer ownership"). The equivalent PG screen
(admin → PG Listings → listing → Owner tab) is read-only: `OwnerSection.tsx` renders six fields and
nothing else. A mis-attributed PG — onboarded by a field worker from their own account, or listed
under an operator who has since sold the property — cannot be corrected by any path in the product.

The 2026-07-28 design listed PG as an explicit non-goal, citing
`infra/migrations/0031_pg_operator_v1.sql:27` — an `EXCLUDE (operator_id) WHERE is_primary`
constraint that would make a PG transfer hard-fail on conflict. **That blocker is gone**:
`infra/migrations/0041_pg_one_property_per_listing.sql:19` drops the constraint and establishes
1 listing : 1 property. The guards left behind are now stale:

- `admin-listing-transfer.service.ts:91` and `:225` reject PG with `pg_not_supported`
  ("PG listings cannot be transferred yet").
- `BasicsStep.tsx:12` hides the PG option in the admin create-on-behalf wizard because
  publish-on-behalf hits that same guard.

## Why PG is not a copy of the flat/house path

A flat/house listing binds to a person through **one row**. A PG binds through **three**, and every
one of them gates something different:

| Column                                                                      | Gates                                                                                                                                                                                                                                                                                    |
| --------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pg_listings.operator_user_id`                                              | The PG aggregate head — listing edit, publish, status (`pg-listing.service.ts:536`, `:589`, `:640`, `:1038`)                                                                                                                                                                             |
| `pg_properties.operator_id`                                                 | The property container — maintenance (`pg-maintenance.service.ts:564`), occupancy (`pg-occupancy.service.ts:131`), bed assignment (`pg-bed-assignment.service.ts:216`), layout (`pg-layout.service.ts:129`), and the live tenant → operator phone lookup (`pg-residence.service.ts:146`) |
| `listings.owner_user_id` + `contact_phone_encrypted` + `whatsapp_available` | The public read projection (same id, 1:1 — `pg-listing.service.ts:307`); the number a tenant receives on unlock (`contacts.service.ts:305`)                                                                                                                                              |

Move one and not the others and you get a half-transferred PG: the new operator sees the listing
but cannot edit the property, or the dashboard shows the new operator while paid unlocks still hand
out the old number.

The **role model** also differs. PG routes are `@Roles("pg_operator")` (11 controllers), and
`middleware.ts:27-34` admits only `owner` to `/owner/*` and only `pg_operator` to `/pg-operator/*` —
the two roles are mutually exclusive on the web. The flat/house transfer promotes `tenant → owner`
freely; PG cannot promote `owner → pg_operator` without silently locking a landlord out of their own
flat dashboard. The platform already takes this position: `auth.service.ts:782` refuses a
self-service role switch with "contact admin to change".

## Goal

An admin opens a PG listing's Owner tab, clicks "Transfer ownership", types the real operator's
phone number, and the entire PG — listing, property, occupancy, maintenance, leads, analytics
history — changes hands atomically. The new operator logs in by OTP and finds the PG fully formed.

## Non-goals

- **Admin create-on-behalf for PG.** `BasicsStep.tsx:12`'s gate stays. Unblocking it needs the admin
  wizard to write the whole PG aggregate (`pg_properties` + `pg_listings` + `pg_details` +
  `pg_room_types` + photos), which only the PG wizard knows how to build. Removing the guard without
  that work relocates the dead end rather than fixing it. Tracked separately.
- **`alsoSubmit` / publish-on-behalf for PG.** No UI reaches a PG draft from admin today; speculative
  until the wizard work lands.
- **Splitting a PG between operators.** Transfer is all-or-nothing.
- **Refactoring the flat/house transfer.** It is live, e2e-covered, and untouched by this change
  except for one error message.

## Semantics: move, not copy

Exactly one PG exists before and after. Every child table keys off `listing_id` or `pg_property_id`,
never off the operator (`pg_details` and `pg_room_types` → `pg_listings(id)` via
`0033_pg_detail_fks_to_pg_listings.sql:62`, `:68`; `pg_rooms` →
`pg_properties(id)` via `0031:101`; `pg_beds` → `pg_rooms(id)` via `0031:111`;
`pg_bed_assignments` → `pg_properties(id)` via `0062:25`; maintenance → `pg_properties(id)` via
`0063:8`; photos and analytics events → `listings(id)`). Re-pointing the operator therefore moves
the whole tree without touching a single child row.

Ids never change, so the public URL `/en/pg/{city}/{id}` keeps working — no dead links, no SEO loss.

Two intended consequences, stated so nobody reports them as bugs:

- The previous operator **loses** that PG's analytics history from their dashboard. It moves with the
  listing; there is no split.
- Tenants currently living there see the new operator's phone **immediately**, because
  `pg-residence.service.ts:146` joins `users` through `pg_properties.operator_id` live rather than
  storing a copy.

## Design

### Approach: a sibling service, not an extension

`AdminPgTransferService` + `POST /admin/pg/listings/:id/transfer`, rather than branching inside
`AdminListingTransferService`.

The route then sits beside the other `pg/listings/:id/*` endpoints the PG admin UI already calls,
and the flat/house path — live, e2e-covered — is not edited. The genuinely shared logic is small:
`normalizeIndianPhone` is already an extracted util in the same folder, and the lead move is five
lines of SQL. The target-user rules actively _differ_ (`pg_operator` vs `owner`, plus PG's
block-existing-owner rule), so extracting a shared core on the second occurrence would abstract over
the part that isn't shared.

`admin-listing-transfer.service.ts`'s `pg_not_supported` guard **stays** — it remains the correct
answer for that endpoint. Only its message changes, from "PG listings cannot be transferred yet" to
naming the PG endpoint.

### API

```
POST /admin/pg/listings/:id/transfer
Body:     { phone_e164: string, full_name?: string }
Response: { listing_id, operator_user_id, operator_phone, leads_moved, already_owned }
```

`@Roles("admin")`, on `AdminController` beside the sibling PG routes.

### The transaction

One transaction, in this order:

1. `SELECT ... FROM pg_listings WHERE id = $1 FOR UPDATE` — serialises two admins racing the same
   listing, exactly as `admin-listing-transfer.service.ts:79` does. Lock the joined `pg_properties`
   row `FOR UPDATE` too.
2. Upsert the target user by phone. A number that has never been seen is created as `pg_operator`;
   an existing user is promoted only from `tenant`, and a name the user already set is never
   overwritten:

   ```sql
   INSERT INTO users (phone_e164, role, preferred_language, full_name)
   VALUES ($1, 'pg_operator', 'en', $2)
   ON CONFLICT (phone_e164) DO UPDATE
     SET role = CASE WHEN users.role = 'tenant' THEN 'pg_operator'::user_role ELSE users.role END,
         full_name = COALESCE(NULLIF(users.full_name, ''), EXCLUDED.full_name),
         updated_at = now()
   RETURNING id::text, phone_e164, role::text, is_blocked
   ```

   `admin` and `owner` therefore survive the upsert unchanged and are rejected in step 3 — the
   upsert never downgrades anyone. An existing `pg_operator` is a no-op.

3. Validate the returned target (see error taxonomy).
4. `UPDATE pg_listings SET operator_user_id = <new>`.
5. `UPDATE pg_properties SET operator_id = <new>` — **skipped when `pg_property_id IS NULL`**
   (`0033:20` relaxed the column to nullable for legacy orphans; those listings still transfer).
6. `UPDATE listings SET owner_user_id, contact_phone_encrypted, whatsapp_available` — all three
   together. `whatsapp_available` is sourced from the **target's** own `whatsapp_opt_in`, never
   carried over, mirroring `admin-listing-transfer.service.ts:158` and matching how the PG publish
   path writes it (`pg-listing.service.ts:349`).
7. `UPDATE leads SET owner_user_id = <new>, transferred_at = now() WHERE listing_id = $1 AND
owner_user_id <> <new>` — `transferred_at` (migration 0069) keeps inherited leads from consuming
   the new operator's free-lead allowance (`leads.service.ts:115`).
8. Re-point the listing-scoped analytics override (below).
9. `UPDATE pg_manage_requests SET operator_user_id = <new> WHERE listing_id = $1` — the operator's
   own view already resolves live through `pg_listings` (`pg-manage-request.service.ts:144`); this is
   so the admin queue's `JOIN users u ON u.id = r.operator_user_id`
   (`pg-manage-request.service.ts:173`) stops naming the previous operator.
10. `INSERT INTO admin_actions (..., 'listing', <id>, 'transfer_owner', before, after)` — reuses the
    enum value added by migration 0069. No new migration is needed for this feature.
11. `COMMIT`.

### Constraint hazard: analytics overrides

`0038_pg_listing_overrides.sql:22` defines
`uq_pg_override_listing ON pg_analytics_overrides(operator_id, listing_id) WHERE listing_id IS NOT NULL`.
A blind `UPDATE ... SET operator_id` raises `23505` when the target operator already holds a row for
this listing — reachable by transferring a PG away and later back. The write is therefore
delete-then-update:

```sql
DELETE FROM pg_analytics_overrides WHERE operator_id = <new> AND listing_id = $1;
UPDATE pg_analytics_overrides SET operator_id = <new> WHERE listing_id = $1;
```

Operator-**global** rows (`listing_id IS NULL`) are deliberately left with the previous operator:
they express a judgement about the person, not this PG.

`pg_manage_requests`' unique indexes are on `listing_id` alone (`0060:29`, `:31`), so step 9 cannot
collide.

### Error taxonomy

| Code                       | HTTP | When                                                                                                                                                          |
| -------------------------- | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `invalid_phone`            | 400  | `normalizeIndianPhone` returns null                                                                                                                           |
| `listing_not_found`        | 404  | No `pg_listings` row for the id                                                                                                                               |
| `cannot_transfer_to_admin` | 400  | Target is an admin — blocked from `/pg-operator/*` by middleware, so it could never manage what it was handed                                                 |
| `target_blocked`           | 400  | `users.is_blocked`                                                                                                                                            |
| `target_is_owner`          | 400  | **PG-specific.** Target holds role `owner`. Message: "That number belongs to a flat/house owner account. Change their role first, or use a different number." |
| `db_disabled`              | 404  | No `DATABASE_URL`                                                                                                                                             |

Transferring to the number that already owns the PG is **not** an error: it returns
`already_owned: true` and changes nothing, mirroring `admin-listing-transfer.service.ts:133`.

### In-memory mode

`AppStateService` has no `pg_listings` model — only a loose `pgProperties` map
(`app-state.service.ts:903`). The sibling admin PG service already throws `db_disabled` when the DB
is off (`pg-admin-properties.service.ts:247`), and the PG admin UI is unreachable without a DB
anyway. `AdminPgTransferService` follows that precedent rather than inventing an in-memory PG
aggregate. This is a deliberate, documented departure from the CLAUDE.md dual-mode rule, consistent
with every other PG admin service.

### UI

- `OwnerSection.tsx` gains a "Transfer ownership" button below the identity rows, styled
  `admin-btn admin-btn--ghost` to match `HomeOwnerTab.tsx:64`.
- `PgTransferOwnerModal.tsx` mirrors `TransferOwnerModal.tsx`: phone (required) + name (optional),
  Escape to close, server-side phone validation only — the modal deliberately does not re-implement
  `normalizeIndianPhone`, so the two can never drift.
- Modal copy names the PG-specific consequences: the property and everything on it (rooms, beds,
  tenants, maintenance) moves too, and current tenants' contact number changes immediately.
- `useAdminPgListing` gains `refetchDetail` so the Owner tab refreshes in place without resetting to
  the Overview tab — the behaviour `AdminHomeWorkspace` gets from its `reloadKey`.

`OwnerSection` currently takes only `detail`; it gains `accessToken` and `onTransferred`.

The PG listing detail has no Activity tab, so the `admin_actions` row is written but not surfaced in
the PG UI. That is acceptable — it is an audit log, readable by the existing admin tooling — and out
of scope here.

## Testing

**Service unit tests** (`__tests__/admin-pg-transfer.service.test.ts`), mirroring the structure of
`admin-listing-transfer.service.test.ts`:

- every error branch above, one test each
- the happy path asserts **all** of `pg_listings.operator_user_id`, `pg_properties.operator_id`, and
  the `listings` triple are written in the same transaction
- `whatsapp_available` comes from the target, not the previous operator
- `already_owned` short-circuits without writing
- a listing with `pg_property_id IS NULL` transfers and skips only the property update
- the override delete-then-update runs in that order

**E2E** (`apps/web/tests/admin-pg-transfer.spec.ts`), mirroring
`admin-listing-transfer.spec.ts`: drive the admin UI to the PG Owner tab, transfer, then assert
directly in SQL that `pg_listings.operator_user_id`, `pg_properties.operator_id` and
`listings.contact_phone_encrypted` all equal the new operator. That last assertion is the
load-bearing one — it is what fails if a future refactor drops a column from the transaction while
leaving the others intact.

## Risks

- **Irreversible from the UI.** There is no undo; recovery is a second transfer back to the original
  number. Acceptable — it matches the flat/house behaviour, and the operator-global analytics
  override is the only state that does not round-trip.
- **A transfer during active occupancy re-points live tenants' contact number instantly.** Intended
  (see Semantics), and the reason the modal copy says so explicitly.
- **Role exclusivity is enforced by `target_is_owner`, not resolved by it.** An admin who genuinely
  needs to hand a PG to an existing flat owner must change that user's role first via the existing
  admin role endpoint, accepting the `/owner/*` lockout. Making one user hold both roles is a much
  larger change to `middleware.ts` and the guards, and is out of scope.
