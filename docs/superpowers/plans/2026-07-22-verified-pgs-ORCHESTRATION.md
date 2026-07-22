# Orchestration Runbook — Verified PGs Admin Surface

**You are the orchestrator.** You do not write implementation code. You spawn subagents per task, verify their claims, maintain the execution log, and tell the human when to start a new chat.

**Run yourself on Opus.** You are making routing and review judgments; that is the strong-model half of the split.

## Inputs (read in this order, once, at session start)

1. `docs/superpowers/plans/2026-07-22-verified-pgs-admin-surface-BRIEF.md` — decisions D1-D4 + traps
2. `docs/superpowers/plans/2026-07-18-verified-pgs-admin-surface.md` — the tasks
3. `docs/superpowers/plans/2026-07-22-verified-pgs-EXECUTION-LOG.md` — **if it exists**, this tells you which session you're in and what's already done. If it doesn't exist, you are Session A.

Invoke `superpowers:subagent-driven-development`. At every GATE below, invoke `superpowers:verification-before-completion` before you claim anything passed.

---

## The execution log — this is what survives a chat boundary

Maintain `docs/superpowers/plans/2026-07-22-verified-pgs-EXECUTION-LOG.md`. **Do not commit it** (it is coordination state, not deliverable — and Task 0 already bans `git add .`, which protects it).

Append after **every** task, before moving on:

```markdown
## Task N — <name> — <PASS|FAIL>

- Agent: <model>, effort <low|medium|high>
- Commit: <sha> "<message>"
- Tests: <exact counts, e.g. "5 passed, 0 failed">
- Raw evidence: <the tail of the actual command output, not a summary>
- Deviations from plan: <none | what and why>
- Notes for next session: <anything non-obvious>
```

If the log and the git history disagree, **git wins** — re-derive the log from `git log --oneline` and say so.

---

## Session plan — three chats

Each session ends at a real verification boundary, not an arbitrary task count.

| Session | Tasks | Ends when                                    |
| ------- | ----- | -------------------------------------------- |
| **A**   | 0 → 4 | API complete and curl-smoked                 |
| **B**   | 5 → 7 | Main tab built and screenshot-verified       |
| **C**   | 8 → 9 | Everything verified, branch ready for review |

---

## Session A — API slice (Tasks 0-4)

**Precondition.** Postgres must be up or the baseline is impossible:

```bash
docker compose -f infra/docker-compose.yml up -d
```

Then capture the baseline yourself (do not delegate this — it is the anchor every later claim is measured against):

```bash
export PATH="$(ls -d /opt/homebrew/opt/node@22/bin):$PATH"
export DATABASE_URL="postgres://postgres:postgres@127.0.0.1:5433/cribliv_v2"
pnpm --filter @cribliv/api test 2>&1 | tail -30
```

Record exact pass/fail counts in the log as `BASELINE`. Expect ~13 pre-existing failures.

**Spawns:**

| Task  | `subagent_type` | `model`    | Effort   | Notes                          |
| ----- | --------------- | ---------- | -------- | ------------------------------ |
| 0+1   | general-purpose | `sonnet`   | low      | One agent. Branch, then types. |
| 2     | general-purpose | `sonnet`   | low      | Verbatim + 5 tests.            |
| **3** | general-purpose | **`opus`** | **high** | The SQL. See below.            |
| 4     | general-purpose | `sonnet`   | low      | Verbatim.                      |

**Task 3 prompt must include, verbatim:**

> The three queries' filter semantics differ deliberately and are documented on `PgAdminListingsResponse`. Every query reserves `$1` for `q` so the shared predicate constants are reusable without renumbering — do not "simplify" this. The leads lateral aliases as `lead`, not `l`, because `l` is the listings projection join. Do not rename it. Implement the SQL exactly as written in Task 3 Step 5; if you believe something is wrong, stop and report rather than adapting.

**After Task 3, review before proceeding.** Read the diff yourself. Check: `$1` is `q` in all three queries; `LEFT JOIN listings l ON l.id = pl.id` present; leads lateral aliased `lead`; no raw phone in any SELECT; `ORDER BY` only from `pgListOrderBy`. If any is wrong, send the agent back — do not fix it yourself and do not proceed.

### GATE A — API smoke

Run yourself, not via subagent. Start the API, get an admin token (OTP mock, `+919999999903`), then:

```bash
curl -s -H "Authorization: Bearer <token>" \
  'http://localhost:4000/v1/admin/pg/listings?verification=verified&page=1&page_size=25' \
  | jq '{total: .data.total, count: (.data.items|length), cities: (.data.available_cities|length), summary: .data.summary, sample: .data.items[0]}'
```

**Pass criteria:** `starting_rent_paise` is a number not a string; `public_path` well-formed or null; **no** `owner_phone`, `cover_blob`, or `total` keys on the item. Also re-run the api suite and confirm zero new failures vs BASELINE.

**If GATE A fails, do not start Session B.** Fix within this session or escalate.

**When GATE A passes, STOP and say this to the human:**

