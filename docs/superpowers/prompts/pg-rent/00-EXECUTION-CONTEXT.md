# PG Rent — Shared Execution Context (READ FIRST)

Every prompt in this folder assumes you have read this file. It is the self-contained context pack:
an orchestrator or implementer with zero conversation history can work from it. Facts marked
**verified** were checked against the repo on 2026-09-17 at `master` `0f93458b`; do not re-derive them.

- **Spec (binding):** `docs/superpowers/specs/2026-09-17-pg-rent-collection-design.md`
- **Plan index:** `docs/superpowers/plans/2026-09-17-pg-rent-00-index.md` — global constraints live there; every task inherits them.
- **Plans:** `…-slice0-pg-ops-fixes.md`, `…-slice1a-backend-foundation.md`, `…-slice1b-payments-settlement.md`, `…-slice1c-queue-messaging-pay.md`

---

## 0. SAFETY — non-negotiable

- The local dev DB is **`postgres://postgres:postgres@127.0.0.1:5433/cribliv_v2`** (Docker container `cribliv-pg-local`, postgis 16 + pgvector). Never point anything at the Azure host. The repo `.env` has the Azure URL commented out — **never uncomment it**.
- Prefix every migrate/seed/test command with the local URL inline:
  `DATABASE_URL="postgres://postgres:postgres@127.0.0.1:5433/cribliv_v2" pnpm db:migrate`
  (`dotenv` does not override an already-set env var, so the inline value wins.)
- Production migration (0072) and the Azure app-setting flips happen at the very end, by the human, per spec §15. No agent touches prod.
- If the DB is down: `docker start cribliv-pg-local`, then `docker exec cribliv-pg-local pg_isready -U postgres`. If the container is gone, the memory note `local-test-db-and-node-setup.md` has the recreate command (data survives in volume `infra_pgdata`; pgvector must be reinstalled in the container).

## 1. Environment quirks (verified)

- **Node 22 is not on PATH in non-interactive shells.** Every Bash call that runs `pnpm`/`npx`/`node` starts with:
  `export PATH="$HOME/.nvm/versions/node/v22.22.2/bin:$PATH"`
- **vitest does not load `.env`.** Export `DATABASE_URL` (local) or DB suites silently skip and report green. Check `Test Files` / `Tests` counts, not the exit code.
- **`@cribliv/shared-types` is consumed from `dist`.** After any edit: `pnpm --filter @cribliv/shared-types build`, or the API's typecheck and tests see stale types.
- **`rtk` hook** compresses long command output; if a `find`/`cat`/`ls` result looks truncated or empty, verify with `stat`/explicit paths. Full logs land under `~/Library/Application Support/rtk/tee/`.
- **Nest "circular dependency / undefined provider" on boot** after adding a module almost always means a stale `apps/api/dist` + `tsconfig.tsbuildinfo` (0-byte dist file). Wipe both and rebuild before hunting a real cycle. `pg-rent` imports nothing from `pg-operations` or `admin`, so a real cycle is impossible by construction.
- **Pre-existing test failures** (memory note `api-integration-test-known-failures.md`): rent-agreement FK teardown, `notification_log` teardown, the destructive migration-0034 test, a stale 0031 assertion. Confirm any red suite outside `pg-rent` also fails on `master` before treating it as yours.
- **Prod worker lags the API** at times; the launch runbook (spec §15) requires verifying the worker carries the sweep build. Not an agent concern until launch.

## 2. Commands

```bash
export PATH="$HOME/.nvm/versions/node/v22.22.2/bin:$PATH"
export DATABASE_URL="postgres://postgres:postgres@127.0.0.1:5433/cribliv_v2"
pnpm --filter @cribliv/shared-types build
pnpm db:migrate
pnpm --filter @cribliv/api typecheck
pnpm --filter @cribliv/api exec vitest run src/modules/pg-rent            # one module
pnpm --filter @cribliv/api exec vitest run <file> -t "<test name>"        # one test
pnpm --filter @cribliv/web typecheck && pnpm --filter @cribliv/web exec vitest run <file>
pnpm lint
```

## 3. Verified schema and code facts (do NOT re-derive)

