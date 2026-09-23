# Phase 0 — pg-operations fixes (6 tasks)

**Plan:** `docs/superpowers/plans/2026-09-17-pg-rent-slice0-pg-ops-fixes.md`
**Branch:** `feat/pg-rent-slice0-pg-ops-dates` off `master`
**Delivers:** IST assignment dates, explicit `move_out_date`, `cancelNotice`, `cancelMoveOut` clears notice fields, web API wrappers. No new tables, no flag.

## Pre-flight specifics

- Ledger prefix: `RENT-0`.
- Conflict scan rows to check first: Task 2 ↔ Task 3 ↔ Task 4 all edit `operatorTransition`'s UPDATE statement (each task shows the full statement as it should look after that task — later wins); Task 3 ↔ Task 5 share `PgMoveOutInput`; Task 5's caller update (`grep confirmAssignmentMoveOut|moveOutAssignmentNow apps/web`) must be done or web typecheck fails.
- The Task 2 timezone-forcing step alters the **local** database's timezone and resets it in Step 5. If a session dies between those steps, run `psql "$DATABASE_URL" -c "ALTER DATABASE cribliv_v2 RESET timezone"` before anything else.

## Routing

| Task                          | Implementer | Reviewer     | Why                                                                                                                      |
| ----------------------------- | ----------- | ------------ | ------------------------------------------------------------------------------------------------------------------------ |
| 1 — `common/date.ts`          | Haiku 4.5   | Sonnet       | Pure helper, complete code and tests in the brief                                                                        |
| 2 — IST writers               | Sonnet      | Sonnet       | Seven surgical SQL edits + a DB-timezone-forced RED step that needs judgment to run correctly                            |
| 3 — `move_out_date` input     | Sonnet      | Sonnet       | Threads a parameter through service + controller + shared type; the error-envelope shape is copied from an existing test |
| 4 — `cancelNotice` + clearing | Sonnet      | **Opus**     | Changes the assignment state machine that production tenants sit in; the rent engine's window rule depends on it         |
| 5 — web wrappers              | Haiku 4.5   | Sonnet       | Transcription + one grep-driven caller update                                                                            |
| 6 — verification + PR         | Sonnet      | Opus (final) | Runs suites, opens the PR                                                                                                |

## Dispatch prompts

Each prompt is complete; substitute `<workspace>` with the path `sdd-workspace` printed.

### Task 1

```
model: haiku
description: "Implement Task 1: IST date helper"
prompt: |
  You are implementing Task 1 of a 6-task plan that makes PG assignment dates IST-safe
  before a rent-collection engine starts reading them.

  Read your task brief first — it is your requirements, and its code blocks are the exact
  code to write, verbatim: <workspace>/task-1-brief.md

  ## Context
  Postgres on Azure runs in UTC; between 00:00 and 05:30 IST `CURRENT_DATE` is yesterday.
  This helper is the one place the codebase knows the timezone. Later tasks and the whole
  rent module import from it.

  ## Non-negotiable
  - TDD: write the test file, run it, watch it fail with "Cannot find module", then write
    the helper, run again, watch it pass.
  - Node 22 is not on PATH: start every shell command with
    export PATH="$HOME/.nvm/versions/node/v22.22.2/bin:$PATH"
  - Do not add anything the brief does not list (no moment/dayjs, no extra exports).

  ## Report
  Write the full report with RED and GREEN command output to <workspace>/task-1-report.md.
  Reply with only: status, commits, one-line test summary, concerns, report path.
```

### Task 2

```
model: sonnet
description: "Implement Task 2: assignment dates in IST"
prompt: |
  You are implementing Task 2 of a 6-task plan: the seven `CURRENT_DATE` writers in
  pg-bed-assignment.service.ts become IST dates via the helper Task 1 added.

  Read your task brief first — it is your requirements: <workspace>/task-2-brief.md

  ## Interface from Task 1 (on disk)
  apps/api/src/common/date.ts exports todayIst(), IST_TODAY_SQL, isIsoDate(), compareIsoDates().

  ## Non-negotiable
  - The brief's Step 2 forces the LOCAL database's timezone so the test fails for the right
    reason, and Step 5 resets it. Do both. If anything goes wrong in between, run
    psql "$DATABASE_URL" -c "ALTER DATABASE cribliv_v2 RESET timezone" before stopping.
  - DATABASE_URL must be the local 5433 URL (see 00-EXECUTION-CONTEXT §0). vitest does not
    load .env; export it. Check the "Tests" count line — a skipped DB suite prints green.
  - Replace exactly the seven occurrences the brief lists; do not touch pg-occupancy,
    pg-maintenance or pg-residence (their CURRENT_DATE uses are reads, out of scope).
  - Every existing test in assignment.integration.test.ts must still pass.

  ## Report
  <workspace>/task-2-report.md with RED (forced timezone) and GREEN output. Reply with
  status, commits, test summary, concerns, report path.
```

### Task 3

