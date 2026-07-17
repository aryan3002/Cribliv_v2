# Handoff and Prompt - PG Map Location Parity Slice 3

Self-contained handoff for a fresh Codex chat to execute **Slice 3 - Browse preview (frontend)** from the lean no-migration PG map-location parity plan.

## Current State

- Repo: `/Users/satviksarthak/Developer/Cribliv_v2_final`
- Branch: `feat/pg-map-location-parity`
- Current HEAD before Slice 3: `e5168bd feat(pg): PG search cards carry coordinates`
- Completed and committed:
  - Task 1: `1a1c1c9 feat(pg): read-time PG map point resolver with exact/locality provenance`
  - Task 2: `b8dd06b feat(pg): expose location_point on public PG detail`
  - Task 3: `e5168bd feat(pg): PG search cards carry coordinates`
- Existing unrelated dirty docs were present before this work and must remain untouched:
  - `docs/superpowers/plans/2026-07-09-pg-commercial-flow-pricing.md`
  - `docs/superpowers/plans/2026-07-09-pg-search-live-suggestions.md`
  - `docs/superpowers/plans/2026-07-11-pg-map-location-parity-EXECUTION-PROMPT.md`
  - `docs/superpowers/plans/2026-07-11-pg-map-location-parity.md`
  - `docs/superpowers/specs/2026-07-11-pg-map-location-parity-design.md`
- `.superpowers/sdd/progress.md` has dated entries for PG map parity Tasks 1-3.
- Focused API verification is green but emits the repo's existing Vite CJS deprecation warning.

## Read First

1. This file.
2. `docs/superpowers/plans/2026-07-11-pg-map-location-parity.md`
   - Read the header, Global Constraints, and Slice 3 Tasks 4-6.
3. `docs/superpowers/specs/2026-07-11-pg-map-location-parity-design.md`
   - Section 0a is authoritative.
   - Later migration/provenance sections are rejected-alternative context and must not govern implementation.
4. `/Users/satviksarthak/.codex/RTK.md`

## Hard Constraints

- Use `superpowers:subagent-driven-development`.
- One fresh subagent per task: Task 4, then Task 5, then Task 6.
- Strict TDD for each task: write failing test, run RED, implement minimally, run GREEN, commit.
- Review each task with a fresh reviewer before moving to the next task.
- Stop and report after each task if the user asks for per-task review checkpoints.
- Prefix shell commands with `rtk`; for real test output use `rtk proxy pnpm ...`.
- Do not create migrations.
- Do not modify `projectGeo()`.
- Do not change `has_exact_geo`.
- Do not modify `apps/web/app/[locale]/search/page.tsx`.
- Do not change `SearchResultsMap.tsx` behavior. Only add `export` to `SearchMapListing` or `SearchResultsMap` if needed for type/component import.
- City fallback remains web-side only via `cityCentroid()` and is not part of Slice 3.
- Preserve API dual-mode behavior; no coordinate fabrication.
- Do not stage, unstage, delete, or commit unrelated dirty docs.
- Path-limit every commit because unrelated files are already staged/untracked.

## Slice 3 Scope

Implement only:

- Task 4: Web types + `pgCardToSearchMapListing`
- Task 5: `/pg` real `SearchResultsMap` preview
- Task 6: `/pg/[city]` real preview when inventory exists

Do not start Slice 4 in this handoff.

## Per-Task Execution Notes

### Task 4

Files:

- `apps/web/lib/pg-public-api.ts`
- `apps/web/lib/pg-map-adapter.ts`
- `apps/web/lib/__tests__/pg-map-adapter.test.ts`
- `apps/web/app/[locale]/search/SearchResultsMap.tsx` only if export-only change is required

Before writing the test:

- Open `apps/web/lib/pg-public-api.ts` and confirm current `PgCard` / `PgPublicDetail`.
- Open `apps/web/app/[locale]/search/SearchResultsMap.tsx` and confirm whether `SearchMapListing` and `SearchResultsMap` are exported.

Command:

```bash
rtk proxy pnpm --filter @cribliv/web test -- pg-map-adapter
```

Commit:

```bash
rtk git add apps/web/lib/pg-public-api.ts apps/web/lib/pg-map-adapter.ts apps/web/lib/__tests__/pg-map-adapter.test.ts apps/web/app/[locale]/search/SearchResultsMap.tsx
rtk git commit --only apps/web/lib/pg-public-api.ts apps/web/lib/pg-map-adapter.ts apps/web/lib/__tests__/pg-map-adapter.test.ts apps/web/app/[locale]/search/SearchResultsMap.tsx -m "feat(web): PG map types + card->SearchMapListing adapter"
```

If zsh expands `[locale]`, quote that path.

### Task 5

Files:

- `apps/web/app/[locale]/pg/page.tsx`
- `apps/web/app/[locale]/pg/__tests__/pg-page.test.tsx`

Before writing the test:

- Open the page and confirm the static aside labels still include `PG · ₹9.5k`, `Food`, or `Verified PG`.
- Confirm the page's existing query helper/import style before adding `buildSearchQuery`.

Command:

```bash
rtk proxy pnpm --filter @cribliv/web test -- pg-page
```

Commit:

```bash
rtk git add "apps/web/app/[locale]/pg/page.tsx" "apps/web/app/[locale]/pg/__tests__/pg-page.test.tsx"
rtk git commit --only "apps/web/app/[locale]/pg/page.tsx" "apps/web/app/[locale]/pg/__tests__/pg-page.test.tsx" -m "feat(web): real SearchResultsMap preview on /pg"
```

### Task 6

Files:

- `apps/web/app/[locale]/pg/[city]/page.tsx`
- `apps/web/app/[locale]/pg/[city]/__tests__/pg-city.test.tsx`

Before writing the test:

- Open the current city page and existing `pg-city.test.tsx`.
- Confirm the existing `vi.mock` style for `pg-public-api`.
- Keep the decorative hero blob; do not add fake pins when there is no inventory.

Command:

```bash
rtk proxy pnpm --filter @cribliv/web test -- pg-city
```

Commit:

```bash
rtk git add "apps/web/app/[locale]/pg/[city]/page.tsx" "apps/web/app/[locale]/pg/[city]/__tests__/pg-city.test.tsx"
rtk git commit --only "apps/web/app/[locale]/pg/[city]/page.tsx" "apps/web/app/[locale]/pg/[city]/__tests__/pg-city.test.tsx" -m "feat(web): PG city page shows live preview map when inventory exists"
```

## Slice 3 Completion Gate

After Tasks 4-6 are individually reviewed and committed, run:

```bash
rtk proxy pnpm --filter @cribliv/web test -- pg-map-adapter pg-page pg-city
```

If this pattern selection does not run all three intended files, run the three focused commands separately.

Append a dated Slice 3 entry to `.superpowers/sdd/progress.md`, including commit range and any minor findings.

## Handoff Prompt To Paste

```text
You are continuing PG Map Location Parity in `/Users/satviksarthak/Developer/Cribliv_v2_final`.

Use `docs/superpowers/HANDOFF-2026-07-11-pg-map-slice3.md` as the operational handoff. Then read `docs/superpowers/plans/2026-07-11-pg-map-location-parity.md` and execute only Slice 3, Tasks 4-6.

Design of record: `docs/superpowers/specs/2026-07-11-pg-map-location-parity-design.md` section 0a. This is the Lean no-migration version.

Current branch is `feat/pg-map-location-parity`; backend Tasks 1-3 are complete through commit `e5168bd`. Do not redo them.

Hard constraints: no migration, no `projectGeo()` change, no `has_exact_geo` change, do not modify `apps/web/app/[locale]/search/page.tsx`, and do not change `SearchResultsMap.tsx` behavior except export-only changes if required.

Use `superpowers:subagent-driven-development`: one fresh subagent per task, strict TDD, run RED before implementation, run GREEN after, commit each task, review each task before moving on. Prefix shell commands with `rtk`; use `rtk proxy pnpm ...` for test commands so real output is visible.

Path-limit commits because unrelated docs are already staged/untracked. Leave those docs untouched.

Start with Task 4. Stop after Task 6 with a Slice 3 completion report and do not start Slice 4 unless explicitly asked.
```
