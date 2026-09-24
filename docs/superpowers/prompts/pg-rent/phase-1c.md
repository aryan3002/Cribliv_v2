# Phase 1c — queue, messaging, pay page API, tenant reads, two carried owner decisions (9 tasks)

**Plan:** `docs/superpowers/plans/2026-09-17-pg-rent-slice1c-queue-messaging-pay.md`
**Branch:** `feat/pg-rent-slice1c-queue-messaging-pay` off `feat/pg-rent` (slice 1b merged)
**Delivers:** everything the Rent tabs and the public pay page will read. That covers reminder states, the collection queue, WhatsApp templates rendered to `wa.me` links, UPI intent + QR, public pay/receipt endpoints, the tenant summary across residences, history, identity dispute, month KPIs and the portfolio. It also carries two owner decisions from 1b: migration 0074 (invoice idempotency key) and Restore absorbing the gap invoice.

Tasks 1–6 are read-mostly. Their only writes are `reminder.opened`, pay-token regeneration and the two dispute flags. The risk there is in **exposure** (what the public and tenant endpoints leak) and in the queue's correctness (what the owner acts on), not in money. Tasks 7–8 do touch money: 7 adds a schema column and changes the invoice-creation path, and 8 moves allocations.

Pre-flight audit (2026-09-24, re-verified against HEAD after 1b):
`.superpowers/sdd/2026-09-17-pg-rent-slice1c-queue-messaging-pay/preflight-audit.md`.
Its corrections are folded into the plan text. Every Task 1–6 code block typechecks and passes on the local DB exactly as written.

## Carried owner decisions (2026-09-24)

- **Task 7:** `pg_rent_invoices.idempotency_key` + `uq_pg_rent_invoice_idem` in migration **0074**, threaded through `createManual` / `createBackfill`. A sequential replay returns the original invoice. A concurrent duplicate gets 409 `duplicate_invoice`.
- **Task 8:** `restoreReprorate` absorbs the engine's `auto` gap invoice. It releases the allocations to credit, cancels the invoice (`restore_absorbed`), and the credit then flows to the restored invoice. It refuses in three cases:
  - 409 `restore_gap_edited` when the gap carries a late fee or an operator/expense line;
  - 409 `period_overlap` when the overlapping invoice is not an absorbable gap;
  - 409 `invoice_cancelled` when the restore card sits on a cancelled invoice.
- Design notes and owner flags: `.superpowers/sdd/2026-09-17-pg-rent-slice1c-queue-messaging-pay/amendment-draft.md` §1.

## Pre-flight specifics

- Ledger prefix: `RENT-1c`.
- Next free migration at slice start: **0074** (last is `0073_pg_rent_alloc_seq.sql`). Task 7 takes it, so the next free number after this slice is 0075.
- Baseline: `src/modules/pg-rent` = 26 files / 179 tests. Target after Task 8: **31 files / 212 tests**.
- Conflict scan rows to check first:
  - Task 1 `PgRentPublicPayPage.instruction_open_amount` ↔ Task 3 `publicPayPage` sets it.
  - Constructor orders are repeated in every test:
    - Task 3 `RentPayInstructionService(db)`, `RentMessageService(db, pay)`;
    - Task 4 `RentQueueService(db, settlement)`;
    - Task 5 `RentTenantService(db, alloc, pay, settlement)`.
  - Task 2 `reminderState` signature ↔ Tasks 4 and 5. On the due date it returns `due_today` only when some offset is ≤ 0 (spec §7.2).
  - Task 5 adds `RentSettlementService.computeStatement` (a 1b file). The tenant hero uses it, never `statement()`, so tenant reads do not generate or write.
  - Task 6's tenant regex includes `rent_source`. It passes only with Task 5's payload stripping (`toEventDto` + drop `rent_source`). Task 5 must land before Task 6.
  - Task 6 public controller returns a 302 via `@Res()`. The handler must not also `return`.
  - `PG_RENT_RECEIPT_RENDERER` is overridden in Task 6's test module, so no Chromium is needed.
  - Tasks 7 and 8 both edit `rent-invoice.service.ts` and `rent-invoice-actions.integration.test.ts`. Run them in order: Task 8's helper is anchored on Task 7's.
