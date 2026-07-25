# PG budget filter — design

**Date:** 2026-07-25
**Status:** approved, ready to implement

## 1. Premise correction

The originating brief stated that the PG surface "supports NO rent filtering whatsoever," based on
`rg min_rent apps/api/src/modules/pg/` returning zero matches.

That grep is accurate but points at the wrong module. `apps/api/src/modules/pg/` is a **legacy
308-redirect stub** — a single `POST /pg/segment` that validates `total_beds` and redirects to
`/pg-operator/segment`. It has never served listings.

The tenant-facing PG surface lives in `pg-operator/`, and it already supports rent filtering:

- `pg-operator/pg-public.controller.ts:34` — `GET /pg/listings` passes `@Query()` through verbatim.
- `pg-operator/services/pg-search.service.ts:158-165` — `min_rent`/`max_rent` become
  `l.monthly_rent >= $n` / `<= $n`; both are already part of the cache key (lines 118-119).
- `apps/web/lib/pg-public-api.ts:90` and the `/pg` page's `normalize()` forward every string param
  with no allowlist.

Verified against production on 2026-07-25 via SSR page loads on cribliv.com:

| Query                         | Cards | Rents returned |
| ----------------------------- | ----- | -------------- |
| `?city=lucknow`               | 20    | 3000 … 7500+   |
| `?city=lucknow&max_rent=6000` | 12    | 2200 … 5999    |
| `?city=lucknow&min_rent=9000` | 5     | 9000 … 13000   |

Consequences for the brief's scope:

- Scope item 1 (add the query params) is **already done**; no API param work is needed.
- The budget intents in `data/seeds/lucknow/intents.json` (`under-5000`, `under-10000`,
  `under-15000`, `premium`, `luxury`) **do** apply to PG today — they emit `min_rent`/`max_rent`,
  which the endpoint honours.
- The top-nav mega-menu budget column is therefore **not blocked**. `/en/pg?max_rent=10000` works
  now. (The referenced nav spec is not present on this branch.)
- The DB dual-mode requirement does not apply. `PgSearchService` deliberately returns an empty page
  when `db.isEnabled()` is false and never injects `AppStateService`. Adding an in-memory PG search
  would be new behaviour unrelated to rent filtering; explicitly out of scope.

## 2. Actual gaps

1. **No budget control in the UI.** `apps/web/components/pg/PgFilters.tsx` exposes `gender_policy`,
   `sharing`, `tenant_type`, `ac`, `food_included` — no rent. Budget filtering is URL-only and
   therefore undiscoverable, despite being plausibly the top-wanted filter for PG seekers.
2. **No test coverage.** `rg 'min_rent|max_rent'` across `pg-operator/__tests__/` and
   `search/__tests__/` returns nothing. The behaviour can regress silently.
3. **No rent validation.** `search.controller.ts:130-135` rejects non-finite `bhk`/`max_rent` with a
   `BadRequestException`. `PgSearchService` has no equivalent: `?min_rent=abc` yields
   `Number("abc")` → `NaN`, pushed as a bound param; Postgres errors; the `catch` at line 263
   swallows it and returns an empty page. A typo reads to the user as "no PGs match."

## 3. Design

### 3.1 Budget chips (`PgFilters.tsx`)

Four mutually exclusive bands, single-select, matching the existing chip idiom:

```ts
const BUDGET = [
  { value: "u5", label: "Under ₹5k", min: "", max: "5000" },
  { value: "5-10", label: "₹5–10k", min: "5000", max: "10000" },
  { value: "10-15", label: "₹10–15k", min: "10000", max: "15000" },
  { value: "15plus", label: "₹15k+", min: "15000", max: "" }
];
```

The existing `toggle()` writes one key; a band needs two. Add `setBand(band)` which writes
`min_rent` and `max_rent` together, and clears both when the active band is re-clicked. `navigate()`
already strips falsy values (`if (v) clean[k] = v`), so `min_rent: ""` removes the key rather than
emitting a blank param.

Active state compares `(filters.min_rent ?? "") === band.min && (filters.max_rent ?? "") === band.max`.
The `?? ""` matters: absent params arrive as `undefined`, not `""`.

Rendered as a new `FilterRow label="Budget"` directly below Gender — highest-intent filter, and it
reuses the existing `Chip` component, so no CSS changes.

Analytics reuse the existing `pg_filter_applied` / `pg_filter_cleared` events with
`filter_key: "budget"`, so the `TrackEvent` union is unchanged.

**Accepted edge case:** natural-language search emits `max_rent=10000` with no `min_rent`, which
matches no band exactly, so no chip renders active. Results are still filtered correctly. Preferred
over lighting a chip that claims a range the URL does not carry.

### 3.2 Rent validation (`pg-search.service.ts`)

Guard both params with `Number.isFinite` before pushing, so `runSearch` can never emit a `NaN` bound
param.

Deliberate divergence from the search module: invalid input is **ignored**, not a 400. `/pg/listings`
is called by SSR on page load, so a `BadRequestException` blanks the entire page; ignoring a junk
param still renders results. Same validation, different failure posture, for a different caller.

### 3.3 Tests

Extend the two existing files; no new files.

- `pg-operator/__tests__/pg-search.service.test.ts` (mocked `db.query`, runs in CI):
  `min_rent` alone emits `monthly_rent >=` with the numeric param; `max_rent` alone emits `<=`;
  both together emit both; non-numeric input emits neither predicate.
- `apps/web/components/pg/__tests__/PgFilters.test.tsx`: a band click pushes a URL carrying both
  params; re-clicking the active band drops both.

**Deviation from the brief:** integration tests were requested, but CI never sets
`TEST_DATABASE_URL`, so every DB-backed test is skipped, and running the full API suite locally
against a DB drops `keyword_rankings` / `seo_indexing_queue` via migration 0045's rollback. A PG
integration test would be dead weight in CI. The mocked-`db.query` unit style already established in
`pg-search.service.test.ts` executes on every run and still pins the exact SQL.

## 4. Out of scope

- In-memory `AppStateService` PG search (see §1).
- The nav mega-menu budget column — unblocked by this finding, but a separate change.
- Any change to `apps/api/src/modules/pg/`, which stays a redirect stub.
