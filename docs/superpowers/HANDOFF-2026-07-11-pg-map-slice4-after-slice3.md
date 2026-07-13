# Handoff and Prompt - PG Map Location Parity Slice 4

Self-contained handoff for a fresh Codex chat to execute **Slice 4 - Detail map (frontend)** from the lean no-migration PG map-location parity plan.

Use this file **only after Slice 3 is complete**.

## Required Precondition

Before starting Slice 4, verify all of the following:

- Branch is `feat/pg-map-location-parity`.
- Tasks 1-3 are complete through:
  - `1a1c1c9 feat(pg): read-time PG map point resolver with exact/locality provenance`
  - `b8dd06b feat(pg): expose location_point on public PG detail`
  - `e5168bd feat(pg): PG search cards carry coordinates`
- Slice 3 Tasks 4-6 are complete, committed, and task-reviewed.
- `.superpowers/sdd/progress.md` contains dated PG map parity entries for Tasks 4-6.
- `apps/web/lib/pg-public-api.ts` exposes `PgLocationSource`, `PgMapPoint`, `PgCard.lat`, `PgCard.lng`, and `PgPublicDetail.location_point`.
- `apps/web/lib/pg-map-adapter.ts` exists and exports `pgCardToSearchMapListing`.
- `/pg` and `/pg/[city]` are already wired to `SearchResultsMap`.

If any precondition is false, stop and complete/review Slice 3 first.

## Read First

1. This file.
2. `docs/superpowers/plans/2026-07-11-pg-map-location-parity.md`
   - Read the header, Global Constraints, and Slice 4 Tasks 7-8.
3. `docs/superpowers/specs/2026-07-11-pg-map-location-parity-design.md`
   - Section 0a is authoritative.
   - Later migration/provenance sections are rejected-alternative context and must not govern implementation.
4. `/Users/satviksarthak/.codex/RTK.md`

## Hard Constraints

- Use `superpowers:subagent-driven-development`.
- One fresh subagent per task: Task 7, then Task 8.
- Strict TDD for each task: write failing test, run RED, implement minimally, run GREEN, commit.
- Review each task with a fresh reviewer before moving to the next task.
- Prefix shell commands with `rtk`; for real test output use `rtk proxy pnpm ...`.
- Do not create migrations.
- Do not modify `projectGeo()`.
- Do not change `has_exact_geo`.
- Do not modify `apps/web/app/[locale]/search/page.tsx`.
- Do not change `SearchResultsMap.tsx` behavior.
- City fallback is web-side only via `cityCentroid()` from `apps/web/lib/city-bboxes.ts`.
- Tests run without a Google Maps key; assert labels, fallback UI, and CriblMap links.
- Do not stage, unstage, delete, or commit unrelated dirty docs.
- Path-limit every commit because unrelated files may already be staged/untracked.

## Slice 4 Scope

Implement only:

- Task 7: `PgDetailLocationMap` with provenance labels, city fallback, and CriblMap deep link
- Task 8: mount the map in `PgDetailClient`

Do not run Task 9 full regression gate unless explicitly asked after Slice 4 review.

## Per-Task Execution Notes

### Task 7

Files:

- `apps/web/components/pg/PgDetailLocationMap.tsx`
- `apps/web/components/pg/__tests__/PgDetailLocationMap.test.tsx`
- `apps/web/app/globals.css`

Before writing the test:

- Open `apps/web/lib/pg-public-api.ts` and confirm `PgMapPoint` exists from Task 4.
- Open `apps/web/lib/city-bboxes.ts` and confirm `cityCentroid`.
- Open `apps/web/lib/google-maps.ts` and `apps/web/app/[locale]/search/SearchResultsMap.tsx` to mirror loader/init style.
- Open `apps/web/app/globals.css` near existing tenant map styles and add only minimal `.pg-detail-map*` styles.

Command:

```bash
rtk proxy pnpm --filter @cribliv/web test -- PgDetailLocationMap
```

Commit:

```bash
rtk git add apps/web/components/pg/PgDetailLocationMap.tsx "apps/web/components/pg/__tests__/PgDetailLocationMap.test.tsx" apps/web/app/globals.css
rtk git commit --only apps/web/components/pg/PgDetailLocationMap.tsx "apps/web/components/pg/__tests__/PgDetailLocationMap.test.tsx" apps/web/app/globals.css -m "feat(web): PgDetailLocationMap with provenance labels + city fallback + CriblMap deep-link"
```

### Task 8

Files:

- `apps/web/components/pg/PgDetailClient.tsx`
- Existing `PgDetailClient` test file; open live tree to find the exact path before editing.

Before writing the test:

- Open `apps/web/components/pg/PgDetailClient.tsx` and confirm the Location `ld-section` location.
- Find the existing `PgDetailClient` test with `rtk rg -n "PgDetailClient|location_point|Location" apps/web`.
- Confirm the test fixture shape includes, or can be extended with, `location_point`.

Command:

```bash
rtk proxy pnpm --filter @cribliv/web test -- PgDetailClient
```

Commit:

```bash
rtk git add apps/web/components/pg/PgDetailClient.tsx <exact PgDetailClient test path>
rtk git commit --only apps/web/components/pg/PgDetailClient.tsx <exact PgDetailClient test path> -m "feat(web): mount location map in PG detail Location section"
```

Replace `<exact PgDetailClient test path>` with the live test path found before editing.

## Slice 4 Completion Gate

After Tasks 7-8 are individually reviewed and committed, run:

```bash
rtk proxy pnpm --filter @cribliv/web test -- PgDetailLocationMap PgDetailClient
```

If this pattern selection does not run both intended files, run the two focused commands separately.

Append a dated Slice 4 entry to `.superpowers/sdd/progress.md`, including commit range and any minor findings.

## Handoff Prompt To Paste

```text
You are continuing PG Map Location Parity in `/Users/satviksarthak/Developer/Cribliv_v2_final`.

Use `docs/superpowers/HANDOFF-2026-07-11-pg-map-slice4-after-slice3.md` as the operational handoff. Then read `docs/superpowers/plans/2026-07-11-pg-map-location-parity.md` and execute only Slice 4, Tasks 7-8.

Design of record: `docs/superpowers/specs/2026-07-11-pg-map-location-parity-design.md` section 0a. This is the Lean no-migration version.

Start only if Slice 3 Tasks 4-6 are already committed and reviewed. If Slice 3 is not complete, stop and report that prerequisite instead of starting Slice 4.

Hard constraints: no migration, no `projectGeo()` change, no `has_exact_geo` change, do not modify `apps/web/app/[locale]/search/page.tsx`, do not change `SearchResultsMap.tsx` behavior, and keep city fallback web-side via `cityCentroid()`.

Use `superpowers:subagent-driven-development`: one fresh subagent per task, strict TDD, run RED before implementation, run GREEN after, commit each task, review each task before moving on. Prefix shell commands with `rtk`; use `rtk proxy pnpm ...` for test commands so real output is visible.

Path-limit commits because unrelated docs may be staged/untracked. Leave unrelated docs untouched.

Start with Task 7. Stop after Task 8 with a Slice 4 completion report and do not run Task 9 unless explicitly asked.
```