- **Real-clock dependence.** Several fixtures read the real IST date:
  - Task 3's "overdue by N days" phrase: fixture invoice due 2026-09-05; on 2026-09-24 it reads 19.
  - Task 4's E suggestion: `onAssignmentEvent` runs on today, and E's notice ends 2026-10-15.
  - `paid_on` values must not be after today.
  - Task 8 drives `onAssignmentEvent` on today.

  This is valid for runs between 2026-09-06 and about 2026-10-01. If the phrase mismatches, check the date arithmetic, never the phrase logic.

## Routing

| Task                                   | Implementer | Reviewer     | Why                                                                                                                                               |
| -------------------------------------- | ----------- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1 — shared types                       | Haiku 4.5   | Sonnet       | Transcription                                                                                                                                     |
| 2 — pure reminder / template / UPI     | Haiku 4.5   | Sonnet       | Pure, 9 tests. The only judgment calls (`URLSearchParams` encoding, due_today needing a non-positive offset) are already decided in the brief.    |
| 3 — message + pay-instruction services | Sonnet      | **Opus**     | Public pay page data is the exposure boundary: first name only (including inside `notify_text`), no phone, no token                               |
| 4 — queue service                      | Sonnet      | Opus         | Seven-section SQL; the owner acts on this every day; `leaving()` runs settlement statements                                                       |
| 5 — tenant service                     | Sonnet      | **Opus**     | Tenant scope across residences, no auto-link, no writes on read, strips owner-only fields (including inside event payloads), touches a 1b service |
| 6 — controllers                        | Sonnet      | Opus         | Public routes with throttle, no-store, token format checks, 302                                                                                   |
| 7 — invoice idempotency key (0074)     | Sonnet      | **Opus**     | Schema change plus the money-creation path; deterministic race test                                                                               |
| 8 — Restore absorbs the gap invoice    | Sonnet      | **Opus**     | Moves allocations and cancels a paid invoice inside one transaction; lock order                                                                   |
| 9 — verification + PR notes            | Sonnet      | Opus (final) |                                                                                                                                                   |

## Dispatch prompts

### Task 1

```
model: haiku
description: "Implement Task 1: queue, messaging, pay-page and tenant read types"
prompt: |
  You are implementing Task 1 of a 9-task plan that adds the read APIs for the PG rent
  module's owner queue, WhatsApp messaging, public pay page and tenant Rent tab.

  Read your task brief first — types verbatim: <workspace>/task-1-brief.md

  ## Non-negotiable
  - Append to packages/shared-types/src/pg-rent.ts; rebuild shared-types; run the API
    typecheck. PgRentPublicPayPage includes `instruction_open_amount`.

  ## Report
  <workspace>/task-1-report.md. Reply with status, commits, test summary, concerns, report path.
```

### Task 2

```
model: haiku
description: "Implement Task 2: pure reminder state, template merge, UPI and wa.me builders"
prompt: |
  You are implementing Task 2 of a 9-task plan (PG rent read APIs): three pure files with
  nine tests.

  Read your task brief first — code and tests verbatim: <workspace>/task-2-brief.md

  ## Non-negotiable
  - One definition of overdue: due_date < today. "In grace" is a boolean tag, not a state.
  - On the due date the state is due_today only when some reminder offset is <= 0;
    all-positive offsets give "upcoming" (spec §7.2: queue = overdue only).
  - Unknown merge fields stay literal AND are reported; `{late_fee_clause}` is the one
    derived helper. Output caps at 900 chars with an ellipsis.
  - `tr` is alphanumerics only (invoice numbers carry hyphens). Keep URLSearchParams
    encoding as the brief says.

  ## Report
  <workspace>/task-2-report.md with RED/GREEN. Reply with status, commits, test summary,
  concerns, report path.
```

