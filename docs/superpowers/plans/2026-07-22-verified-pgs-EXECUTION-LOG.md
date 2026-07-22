# Execution Log — Verified PGs Admin Surface

**Do not commit this file.** Coordination state, not deliverable.

Plan: `docs/superpowers/plans/2026-07-18-verified-pgs-admin-surface.md`
Brief: `docs/superpowers/plans/2026-07-22-verified-pgs-admin-surface-BRIEF.md`
Orchestration: `docs/superpowers/plans/2026-07-22-verified-pgs-ORCHESTRATION.md`

## Session A — started 2026-07-22

### Environment notes (non-obvious — read these)

- **`git` via the rtk hook returns wrong output in this repo.** `git log --oneline -3` reported HEAD as `a014389`, which does not exist. Always use `rtk proxy git ...` for git ground truth.
- Real HEAD at session start: **`0d55a98`** — exactly the commit the plan was verified at. No drift.
- **`docker compose -f infra/docker-compose.yml up -d` does NOT give you the test DB.** It maps :5432 and fails (port in use). The test DB is the pre-existing container **`cribliv-pg-local`** on **:5433**, which was stopped — start it with `docker start cribliv-pg-local`.
- Working tree dirty as the brief predicted: `.gitignore`, `migration-0034.integration.test.ts`, `migration-0031-pg-operator.integration.test.ts`. Leave them. Never `git add .`.
- `.superpowers/sdd/progress.md` exists but belongs to the **unrelated** PG Operations V2 run. Ignore it; this log is authoritative for this work.

### BASELINE (captured by orchestrator, not delegated)

```
export PATH="$(ls -d /opt/homebrew/opt/node@22/bin):$PATH"
export DATABASE_URL="postgres://postgres:postgres@127.0.0.1:5433/cribliv_v2"
pnpm --filter @cribliv/api test
```

```
 Test Files  2 failed | 233 passed | 18 skipped (253)
      Tests  7 failed | 2150 passed | 91 skipped (2248)
```

**BASELINE = 7 failed, 2150 passed, 91 skipped.** Exit status 1.

All 7 failures are pre-existing rent-agreement failures (500 on `POST /v1/rent-agreement/draft`):

- `rent-agreement/__tests__/integration/e2e-dev-flow.int.test.ts` — 3 failures
- `rent-agreement/__tests__/integration/rent-agreement-controller.smoke.int.test.ts` — 4 failures

Note: the brief predicted ~13 failures; the measured baseline is 7. The extra
expected failures (migration-0034 destructive test, stale 0031, notification_log
teardown) did not fire in this run. **7 is the number every later claim is
measured against.**

Full log: `scratchpad/baseline-api-test.log`

---

## Task 0+1 — Branch setup + shared types — PASS

- Agent: sonnet, effort low (one agent for both, per orchestration)
- Commit: `b2f9e3d` "feat(shared-types): PgAdminListing envelope + verification/status/sort params"
- Branch `feat/verified-pgs-admin-surface` created from `0d55a98`. Task 0 produced no commit (branch creation only) — correct.
- Tests: no test in this task. `pnpm --filter @cribliv/shared-types build` exit 0; `pnpm typecheck` 6/6 successful before AND after (no regression).
- Raw evidence (orchestrator-verified, not agent-reported):
  ```
  $ rtk proxy git diff --stat 0d55a98..HEAD
   packages/shared-types/src/pg-operator.ts | 56 +++++++++++++++++++++++++++++++-
   1 file changed, 55 insertions(+), 1 deletion(-)
  ```
  Orchestrator read the full diff against plan lines 101-189: **byte-for-byte match**. All 6 new
  fields on `PgAdminListingListItem` present; all 5 new exports present with the exact union
  members and doc comments. No extra fields, no extra exports.
  Unrelated dirty files confirmed still uncommitted and unmodified.
