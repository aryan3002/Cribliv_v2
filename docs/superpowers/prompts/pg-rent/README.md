# PG Rent Collection — Backend Execution Playbook

Paste-and-go orchestration for the four backend slices of the rent module. Written 2026-09-17 against
the plans below; every file:line and command was verified on `master` at `0f93458b`.

| File                          | What it is                                                                                                                      |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `00-EXECUTION-CONTEXT.md`     | Read first, every session. Safety, environment, verified facts, patterns, the review lens.                                      |
| `01-orchestrator-playbook.md` | How to run a slice with `superpowers:subagent-driven-development`: workspace, ledger, loop, routing rules, escalation, PR gate. |
| `phase-0.md`                  | Slice 0 — pg-operations fixes (6 tasks). Routing table + dispatch prompts.                                                      |
| `phase-1a.md`                 | Slice 1a — backend foundation (16 tasks).                                                                                       |
| `phase-1b.md`                 | Slice 1b — payments, invoice actions, late fees, receipts, settlement (9 tasks).                                                |
| `phase-1c.md`                 | Slice 1c — queue, messaging, pay page API, tenant reads (7 tasks).                                                              |

## Order

```
0  →  1a  →  1b  →  1c        (strictly sequential; each is one PR into the integration branch `feat/pg-rent` — never `master`, which is production — merged before the next starts; one final PR feat/pg-rent → master ships them all)
```

Slice 0b (web workspace shell) can run in parallel with 1a in a separate worktree — its plan is not yet
written (see `../../plans/2026-09-17-pg-rent-00-index.md`). The web slices 2–6 follow the backend.

## How to start a slice

1. Open a fresh Claude Code session on **Opus** in this repo. Say:

   > Read `docs/superpowers/prompts/pg-rent/00-EXECUTION-CONTEXT.md`, then
   > `docs/superpowers/prompts/pg-rent/01-orchestrator-playbook.md`, then
   > `docs/superpowers/prompts/pg-rent/phase-<N>.md`. Execute phase `<N>` with
   > `superpowers:subagent-driven-development` exactly as the playbook says.

2. The orchestrator does the pre-flight (Part 0 of the playbook), then runs the loop without
   checking in. It stops only for the four SDD stop conditions or the slice's PR gate.

3. When the slice's final review is clean and the PR is open, you (the human) review the PR, run
   CI, merge. Then start the next slice from a fresh session.

## Where the truth lives

- **Spec:** `docs/superpowers/specs/2026-09-17-pg-rent-collection-design.md` — binding authority; §19 has the 50 review findings and their dispositions.
- **Plans:** `docs/superpowers/plans/2026-09-17-pg-rent-*.md` — the plan is the spec's argument; conflicts inside a plan resolve against the spec.
- **Ledger:** `.superpowers/sdd/<plan-basename>/progress.md` — per plan, git-ignored, the recovery map after compaction.