### Task 3

```
model: sonnet
description: "Implement Task 3: message service and pay-instruction service"
prompt: |
  You are implementing Task 3 of a 9-task plan (PG rent read APIs): RentPayInstructionService
  (UPI intent + QR SVG, pay links on the apex site URL, the public pay page data) and
  RentMessageService (four templates merged for an invoice, wa.me links, editor preview,
  reminder.opened, pay-token regeneration, the tenant-paid message).

  Read your task brief first — code verbatim: <workspace>/task-3-brief.md

  ## Context
  The pay page is public. It returns the tenant's FIRST NAME only, including inside
  notify_text. It never returns the phone, internal notes or the token itself. The pay link
  is the one place a token leaves the API (inside a URL). Site URL is the apex
  https://cribliv.com, never a www variant; SITE_URL is exported from the pay-instruction
  service. The receipt link uses NEXT_PUBLIC_API_BASE_URL || `${SITE_URL()}/v1`.

  ## Interfaces on disk
  Task 2 pure functions; slice 1b's resolveTenantAssignmentIds, newPayToken; qrcode is
  already a dependency (import * as QRCode from "qrcode"; QRCode.toString(uri, { type: "svg" })).

  ## Non-negotiable
  - Set both `instruction` (with amount) and `instruction_open_amount` (without) on a
    payable page. A cancelled invoice's page reads "expired", not "paid".
  - Keep the test order exactly as written: the tenant-paid test runs before the pay-page
    test pays September. The pay token is regenerated while the invoice is still payable;
    the replaced token 404s.
  - The test's "overdue by N days" assertion is computed by its daysSince helper from the
    real clock; if the phrase mismatches, check the date arithmetic, not the phrase.
  - Stage exactly the four files the commit step lists.

  ## Report
  <workspace>/task-3-report.md. Reply with status, commits, test summary, concerns, report path.
```

### Task 4

```
model: sonnet
description: "Implement Task 4: collection queue, month summary, portfolio"
prompt: |
  You are implementing Task 4 of a 9-task plan (PG rent read APIs): RentQueueService —
  the seven queue sections, the billing-lens month summary, and the portfolio.

  Read your task brief first — code verbatim: <workspace>/task-4-brief.md

  ## Context (spec §7.3, §10.2)
  - Awaiting: pending claims, oldest first.
  - Needs attention: drafts, missing move-in, notice ended, re-prorate/restore suggestions on
    non-cancelled invoices, booking held, identity disputed.
  - Leaving: from the settlement statement; rows auto-clear when nothing is left to settle.
  - Overdue: sorted by balance × days.
  - Due today, due soon.
  - Former tenants with dues.
  An invoice with a pending claim never appears in the reminder sections, but that tenant's
  other, unclaimed invoices still do. Summary = rent + adhoc by billing_month, excluding
  draft/cancelled.

  ## Interfaces on disk
  Slice 1b's RentSettlementService.statement (used per leaving row — it also generates the
  final cut period, which is intended); Task 2's reminderState; 1a's periodLabel.

  ## Non-negotiable
  - The month-summary literal (9000 × 4 + 6000) depends on tenant F's cut September existing;
    if it is off, the engine run at "2026-10-10" did not generate it — investigate the window,
    do not change the literal.
  - overdue_inr = outstanding_inr − 6000 is correct: F's cut period is due on the run day
    (2026-10-10), so it is not yet overdue. Grace is 7 days in this fixture, and tenant E is
    created before the first run. Both are deliberate.
  - No `_paise` in any output (the test asserts it). waiting_days uses todayIst(created_at),
    never toISOString().slice(0, 10).
  - Stage exactly the files the commit step lists.

  ## Report
  <workspace>/task-4-report.md. Reply with status, commits, test summary, concerns, report path.
```

