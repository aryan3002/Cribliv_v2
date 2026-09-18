# Phase 1c — queue, messaging, pay page API, tenant reads (7 tasks)

**Plan:** `docs/superpowers/plans/2026-09-17-pg-rent-slice1c-queue-messaging-pay.md`
**Branch:** `feat/pg-rent-slice1c-queue-messaging-pay` off `feat/pg-rent` (slice 1b merged)
**Delivers:** everything the Rent tabs and the public pay page will read: reminder states, the collection queue, WhatsApp templates → `wa.me`, UPI intent + QR, public pay/receipt endpoints, tenant summary across residences, history, identity dispute, month KPIs, portfolio.

Read-mostly. The only writes are `reminder.opened`, pay-token regeneration and the two dispute flags. Risk is in **exposure** (what the public and tenant endpoints leak) and in the queue's correctness (what the owner acts on), not in money.

## Pre-flight specifics

- Ledger prefix: `RENT-1c`.
- Conflict scan rows to check first:
  - Task 1 `PgRentPublicPayPage` has `instruction_open_amount` (folded in during the plan's self-review) ↔ Task 3 `publicPayPage` sets it.
  - Task 3 `RentMessageService(db, pay)` ↔ Task 5 `RentTenantService(db, alloc, invoices, receipts, pay, settlement, messages)` ↔ Task 4 `RentQueueService(db, settlement)` — constructor orders are repeated in every test.
  - Task 2 `reminderState` signature ↔ Tasks 4 and 5.
  - Task 6 public controller returns a 302 via `@Res()` — the handler must not also `return`.
  - `PG_RENT_RECEIPT_RENDERER` must be overridden in Task 6's test module so no Chromium is needed.
- The Task 3 integration test asserts an "overdue by N days" phrase computed from the real clock (fixture invoice due 2026-09-05); the `daysSince` helper keeps it honest. If the session date is before 2026-09-06 the phrase differs — rule: adjust the fixture's `due_day`/dates, never the phrase logic.

## Routing

| Task                                   | Implementer | Reviewer     | Why                                                                                              |
| -------------------------------------- | ----------- | ------------ | ------------------------------------------------------------------------------------------------ |
| 1 — shared types                       | Haiku 4.5   | Sonnet       | Transcription                                                                                    |
| 2 — pure reminder / template / UPI     | Haiku 4.5   | Sonnet       | Pure with 9 tests; the only judgment is `URLSearchParams` encoding, already decided in the brief |
| 3 — message + pay-instruction services | Sonnet      | **Opus**     | Public pay page data = the exposure boundary (first name only, no phone, no token)               |
| 4 — queue service                      | Sonnet      | Opus         | Seven-section SQL; the owner acts on this every day; `leaving()` runs settlement statements      |
| 5 — tenant service                     | Sonnet      | **Opus**     | Tenant scope across residences, no auto-link, strips owner-only fields                           |
| 6 — controllers                        | Sonnet      | Opus         | Public routes with throttle, no-store, token format checks, 302                                  |
| 7 — verification + PR notes            | Sonnet      | Opus (final) |                                                                                                  |

## Dispatch prompts

### Task 1

```
model: haiku
description: "Implement Task 1: queue, messaging, pay-page and tenant read types"
prompt: |
  You are implementing Task 1 of a 7-task plan that adds the read APIs for the PG rent
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
  You are implementing Task 2 of a 7-task plan (PG rent read APIs): three pure files with
  nine tests.

  Read your task brief first — code and tests verbatim: <workspace>/task-2-brief.md

  ## Non-negotiable
  - One definition of overdue: due_date < today. "In grace" is a boolean tag, not a state.
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
  You are implementing Task 3 of a 7-task plan (PG rent read APIs): RentPayInstructionService
  (UPI intent + QR SVG, pay links on the apex site URL, the public pay page data) and
  RentMessageService (four templates merged for an invoice, wa.me links, editor preview,
  reminder.opened, pay-token regeneration, the tenant-paid message).

  Read your task brief first — code verbatim: <workspace>/task-3-brief.md

  ## Context
  The pay page is public: it returns the tenant's FIRST NAME only, never the phone, never
  internal notes, never the token itself. The pay link is the one place a token leaves the
  API (inside a URL). Site URL is the apex https://cribliv.com — never a www variant.

  ## Interfaces on disk
  Task 2 pure functions; slice 1b's resolveTenantAssignmentIds, newPayToken; qrcode is
  already a dependency (QRCode.toString(uri, { type: "svg" })).

  ## Non-negotiable
  - Set both `instruction` (with amount) and `instruction_open_amount` (without) on a
    payable page.
  - The test's "overdue by N days" assertion is computed by its daysSince helper from the
    real clock; if the phrase mismatches, check the date arithmetic, not the phrase.

  ## Report
  <workspace>/task-3-report.md. Reply with status, commits, test summary, concerns, report path.
```

### Task 4

```
model: sonnet
description: "Implement Task 4: collection queue, month summary, portfolio"
prompt: |
  You are implementing Task 4 of a 7-task plan (PG rent read APIs): RentQueueService —
  the seven queue sections, the billing-lens month summary, and the portfolio.

  Read your task brief first — code verbatim: <workspace>/task-4-brief.md

  ## Context (spec §7.3, §10.2)
  Awaiting (pending claims, oldest first) · Needs attention (drafts, missing move-in, notice
  ended, re-prorate/restore suggestions, booking held, identity disputed) · Leaving (from the
  settlement statement; rows auto-clear when nothing is left to settle) · Overdue sorted by
  balance × days · Due today · Due soon · Former tenants with dues. Invoices with a pending
  claim never appear in the reminder sections. Summary = rent + adhoc by billing_month,
  excluding draft/cancelled.

  ## Interfaces on disk
  Slice 1b's RentSettlementService.statement (used per leaving row — it also generates the
  final cut period, which is intended); Task 2's reminderState; 1a's periodLabel.

  ## Non-negotiable
  - The month-summary literal (9000 × 4 + 6000) depends on tenant F's cut September existing;
    if it is off, the engine run at "2026-10-10" did not generate it — investigate the window,
    do not change the literal.
  - No `_paise` in any output (the test asserts it).

  ## Report
  <workspace>/task-4-report.md. Reply with status, commits, test summary, concerns, report path.
```

### Task 5

```
model: sonnet
description: "Implement Task 5: tenant summary, history, invoice view, identity dispute"
prompt: |
  You are implementing Task 5 of a 7-task plan (PG rent read APIs): RentTenantService —
  summary across every residence the user matches (linked OR phone-matched, no auto-link on
  read), a hero per residence, history, the tenant invoice view with tenant-visible events,
  identity dispute and its operator-side resolve.

  Read your task brief first — code verbatim: <workspace>/task-5-brief.md

  ## Context (spec §9, §19 #14)
  A parent paying for two children sees both residences; the second can never be LINKED
  (unique index) but is still READ. Hero precedence: settled/leaving → awaiting → the
  oldest-due open invoice (overdue / partially_paid / due) → paid → nothing_due. The tenant
  invoice strips internal_note, rent_snapshot_inr, rent_source, suggested_late_fee_inr,
  reprorate_suggestion, and only shows events at or after issued_at from the visible list.

  ## Interfaces on disk
  Task 3 RentMessageService + RentPayInstructionService; slice 1b's RentSettlementService,
  RentReceiptService, receipt/payment/invoice DTO selects.

  ## Non-negotiable
  - The test proves reads do not auto-link (tenant_user_id stays null on the phone-matched
    assignment). Do not call lockTenantAssignment anywhere in this service.
  - The forbidden-fields regex in the test is a contract.

  ## Report
  <workspace>/task-5-report.md. Reply with status, commits, test summary, concerns, report path.
```

### Task 6

```
model: sonnet
description: "Implement Task 6: queue, tenant, portfolio and public controllers"
prompt: |
  You are implementing Task 6 of a 7-task plan (PG rent read APIs): four controllers and
  their supertest suite.

  Read your task brief first: <workspace>/task-6-brief.md

  ## Non-negotiable
  - Public routes: no guard, @Throttle 30/min, @Header("Cache-Control","no-store"), a
    43-char base64url token format check before touching the DB, assertRentFlag() first
    (flag off → 404 even for public routes). The receipt route answers 302 via @Res() and
    must not also return a value.
  - Override PG_RENT_RECEIPT_RENDERER in the test module so no Chromium is needed.
  - Every operator/tenant handler starts with assertRentFlag(); tenant routes use
    @Roles("tenant"); a tenant calling an operator route must get 403 (the test checks).

  ## Report
  <workspace>/task-6-report.md. Reply with status, commits, test summary, concerns, report path.
```

### Task 7

```
model: sonnet
description: "Implement Task 7: slice 1c verification and PR notes"
prompt: |
  You are running Task 7 of a 7-task plan: full verification of slice 1c.

  Read your task brief first: <workspace>/task-7-brief.md

  ## Non-negotiable
  - Paste every vitest summary line (the brief expects 165 pg-rent tests).
  - Step 2's public-surface grep must print nothing; paste the command and its (empty) output.
  - Step 3: verify spec §4.10/§12 already list the event and the two routes; run
    `graphify update .`.
  - Do NOT open the PR — write title and body into the report.

  ## Report
  <workspace>/task-7-report.md. Reply with status, commits, test summary, concerns, report path.
```

## Slice acceptance

- 165 pg-rent tests green.
- `curl -s http://localhost:4000/v1/public/pg-rent/pay/<token>` (API running with the flag on, a seeded invoice) returns `state`, `tenant_first_name`, `instruction.qr_svg` starting with `<svg`, and no key containing `phone`.
- `GET /v1/tenant/pg-rent/summary` for a phone with two beds returns two residences and leaves `tenant_user_id` untouched on the unlinked one.
- The backend is now complete for web slices 2–4; only slice 5 (analytics/export/expenses/preferences) and slice 6 (seed, nightly invariants, e2e, runbook) remain on the API side.
