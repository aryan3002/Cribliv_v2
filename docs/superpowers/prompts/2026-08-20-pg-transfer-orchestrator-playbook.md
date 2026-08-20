# PG Ownership Transfer — Orchestrator Playbook

**Plan:** `docs/superpowers/plans/2026-08-20-pg-ownership-transfer.md`
**Spec:** `docs/superpowers/specs/2026-08-20-pg-ownership-transfer-design.md`
**Skill:** `superpowers:subagent-driven-development`
**Written:** 2026-08-20

You are the orchestrator. You do not write feature code. You dispatch one implementer per task,
gate each on a reviewer, and keep a ledger. This document is everything you need; read the plan
only through `task-brief`, never in full.

---

## Part 0 — Pre-flight (do this before dispatching anything)

### 0.1 Branch and commit policy — SETTLED, no question to ask

Decided by the repo owner on 2026-08-20:

- **Branch:** `feat/admin-pg-transfer`, created off `master` at commit `e500c3b`. Already exists —
  do not create it again, and never commit to `master`.
- **Commits:** every implementer commits its own task to this branch. This is what makes
  `review-package BASE HEAD` and the ledger's `commits <base7>..<head7>` work. The human reviews
  and merges the branch as a whole at the end, so per-task commits cost them nothing.

Verify before Task 1 and stop if it disagrees:

```bash
git branch --show-current   # expect: feat/admin-pg-transfer
```

### 0.2 The stale ledger — highest-risk trap in this run

`.superpowers/sdd/progress.md` already exists and belongs to an **unrelated** project (PG
Operations V2). It contains these lines:

```
Task 1: complete (commits bb7a281..434c564, review clean)
Task 2: complete (commits 434c564..7ce1090, review clean)
Task 3: complete (commits 7ce1090..b87bd59, review clean)
Task 4: complete (commits b87bd59..f3ca68a, review clean)
```

SDD tells you to treat ledger-complete tasks as DONE and resume after them. Followed literally
here, you would mark all four PG-transfer tasks complete and **dispatch nothing**. Those SHAs are
real commits from the earlier project, so `git log` corroborates the lie.

**Before Task 1,** append a clearly scoped section and only ever read/write within it:

```bash
cat >> "$(git rev-parse --show-toplevel)/.superpowers/sdd/progress.md" <<'EOF'

## === PG Ownership Transfer (plan 2026-08-20) — tasks below are THIS project ===
Branch: feat/admin-pg-transfer
Plan: docs/superpowers/plans/2026-08-20-pg-ownership-transfer.md
Nothing above this line belongs to this run.
EOF
```

Record progress as `PGX Task N: complete (...)` — the `PGX` prefix makes a stale match impossible.
After any compaction, re-read **only** below that header line.

### 0.3 Verified tooling

Already confirmed working against this plan — do not re-derive:

```bash
B=~/.claude/plugins/cache/claude-plugins-official/superpowers/6.1.1/skills/subagent-driven-development
"$B/scripts/task-brief" docs/superpowers/plans/2026-08-20-pg-ownership-transfer.md 1
```

All four tasks extract cleanly (634 / 180 / 478 / 77 lines). Briefs land in
`.superpowers/sdd/task-N-brief.md`.

### 0.4 Plan conflict scan — result