- **Next free migration is 0072** (`infra/migrations/0071_blog_post_views.sql` is the last). Runner: `infra/migrations/run-migrations.js` — lexical order, each file in its own `BEGIN…COMMIT`, files containing `rollback` are skipped. Rollback companion: `0072_pg_rent_collection.rollback.sql`.
- **`pg_bed_assignments` (0062):** `move_in_date` **nullable**; `notice_end_date`, `move_out_date`, `monthly_rent_paise` (null = inherit), `security_deposit_paise`; statuses `reserved|active|notice_served|move_out_requested|move_out_pending_confirmation|moved_out|cancelled`; `uq_pg_active_assignment_per_tenant` (one active bed per linked user), `uq_pg_active_assignment_per_bed`.
- **Assignment date writers** (`apps/api/src/modules/pg-operations/services/pg-bed-assignment.service.ts`): `CURRENT_DATE` at `:544`, `:573`, `:655`, `:663`, `:914`, `:973`, `:981` — slice 0 makes them IST. `cancelMoveOut` (`:753`) does not clear notice fields; slice 0 fixes it and adds `cancelNotice`. No DB session timezone is pinned anywhere (UTC on Azure).
- **Rent resolution:** `COALESCE(a.monthly_rent_paise, rt.monthly_rent_paise, pl.starting_rent_paise)` (`pg-residence.service.ts:135`). **Deposit:** `a.security_deposit_paise → pg_room_types.security_deposit_paise` (0065) `→ pg_details.security_deposit_paise` — the residence page skips the middle step (spec §17 #9); the rent module must not.
- **Tenant linking:** `lockTenantAssignment` (`pg-bed-assignment.service.ts:377`) auto-links on write via phone match; `queryResidence` (`pg-residence.service.ts:180`) resolves ONE assignment (`LIMIT 1`). The rent module reads across all matches and never auto-links on read.
- **Ownership transfer:** `admin/admin-pg-transfer.service.ts` — `UPDATE pg_properties SET operator_id` at `:181`, inside a transaction opened at `:75` with `pg_properties … FOR UPDATE` at `:104`; constructor at `:53`.
- **Guards/idempotency:** `AuthGuard` + `RolesGuard` + `@Roles("pg_operator"|"tenant")`; `IdempotencyService.run(userId, route, key, fn)` + `requireIdempotencyKey(header)` (`common/idempotency.*`), 24-hour cache in `idempotency_keys`. `ok(data)` → `{ data, meta? }`. `UserContext = { id, role }` via `@AuthUser()`.
- **Validation precedent:** zod `safeParse` → `BadRequestException({ code: "invalid_payload", message })` at `admin/admin.controller.ts:1314`.
- **Transactions:** `transaction(db, work, { uniqueViolationCode })` (`common/transaction.ts`) maps `23505` → `ConflictException({ code })`.
- **Throttling:** global 100/min; per-route `@Throttle({ default: { ttl: 60_000, limit: N } })` (`rent-agreement.controller.ts:102`).
- **PDF pipeline:** `rent-agreement/pdf/browser-pool.ts` (`BrowserPool.launch/acquire/release`), `azure-pdf-storage.ts` (`upload(buffer, id, locale)` → `yyyy/mm/<id>.pdf`), `downloads/azure-sas-issuer.ts`, dev adapters `in-memory-pdf-storage.ts` + `downloads/dev-api-sas-issuer.ts`, config `pdf/azure-storage-config.ts`. `PdfRendererPort.render(RenderInput)` is agreement-shaped — receipts use the pool directly. `numberToIndianWords(rupees)` at `rent-agreement/format/words.format.ts:58`.
- **Deps present:** `qrcode ^1.5.4`, `handlebars ^4.7.9`, `zod ^4.4.3`, `@nestjs/throttler`.
- **Worker:** `apps/api/src/worker/worker.ts` uses `setInterval`, no overlap guard, builds a `DatabaseService`-shaped adapter `maintenanceDb` at `:1097`; the stale-listing precedent (`:1252`) deliberately does not run on startup. Sweep pattern to copy: `worker/maintenance-sweeps.ts` (`FOR UPDATE SKIP LOCKED`, batch, per-batch transaction).
- **Enum literals:** `pg_sharing_kind` `single|double|triple|quad|dorm`; `pg_bathroom_kind` `attached_western|attached_indian|shared_western|shared_indian`; `furnishing_type` `unfurnished|semi_furnished|fully_furnished`; `pg_onboarding_path` `self_serve|sales_assist`; `pg_details.total_beds` + `onboarding_path` are NOT NULL without defaults.
- **Middleware:** `/en/pay` is not in `apps/web/middleware.ts`'s matcher (`:296`) — already public, no change needed.
- **`btree_gist` is not allow-listed** on the Azure server — rent-period overlap is a service check under the assignment-row lock, not an `EXCLUDE` constraint.

## 4. The module you are building (orientation)

`apps/api/src/modules/pg-rent/` — DB-required (D13): every service throws `rent_requires_db` without `DATABASE_URL`. Layout per spec §13: `pure/` (no I/O), `services/`, `controllers/`, `dto/` (the only rupee⇄paise boundary), `receipt/`, `__tests__/` (+ `helpers/rent-fixtures.ts`, `helpers/assert-rent-invariants.ts`). Sweeps in `apps/api/src/worker/pg-rent-sweeps.ts`. Shared types in `packages/shared-types/src/pg-rent.ts`.

Invariants that every review checks (spec §3): totals = Σ lines; `amount_paid = Σ confirmed allocations` and **≤ total** (14); status is the pure function (4, equality); no overlapping rent periods (5); IST everywhere (10); contiguity + floor (11, 12); outflows fully funded (15); late fees only on eligible rent invoices (16); every mutation writes an event in the same transaction (8); nothing financial deleted (D14).

## 5. Review lens (hand this to every reviewer)

Beyond the SDD task-reviewer rubric, check:

1. **Money boundary.** No `_paise`, `pay_token`, `share_token`, `occupant_phone` in any HTTP response; rupee conversion only in `dto/`; every amount rounded to the rupee; splits sum exactly.
2. **Invariants.** The test calls `assertRentInvariants` after every mutation; any mutation that can reduce `total` routes through `deallocateExcess`; `finalizeConfirmed` is the only path to `paid`.
3. **Dates.** No `CURRENT_DATE`, no `new Date().toISOString().slice(0,10)`; `todayIst()` / `IST_TODAY_SQL` only.
4. **Scope.** Operator calls go through `assertManagedOwnership`; tenant calls through `resolveTenantAssignmentIds` with no auto-link on reads; public endpoints expose the §7.7 minimum and are throttled.
5. **Idempotency + locking.** Money-creating endpoints carry the header AND persist the key; `FOR UPDATE` before every status check; unique violations map to the plan's code.
6. **Flags and hooks.** Controllers 404 on the flag; `onAssignmentEvent` / `onOwnershipTransferred` are data-driven and never throw to the caller.
7. **TDD evidence.** The report shows RED (command + failure reason) then GREEN (command + counts). A test loosened to pass is a Critical finding.
8. **Nothing outside the brief.** Drive-by refactors, extra endpoints, "improvements" to unrelated files → Important finding, revert.