> **Session A complete — please start a new chat.**
>
> Done: Tasks 0-4. API returns the envelope and smokes clean.
>
> - Branch: `feat/verified-pgs-admin-surface`, commits `<sha>`…`<sha>`
> - API tests: `<N passed, M failed>` vs baseline `<N passed, M failed>` — **zero new failures**
> - Curl smoke: passed (rent is a number, no leaked columns)
>
> Context is now heavy with API test output, and Session B builds UI with screenshots. Start a fresh chat and paste:
>
> `Continue the Verified PGs work. Read docs/superpowers/plans/2026-07-22-verified-pgs-ORCHESTRATION.md and resume at Session B.`

---

## Session B — Web slice (Tasks 5-7)

**Spawns:**

| Task  | `model`  | Effort     | Notes                                      |
| ----- | -------- | ---------- | ------------------------------------------ |
| 5+6   | `sonnet` | low        | Helper + client. One agent; both verbatim. |
| **7** | `sonnet` | **medium** | Large React diff. Its own agent.           |

**Task 7 prompt must include, verbatim:**

> Use launch.json entries "API (NestJS)" and "Web (Next.js, alt port)". The entry named "Web (Next.js)" is broken — it points at another machine's absolute path. Do not use or fix it.
>
> Your report must include the actual `read_network_requests` output showing the request query string, and screenshots at desktop and 375px. A claim of "verified" without that output will be rejected.

### GATE B — screenshot review

Verify yourself, do not take the agent's word:

- Network output shows `verification=verified&status=active&sort=leads&page=1&page_size=25`
- Typing in search produced **exactly one** request after ~300 ms
- 375px screenshot: chips wrap, table scrolls inside its container, page body does **not** scroll sideways
- A draft-status row shows "Not publicly available"
- Zero console errors

**When GATE B passes, STOP and say this to the human:**

> **Session B complete — please start a new chat.**
>
> Done: Tasks 5-7. The tab is built and verified.
>
> - Commits `<sha>`…`<sha>`
> - Web tests: `<counts>` · typecheck + lint clean
> - Verified in browser: debounce fires once, filters hit the server, 375px scrolls correctly
> - Screenshots: attached above
>
> Session C is the final full-repo verification, which produces a lot of output. Start a fresh chat and paste:
>
> `Continue the Verified PGs work. Read docs/superpowers/plans/2026-07-22-verified-pgs-ORCHESTRATION.md and resume at Session C.`

---

## Session C — Finish (Tasks 8-9)

**Spawns:**

| Task  | `model`    | Effort   | Notes                            |
| ----- | ---------- | -------- | -------------------------------- |
| 8     | `sonnet`   | low      | Small header change.             |
| **9** | **`opus`** | **high** | Verification + honest reporting. |

**Task 9 prompt must include, verbatim:**

> Report raw command output, not summaries. If a test fails, paste the failure. Compare against the BASELINE counts in the execution log — the deliverable is zero NEW failures, not zero failures. In the psql check, `missing_projection` must be 0; a non-zero value is a hard stop. The `drifted` count is informational only — the head column has no readers.

### GATE C — final

Run yourself:

```bash
git diff --stat master -- apps/api/src/modules/admin/admin-homes.service.ts \
  apps/api/src/modules/admin/admin-homes.params.ts \
  apps/api/src/modules/admin/admin-homes.controller.ts \
  apps/web/components/admin/homes/ apps/web/lib/admin-home-url.ts
```

Must print **nothing**. Then confirm: 10 commits on the branch, `pnpm build && pnpm lint && pnpm typecheck` green, zero new test failures, Verified Homes still works in the browser.

**Then STOP. Do not open a PR, do not merge.** Report:

> **All tasks complete.** Branch `feat/verified-pgs-admin-surface`, 10 commits, ready for your review.
>
> - Tests: `<counts>` vs baseline `<counts>` — zero new failures
> - `missing_projection`: `<n>` · `drifted`: `<n>` (informational)
> - Verified Homes: unchanged (empty diff) and working
> - Screenshots: `<links>`
>
> Integration is your call — say the word if you want a PR opened.

---

## Escalation — when to stop and ask the human

Stop immediately and ask, rather than working around, if:

- A subagent proposes deviating from D1-D4, or from Task 3's SQL
- A **new** test failure appears that isn't in BASELINE
- `missing_projection` is non-zero
- Any diff appears in the off-limits files (`admin-homes.*`, `homes/**`, `admin-home-url.ts`, `StatusPill.tsx`)
- The plan contradicts the code (it was verified at `0d55a98`; the tree may have moved)
- A subagent reports success but its evidence doesn't support the claim — say so plainly and re-run

**Never** paper over a failure to keep the run moving. A red result reported early is the point of this structure.

## Rules for you, the orchestrator

- **Do not implement.** If a task is nearly done and you're tempted to finish it yourself, spawn the agent instead. Your context is the scarce resource.
- **Do not trust reports.** Every GATE is you running the command yourself.
- **Do not parallelize.** Task 1's types are consumed by everything downstream.
- **Do not skip the log.** It is the only thing that crosses a chat boundary.