- Deviations from plan: none.
- Notes for next session:
  - `.superpowers/sdd/task-1-report.md` had a stale unrelated report in it (from an older task
    series reusing the filename); the agent overwrote it. Harmless.
  - A pre-commit lint-staged/prettier hook fires on every commit and reformats staged files.
    Expect it; it made no semantic change here.

---

## Task 2 — Param sanitizer — PASS

- Agent: sonnet, effort low
- Commit: `ced9597` "feat(admin-pg): param sanitizer for PG listings list"
- Tests: **5 passed, 0 failed** (`apps/api/src/modules/admin/__tests__/unit/pg-admin-listings.params.test.ts`).
  `pnpm typecheck` 6/6 successful — matches baseline.
- Raw evidence (orchestrator-verified):
  ```
  $ rtk proxy git diff --stat b2f9e3d..HEAD
   .../unit/pg-admin-listings.params.test.ts          | 66 ++++++++++++++++++++++
   .../src/modules/admin/admin-pg-listings.params.ts  | 46 +++++++++++++++
   2 files changed, 112 insertions(+)
  ```
  Orchestrator read the full sanitizer source against plan Step 3 (lines ~290-325):
  **byte-for-byte match.** Both files new, nothing else touched. Defaults are
  `verification: "verified"`, `status: "active"`, `sort: "leads"`, `page: 1`,
  `page_size: 25`; unknown enums clamp to defaults (trust boundary holds);
  `city` lowercased/trimmed/capped 100, `q` trimmed/capped 200.
- Deviations from plan: none.
- Notes for next session: the sanitizer is the ONLY place untrusted enum values are
  admitted — Task 3's `pgListOrderBy` switch must key off this already-narrowed union.

---

## Task 3 — Service `listListings` envelope — PASS

- Agent: opus, effort high
- Commit: `732d3ef` "feat(admin-pg): listListings envelope — projection-backed verification, sort, cover, facets"
- Tests: **7 passed, 0 failed** (`__tests__/unit/pg-admin-listings.service.test.ts`; was 6 failed/1 passed pre-implementation — genuine red→green).
  Full API suite: **7 failed | 2162 passed | 91 skipped**. The 7 are exactly the baseline
  rent-agreement failures. **Zero new failures**; passing count rose 2150 → 2162.
- Raw evidence (orchestrator-verified, not agent-reported). I ran the five mandated checks
  against the committed source myself:
  1. **`$1` is `q` in all three queries** ✅ — page `[q, city, verification, status, pageSize, offset]`
     ($1..$6 as specified); cities `[q, verification, status]`; summary `[q, city]`.
  2. **`LEFT JOIN listings l ON l.id = pl.id`** ✅ — present in `PG_LIST_FROM`; verification
     filters on `COALESCE(l.verification_status::text, pl.verification_status::text)` (D1).
  3. **Leads lateral aliased `lead`** ✅ — `FROM leads lead WHERE lead.listing_id = pl.id`.
  4. **No raw phone in the list SELECT** ✅ — `u.phone_e164` appears only inside
     `PG_LIST_Q_PREDICATE` (matched, never selected) and in the pre-existing
     `owner_phone_masked` regexp. The raw `owner_phone` at service lines 257-292 is in
     `getListing` (detail), pre-existing and outside this diff.
  5. **`ORDER BY` only from `pgListOrderBy`** ✅ — private whitelisted switch on the narrowed
     sort union; cities facet uses a literal `ORDER BY name ASC, slug ASC`. No interpolation.
     Also confirmed: `count(*) OVER ()` empty-page fallback COUNT implemented (trap 3);
     facet uses the identical `PG_LIST_Q_PREDICATE` constant as the row query (trap 2);
     `!db.isEnabled()` returns a full empty envelope and does not throw.
  ```
  $ rtk proxy git diff --stat ced9597..HEAD
   .../unit/pg-admin-listings.service.test.ts         | 133 ++++++++++++
   .../modules/admin/pg-admin-properties.service.ts   | 229 ++++++++++++++++++---
   2 files changed, 335 insertions(+), 27 deletions(-)
  ```
