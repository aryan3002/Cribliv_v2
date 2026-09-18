# PG Rent — Orchestrator Playbook (all backend slices)

**Skill:** `superpowers:subagent-driven-development` (plugin 6.3.0 — scripts at
`~/.claude/plugins/cache/claude-plugins-official/superpowers/6.3.0/skills/subagent-driven-development/scripts/`)
**Context pack:** `00-EXECUTION-CONTEXT.md` (read it first)
**Phase files:** `phase-0.md`, `phase-1a.md`, `phase-1b.md`, `phase-1c.md` — routing + dispatch prompts per task
**Written:** 2026-09-17

You are the orchestrator. You do not write feature code. You dispatch one implementer per task, gate
each on a reviewer, keep the ledger, and open the PR. Read the plan only through `task-brief`; never
paste task text into a dispatch. This file is the loop; the phase file is the per-task detail.

---

## Part 0 — Pre-flight (every slice, before dispatching anything)

### 0.1 Branch — SETTLED

**`master` is production.** All rent work integrates on the long-lived branch **`feat/pg-rent`**
(created 2026-09-18 from `master@0f93458b`); one final PR `feat/pg-rent → master` ships the backend
slices together with the spec §15 launch runbook. Slice PRs target `feat/pg-rent`, never `master`.

One branch per slice, off `feat/pg-rent` **after the previous slice's PR merged into it**:

| Slice | Branch                                       | Depends on (merged into `feat/pg-rent`) |
| ----- | -------------------------------------------- | --------------------------------------- |
| 0     | `feat/pg-rent-slice0-pg-ops-dates` (PR #148) | —                                       |
| 1a    | `feat/pg-rent-slice1a-backend-foundation`    | 0                                       |
| 1b    | `feat/pg-rent-slice1b-payments-settlement`   | 1a                                      |
| 1c    | `feat/pg-rent-slice1c-queue-messaging-pay`   | 1b                                      |

```bash
git fetch origin && git checkout feat/pg-rent && git pull --ff-only
git checkout -b <branch>          # or `git checkout <branch>` if resuming
git branch --show-current         # must print the slice branch; never commit to master or feat/pg-rent
```

At each slice boundary, merge `origin/master` into `feat/pg-rent` (the human does this, or the
orchestrator when asked) so the final PR stays reviewable; the Part 4 rebase ruling covers the
four files that only gain lines.

Implementers commit each task to the branch (that is what makes `review-package BASE HEAD` and the
ledger's commit ranges work). The human merges the PR. Use `superpowers:using-git-worktrees` if the
main checkout is busy; the DB is shared, tests use unique fixtures, so two worktrees may share it.

### 0.2 Workspace and ledger — per plan, never the flat one

```bash
B=~/.claude/plugins/cache/claude-plugins-official/superpowers/6.3.0/skills/subagent-driven-development
PLAN=docs/superpowers/plans/2026-09-17-pg-rent-<slice>.md
"$B/scripts/sdd-workspace" "$PLAN"      # prints .superpowers/sdd/2026-09-17-pg-rent-<slice>/
```

- The ledger is `<workspace>/progress.md`; its first line must be `# SDD ledger — plan: <PLAN>`.
- A **stale flat ledger exists** at `.superpowers/sdd/progress.md` from older projects, and stale
  briefs/reports with generic names (`task-1-brief.md`…) sit beside it. They are not yours. Only read
  and write inside your plan's directory. After compaction, trust `<workspace>/progress.md` and
  `git log`, never memory.
- Ledger lines: `RENT-<slice> Task N: complete (commits <base7>..<head7>, review clean)`, plus
  `Ruling: … — … — …` for every decision and `Parked: …` for accepted Minor findings.

### 0.3 Environment check (once per session)

```bash
export PATH="$HOME/.nvm/versions/node/v22.22.2/bin:$PATH"
export DATABASE_URL="postgres://postgres:postgres@127.0.0.1:5433/cribliv_v2"
docker exec cribliv-pg-local pg_isready -U postgres
pnpm --filter @cribliv/shared-types build && pnpm --filter @cribliv/api typecheck
psql "$DATABASE_URL" -tc "SELECT filename FROM schema_migrations ORDER BY id DESC LIMIT 1"
```

Expected: `accepting connections`; typecheck clean; last migration `0071_blog_post_views.sql` before
slice 1a, `0072_pg_rent_collection.sql` from 1a onward. Stop and tell the human if any line disagrees.

### 0.4 Plan conflict scan

Run the SDD scan (one row per task pair sharing a file/interface; one row per task for internal
consistency) and write the table to the ledger. The phase file lists the known cross-task interfaces
to check first. The plans were self-reviewed for type consistency at writing time; the scan is still
mandatory — implementation reveals what reading does not.

### 0.5 Models

Run this session on **Opus**. Routing per task is in the phase file (Part 1). **Always pass
`model:` explicitly** — an omitted model inherits Opus for every transcription task and burns the
budget. Never parallelise implementers: every slice edits `pg-rent.module.ts` and shared test helpers.

---

## Part 1 — Routing rules (why the phase tables look the way they do)

Two rules pull in opposite directions; the tables in the phase files resolve them per task:

- **SDD:** when the brief contains the complete code, the work is transcription + running tests →
  cheapest tier. Turn count beats token price.
- **ENGINEERING.md:** data-integrity and security code goes to the strongest model; verification
  flows upward — the reviewer is never weaker than the implementer.

Applied to this module:

| Shape of task                                                                                                                                     | Implementer                          | Reviewer                                        |
| ------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ | ----------------------------------------------- |
| Migration SQL, shared types, pure functions with full tests in the brief, DTO mappers, controllers that are route→schema→service glue             | **Haiku 4.5**                        | **Sonnet**                                      |
| Services with transactions but complete code in the brief, worker wiring, hooks into existing services                                            | **Sonnet**                           | **Sonnet** (small diff) / **Opus** (money path) |
| Anything that writes `pg_rent_payment_allocations`, `amount_paid_paise`, or a fee line; `finalizeConfirmed`; settlement; the engine's period walk | **Sonnet**                           | **Opus**                                        |
| Tasks that must discover existing code (test bootstrap copied from a sibling suite, admin-transfer fixture, worker `.hbs` asset config)           | **Sonnet**                           | **Sonnet**                                      |
| Final whole-branch review, every slice                                                                                                            | —                                    | **Opus**                                        |
| Fix rounds 4–5                                                                                                                                    | one tier above the stuck implementer | same as the task                                |

A Haiku implementer that hits a failing assertion on SQL text or a number tends to loosen the
assertion. The dispatch prompts say explicitly that loosening a test is a failure of the task; the
reviewer lens item 7 catches it anyway.

---

## Part 2 — The loop (per task)

```bash
BASE=$(git rev-parse HEAD)                       # BEFORE dispatching — never HEAD~1
"$B/scripts/task-brief" "$PLAN" N                # prints <workspace>/task-N-brief.md
```

1. Dispatch the implementer with the phase file's prompt for Task N (model from the table). The
   prompt carries: the brief path, the one-line context, interfaces from earlier tasks the brief cannot
   know, any ruling, the report path `<workspace>/task-N-report.md`, and the report contract.
2. On `DONE` / `DONE_WITH_CONCERNS`: `"$B/scripts/review-package" "$PLAN" $BASE HEAD` → dispatch the
   task reviewer (`task-reviewer-prompt.md`) with the package path, brief path, report path, and the
   **review lens from `00-EXECUTION-CONTEXT.md` §5** pasted verbatim as its constraints block.
3. Critical/Important findings → **one** fix dispatch carrying the complete findings list (resume the
   same implementer agent for rounds 1–3; a fresh, stronger one for 4–5). The fix dispatch names the
   covering test files and requires RED/GREEN evidence appended to the same report. Then one scoped
   re-review (`re-review-prompt.md`).
4. Clean → ledger line, tick the todo, next task. Minor findings → `Parked:` lines, handed to the
   final review.
5. `NEEDS_CONTEXT` → answer from the spec/plan and re-dispatch. `BLOCKED` → per SDD: more context,
   stronger model, split, or rule on the plan defect and ledger it.

Do not check in with the human between tasks. Stop only for the four SDD stop conditions or a
pre-flight mismatch.

---

## Part 3 — Slice end: final review, PR gate, handoff

1. Run the slice's last task (full verification) — it is a real task with a reviewer.
2. Dispatch the final whole-branch reviewer on **Opus** (`requesting-code-review/code-reviewer.md`)
   with `review-package "$PLAN" <first BASE of the slice> HEAD`, the spec sections the plan header
   names, the ledger's `Parked:` list, and the §5 lens. One fix dispatch, one scoped re-review,
   adjudicate residuals, ledger.
3. Open the PR with `gh pr create --base feat/pg-rent` on the slice branch. Body: the plan's PR notes (each plan's last
   task says what to include), the ledger's rulings, and the test counts from the verification
   task. End the body with `🤖 Generated with [Claude Code](https://claude.com/claude-code)`.
4. **Stop.** Merging is the human's. Tell them: branch, PR URL, test count, anything parked, and
   which phase file starts next.
5. Delete this plan's SDD workspace only after the PR is merged (the human may ask for a re-review).

---

## Part 4 — Rulings you are pre-authorised to make

So a session never parks on these:

| Situation                                                                                                                                 | Ruling                                                                                                                                                                                                                                         |
| ----------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A brief's test literal disagrees with a number the implementation produces (rounding, day counts, a period label)                         | Recompute by hand from the spec formula. If the spec formula is right and the literal wrong, fix the **test literal**, ledger it with the arithmetic. If the code is wrong, it is a fix round. Never "make both agree" without the arithmetic. |
| A brief references a line number that moved                                                                                               | The plan pins names, not lines; find by name, proceed.                                                                                                                                                                                         |
| `pg` returns a `date` column as a Date at local midnight vs UTC                                                                           | 1a Task 9's driver note applies: `toIsoDate` must produce `YYYY-MM-DD`; adjust the helper, keep the contract.                                                                                                                                  |
| A zod `satisfies` clause fails to compile under zod 4                                                                                     | Drop the `satisfies`, keep the schema, add the `type _Check = …` assertion the plan offers.                                                                                                                                                    |
| An existing pg-operations/admin suite goes red                                                                                            | Run the same file on `master`. Pre-existing → note in the ledger and continue. New → fix round.                                                                                                                                                |
| A finding says "add an index / a cache / a refactor" outside the brief                                                                    | Park it. Scope is the plan's.                                                                                                                                                                                                                  |
| The reviewer wants the receipt renderer test to run real Chromium                                                                         | It is `describe.skipIf(!PG_RENT_TEST_CHROMIUM)` by design; not a finding.                                                                                                                                                                      |
| A merge conflict with `feat/pg-rent` (or `master` merged into it) in `feature-flags.ts`, `app.module.ts`, `worker.ts`, `pg-rent.ts` types | Rebase the slice branch; those files only ever gain lines here.                                                                                                                                                                                |

Anything else that changes money semantics, schema, or the spec's decisions D1–D20 is not yours to
rule — stop and ask.
