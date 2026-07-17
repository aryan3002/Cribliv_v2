# Execution Prompt — PG Map Location Parity

Copy the block below to launch execution (subagent-driven, one task per subagent).

---

You are implementing the plan at `docs/superpowers/plans/2026-07-11-pg-map-location-parity.md`
(the **Lean — no migration** version). Design of record:
`docs/superpowers/specs/2026-07-11-pg-map-location-parity-design.md` (§0a is authoritative).

Repo: `/Users/satviksarthak/Developer/Cribliv_v2_final` (Turborepo + pnpm; NestJS API,
Next.js 14 web). Work on a feature branch off `master`, e.g.
`feat/pg-map-location-parity`.

## How to execute

- Use **superpowers:subagent-driven-development**: one fresh subagent per task,
  strict TDD (write the failing test → run it RED → minimal implementation →
  run GREEN → commit), review between tasks. Do tasks in order 1 → 9.
- Every code step in the plan has literal code — use it. Do not invent APIs.
- Before writing each test, open the target file and confirm the exact symbol
  names/line numbers (they drift); the plan calls these out (e.g. confirm
  `PgListingService.loadListingDetail` and its constructor arity).
- Run the exact command in each step and paste the real output. A test must be
  seen RED before it is made GREEN. Never claim green without the run.

## Hard constraints (do not violate)

- **No database migration. No `projectGeo()` change. No `has_exact_geo` change.**
  If you think you need any of these, STOP and report — the design deliberately
  avoids them.
- Do **not** modify `apps/web/app/[locale]/search/page.tsx` (stays flat/house-only,
  keeps redirecting `listing_type=pg` → `/pg`).
- Do **not** change `SearchResultsMap.tsx` behavior — it is already PG-aware. The
  only allowed edit is adding `export` to its `SearchMapListing` interface / the
  component if they are not already exported.
- Locality-vs-exact detection is `abs(ll.lat - loc.lat) < 1e-6 && abs(ll.lng - loc.lng) < 1e-6`
  → `'locality'`, else `'exact'` (see `resolvePgMapPoint`, Task 1).
- City fallback is web-side only (`cityCentroid()` from `apps/web/lib/city-bboxes.ts`).
- Preserve API dual-mode: PG paths return empty when `DatabaseService.isEnabled()`
  is false; never fabricate coordinates.
- Match each file's existing style, imports, and test patterns
  (API unit: fake `{ isEnabled:()=>true, query: vi.fn() }`; web: `vi.mock` the
  `pg-public-api` module; no Google Maps key in tests → assert the fallback UI).

## Definition of done

- Tasks 1–8 committed, each with its own RED→GREEN evidence in the task report.
- Task 9 regression gate green:
  - `pnpm typecheck`
  - `pnpm --filter @cribliv/api test -- pg`
  - `pnpm --filter @cribliv/web test -- pg`
  - `pnpm --filter @cribliv/api test -- map-search && pnpm --filter @cribliv/web test -- map-page criblmap`
- No changes outside the plan's file list. Report anything that surprised you
  (renamed symbols, extra ctor deps, missing exports) instead of guessing.

## Manual verification after green (report back, don't ask me to check)

- `/en/pg?city=lucknow` renders the real map preview (no `PG · ₹9.5k` fake pins)
  and an "Open full CriblMap" link containing `listing_type=pg`.
- A PG detail page with an operator pin shows an "Exact location" map; one without
  shows "Approximate area"; a no-locality one shows "City area"; deep-link opens
  `/en/map?...&listing_type=pg&lat=...&lng=...&zoom=...&listing=...`.

Start with Task 1. Report after each task and wait for review before the next.

---
