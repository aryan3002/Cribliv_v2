# Phase 1a — backend foundation (16 tasks)

**Plan:** `docs/superpowers/plans/2026-09-17-pg-rent-slice1a-backend-foundation.md`
**Branch:** `feat/pg-rent-slice1a-backend-foundation` off `feat/pg-rent` (slice 0 merged)
**Delivers:** migration 0072, shared types, the `pg-rent` module skeleton, pure period/money math, settings (enable with preview, patch, pause/resume, transfer hook), the invoice engine (rent periods + deposits), the hourly sweep. No payments yet.

## Pre-flight specifics

- Ledger prefix: `RENT-1a`.
- `psql … "SELECT filename FROM schema_migrations ORDER BY id DESC LIMIT 1"` must print `0071_blog_post_views.sql` before Task 1 and `0072_pg_rent_collection.sql` after it.
- Conflict scan rows to check first:
  - Task 1 (schema) ↔ Task 9 (`RentSettingsRow`) ↔ Task 10 (`SETTINGS_COLUMNS`): every column in the SQL must appear in the row type and the select list — including `enabled_on`, `pause_reason`, and the absence of `next_*_seq` (they live in `pg_rent_counters`).
  - Task 1 ↔ Task 13 (`INVOICE_SELECT`, `RentInvoiceRow`): `reprorate_suggestion`, `settled_on`, `late_fee_eligible` all present.
  - Task 2 shared types ↔ Task 9/13 mappers: every `_inr` field has a source column.
  - Task 5 `Period/PeriodSpec/DueSpec` ↔ Task 6 (`rent-window`, `rent-proration`) ↔ Task 12 engine — same names.
  - Task 11 `applyUnallocatedCredit(client, invoiceId, actor)` ↔ Task 12 (called twice).
  - Task 12 `generateInvoicesForProperty(propertyId, today, actor?, opts?)` ↔ Task 13 controller ↔ Task 15 sweep.
  - Task 14 constructor edits in `pg-bed-assignment.service.ts` and `admin-pg-transfer.service.ts` use `@Optional()` so slice-0 tests that construct the services by hand keep compiling.
- Task 8's fixture literals were verified against the migrations (see the brief's note); do not let an implementer "fix" them to something else.

## Routing

