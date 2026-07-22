# Executor Brief — Verified PGs Admin Surface

**Plan:** `docs/superpowers/plans/2026-07-18-verified-pgs-admin-surface.md` (v2, re-verified 2026-07-22)
**Repo:** `/Users/satviksarthak/Developer/Cribliv_v2_final`
**Shape:** Task 0 (branch setup) + 9 sequential tasks, 9 commits. API (NestJS) + web (Next.js 14) + shared-types. **No DB migration.**

## Branch — do this first

The repo sits on `master`. **Task 0 is mandatory**: create `feat/verified-pgs-admin-surface` before touching a file, or nine commits land on the default branch. Finish on the branch; do not open a PR or merge — integration is the owner's call.

Two files (`migration-0034.integration.test.ts`, `migration-0031-pg-operator.integration.test.ts`) may already be dirty. They are unrelated in-progress work: leave them, and **never use `git add .` or `git add -A`** — every commit in the plan uses explicit paths.

---

## The one-paragraph version

The admin **PG Listings** tab (`PgPropertiesTab`) is a flat, unpaginated list with two filters. Verified Homes — the sibling surface — already has server-side filtering, faceted city counts, sort, pagination, cover thumbnails, and one-click copy/open of the public URL. This work brings PG to that bar by turning `GET /admin/pg/listings` into an envelope response and rebuilding the tab against it, plus copy/open buttons in the listing detail header. Copy the _pattern_ from homes; import nothing from it.

---

## Four decisions already made — implement them, don't revisit

**D1 — "Verified" means `listings.verification_status`, not `pg_listings.verification_status`.**
The PG head column has **zero readers** in `apps/api` — it's written on insert, by the V1 import, and by review approval, and consulted by nothing. Every real consumer (search, map, admin-homes, pg-score, pg-search) reads the `listings` projection, and `pg-listing.service.ts:815` says so in a comment. So the service does `LEFT JOIN listings l ON l.id = pl.id` and filters on `COALESCE(l.verification_status::text, pl.verification_status::text)`; the COALESCE covers only a missing projection row. This is conformance to the existing convention, not a workaround — don't "improve" it by syncing the head.
_Side effect:_ the `leads` lateral must alias as `lead`, not `l` — `l` now belongs to the projection join.

**D2 — Status filter keeps `draft` and `pending_review`.**
Six options: `all | active | paused | pending_review | draft | archived`, defaulting to `active`. This tab is the only PG-listing management surface in admin, so dropping draft/pending would strand those listings.

**D3 — Keep the existing `DataTable`; no mobile card layout.**
`DataTable` already scrolls inside `.admin-table-wrap`. Homes' `useIsMobile` is local to `HomesInventory` and not shared. Don't port it.

**D4 — One shared helper `apps/web/lib/public-site-url.ts`, fallback `https://cribliv.com`.**
33 of 34 `NEXT_PUBLIC_SITE_URL` call sites use the apex fallback — including the PG detail page, which builds its own canonical from it. A `www` fallback would make the copied admin link disagree with the target page's canonical tag. `admin-home-url.ts` stays byte-for-byte untouched (4 test files depend on it).

---

## Three traps that will bite you

1. **SQL param numbering.** Three queries share predicate constants. **Every query reserves `$1` for `q`** so `PG_LIST_Q_PREDICATE` is reusable verbatim. Page query: `$1` q, `$2` city, `$3` verification, `$4` status, `$5` limit, `$6` offset. Cities: `$1` q, `$2` verification, `$3` status. Summary: `$1` q, `$2` city. Renumbering silently produces a wrong filter that no test will catch unless you keep the constants intact.

2. **Facet/row divergence.** The city facet must use the **identical** `q` predicate as the row query. A narrower facet predicate makes city counts disagree with visible rows whenever someone searches by phone or locality.

3. **`count(*) OVER ()` returns nothing on an empty page.** Page 7 of a 3-page result yields zero rows and therefore zero total → "Page 7 of 1 · 0 total" with both buttons disabled. The plan specifies an explicit fallback `COUNT` when `rows.length === 0 && page > 1`.

---

## Guardrails

**Never touch:** `admin-homes.*`, `apps/web/components/admin/homes/**`, `admin-home-url.ts`, `StatusPill.tsx`, the `/admin/review/*` verification endpoints, `pg_listings`/`pg_details` schema.
**Security invariants:** endpoint stays `@Roles("admin")`; raw phone may be matched in `q` but never SELECTed; every value parameterized; `ORDER BY` only from the whitelisted switch.
**Preserve:** `PgAdminPropertiesService` returns an empty envelope (never throws) when `!db.isEnabled()`.

## Environment

```bash
export PATH="$(ls -d /opt/homebrew/opt/node@22/bin):$PATH"
export DATABASE_URL="postgres://postgres:postgres@127.0.0.1:5433/cribliv_v2"   # local :5433 — never Azure
```

- Both `apps/api` and `apps/web` run `vitest run` for `test` (Playwright is `test:e2e`).
- Browser verification: use launch.json entries **"API (NestJS)"** and **"Web (Next.js, alt port)"**. The entry named "Web (Next.js)" is broken — it points at another machine's absolute path. Don't fix it here.
- **13 pre-existing API test failures** are expected (rent-agreement FK, notification_log teardown, migration-0034, stale 0031). Record the baseline first; the deliverable is **zero new** failures.

## Deployment reality

`cribliv.com` and `www.cribliv.com` both currently serve the **V1** site; `/en/pg` 404s on both. V2 isn't deployed to either host. So "Open public page" is verifiable only against localhost. Assert the **path** is well-formed; don't assert the host, and don't treat the prod 404 as a bug.

## Definition of done

Task 0 branch created; all 9 tasks committed on it (no PR, no merge — the owner integrates); `pnpm build && pnpm lint && pnpm typecheck` green; zero new test failures vs. baseline; desktop + 375px screenshots of the tab and the detail header; `git diff --stat master -- <homes paths>` prints nothing.

From the Task 9 Step 4 psql query, report both counts. **`missing_projection` must be 0** — a non-zero value means the COALESCE fallback is load-bearing and those listings are also invisible to search/maps, so stop and report. **`drifted` is informational only** — the head column has no readers, so any value is expected and harmless.