```
model: sonnet
description: "Implement Task 3: explicit move-out date"
prompt: |
  You are implementing Task 3 of a 6-task plan: operators can state the real move-out date
  on confirm-move-out and move-out-now; it defaults to today (IST) and is bounded by
  move-in and today.

  Read your task brief first — it is your requirements: <workspace>/task-3-brief.md

  ## Interfaces already on disk
  - apps/api/src/common/date.ts: todayIst, isIsoDate, compareIsoDates, IST_TODAY_SQL
  - operatorTransition() in pg-bed-assignment.service.ts now uses IST_TODAY_SQL (Task 2)

  ## Non-negotiable
  - packages/shared-types must be rebuilt after adding PgMoveOutInput:
    pnpm --filter @cribliv/shared-types build — the API tests resolve it from dist.
  - The brief tells you to copy the error-envelope assertion shape from the existing test at
    :361 rather than guess it. Do that.
  - The "without a database" test at the top of the file calls these methods with three
    arguments; the fourth is optional, so it must keep compiling unchanged.

  ## Report
  <workspace>/task-3-report.md with RED/GREEN. Reply with status, commits, test summary,
  concerns, report path.
```

### Task 4

```
model: sonnet
description: "Implement Task 4: cancelNotice and notice-field clearing"
prompt: |
  You are implementing Task 4 of a 6-task plan: cancelling a pending move-out now clears the
  notice dates, and a new operator transition cancelNotice takes notice_served or
  move_out_requested straight back to active.

  Read your task brief first — it is your requirements: <workspace>/task-4-brief.md

  ## Why this matters
  The rent engine's billing window (spec §5.2) treats notice_end_date as the end of billing
  for tenants in the notice family. Production rows exist where cancelMoveOut left that date
  behind on an active tenant. This task stops that happening again; the engine tolerates the
  old rows separately.

  ## Interfaces already on disk
  - operatorTransition(operatorId, propertyId, assignmentId, allowed, target, eventType,
    bedStatus, moveOut?) — Task 3 added the optional last parameter. You edit its UPDATE
    statement to clear notice fields when target = 'active'.

  ## Non-negotiable
  - No new NotificationType (the union in notification.templates.ts is closed). cancelNotice
    sends no notification.
  - Extend the "without a database" test with the one line the brief shows.
  - Run the whole pg-operations test folder at the end (Step 5), not just the one file.

  ## Report
  <workspace>/task-4-report.md with RED/GREEN and the full-folder run. Reply with status,
  commits, test summary, concerns, report path.
```

### Task 5

```
model: haiku
description: "Implement Task 5: web API wrappers"
prompt: |
  You are implementing Task 5 of a 6-task plan: the web client wrappers for the two move-out
  endpoints gain an optional date body, and a cancelAssignmentNotice wrapper is added.

  Read your task brief first — it is your requirements: <workspace>/task-5-brief.md

  ## Interfaces already on disk
  - PgMoveOutInput in @cribliv/shared-types (rebuilt in Task 3).
  - API routes: POST …/assignments/:id/confirm-move-out, …/move-out-now (body
    { move_out_date? }), …/cancel-notice.

  ## Non-negotiable
  - Step 1 tells you to read the existing wrapper test and copy its fetchApi mocking style.
    Do not invent a different mock.
  - Step 4's grep for existing callers is mandatory; the web typecheck in Step 5 is what
    proves you found them all. A caller left as (propertyId, assignmentId, token) now passes
    the token as the body — that is the bug you are preventing.

  ## Report
  <workspace>/task-5-report.md. Reply with status, commits, test summary, concerns, report path.
```

### Task 6

```
model: sonnet
description: "Implement Task 6: slice 0 verification and PR"
prompt: |
  You are running Task 6 of a 6-task plan: full verification of slice 0 and the PR.

  Read your task brief first: <workspace>/task-6-brief.md

  ## Non-negotiable
  - Run every command in Step 1 with the PATH and DATABASE_URL exports from
    docs/superpowers/prompts/pg-rent/00-EXECUTION-CONTEXT.md §2. Paste the "Test Files" /
    "Tests" summary lines for each vitest run into the report.
  - A red suite outside the files this slice touched must be checked against master
    (git stash / checkout master / run / return) before you call it pre-existing. Name it in
    the report either way.
  - Do NOT open the PR yourself — write the PR title and body (per the brief's Step 3) into
    the report and return. The orchestrator runs the final review and opens the PR.

  ## Report
  <workspace>/task-6-report.md. Reply with status, commits, test summary, concerns, report path.
```

## Slice acceptance (orchestrator checks before the final review)

- `assignment.integration.test.ts` has 5 new tests and every old one still passes.
- `grep -c CURRENT_DATE apps/api/src/modules/pg-operations/services/pg-bed-assignment.service.ts` prints `0`.
- `pnpm --filter @cribliv/web typecheck` clean.
- Local DB timezone is reset: `psql "$DATABASE_URL" -tc "SHOW timezone"` prints the server default (not `Etc/GMT…`).