- Deviations from plan: none. SQL implemented verbatim.
- Notes for next session (**important**):
  - **`pnpm typecheck` is 5/6 at this commit, not 6/6.** Single error:
    `admin.controller.ts(1250,7): TS2322: Type 'string | undefined' is not assignable to
type 'PgAdminListingStatusFilter'` — the old call site. Plan Step 7 predicts and sanctions
    this; **Task 4 resolves it.** Not a regression.
  - The unit tests mock `db.query`, so they validate **zero** SQL. The agent separately ran all
    five query shapes against real Postgres on :5433 — all execute, facets/summary return sane
    counts. That also proved the pg driver returns `starting_rent_paise` as a **string**
    (`"1200000"`), so the `Number()` mapping is load-bearing, not defensive. GATE A's curl is
    the real check that it arrives as a number on the wire.
  - `pg-admin.controller.integration.test.ts` (lines 37, 89) mocks the OLD `{items, total}`
    shape and asserts the old call signature. It passes today only because the service is
    mocked — Task 4 must update it.
  - The sanitizer's field is `page_size` (snake_case), not `pageSize`.

---

## Task 4 — Controller — PASS

- Agent: sonnet, effort low
- Commit: `065bd9a` "feat(admin-pg): controller runs sanitizer, returns Verified-PGs envelope"
- Tests: controller integration file **10 passed, 0 failed** (8 pre-existing updated to the new
  envelope shape + 2 new). `pnpm typecheck` back to **6/6 successful** — the sanctioned Task 3
  error is resolved.
- Raw evidence (orchestrator-verified):
  ```
  $ rtk proxy git diff --stat 732d3ef..HEAD
   .../pg-admin.controller.integration.test.ts        | 54 ++++++++++++++++++----
   apps/api/src/modules/admin/admin.controller.ts     | 26 +++++++----
   2 files changed, 63 insertions(+), 17 deletions(-)
  ```
  Route now takes `verification`, `sort`, `page_size` (renamed from `pageSize`) and pipes the raw
  query through `sanitizeAdminPgListingsParams` — no raw value reaches the service. Returns
  `ok(envelope)`, so the payload lands under `.data`. Class-level `@Roles("admin")` +
  `@UseGuards(AuthGuard, RolesGuard)` at `admin.controller.ts:59-61` confirmed intact.
- Deviations from plan: none.

---

# GATE A — API smoke — **PASS**

Run by the orchestrator against a live server (`pnpm dev:api`, `OTP_PROVIDER=mock`, DB up on :5433).
Admin token obtained as `+919999999903` via `POST /v1/auth/otp/send` → `POST /v1/auth/otp/verify`.

**Note on the OTP flow** (the orchestration doc understates it): `/auth/otp/send` takes
`{phone_e164, purpose}` — NOT `{phone}` — and `/auth/otp/verify` takes
`{challenge_id, otp_code}` — NOT `{phone, code}`. In mock mode the send response includes
`dev_otp` directly, so no DB lookup is needed.

### Envelope smoke

```
$ curl -s -H "Authorization: Bearer <token>" \
    'http://localhost:4000/v1/admin/pg/listings?verification=verified&page=1&page_size=25' | jq ...
{
  "total": 6666, "count": 25, "cities": 8,
  "summary": { "verified": 6666, "active": 6666, "cities": 8 },
  "page": 1, "page_size": 25,
  "filters": { "verification":"verified","status":"active","city":null,"q":null,"sort":"leads" },
  "sample": {
    "listing_id":"b0000000-0000-4000-8000-000000019998",
    "status":"active","verification_status":"verified",
    "starting_rent_paise": 1177400,
    "owner_phone_masked":"+91000***098",
    "cover_photo_url": null,
    "public_path":"/en/pg/lucknow/b0000000-0000-4000-8000-000000019998",
    "updated_at":"2026-06-21 11:39:13.602815+00"
  }
}
```