### Task 5

```
model: sonnet
description: "Implement Task 5: tenant summary, history, invoice view, identity dispute"
prompt: |
  You are implementing Task 5 of a 9-task plan (PG rent read APIs): RentTenantService —
  summary across every residence the user matches (linked OR phone-matched, no auto-link on
  read), a hero per residence, history, the tenant invoice view with tenant-visible events,
  identity dispute and its operator-side resolve. You also add a read-only
  RentSettlementService.computeStatement.

  Read your task brief first — code verbatim: <workspace>/task-5-brief.md

  ## Context (spec §9, §19 #14)
  A parent paying for two children sees both residences. The second can never be LINKED
  (unique index) but is still READ.

  Hero precedence: settled/leaving → awaiting → the oldest-due open invoice (overdue /
  partially_paid / due) → paid → nothing_due.

  The tenant invoice strips internal_note, rent_snapshot_inr, rent_source,
  suggested_late_fee_inr and reprorate_suggestion. It only shows events at or after
  issued_at from the visible list; their payloads go through toEventDto (no `_paise`) and
  drop rent_source.

  ## Interfaces on disk
  - Task 3: RentPayInstructionService.
  - Slice 1b: RentSettlementService (you add computeStatement to it), RentAllocationService,
    and the receipt/payment/invoice DTO selects plus toEventDto.
  - Constructor: RentTenantService(db, alloc, pay, settlement).

  ## Non-negotiable
  - The test proves reads do not auto-link (tenant_user_id stays null on the phone-matched
    assignment). Do not call lockTenantAssignment anywhere in this service.
  - The hero calls settlement.computeStatement. Never call statement() (it generates) and
    never add a .catch.
  - The forbidden-fields regex in the test is a contract.
  - Fixture rules: enableRentAsOf (deposits for past move-ins), generation at 2026-09-01 then
    2026-10-01, phone +917700000066, and only one linked active assignment per user. Keep
    them all exactly as written.
  - Stage exactly the five files the commit step lists (including rent-settlement.service.ts).

  ## Report
  <workspace>/task-5-report.md. Reply with status, commits, test summary, concerns, report path.
```

### Task 6

```
model: sonnet
description: "Implement Task 6: queue, tenant, portfolio and public controllers"
prompt: |
  You are implementing Task 6 of a 9-task plan (PG rent read APIs): four controllers and
  their supertest suite, all given in full in the brief.

  Read your task brief first: <workspace>/task-6-brief.md

  ## Non-negotiable
  - Public routes:
    - no guard;
    - @Throttle 30/min;
    - @Header("Cache-Control","no-store");
    - a 43-char base64url token format check before touching the DB;
    - assertRentFlag() first (flag off → 404 even for public routes).
    The receipt route answers 302 via @Res() and must not also return a value.
  - Override PG_RENT_RECEIPT_RENDERER in the test module so no Chromium is needed.
  - Every operator/tenant handler starts with assertRentFlag(); tenant routes use
    @Roles("tenant"); a tenant calling an operator route must get 403 (the test checks).
  - The test tenant uses the fixture's per-run phone, never a fixed one.
  - Stage exactly the six files the commit step lists.

  ## Report
  <workspace>/task-6-report.md. Reply with status, commits, test summary, concerns, report path.
```

### Task 7

