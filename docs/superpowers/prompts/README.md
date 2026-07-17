# PG Operations V2 — Phased Execution Prompts

Paste-and-go prompts for Codex or a Sonnet agent running **in this repo** on branch `feat/pg-operations-v2`.

## How to use

1. Every executor session must first read **`00-EXECUTION-CONTEXT.md`** (safety, local DB on 5433, verified schema facts, patterns to copy) and the plan `../plans/2026-07-12-pg-operations-v2-plan.md`.
2. Then paste ONE phase prompt. Execute its slices in order, **test-first**, against the local DB only. Do not start the next phase until the current one's acceptance criteria pass.
3. **Never** run a DB command without the inline local `DATABASE_URL` (see context §0). Production stays commented out in `.env` until the very end.

## Order (each depends on the previous)

| #   | File                          | Delivers                                                   | Suggested model                   |
| --- | ----------------------------- | ---------------------------------------------------------- | --------------------------------- |
| 1   | `phase-1-manage-gate.md`      | Manage-PG request + admin approval queue (+ payment shell) | Sonnet (Opus reviews approval tx) |
| 2   | `phase-2-layout-occupancy.md` | Room/bed layout builder, bed grid, occupancy               | Opus service / Sonnet rest        |
| 3   | `phase-3-assignments.md`      | Assignments + notice/move-out state machine                | **Opus authors**                  |
| 4   | `phase-4-tenant-portal.md`    | Tenant "My Stay" + notice/move-out                         | Sonnet                            |
| 5   | `phase-5-maintenance.md`      | Maintenance tickets (both sides)                           | Sonnet                            |

Phases 1–3 = MVP2 (bed management). Phases 4–5 = MVP3 first cut. Phase 6 (rent ledger, food opt-out, operator-side Razorpay checkout) is deferred — see the bottom of `phase-5`.

## Environment already set up

- Branch `feat/pg-operations-v2`, local Postgres `cribliv-pg-local` on `127.0.0.1:5433` (db `cribliv_v2`, pgvector installed), migrations 0001–0054 + seed applied, test users 901/902/903 present. `.env` points at 5433 (production URL commented out).