**Pass criteria — all met:**

- `starting_rent_paise` is a **number**, not a string — `jq '…|type'` → `number`. ✅
  (Task 3 confirmed the pg driver hands this back as `"1177400"`; the `Number()` mapping is
  doing real work.)
- `public_path` well-formed: `/en/pg/{city}/{id}`. ✅
- **No leaked keys.** Full key set across all 25 items:
  `analytics_cut city_slug cover_photo_url gender_policy leads_7d listing_id locality_slug
 owner_id owner_name owner_phone_masked pg_property_id property_name public_path
 starting_rent_paise status title updated_at verification_status`
  `jq` filter for `owner_phone` / `cover_blob` / `total` across every item → `[]`. ✅

### Extra live checks the orchestrator ran (the three documented traps)

- **Trap 2 — facet/row divergence:** `q=mahanagar&city=lucknow` → rows `total=409`;
  same `q` without city → `available_cities[lucknow].count = 409`. **Identical.** ✅
- **Trap 3 — empty page:** `page=999` → `{"total":6666,"count":0,"page":999}`. The fallback
  COUNT fires; it does NOT report `total=0`. ✅
- **ORDER BY whitelist:** all four sorts produce genuinely different first rows
  (`rent_desc` 1799900 / `rent_asc` 700500 / `leads` 1177400). Injection attempt
  `sort=id; DROP TABLE users--` clamps to `leads`. ✅
- **D2 statuses:** `draft`, `pending_review`, `archived` all pass through the filter;
  `rejected` correctly clamps to `active` (not surfaced in this tab). ✅

### Suite re-run (orchestrator, not delegated)

```
 Test Files  2 failed | 235 passed | 18 skipped (255)
      Tests  7 failed | 2163 passed | 91 skipped (2261)
```

vs **BASELINE 7 failed | 2150 passed | 91 skipped**.
The 7 failures are byte-identical to the baseline list (rent-agreement `e2e-dev-flow` ×3,
`rent-agreement-controller.smoke` ×4). **ZERO NEW FAILURES.** +13 net new passing tests.
`pnpm typecheck` → `Tasks: 6 successful, 6 total`.
Full log: `scratchpad/gateA-api-test.log`

---

## SESSION A COMPLETE — resume at Session B

Branch `feat/verified-pgs-admin-surface`, 4 commits `b2f9e3d`..`065bd9a` (Task 0 created the
branch without a commit, so 4 commits cover Tasks 0-4).

Working tree still carries only the three expected unrelated dirty files plus the uncommitted
coordination docs. Nothing from `admin-homes.*` / `homes/**` / `admin-home-url.ts` was touched.

**For Session B:**