```
model: sonnet
description: "Implement Task 7: invoice idempotency key (migration 0074)"
prompt: |
  You are implementing Task 7 of a 9-task plan (PG rent slice 1c). This carries an owner
  decision of 2026-09-24: POST /rent/invoices stores its Idempotency-Key on the invoice row,
  behind a partial unique index, exactly as pg_rent_payments already does.

  Read your task brief first — SQL, code and tests verbatim: <workspace>/task-7-brief.md

  ## Non-negotiable
  - Migration pair 0074_pg_rent_invoice_idempotency.sql + .rollback.sql. Apply with
    `pnpm db:migrate` against the LOCAL DB only.
  - createManual / createBackfill take an optional trailing idempotencyKey (default null).
    Forfeit and settlement invoices store NULL. A replay returns the original invoice; a
    concurrent duplicate is 409 duplicate_invoice.
  - The race test holds the property lock on a third connection. It must fail when the
    index is missing — do not "simplify" it into Promise.allSettled.
  - Do not touch CLAUDE.md (it has unrelated uncommitted edits), the engine, the settlement
    service, the payment service or shared-types.
  - Stage exactly the files the commit step lists.

  ## Report
  <workspace>/task-7-report.md with RED/GREEN per step. Reply with status, commits, test
  summary, concerns, report path.
```

### Task 8

```
model: sonnet
description: "Implement Task 8: Restore absorbs the engine's gap invoice"
prompt: |
  You are implementing Task 8 of a 9-task plan (PG rent slice 1c). This carries an owner
  decision of 2026-09-24: restoreReprorate absorbs the engine-issued gap invoice (release
  its allocations to credit, cancel it as restore_absorbed) instead of refusing
  period_overlap.

  Read your task brief first — code and tests verbatim: <workspace>/task-8-brief.md

  ## Non-negotiable
  - The absorbable rule table in the brief is decided; do not re-derive it.
    - Only `auto` invoices lying entirely inside the gap are absorbable.
    - A late_fee line or an operator/expense_split line → 409 restore_gap_edited.
    - A cancelled restored invoice → 409 invoice_cancelled.
  - Lock order: property → restored invoice → gap invoices ORDER BY period_start, id
    FOR UPDATE → payments (inside applyUnallocatedCredit).
  - Replace the one contradicting 1b test exactly as the brief says; leave the other two
    restore tests unchanged.
  - Do not modify cancel(), RentAllocationService or RentInvoiceEngineService.
  - Stage exactly the files the commit step lists.

  ## Report
  <workspace>/task-8-report.md with RED/GREEN. Reply with status, commits, test summary,
  concerns, report path.
```

### Task 9

```
model: sonnet
description: "Implement Task 9: slice 1c verification and PR notes"
prompt: |
  You are running Task 9 of a 9-task plan: full verification of slice 1c.

  Read your task brief first: <workspace>/task-9-brief.md

  ## Non-negotiable
  - Run `pnpm db:migrate` first.
  - Paste every vitest summary line. The brief expects 212 pg-rent tests / 31 files, and
    490 / 58 for the four-directory run.
  - Step 2's public-surface grep must print nothing; paste the command and its (empty) output.
  - Step 3: add the identity-dispute/resolve route to spec §12 and align §4.10's
    tenant-visible wording; run `graphify update .`.
  - Do NOT open the PR — write title and body into the report, including every PR-note item
    the brief lists.

  ## Report
  <workspace>/task-9-report.md. Reply with status, commits, test summary, concerns, report path.
```

## Slice acceptance

- 212 pg-rent tests green (31 files); `pnpm db:migrate` applied 0074.
- `curl -s http://localhost:4000/v1/public/pg-rent/pay/<token>`, with the API running, the flag on and a seeded invoice, returns:
  - `state`;
  - `tenant_first_name`;
  - `instruction.qr_svg` starting with `<svg`;
  - no key containing `phone`, and no surname anywhere in the body.
- `GET /v1/tenant/pg-rent/summary` for a phone with two beds returns two residences and leaves `tenant_user_id` untouched on the unlinked one. It writes no `pg_rent_events` row.
- A duplicate `POST …/rent/invoices` with the same Idempotency-Key returns the same invoice. Restore on a re-prorated invoice absorbs the engine's gap invoice.
- The backend is now complete for web slices 2–4. On the API side only slice 5 (analytics/export/expenses/preferences) and slice 6 (seed, nightly invariants, e2e, runbook) remain.
