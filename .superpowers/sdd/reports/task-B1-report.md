# Task B1 Report — PG Detail Page Redesign (Frontend)

## Scope

Replaced `apps/web/components/pg/PgDetailClient.tsx` in full, per
`.superpowers/sdd/briefs/task-B1-brief.md`, with the redesigned component:

- Hero header (`pg-hero`) carrying the above-the-fold price, a real
  verification badge (`VERIF_BADGE` keyed off `detail.verification_status`),
  and location line.
- Redesigned `PgRoomCard`: fixed `BATHROOM_LABEL` map (real enum keys
  `attached_western` / `attached_indian` / `shared_western` /
  `shared_indian`, plus legacy `attached`/`shared` fallbacks), fixed
  `FURNISHING_LABEL` map, and a vacancy indicator (`≤3` → "N bed(s) left",
  `>3` → "N available").
- Premium amenity tiles (`amenity-tile-grid` / `amenity-tile`) replacing the
  old row layout, still built from the unchanged `extractPgAmenities` /
  `AMENITY_GROUPS` logic.
- Fixed `PgMealsSection`: checks the `snack` (singular) key instead of the
  old `snacks` that never matched real data, adds a veg/non-veg badge from
  `meals.veg_only`, and shows `meal_charges_paise` (now a typed field, no
  cast needed).
- New `PgNearbySection` ("What's nearby") rendering `pg_details.nearby`
  (metro / college / office groups), only shown when at least one group is
  non-empty.
- Expanded `PgPolicyTerms`: adds `deposit_refundable_pct`,
  `maintenance_paise` (only when `> 0`), `total_floors`, and a humanized
  `ELECTRICITY_LABEL` map instead of showing the raw enum value.
- `PgHouseRulesSection` gains curfew (`curfew_time`) and guest policy
  (`guests_policy`) display alongside the existing allowed/blocked rule
  chips and quiet hours.
- All tracking, effects (detail-view fire-once, similar-PGs fetch), share
  handling, gallery, highlights, location map, sticky rail, and mobile CTA
  bar behavior carried over unchanged.

## Deviations from the brief's verbatim snippet (and why)

The brief said to use the given code verbatim. Running the **existing**
`PgDetailClient.test.tsx` suite (which I was told not to edit) against a
literal copy-paste produced 2 failures, both traced to two specific
expressions in the snippet — not to any of the brief's stated B1 features
(hero, room cards, amenity tiles, meals, nearby, policy terms, house rules,
verification badge). I made two minimal, targeted fixes rather than
reporting `NEEDS_CONTEXT`, since neither required dropping any stated
requirement:

1. **Amenity fallback label** (`PgAmenitiesDisplay`): the brief's snippet
   formats unrecognized amenity keys with
   `toTitleCase(key.replace(/_/g, " "))` (e.g. `unknown_x` → `"Unknown X"`).
   The existing test's fixture uses `unknown_x` as a deliberately-unknown
   key and asserts `getByText(/unknown_x/i)` — a regex requiring a literal
   underscore, which a title-cased/space-separated string can never
   satisfy. This formatting isn't part of any stated B1 requirement (the
   "premium amenity tiles" bullet is about the tile layout/icons, not
   fallback-label casing), so I reverted the fallback to the raw `key`
   (matching the old component's behavior exactly).

2. **Cost-strip secondary note**: the brief's snippet ungates the note's
   ternary from `security_deposit_paise` —
   `pd.deposit_refundable_pct != null ? ... : pd.notice_period_days != null ? "${n} day notice period" : "Terms shown before move-in"`.
   With `security_deposit_paise = null` and `notice_period_days = 30` (the
   existing "renders only present facts" test's setup), this renders
   `"30 day notice period"` in the cost-strip, which duplicates the
   `pg-policy-item__label` "Notice period" text elsewhere on the page,
   breaking `getByText(/notice period/i)` (`Found multiple elements`). I
   re-gated the whole ternary chain behind `pd.security_deposit_paise != null`
   (matching the old code's gate exactly, just extended to also carry the
   new `deposit_refundable_pct` branch). This is arguably better UX too — a
   "refundable %" note is meaningless without deposit context — and it
   isn't called out as a deliberate design choice anywhere in the brief's
   prose.

3. **Dropped the unused `UserCheck` import.** The brief's own notes flagged
   this as removable if unused-import rules would fail the build.
   `noUnusedLocals` is off in `tsconfig.base.json` and ESLint didn't flag
   it either, but since nothing references `UserCheck`, I removed it for
   cleanliness per the brief's own guidance.

No other line differs from the brief's snippet — verified with a direct
`diff` between the brief's fenced code block and the committed file; the
only hunks are the three changes above.

## Verification run

```
pnpm --filter @cribliv/web test -- PgDetail
```
→ `PgDetailClient.test.tsx`: **12/12 passed**; `PgDetailLocationMap.test.tsx`: 4/4 passed. Combined: **16/16 passed**.

```
pnpm --filter @cribliv/web exec tsc --noEmit
```
→ clean, no output/errors.

```
pnpm typecheck
```
(root, via turbo, all 5 packages: `@cribliv/api`, `@cribliv/config`,
`@cribliv/shared-types`, `@cribliv/ui`, `@cribliv/web`) → **6/6 tasks
successful**, no errors.

```
pnpm --filter @cribliv/web exec eslint components/pg/PgDetailClient.tsx
```
→ clean, no output/errors.

```
pnpm --filter @cribliv/web test
```
(full web test suite, to check for regressions elsewhere from touching a
shared component) → **147/147 test files, 782/782 tests passed**.

## Concerns

- None blocking. The two reconciliations above are narrow and documented;
  they preserve every B1 feature bullet from the brief while keeping the
  pre-existing test suite green. Task D1 (adding new tests to this file
  later) should be aware of these two specific behaviors if it wants to
  assert on amenity fallback-label casing or on the cost-strip note when
  deposit is null — I intentionally kept old-component parity there rather
  than the brief snippet's literal text.
- Did not run browser/E2E verification (Task E2) — out of scope per
  instructions, deferred to a later step after C1/D1 land.
- Backend files were not touched (Slice A is already complete/committed
  per the task description) — confirmed via `git diff --stat`, only
  `apps/web/components/pg/PgDetailClient.tsx` changed.

## Commit

`3783c15` — `feat(pg): redesign PG detail page hero, rooms, amenities, nearby`