- Use `rtk proxy git ...` for all git. Bare `git` lies in this repo.
- Start the DB with `docker start cribliv-pg-local` (:5433), NOT `docker compose up`.
- Web tasks 5+6 → one sonnet agent; Task 7 → its own sonnet agent, medium effort.
- launch.json: use **"API (NestJS)"** and **"Web (Next.js, alt port)"**. The entry named
  "Web (Next.js)" is broken (another machine's absolute path) — do not use or fix it.

---

## Session B — started 2026-07-22

## Task 5+6 — public-site URL helper + web client envelope — PASS

- Agent: sonnet, effort low (one agent for both, per orchestration)
- Commits: `9133918` "feat(web): shared public-site URL helper for admin share actions"
  and `146dc80` "feat(admin-pg): fetchAdminPgListings returns the list envelope"
- Tests: `public-site-url.test.ts` **6 passed, 0 failed**. Full web suite **1230 passed**
  across 218 files, 0 failed. `pnpm --filter @cribliv/web typecheck` exit 0.
- Raw evidence (orchestrator-verified, not agent-reported):
  ```
  $ rtk proxy git diff --stat 065bd9a..HEAD
   apps/web/components/admin/tabs/PgPropertiesTab.tsx |  2 +-
   apps/web/lib/__tests__/public-site-url.test.ts     | 79 ++++++++++++++++++++++
   apps/web/lib/admin-api.ts                          | 15 +++-
   apps/web/lib/public-site-url.ts                    | 46 +++++++++++++
   4 files changed, 138 insertions(+), 4 deletions(-)
  ```
  Orchestrator read the full diff against plan Tasks 5-6: **byte-for-byte match** on
  `public-site-url.ts` (apex `https://cribliv.com` fallback per D4, trailing-slash strip,
  clipboard → textarea fallback → `copy_failed` throw) and on the `fetchAdminPgListings`
  signature (`verification`, `sort`, `page_size`; returns `PgAdminListingsResponse`).
  The single-line `PgPropertiesTab.tsx` change (`setRows(res.items)`) is Task 6 Step 2 —
  mandated to restore compilation, full wiring is Task 7.
  `admin-home-url.ts` and `homes/**`: untouched (absent from the diff).
- Envelope-unwrap check: `apps/web/lib/api.ts:69` returns `payload.data as T`, so the
  controller's `ok(envelope)` arrives as the envelope itself — `res.items` is correct.
- Deviations from plan: none.
- Notes for next session: `.env.example` has **zero** `NEXT_PUBLIC_SITE_URL` entries today;
  Task 9 Step 1 adds it. Don't let Task 7 add it early.

---

## Task 7 — PG Listings tab rebuild — PASS

- Agent: sonnet, effort medium (own agent, per orchestration)
- Commit: `7db1086` "feat(admin-pg): Verified-PGs tab — filters/search/sort/pagination + copy/open"
- Tests: web suite **1230 passed / 218 files, 0 failed**; typecheck exit 0; lint clean on the
  changed file.
- Raw evidence (orchestrator-verified):
  ```
  $ rtk proxy git diff --stat 146dc80..HEAD
   apps/web/components/admin/tabs/PgPropertiesTab.tsx | 359 +++++++++++++++++----
   1 file changed, 293 insertions(+), 66 deletions(-)
  ```
  Single-file diff. Orchestrator read the whole component against the Task 7 brief:
  faithful. `StatusPill.tsx` untouched (`git status --porcelain` empty) and its existing
  `tone?: PillTone` prop is what the `failed` case uses — the brief mandated that line
  including its comment. Shareability computed server-side at
  `pg-admin-properties.service.ts:159` as `status === "active" && !!city_slug` — the exact
  spec rule; the component only null-checks `public_path`.
- Deviations from plan: **one**, accepted. `const rows = data?.items ?? []` was wrapped in
  `useMemo` because the brief's literal code makes `maxLeads`'s dep array trip
  `react-hooks/exhaustive-deps`. Pure lint fix, no behavior change.

---

# GATE B — browser verification — **PASS** (2 caveats, both honest)

Run by the orchestrator, not the agent. API on :4000 ("API (NestJS)"), web on :3100
("Web (Next.js, alt port)"), DB `cribliv-pg-local` :5433. Admin session via the OTP login UI.

**1. First request carries the exact default query string** ✅

```
GET /v1/admin/pg/listings?verification=verified&status=active&sort=leads&page=1&page_size=25 → 200
```

(Fires twice on mount — React 18 StrictMode double-effect in dev. Not a defect.)

**2. Debounce — exactly ONE request after 9 keystrokes** ✅
Typed `mahanagar` (9 chars) into the search box, waited 2s. Network shows one preflight +
**one** GET:

```
OPTIONS …?q=mahanagar&verification=verified&status=active&sort=leads&page=1&page_size=25 → 204
GET     …?q=mahanagar&verification=verified&status=active&sort=leads&page=1&page_size=25 → 200
```

Also confirmed two chip changes (verification→all, status→all) coalesce into a **single**
request via React batching.

**3. 375px layout** ✅ — measured, not eyeballed:

```
viewport 375 · documentElement.scrollWidth 375 → body does NOT scroll sideways
.admin-table-wrap: clientWidth 327, scrollWidth 1233, overflow-x auto → table scrolls INSIDE
```

Screenshot confirms the chip row wraps to two lines. D3 holds — no mobile card layout needed.

**4. Non-shareable row shows "Not publicly available"** ✅ _(with a data caveat)_
API for `verification=all&status=all` returns 2 of 25 items with `public_path: null`; the DOM
renders **exactly 2** "Not publicly available" cells and 23 Copy/Open pairs. `Open` href is
`https://cribliv.com/en/pg/…` — the D4 apex fallback.
⚠️ **Caveat:** the two rows are non-shareable because `city_slug IS NULL`, not because they
are drafts. **This DB has zero non-`active` pg_listings**, so the `status !== 'active'` arm is
unexercised by data. Both arms are the same one-line expression, so the branch is proven —
but the draft case specifically was not seen live.

**5. Console errors** ✅ _(with an environmental caveat)_
Zero errors originate from `PgPropertiesTab`. ⚠️ There ARE repeating
`next-auth ClientFetchError: Failed to fetch` errors, entirely inside next-auth's
`getSession`/`getCsrfToken` polling. **Cause: `.env.local` sets `NEXTAUTH_URL=http://localhost:3000`
while the alt-port dev server runs on :3100.** Proven environmental: the identical errors keep
firing on the **Verified Homes** tab, which this work never touched. Pre-existing, out of scope.

### Additional finding for Session C — `missing_projection` is NOT zero

The orchestrator ran Task 9 Step 4's psql query early:

```
 pg_total | missing_projection | drifted
    20039 |                 39 |       0
```

The brief calls a non-zero `missing_projection` a hard stop. **Interpretation: it is a local
test-DB artifact, not data drift.** All 39 orphan `pg_listings` were created 2026-07-21/22 —
i.e. by this work's own integration-test runs. All 20,000 seeded rows have projections.
`drifted` is 0. Session C should re-run this after a DB reset before reporting it as real.

---

---

## Owner change request (post-GATE-B) — icon-only public URL actions — DONE

- Implemented by the orchestrator directly (a ~20-line presentational change; spawning an
  agent would have cost more than the edit).
- Commit: `6df259b` "refactor(admin-pg): icon-only public URL actions in the PG listings table"
- **This overrides the plan's Task 7 text labels at the owner's explicit request.**
  `Copy link` → `Link2`, `Open` → `ExternalLink`, `Copied ✓` → `Check` (green),
  `Not publicly available` → muted `EyeOff` with `role="img"`.
- Used `lucide-react` + the pre-existing `.admin-btn--icon` (32×32) class — both already the
  admin convention (`AdminTopbar.tsx:52`, `FraudTab.tsx:178`, `admin.css:426`). No new CSS.
- Accessibility preserved: every icon keeps its `aria-label`, plus a `title` tooltip. Dropped
  the ad-hoc `minHeight: 40` in favour of the system's 32px — still above WCAG 2.5.8 AA (24px).
- Verified live by the orchestrator: 25 icon buttons render, zero "Copy link" text remains,
  the 2 non-shareable rows render the `EyeOff` (same 2/23 split as GATE B), and at 375px the
  body still does not scroll sideways (`documentElement.scrollWidth` 375). Table content width
  1233px → **1169px**.
- Tests after the change: **1230 passed / 218 files, 0 failed**; typecheck exit 0; zero lint
  warnings for the changed file.

### ⚠️ Two things Session C must adjust

1. **Task 8 (PG detail header copy/open) must use the SAME icon treatment**, or the detail
   header and the table will disagree. The plan's Task 8 text still says text labels.
2. **GATE C expects "10 commits on the branch". It will now be 11** (`6df259b` is the extra).
   Do not treat that as drift.

---

## SESSION B COMPLETE — resume at Session C

Branch `feat/verified-pgs-admin-surface`, 8 commits `b2f9e3d`..`6df259b`.
Working tree still carries only the three expected unrelated dirty files + coordination docs.

---

## Session C — started 2026-07-22

State re-derived from git at session start (git is the authority, not this log):
8 commits `b2f9e3d`..`6df259b` on `feat/verified-pgs-admin-surface`, working tree carrying
exactly the three expected dirty files + four untracked coordination docs. **Log and git agree.**
DB restarted with `docker start cribliv-pg-local` (:5433).

## Task 8 — PG detail header copy/open — PASS

- Agent: sonnet, effort low
- Commit: `bc63d0a` "feat(admin-pg): copy/open public URL in the listing detail header"
- Tests: web suite **1230 passed / 218 files, 0 failed** (agent-run, matches the Session B
  baseline exactly); `pnpm --filter @cribliv/web typecheck` **exit 0 — re-run by the
  orchestrator, not taken on trust**; lint clean for the changed file.
- Raw evidence (orchestrator read the full diff):
  ```
  $ rtk proxy git diff 6df259b..HEAD --stat
   .../admin/pg-properties/PgListingDetail.tsx        | 55 ++++++++++++++++++++++
   1 file changed, 55 insertions(+)
  ```
  Single file, insertions only, no deletions. Byte-for-byte match to the brief.
- **Deviation from the plan's Task 8 text — intentional, carried forward from Session B.**
  The plan specifies text labels (`Copy public link` / `Open public page` /
  `Not publicly available`). Session B's owner change request made the table icon-only, and
  the Session B log mandated Task 8 match it. Implemented as `Link2` / `Check` (green) /
  `ExternalLink` / muted `EyeOff`, labels preserved in `aria-label` + `title`.
- **CSS trap found by the orchestrator during brief authoring (would have shipped broken).**
  In `admin.css`, `.admin-btn--icon` is line 426 but `.admin-chip` is line 434 — equal
  specificity, so source order wins and `.admin-chip`'s `height:28px; padding:0 12px` silently
  overrides the icon sizing. The plan's Task 8 markup uses `admin-chip admin-btn--sm`, so the
  naive icon port would have rendered wrong. Brief mandated
  `admin-btn admin-btn--ghost admin-btn--sm admin-btn--icon` (→ 32×26) instead. Icons are
  `size={14}` here vs `15` in the table, matching the header's smaller scale.
- Notes: 26px tap height is above the WCAG 2.5.8 AA 24px floor and matches the adjacent
  "Copy listing ID" chip. Task 9 still owns `.env.example`; Task 8 did not touch it.
- ⚠️ **Not browser-verified.** Plan Task 8 Step 5 (open an active PG / a draft PG at desktop
  - 375px) was NOT run — the owner stopped browser verification. Code is a transcription of
    the pattern proven live at GATE B, and typecheck/lint/tests are clean, but the rendered
    header has not been looked at.

---

## Task 9 — Docs + full verification — PASS (with concerns)

- Agent: opus, effort high
- Commit: `bb26790` "docs(env): document NEXT_PUBLIC_SITE_URL for public share URLs"
  (1 file, 4 insertions — `.env.example` only)
- Suites (agent-run, raw):
  ```
  API:  Test Files  2 failed | 235 passed | 18 skipped (255)
              Tests  7 failed | 2163 passed | 91 skipped (2261)
  WEB:  Test Files  218 passed (218)
              Tests  1230 passed (1230)
  ```
  vs BASELINE API 7 failed | 2150 passed | 91 skipped, WEB 1230 passed.
  **ZERO NEW FAILURES.** The agent verified the 7 failures by _cause_ as well as filename —
  all `expected 201, got 500` on `POST /v1/rent-agreement/draft`. +13 net new API passes.
- Full report: `scratchpad/task-9-report.md`

---

# GATE C — final — **PASS on everything runnable; browser leg NOT run**

Run by the orchestrator.

**1. Verified Homes untouched** ✅ — both commands printed nothing:

```
$ rtk proxy git diff --stat master -- admin-homes.service.ts admin-homes.params.ts \
    admin-homes.controller.ts apps/web/components/admin/homes/ apps/web/lib/admin-home-url.ts
$ rtk proxy git diff --stat master -- apps/web/components/admin/primitives/StatusPill.tsx
```

**2. Commit count = 10** ✅ `b2f9e3d`..`bb26790`. (The Session B note predicting 11 was
arithmetic drift — 9 planned commits, Task 0 produced none, +1 owner icon commit = 10.)

**3. lint + typecheck** ✅ re-run by the orchestrator: `pnpm lint` **4 successful, 4 total**;
`pnpm typecheck` **6 successful, 6 total** (= baseline). Grepping the full lint output for
`PgPropertiesTab|PgListingDetail|public-site-url|admin-pg|error` → **no matches**; the only
warnings are pre-existing `react-hooks/exhaustive-deps` in the untouched `search-hero.tsx`.
⚠️ **rtk's lint filter reports a false exit 2** (it fails to parse ESLint JSON and surfaces an
`apps/api/dist` config error; `apps/api`'s lint script is a placeholder with no ESLint config).
`rtk proxy pnpm lint` is the truth — same tooling-defect class as bare `git`. Use the proxy.

**4. `missing_projection` — 39, NOT 0. Orchestrator-verified, escalated to the owner.**

```
 pg_total | missing_projection | drifted
    20039 |                 39 |       0
```

Independently confirmed (not taken from the agent): **zero orphans predate 2026-07-18**
(earliest `2026-07-21 12:01:05`), every orphan is a test fixture by title ("Unowned listing",
"Missing idempotency listing", "Property-less listing", …), and all are `unverified` so they
never enter the `verification=verified` default view. `drifted` is 0.
The agent's causal account closes the arithmetic: they come from
`manage-request.integration.test.ts`, whose `afterAll` deletes users and cascades via
`pg_listings.operator_user_id ON DELETE CASCADE` — so only runs killed before teardown leave
residue (6 operator users × 13 listings/run ≈ 3 interrupted runs = 39).
The before/after probe across a full API suite showed **39 → 39**: a completed suite leaks
nothing. **Assessment: local dev-DB residue, not data drift.** Per the brief's letter it is
still a hard stop, so it is the owner's call, not the orchestrator's. Nothing was mutated.

**5. Browser leg — NOT RUN.** The owner stopped browser verification before it started.
Outstanding: Task 8 Step 5 (detail header, desktop + 375px, active vs draft PG) and Task 9
Step 5's visual confirmation that Verified Homes still lists/filters/copies. Note the _code_
regression proof for homes is stronger than the visual one and it passed (empty diff).
GATE A already curl-smoked the API and GATE B already browser-verified the table.

### Open follow-up recorded by Task 9 (not a regression)

No test file exists for `PgPropertiesTab.tsx` or `PgListingDetail.tsx` — the two surfaces this
feature rebuilt — although sibling tabs (`ListingReviewTab`, `ManagePgRequestsTab`,
`VerificationTab`) all have one. So "web 1230/218, unchanged from baseline" means no new UI
assertions ran; it is weak evidence about _this_ feature. The API side does carry new tests.

---

## SESSION C COMPLETE — all 10 tasks committed, branch ready for owner review

No PR opened, no merge, per the brief. Working tree still carries only the three expected
unrelated dirty files + the four untracked coordination docs.