Scanned, clean. The one conflict found (no-commits vs. SDD's commit-range review) was settled by
the owner and folded into §0.1 and the plan's Global Constraints. No task contradicts another, and
no task mandates something the review rubric would call a defect. Task 4 is deliberately
under-specified — see Part 5. Proceed to Task 1 without further questions.

### 0.5 Orchestrator model

Run this session on **Opus**. You adjudicate every reviewer finding, resolve the "⚠️ cannot verify
from diff" items using cross-task context no subagent holds, and decide escalations. Those are the
judgment calls that set the ceiling on output quality — the implementers are working from complete
code and cannot exceed the coordination around them. See Part 1 for the per-task routing.

---

## Part 1 — Model routing and why

Two rules govern this, and they pull in opposite directions:

- **SDD Model Selection:** when the plan text contains the complete code, the job is transcription
  plus testing — use the cheapest tier. Turn count beats token price.
- **ENGINEERING.md:** security-sensitive and data-integrity code goes to the strongest model, and
  verification flows upward — a reviewer is never weaker than the model that wrote the code.

| Task                         | Implementer   | Reviewer   | Reasoning                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ---------------------------- | ------------- | ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1 — `AdminPgTransferService` | **Sonnet**    | **Opus**   | The plan hands over complete code, which argues for Haiku. Overridden by the failure mode: this is a 13-statement transaction where a transcription slip is a _silent data-integrity bug_, not a crash. The tests assert regexes against SQL strings — brittle by construction. A weak implementer that hits a whitespace-driven regex failure tends to loosen the assertion rather than fix the SQL, which destroys the test's value while showing green. Sonnet has the judgment to fix the right side. Opus reviews because this transaction _is_ the feature. |
| 2 — Endpoint + wiring        | **Haiku 4.5** | **Sonnet** | Genuine transcription: three files, complete code given, no design decisions. The one thinking step is counting constructor parameters so the test's positional stubs line up — mechanical, and the brief states the count. Sonnet reviews (one tier up from Haiku).                                                                                                                                                                                                                                                                                              |
| 3 — Web slice                | **Sonnet**    | **Sonnet** | Five files. Steps 1–5 are transcription, but steps 6–8 are integration: threading `refetchDetail` through an existing hook's return object and rewiring a render site inside a 400-line component. Integration with existing code is explicitly standard-model work. Same-tier review is acceptable for UI with no data-integrity surface.                                                                                                                                                                                                                        |
| 4 — E2E                      | **Opus**      | **Opus**   | The only genuinely unspecified task. The implementer must discover the existing e2e helper signatures and hand-seed a PG aggregate across `pg_properties` + `pg_listings` + `listings` with matching ids, then write correct FK-ordered teardown. Design judgment plus broad codebase understanding. Reviewer must be ≥ the writer.                                                                                                                                                                                                                               |
| Final whole-branch           | —             | **Opus**   | Mandated by the skill; also the first point where the three ownership columns are seen together against the spec.                                                                                                                                                                                                                                                                                                                                                                                                                                                 |

**Always pass `model:` explicitly.** Omitting it inherits your session model — usually the most
expensive one — which silently defeats this entire table.

**Do not parallelise implementers.** Tasks 2 and 3 look independent (the plan's Interfaces blocks
fix the contract between them), but they both edit files under `apps/api/src/modules/admin/` and
`apps/web/lib/`, and SDD forbids concurrent implementers for exactly that reason. Sequential.

---

## Part 2 — The loop

For each task N in 1, 2, 3, 4:

```bash
B=~/.claude/plugins/cache/claude-plugins-official/superpowers/6.1.1/skills/subagent-driven-development
PLAN=docs/superpowers/plans/2026-08-20-pg-ownership-transfer.md

BASE=$(git rev-parse HEAD)          # record BEFORE dispatching — never use HEAD~1
"$B/scripts/task-brief" "$PLAN" N   # prints the brief path
```

1. Dispatch the implementer (Part 3), passing the brief path and a report path
   `.superpowers/sdd/task-N-report.md`.
2. On `DONE` / `DONE_WITH_CONCERNS`: `"$B/scripts/review-package" $BASE HEAD` → dispatch the
   reviewer with the printed path, the brief path, the report path, and the constraints lens
   from Part 4.
3. Critical/Important findings → **one** fix subagent carrying the complete findings list (never
   one fixer per finding). The fix dispatch must name the covering test files and require the
   fixer to re-run them and append results to the same report file. Re-review only once the
   report shows the command, the tests, and the output.
4. Clean → append `PGX Task N: complete (commits <base7>..<head7>, review clean)` below the
   header from §0.2. Record Minor findings in the ledger; hand that list to the final review.

Do not check in with the human between tasks. Stop only for BLOCKED you cannot resolve, or the
decisions in §0.1.

---

## Part 3 — Dispatch prompts

Keep these short. Exact values live in the brief; never paste task text or prior-task history
into a dispatch.

### Task 1

```
model: sonnet
description: "Implement Task 1: AdminPgTransferService"
prompt: |
  You are implementing Task 1 of a 4-task plan that adds admin "transfer ownership"
  for PG listings, mirroring the flat/house feature that already ships.

  Read your task brief first — it is your requirements, and its code blocks are the
  exact code to write, verbatim: .superpowers/sdd/task-1-brief.md

  ## Context
  A flat/house listing binds to a person through one column. A PG binds through three
  — pg_listings.operator_user_id, pg_properties.operator_id, and the listings read
  projection (same id, 1:1). Your transaction must move all three or the PG ends up
  half-transferred: a new operator who can see the listing but not edit it, or a
  dashboard showing the new owner while paid contact-unlocks still hand out the old
  phone number. The brief's inline comments explain each write; preserve them.

  ## Non-negotiable
  - Do NOT add a migration. `transferred_at` and the `transfer_owner` enum value both
    already exist from infra/migrations/0069_listing_owner_transfer.sql.
  - Do NOT edit apps/api/src/modules/admin/admin-listing-transfer.service.ts. That is
    the live flat/house path and belongs to Task 2.
  - TDD: write the test file first, run it, watch it fail for the right reason
    (unresolved import), then write the service.
  - If a test fails on a regex that asserts SQL text, the SQL is what you fix.
    Loosening the assertion to get green is a failure of this task — the regexes are
    the only thing proving all three ownership columns move together.

  ## Report
  Write your full report to .superpowers/sdd/task-1-report.md, including TDD evidence
  (the RED command and output, then the GREEN command and output). Reply with only:
  status, commits, a one-line test summary, concerns, and the report path.
```

### Task 2

```
model: haiku
description: "Implement Task 2: PG transfer endpoint and wiring"
prompt: |
  You are implementing Task 2 of a 4-task plan adding admin "transfer ownership" for
  PG listings. Task 1 created AdminPgTransferService; you expose it over HTTP.

  Read your task brief first — it is your requirements, with the exact code to write
  verbatim: .superpowers/sdd/task-2-brief.md

  ## Interface from Task 1 (already on disk)
  apps/api/src/modules/admin/admin-pg-transfer.service.ts exports
  AdminPgTransferService with:
    transferOperator(input: { listingId: string; phoneE164: string;
                              fullName?: string; adminUserId: string })
      => Promise<{ listing_id, operator_user_id, operator_phone,
                   leads_moved, already_owned }>

  ## Watch for
  - The controller test builds AdminController with positional stubs. AdminController
    currently takes 17 constructor params; you append pgTransfer as the 18th, LAST.
    If your count disagrees with the brief, count the real constructor and say so in
    your report rather than adjusting the test to fit.
  - Step 5 changes two message strings in admin-listing-transfer.service.ts. Change
    ONLY those strings. The `pg_not_supported` code and every other line stay as they
    are — the existing flat/house test suite asserts the code, not the message, and
    must stay green.

  ## Report
  Write your full report to .superpowers/sdd/task-2-report.md. Reply with only:
  status, commits, a one-line test summary, concerns, and the report path.
```

### Task 3

```
model: sonnet
description: "Implement Task 3: PG transfer web slice"
prompt: |
  You are implementing Task 3 of a 4-task plan adding admin "transfer ownership" for
  PG listings. The API endpoint exists; you build the admin UI that calls it.

  Read your task brief first — it is your requirements, with the exact code to write
  verbatim: .superpowers/sdd/task-3-brief.md

  ## Interface from Task 2 (already live)
  POST /admin/pg/listings/:id/transfer
    body     { phone_e164: string, full_name?: string }
    response { listing_id, operator_user_id, operator_phone, leads_moved, already_owned }

  ## Context
  Steps 1-5 are transcription. Steps 6-8 are integration into existing files: you add
  refetchDetail to a hook's returned object and rewire one render site inside
  PgListingDetail.tsx. Read the surrounding code before editing — match its idiom, and
  change nothing the brief did not ask for.

  ## Non-negotiable
  The modal must NOT validate phone numbers client-side beyond the empty-field check.
  Phone shape is the API's authority (normalizeIndianPhone); a second validator on the
  web side is exactly the drift the flat/house modal's header comment warns against.

  ## Report
  Write your full report to .superpowers/sdd/task-3-report.md. Reply with only:
  status, commits, a one-line test summary, concerns, and the report path.
```

### Task 4

```
model: opus
description: "Implement Task 4: PG transfer end-to-end test"
prompt: |
  You are implementing Task 4, the final task of a plan adding admin "transfer
  ownership" for PG listings. Tasks 1-3 built the service, endpoint and UI; you prove
  the whole path works against a real database.

  Read your task brief first: .superpowers/sdd/task-4-brief.md

  ## Read this before you start
  This task is deliberately less specified than the others. The brief describes what
  the test must assert but not how to seed the data, because the existing e2e helper
  signatures were not verified when the plan was written. Your first step is to read
  apps/web/tests/admin-listing-transfer.spec.ts end to end and reuse its helpers
  verbatim — loginAsRole, setSessionOnPage, withPgClient, escapeRegExp, toTypedPhone,
  toDisplayPhone. Do not invent parallel helpers.

  ## The hard part
  There is no admin "create PG" flow, so you must seed the aggregate by hand: a
  pg_properties row, a pg_listings row, and a listings row that shares the SAME id as
  the pg_listings row (the projection is 1:1 on id). Teardown deletes children before
  parents or foreign keys will block it.

  ## The assertion that matters
  The SQL check in the brief — head operator, property operator, projection owner and
  projection phone all equal the new user — is the point of this task. It is what
  fails if someone later drops one table from the transaction while leaving the others
  intact. Everything else in the test is scaffolding for it.

  ## If you get stuck
  Report NEEDS_CONTEXT with the specific helper or fixture you could not resolve
  rather than inventing one. A wrong e2e test is worse than none.

  ## Report
  Write your full report to .superpowers/sdd/task-4-report.md. Reply with only:
  status, commits, a one-line test summary, concerns, and the report path.
```

---

## Part 4 — Review gates

Give every reviewer three paths (brief, report, review package) plus the constraints lens below.
Copy the values verbatim. Never tell a reviewer what not to flag, and never pre-rate a finding's
severity — the plan's example code is a starting point, not proof its weaknesses were chosen.

**Binding on every task:**

- No new migration file. `transferred_at` and `transfer_owner` exist from migration 0069.
- `admin-listing-transfer.service.ts` is unmodified except two message strings in Task 2.
- Error codes exactly: `invalid_phone`, `listing_not_found`, `cannot_transfer_to_admin`,
  `target_blocked`, `target_is_owner`, `db_disabled`.
- `target_is_owner` message exactly: _"That number belongs to a flat/house owner account. Change
  their role first, or use a different number."_
- TypeScript strict; no `any` outside the test-harness database mock.

**Task 1 lens.** All three ownership columns move in one transaction; `whatsapp_available` is
sourced from the target's own `whatsapp_opt_in`, never carried from the previous operator; the
`pg_analytics_overrides` DELETE precedes the UPDATE (unique index `uq_pg_override_listing` on
`(operator_id, listing_id)` makes a blind UPDATE raise 23505 on a transfer-back); both override
statements are scoped by `listing_id` so operator-global rows stay behind; a null `pg_property_id`
skips only the property write; every failure path rolls back and releases the client.

**Task 2 lens.** The route is `POST admin/pg/listings/:id/transfer` under the `admin`-guarded
controller; the service is registered as a provider; `pg_not_supported` remains a code and only
its message changed.

**Task 3 lens.** No client-side phone validation beyond the empty check; the modal renders the
server's error text; `refetchDetail` re-reads only the thin detail, not analytics or `full`
(a full reload would reset the open tab).

**Task 4 lens.** The SQL assertion covers all four columns; helpers are reused rather than
duplicated; teardown removes every seeded row in FK-safe order.

**⚠️ items.** A reviewer may report "cannot verify from diff" — usually about unchanged code or
cross-task behaviour. Those do not block the other verdicts, but you resolve each one yourself
before marking the task complete; you hold the cross-task context the reviewer lacks. A confirmed
gap is a failed spec review: back to the implementer, then re-review.

---

## Part 5 — Escalation

| Signal                                     | Action                                                                                                                                                                                                                                                                    |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `NEEDS_CONTEXT`                            | Supply exactly what was asked, re-dispatch same model. Expected on Task 4.                                                                                                                                                                                                |
| `BLOCKED` on Task 1 or 3                   | Context problem first; if the report shows genuine reasoning difficulty, re-dispatch one tier up. Never retry the same model unchanged.                                                                                                                                   |
| `BLOCKED` on Task 2                        | Almost certainly the constructor-count mismatch. Give the real count, re-dispatch Haiku.                                                                                                                                                                                  |
| `BLOCKED` on Task 4                        | Do not escalate the model — Opus is already the ceiling. Narrow the task: seed via SQL only, drop the UI drive, keep the SQL assertion.                                                                                                                                   |
| Reviewer flags something the plan mandates | Human's call. Present the finding beside the plan text and ask which governs. Do not dismiss it, and do not fix against the plan without asking.                                                                                                                          |
| API suite shows failures                   | 13 pre-existing failures are known and unrelated (rent-agreement FK, notification_log teardown, destructive migration-0034 test, stale 0031 assertion). Confirm the count has not grown and that no failure names a PG transfer file. A grown count is a real regression. |

---

## Part 6 — Traps specific to this plan

1. **The stale ledger (§0.2).** Highest-cost failure available in this run: silently skipping the
   entire plan. Section the ledger before Task 1.
2. **`BASE` capture.** Record `git rev-parse HEAD` _before_ each dispatch. `HEAD~1` silently drops
   all but the last commit when an implementer commits more than once — which Task 1's TDD cycle
   makes likely.
3. **The regex-on-SQL tests.** Task 1's assertions match SQL text. They are the only proof the
   three columns move together, and they are the easiest thing in this plan to "fix" the wrong way.
   Called out in both the dispatch and the review lens on purpose.
4. **No migration.** Any migration file appearing in a diff is a defect, not an improvement.
5. **The admin Add Listing wizard stays gated.** `BasicsStep.tsx:12` still hides the PG option.
   That is a documented non-goal in the spec. An implementer "helpfully" removing it is
   out-of-scope work that would ship a dead end.
6. **Local DB safety.** E2E needs the local Postgres on port 5433 (`infra/docker-compose.yml`),
   never the Azure one. Any DB command must carry an inline `DATABASE_URL=` pointing at 5433.

---

## Part 7 — After Task 4

```bash
"$B/scripts/review-package" "$(git merge-base master HEAD)" HEAD
```

Dispatch the final whole-branch review on **Opus** using
`superpowers:requesting-code-review`'s `code-reviewer.md`, passing that package path and the
accumulated Minor findings from the ledger so it can triage what must be fixed before merge.

If it returns findings, dispatch **one** fix subagent with the complete list — per-finding fixers
each rebuild context and re-run suites, and in real sessions that wave has cost more than all the
tasks combined.

Then hand to `superpowers:finishing-a-development-branch`, which is where the human decides what
happens to the branch.