| Task                                              | Implementer | Reviewer     | Why                                                                                                                                                                   |
| ------------------------------------------------- | ----------- | ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1 — migration 0072 + schema test                  | Sonnet      | **Opus**     | The schema IS the data model; every later slice hangs off it. Complete SQL in the brief, but the rollback symmetry and CHECK constraints deserve the strongest review |
| 2 — flag + shared types                           | Haiku 4.5   | Sonnet       | Transcription                                                                                                                                                         |
| 3 — money helpers                                 | Haiku 4.5   | Sonnet       | Pure, tests given                                                                                                                                                     |
| 4 — date arithmetic                               | Haiku 4.5   | Sonnet       | Pure, tests given                                                                                                                                                     |
| 5 — period math                                   | Sonnet      | **Opus**     | Pure but load-bearing: floor rule (§19 #48), anchor clamping, arrears due dates. A wrong literal here silently mis-bills every tenant                                 |
| 6 — window / proration / status                   | Sonnet      | Opus         | Same reason: invariant 4 equality, status-aware window (§19 #2, #37)                                                                                                  |
| 7 — module skeleton, guards, events               | Haiku 4.5   | Sonnet       | Glue                                                                                                                                                                  |
| 8 — fixtures + invariant checker                  | Sonnet      | Opus         | The invariant checker is the net for every later slice; a weak assertion here hides bugs forever                                                                      |
| 9 — settings DTO                                  | Haiku 4.5   | Sonnet       | zod transcription; the driver-note branch is the only judgment                                                                                                        |
| 10 — settings service                             | Sonnet      | Opus         | Transactions, optimistic concurrency, transfer hook (D20)                                                                                                             |
| 11 — allocation service (credit auto-apply)       | Sonnet      | **Opus**     | First code that writes allocations and `amount_paid_paise`                                                                                                            |
| 12 — invoice engine                               | Sonnet      | **Opus**     | The engine. Largest brief (776 lines); complete code, but the tests encode §11.1 fixtures                                                                             |
| 13 — invoice reads, tenant overrides, controllers | Sonnet      | Sonnet       | Multi-file integration, no money mutation beyond `monthly_rent_paise`                                                                                                 |
| 14 — hooks into pg-operations and admin           | Sonnet      | Opus         | Touches two live modules; the transfer hook runs inside an admin transaction                                                                                          |
| 15 — worker sweep                                 | Haiku 4.5   | Sonnet       | Wiring with a precedent to copy                                                                                                                                       |
| 16 — verification + PR                            | Sonnet      | Opus (final) |                                                                                                                                                                       |

## Dispatch prompts

### Task 1

```
model: sonnet
description: "Implement Task 1: migration 0072 and schema test"
prompt: |
  You are implementing Task 1 of a 16-task plan that builds the backend of PG rent
  collection. This task is the schema: ten tables, sixteen enums, four assignment columns.

  Read your task brief first — its SQL is the exact migration to write, verbatim:
  <workspace>/task-1-brief.md

  ## Context
  Every later task, and two further slices, hang off these column names. The plan's
  self-review already cross-checked them against the TypeScript row types in Tasks 9
  and 13, so do not rename anything. Conventions come from 0062/0063 (idempotent DO
  blocks, IF NOT EXISTS, trigger_set_updated_at, CASCADE from pg_properties, RESTRICT
  between money rows). No btree_gist — it is not allow-listed on Azure.

  ## Non-negotiable
  - DATABASE_URL is the local 5433 database only. Run `pnpm db:migrate`, then the
    rollback, then migrate again (Step 5) — the rollback must be symmetric.
  - Update CLAUDE.md's migration note exactly as Step 6 says.
  - The schema test asserts constraint and index NAMES; those names are the contract.

  ## Report
  <workspace>/task-1-report.md with the migrate/rollback/migrate output and the test run.
  Reply with status, commits, test summary, concerns, report path.
```

### Task 2

```
model: haiku
description: "Implement Task 2: feature flag and shared wire types"
prompt: |
  You are implementing Task 2 of a 16-task plan (PG rent backend): the FF_PG_RENT_COLLECTION
  flag and the shared TypeScript wire types.

  Read your task brief first — its code is verbatim: <workspace>/task-2-brief.md

  ## Non-negotiable
  - Rebuild shared-types after editing it: pnpm --filter @cribliv/shared-types build.
    The API typecheck and every later test read the dist output.
  - Add the flag in all three places the brief names (interface, defaults, reader) and
    the three lines in .env.example.
  - Copy the types exactly; every `_inr` name is referenced by later tasks.

  ## Report
  <workspace>/task-2-report.md. Reply with status, commits, test summary, concerns, report path.
```

### Task 3

```
model: haiku
description: "Implement Task 3: rupee/paise boundary and largest-remainder split"
prompt: |
  You are implementing Task 3 of a 16-task plan (PG rent backend): the only rupee⇄paise
  conversion point and the rounding helpers.

  Read your task brief first — its code and tests are verbatim: <workspace>/task-3-brief.md

  ## Non-negotiable
  - TDD: tests first, watch them fail on "module not found", then implement.
  - Do not export anything the brief does not list. dto/money.ts is the single place rupees
    meet paise (spec D2); nothing else in the module may divide by 100.

  ## Report
  <workspace>/task-3-report.md. Reply with status, commits, test summary, concerns, report path.
```

### Task 4

```
model: haiku
description: "Implement Task 4: pure ISO date arithmetic"
prompt: |
  You are implementing Task 4 of a 16-task plan (PG rent backend): string-based ISO date
  arithmetic with no Date object escaping the file.

  Read your task brief first — code and tests verbatim: <workspace>/task-4-brief.md

  ## Non-negotiable
  - TDD as the brief shows. All arithmetic runs in UTC on purpose (the strings are already
    IST calendar dates); do not "fix" it to local time.
  - The `compareIso` re-export that Task 5 adds to this file is Task 5's job, not yours.

  ## Report
  <workspace>/task-4-report.md. Reply with status, commits, test summary, concerns, report path.
```

### Task 5

```
model: sonnet
description: "Implement Task 5: billing-period math"
prompt: |
  You are implementing Task 5 of a 16-task plan (PG rent backend): period ends for both cycle
  modes, due dates for both billing timings, the floor rule, and contiguity.

  Read your task brief first — code and tests verbatim: <workspace>/task-5-brief.md

  ## Context
  The floor rule uses max(natural due, period start) — spec §19 #48. Anniversary periods are
  computed from the stored anchor each time (Jan 31 → Feb 28 → Mar 31, never Mar 28). A cut
  calendar period in arrears is due period_end + 1. The 15 tests encode these; they are the
  spec's §11.1 fixtures.

  ## Non-negotiable
  - If a test fails on a date literal, recompute by hand from the brief's rule before
    touching either side, and put the arithmetic in your report. Loosening a test is a
    failure of this task.
  - Add the `compareIso` re-export to rent-dates.ts as the brief says.

  ## Report
  <workspace>/task-5-report.md. Reply with status, commits, test summary, concerns, report path.
```

### Task 6

```
model: sonnet
description: "Implement Task 6: billing window, proration, invoice status"
prompt: |
  You are implementing Task 6 of a 16-task plan (PG rent backend): the status-aware billing
  window, proration, and the invoice status function.

  Read your task brief first — code and tests verbatim: <workspace>/task-6-brief.md

  ## Context
  `active` ignores notice_end_date on purpose (production rows have stale ones). `moved_out`
  IS eligible (its window ends at move_out_date). Status uses equality, not ≥, because
  invariant 14 forbids amount_paid > total — the function throws in that case.

  ## Interfaces on disk
  Task 5's Period, PeriodSpec, naturalPeriodContaining, isNaturalPeriod; Task 4's dates;
  Task 3's roundToRupee.

  ## Report
  <workspace>/task-6-report.md with RED/GREEN. Reply with status, commits, test summary,
  concerns, report path.
```

### Task 7

```
model: haiku
description: "Implement Task 7: module skeleton, guards, event writer"
prompt: |
  You are implementing Task 7 of a 16-task plan (PG rent backend): rent-guards.ts,
  rent-events.ts, an empty PgRentModule registered in AppModule.

  Read your task brief first — code verbatim: <workspace>/task-7-brief.md

  ## Non-negotiable
  - Register PgRentModule in apps/api/src/app.module.ts imports after PgOperationsModule
    (grep for it). The module's arrays start empty by design.
  - assertManagedOwnership must require manage_enabled = true, exactly like
    pg-bed-assignment.service.ts does.
  - Both tests in the file must pass, including the DB one (export DATABASE_URL).

  ## Report
  <workspace>/task-7-report.md. Reply with status, commits, test summary, concerns, report path.
```

### Task 8

```
model: sonnet
description: "Implement Task 8: DB fixtures and the invariant checker"
prompt: |
  You are implementing Task 8 of a 16-task plan (PG rent backend): the RentFixtures helper
  every later integration suite uses, and assertRentInvariants, the net that catches money
  bugs in every later slice.

  Read your task brief first — code verbatim: <workspace>/task-8-brief.md

  ## Non-negotiable
  - The enum literals and NOT NULL columns in the fixture SQL were verified against the
    migrations (the brief lists where). Do not change them.
  - assertRentInvariants must list EVERY violation it finds, not stop at the first — a test
    that fails must name the broken rule.
  - The test proves the checker fires (it inserts a bad invoice and expects a throw).

  ## Report
  <workspace>/task-8-report.md. Reply with status, commits, test summary, concerns, report path.
```

### Task 9

```
model: haiku
description: "Implement Task 9: settings zod schemas and row mapper"
prompt: |
  You are implementing Task 9 of a 16-task plan (PG rent backend): dto/common.ts,
  dto/settings.dto.ts, and their unit tests.

  Read your task brief first — code and tests verbatim: <workspace>/task-9-brief.md

  ## Non-negotiable
  - Follow the brief's driver note: check how `pg` parses date columns before finalising
    toIsoDate, and adjust only the way the note says.
  - If `satisfies z.ZodType<…>` does not compile under zod 4 for the transformed schema,
    do exactly what the brief's zod-4 note says (drop satisfies, add the type check line).
  - The "no _paise key escapes" assertion in the test is a contract; do not weaken it.

  ## Report
  <workspace>/task-9-report.md. Reply with status, commits, test summary, concerns, report path.
```

### Task 10

```
model: sonnet
description: "Implement Task 10: settings service with transfer hook"
prompt: |
  You are implementing Task 10 of a 16-task plan (PG rent backend): RentSettingsService —
  enable (seeds due_day and receipt prefix, creates the counters row), get, patch with an
  updated_at token, pause, resume with a floor, and onOwnershipTransferred.

  Read your task brief first — code verbatim: <workspace>/task-10-brief.md

  ## Context
  Counters live in pg_rent_counters, NOT on the settings row, so system activity never
  409s an owner's open Settings form (spec §19 #7). The transfer hook (D20) runs inside the
  admin's transaction: it pauses with pause_reason='transfer', clears the four payee columns,
  keeps branding, writes settings.transferred with actor_role 'admin'.

  ## Interfaces on disk
  Tasks 7 (guards, events), 9 (RentSettingsRow, toSettingsDto, settingsInputToColumns).

  ## Non-negotiable
  - Keep either the TypeScript todayIst() or the SQL IST_TODAY_SQL for enabled_on — the
    brief's note says not both; remove the unused import.
  - The diff test compares "10000" vs 10000; the normalise() helper is what makes it pass —
    apply it on both sides, do not stringify the expectation.

  ## Report
  <workspace>/task-10-report.md. Reply with status, commits, test summary, concerns, report path.
```

### Task 11

```
model: sonnet
description: "Implement Task 11: credit auto-apply and invoice recompute"
prompt: |
  You are implementing Task 11 of a 16-task plan (PG rent backend): RentAllocationService
  with applyUnallocatedCredit (oldest inflow first, up to the balance) and recomputeInvoice
  (invariants 2 and 4, settled_on).

  Read your task brief first — code verbatim: <workspace>/task-11-brief.md

  ## Why it matters
  This is the first code that writes pg_rent_payment_allocations and amount_paid_paise.
  Slice 1b's payments plug into these two methods; the engine (Task 12) calls
  applyUnallocatedCredit at issue. Unallocated credit = amount − Σ allocations to invoices
  AND to outflows (invariant 3) — the SQL already counts both.

  ## Non-negotiable
  - assertRentInvariants at the end of the main test must pass; if it names a violation,
    that is a bug in your code, not in the checker.
  - `settled_on` is set only when the balance first reaches zero and never overwritten.

  ## Report
  <workspace>/task-11-report.md. Reply with status, commits, test summary, concerns, report path.
```

### Task 12

```
model: sonnet
description: "Implement Task 12: invoice engine"
prompt: |
  You are implementing Task 12 of a 16-task plan (PG rent backend): the invoice engine —
  periodLabel, generateInvoicesForProperty (rent periods + deposit invoices, one transaction
  each), previewForProperty, and the assignment hook.

  Read your task brief first — code and the 12 integration tests verbatim:
  <workspace>/task-12-brief.md (it is long; read it all before writing anything)

  ## Context
  The engine walks each assignment's window from move_in_date (contiguity), applies the floor
  on max(natural due, period start), cuts the final period at the window end when
  prorate_move_out is on, gates creation on due − lead_days OR an already-ended window, and
  issues drafts when rent resolves only from the listing. Deposits are sweep-generated with
  enabled_on as their floor. The preview ignores lead time on purpose.

  ## Interfaces on disk
  Tasks 5/6 pure functions (firstGeneratedPeriod, nextPeriod, naturalDueDate, prorate,
  billingWindow, cutToWindow), Task 10 RentSettingsService.getRow, Task 11
  RentAllocationService.applyUnallocatedCredit(client, invoiceId, actor), Task 8 fixtures +
  assertRentInvariants.

  ## Non-negotiable
  - Every rent-invoice insert happens under the assignment-row lock and after the overlap
    check — both are in the brief.
  - The test literals (570000, 330000, 435500, 580600, the due dates) come from the spec's
    formulas; if one disagrees with your output, do the arithmetic in the report before
    touching anything. Loosening a test is a failure of this task.
  - Run the whole pg-rent folder at the end (Step 6), not only this file.

  ## Report
  <workspace>/task-12-report.md. Reply with status, commits, test summary, concerns, report path.
```

### Task 13

```
model: sonnet
description: "Implement Task 13: invoice reads, tenant overrides, controllers"
prompt: |
  You are implementing Task 13 of a 16-task plan (PG rent backend): the invoice DTO mapper,
  RentInvoiceService reads + tenant overrides, and the settings and invoices controllers
  with their supertest suite.

  Read your task brief first — code verbatim: <workspace>/task-13-brief.md

  ## Interfaces on disk
  Task 10 RentSettingsService (enable/getRow/defaultsFor/patch/pause/resume), Task 12
  RentInvoiceEngineService (generateInvoicesForProperty, previewForProperty, EngineSettings).

  ## Non-negotiable
  - Bootstrap the controller test exactly like the existing pg-operations suites: override
    AuthGuard with the x-test-identity map. FF_PG_RENT_COLLECTION must be "true" in the test
    process before AppModule compiles.
  - The generate-now limiter is per process by design (the brief says so) — do not add a
    table for it.
  - No `_paise` and no `pay_token` may appear in any response; the tests assert it.

  ## Report
  <workspace>/task-13-report.md. Reply with status, commits, test summary, concerns, report path.
```

### Task 14

```
model: sonnet
description: "Implement Task 14: assignment and ownership-transfer hooks"
prompt: |
  You are implementing Task 14 of a 16-task plan (PG rent backend): wiring
  RentInvoiceEngineService.onAssignmentEvent into PgBedAssignmentService (post-commit,
  best-effort) and RentSettingsService.onOwnershipTransferred into AdminPgTransferService
  (inside its transaction).

  Read your task brief first: <workspace>/task-14-brief.md

  ## Non-negotiable
  - Both injections are @Optional() so slice-0's hand-constructed service tests keep
    compiling. Import PgRentModule into PgOperationsModule and AdminModule.
  - The hook call goes AFTER the transaction resolves, next to notify(), never inside it.
  - The brief's Step 1 tells you to copy the transferable-listing seed from the existing
    AdminPgTransferService integration test. Find that test, copy its inserts exactly, and
    verify the transfer() call signature at admin-pg-transfer.service.ts:56-60.
  - Run pg-operations AND admin suites after (Step 5); compare any red file against master
    before calling it pre-existing.

  ## Report
  <workspace>/task-14-report.md. Reply with status, commits, test summary, concerns, report path.
```

### Task 15

```
model: haiku
description: "Implement Task 15: hourly rent sweep in the worker"
prompt: |
  You are implementing Task 15 of a 16-task plan (PG rent backend): pg-rent-sweeps.ts with
  runPgRentSweep and its wiring in worker.ts behind FF_PG_RENT_COLLECTION.

  Read your task brief first — code verbatim: <workspace>/task-15-brief.md

  ## Non-negotiable
  - Reuse the existing `maintenanceDb` adapter in worker.ts; do not construct a second pool.
  - Not on startup — the stale-listing precedent at worker.ts:1252 explains why.
  - Step 5 boots the worker once with a timeout; paste its first lines into the report.

  ## Report
  <workspace>/task-15-report.md. Reply with status, commits, test summary, concerns, report path.
```

### Task 16

```
model: sonnet
description: "Implement Task 16: slice 1a verification and PR notes"
prompt: |
  You are running Task 16 of a 16-task plan: full verification of slice 1a.

  Read your task brief first: <workspace>/task-16-brief.md

  ## Non-negotiable
  - Use the exports from 00-EXECUTION-CONTEXT §2. Paste every vitest "Test Files"/"Tests"
    summary line into the report; the brief expects 91 pg-rent tests.
  - Run the `_paise` grep in Step 2 and paste its output.
  - Do NOT open the PR — write the title and body into the report; the orchestrator opens it
    after the final review.

  ## Report
  <workspace>/task-16-report.md. Reply with status, commits, test summary, concerns, report path.
```

## Slice acceptance

- 91 pg-rent tests green; `assertRentInvariants` never fails in any suite.
- `schema_migrations` last row is `0072_pg_rent_collection.sql`; rollback file exists.
- `FF_PG_RENT_COLLECTION=true` boots the API and the worker; `=false` 404s every `/rent` route.
- No controller file mentions `_paise` or `pay_token`.
