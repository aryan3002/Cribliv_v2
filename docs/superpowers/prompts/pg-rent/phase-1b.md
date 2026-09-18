# Phase 1b — payments, invoice actions, late fees, receipts, settlement (9 tasks)

**Plan:** `docs/superpowers/plans/2026-09-17-pg-rent-slice1b-payments-settlement.md`
**Branch:** `feat/pg-rent-slice1b-payments-settlement` off `feat/pg-rent` (slice 1a merged)
**Delivers:** money moving — record/claim/confirm/reject/reverse/refund, excess de-allocation (invariant 14), invoice actions, late-fee sweep, receipt rendering queue, move-out settlement, booking forfeits, backfill.

This is the highest-risk slice. Every task after 2 writes allocations or fee lines. Reviews are Opus by default.

## Pre-flight specifics

- Ledger prefix: `RENT-1b`.
- Conflict scan rows to check first:
  - Task 4 defines `RentPaymentService(db, settings, alloc, receipts)` and Task 5 changes `RentInvoiceService`'s constructor to `(db, alloc, payments, engine)`; Task 7's `RentSettlementService(db, alloc, payments, invoices, engine)`. Every test file constructs these by hand in that order.
  - Task 6 changes `RentReceiptService`'s constructor to `(db, renderer, storage, sas)` and tells the executor to update Task 4/5's tests — the scan must confirm those edits land in Task 6, not be forgotten.
  - Task 4's `applyFeeDecision(client, alloc, ctx, decision, actor, { applyMode, reason })` is used by Task 5 (`applyFee`, `waiveFee`, `extendDue`) and Task 6 (sweep) — same signature.
  - Task 5 Step 4 moves `nextInvoiceNumber`/`newPayToken` out of the engine into `rent-numbering.ts`; the engine test from 1a must still pass afterwards.
  - Task 7 needs two small additions in other services (`insertSettlementInvoice`, `recordRefundInTransaction`) — named with signatures in the brief; the scan should note they are created in Task 7, not earlier.
  - `.hbs` templates must be copied to `dist` — Task 6 says to find how rent-agreement ships its templates and mirror it (`nest-cli.json` assets or a tsconfig include).
- **Chromium:** the receipt render integration test is skipped without `PG_RENT_TEST_CHROMIUM`; do not let a reviewer demand it.

## Routing

| Task                                      | Implementer | Reviewer     | Why                                                                                           |
| ----------------------------------------- | ----------- | ------------ | --------------------------------------------------------------------------------------------- |
| 1 — shared types + payment DTOs           | Haiku 4.5   | Sonnet       | Transcription with zod tests                                                                  |
| 2 — pure late-fee + allocation planning   | Sonnet      | **Opus**     | Pure, but the fee rules (grace, freeze, as-of) and FIFO order decide what tenants are charged |
| 3 — allocation mutations                  | Sonnet      | **Opus**     | Writes allocations; de-allocation newest-first; outflow funding                               |
| 4 — payment service + receipt mint        | Sonnet      | **Opus**     | `finalizeConfirmed` — the only path to `paid`; 933-line brief                                 |
| 5 — invoice actions + suggestions         | Sonnet      | **Opus**     | Every total-reducing edit; re-proration                                                       |
| 6 — late-fee sweep, receipt queue, worker | Sonnet      | Opus         | Sweep changes bills; SKIP LOCKED claim; asset config discovery                                |
| 7 — settlement                            | Sonnet      | **Opus**     | Deposit release + refund + write-down in one transaction                                      |
| 8 — controllers                           | Haiku 4.5   | Sonnet       | Route→schema→service glue; one handler fully written, the rest follow it                      |
| 9 — verification + PR notes               | Sonnet      | Opus (final) |                                                                                               |

Fix rounds on Tasks 3–7 that reach round 4 go to **Opus** as implementer.

## Dispatch prompts

### Task 1

```
model: haiku
description: "Implement Task 1: payment/receipt/settlement types and payment DTOs"
prompt: |
  You are implementing Task 1 of a 9-task plan that adds payments, receipts and settlement to
  the PG rent backend built in slice 1a.

  Read your task brief first — code and tests verbatim: <workspace>/task-1-brief.md

  ## Non-negotiable
  - Append to packages/shared-types/src/pg-rent.ts; do not reorder or rename the 1a types.
    Rebuild shared-types afterwards.
  - Every schema bound in the brief (₹1–₹10,00,000, 64-char reference, 3 proofs, methods that
    exclude gateway/deposit, claims that exclude cash) is a spec rule — copy exactly.

  ## Report
  <workspace>/task-1-report.md. Reply with status, commits, test summary, concerns, report path.
```

### Task 2

```
model: sonnet
description: "Implement Task 2: pure late-fee and allocation planning"
prompt: |
  You are implementing Task 2 of a 9-task plan (PG rent payments): computeLateFee /
  daysPastGrace and planAllocation / planDeallocation, pure, with 12 tests.

  Read your task brief first — code and tests verbatim: <workspace>/task-2-brief.md

  ## Context
  Spec §5.6: fees only accrue on the chargeable balance (balance minus the fee line); a zero
  chargeable balance freezes the fee; an as-of date inside grace REMOVES an existing fee
  (that is how a late-recorded cash payment is forgiven); flat/percent/override compute once.
  Spec §6.2: targets first, FIFO by due date, deposit before rent on ties, settlement last.
  Invariant 14: de-allocate newest allocation first.

  ## Non-negotiable
  - The rupee literals (22500, 3100, 20000…) are from the spec's formulas; recompute before
    touching a test.
  - No I/O in pure/.

  ## Report
  <workspace>/task-2-report.md with RED/GREEN. Reply with status, commits, test summary,
  concerns, report path.
```

### Task 3

```
model: sonnet
description: "Implement Task 3: allocation mutations"
prompt: |
  You are implementing Task 3 of a 9-task plan (PG rent payments): extending
  RentAllocationService with allocateInflow, deallocateExcess, releaseAllocations,
  removeAllocationsOf, fundOutflow, unallocatedCredit, openInvoices.

  Read your task brief first — code verbatim: <workspace>/task-3-brief.md

  ## Interfaces on disk (slice 1a)
  RentAllocationService.applyUnallocatedCredit / recomputeInvoice / lockInvoice; Task 2's
  planAllocation / planDeallocation.

  ## Non-negotiable
  - A claimed_invoice_id is a SOFT target (skipped if no longer open); explicit operator
    targets are HARD (400 invalid_allocation if any is not open). The brief encodes both.
  - fundOutflow must throw refund_exceeds_credit when credit is short — never partially fund.
  - assertRentInvariants after every step of the big test must pass.

  ## Report
  <workspace>/task-3-report.md. Reply with status, commits, test summary, concerns, report path.
```

### Task 4

```
model: sonnet
description: "Implement Task 4: payment service, finalizeConfirmed, receipt mint"
prompt: |
  You are implementing Task 4 of a 9-task plan (PG rent payments): rent-fee-line.ts helpers,
  RentReceiptService (mint/void/remint only), and RentPaymentService — recordByOperator,
  claimByTenant, cancelClaim, confirm, confirmBulk, reject, reverse, recordRefund,
  reallocate, recordBackfillPayment, releaseDeposit, and the private finalizeConfirmed.

  Read your task brief first — 933 lines, code verbatim; read all of it before writing:
  <workspace>/task-4-brief.md

  ## Context
  finalizeConfirmed is the ONLY code that can make an invoice paid (spec §6.1). It dry-runs
  the allocation to find invoices the payment settles, re-evaluates their late fee as of
  paid_on (removing it when paid_on is inside grace), then allocates for real, expires pay
  tokens on paid invoices, and mints a receipt for operator/tenant_claim/gateway sources
  only. Reversal is refused while the inflow funds a live outflow (invariant 15).

  ## Interfaces on disk
  Task 3 allocation methods; Task 2 computeLateFee; 1a's newPayToken is still private to
  the engine — this task uses randomBytes directly for refreshPayToken (Task 5 extracts the
  helper later; do not do that here).
  resolveTenantAssignmentIds is ADDED to rent-guards.ts by this task (Step 5).

  ## Non-negotiable
  - `amount_inr: null` is the sentinel for "the invoice balance" in the backfill path; both
    finalizeConfirmed and allocateInflow honour it — do not "type-fix" it away.
  - The numberToIndianWords regex in the test may need its literal adjusted to that
    function's real output (check words.format.ts:58); the behaviour is what matters.
  - Every test ends with assertRentInvariants; a violation is your bug.

  ## Report
  <workspace>/task-4-report.md. Reply with status, commits, test summary, concerns, report path.
```

### Task 5

```
model: sonnet
description: "Implement Task 5: invoice actions and re-proration suggestions"
prompt: |
  You are implementing Task 5 of a 9-task plan (PG rent payments): invoice action DTOs,
  the rent-numbering.ts extraction, RentInvoiceService mutations (lines, issueDraft,
  extendDue, cancel, applyFee, waiveFee, waiveAllFees, setEligibility, createManual,
  createBackfill, applyReprorate/dismiss/restore), and the engine's suggestion writer.

  Read your task brief first — code verbatim: <workspace>/task-5-brief.md

  ## Context
  Every mutation that can drop total below amount_paid goes through settleTotal →
  deallocateExcess (invariant 14). Rent, deposit and late_fee lines are locked (waive /
  re-prorate / issue are the only ways to change them). Suggestions live in the invoice's
  reprorate_suggestion jsonb and are written only by the engine hook; the owner applies,
  dismisses or restores.

  ## Interfaces on disk
  Task 4's RentPaymentService.recordBackfillPayment(client, ctx), rent-fee-line helpers;
  1a engine (you edit onAssignmentEvent and extract two private helpers into
  rent-numbering.ts — the 1a engine tests must still pass after Step 4).

  ## Non-negotiable
  - RentInvoiceService's constructor becomes (db, alloc, payments, engine); update the 1a
    controller test's module wiring only if it constructs the service by hand (it does not).
  - Restore puts the RENT LINE back (meta.reprorated), not an adjustment line — the spec was
    aligned to this (§5.8).
  - Run the whole pg-rent folder at the end.

  ## Report
  <workspace>/task-5-report.md. Reply with status, commits, test summary, concerns, report path.
```

### Task 6

```
model: sonnet
description: "Implement Task 6: late-fee sweep, receipt rendering queue, worker wiring"
prompt: |
  You are implementing Task 6 of a 9-task plan (PG rent payments): runPgRentLateFeeSweep,
  the Handlebars receipt renderer + templates, RentReceiptService rendering/queue/retry/
  download/share, the module's PDF storage and SAS providers, and worker wiring.

  Read your task brief first — code verbatim: <workspace>/task-6-brief.md

  ## Context
  Receipts get their own Azure container (pg-rent-receipts) so paths never collide with
  agreements. Both the API's immediate attempt and the worker claim rows with
  FOR UPDATE SKIP LOCKED so a receipt is never rendered twice. Five failures → failed;
  retry resets. A voided receipt re-renders with a VOID banner.

  ## Non-negotiable
  - RentReceiptService's constructor becomes (db, renderer, storage, sas). Update the
    hand-constructed instances in the Task 4 and Task 5 test files exactly as Step 6 says.
  - Find how rent-agreement ships its .hbs templates to dist (grep nest-cli.json /
    tsconfig / package.json for "hbs") and mirror it for pg-rent/receipt/templates. Report
    what you found.
  - The render unit test uses the HTML only; the real-Chromium test is skipIf'd. Do not
    require Chromium to pass.
  - The late-fee sweep never touches backfill, deposit, adhoc, settlement, exempt, waived,
    paused, or invoices with a pending claim — the SQL WHERE clause is the contract.

  ## Report
  <workspace>/task-6-report.md. Reply with status, commits, test summary, concerns, report path.
```

### Task 7

```
model: sonnet
description: "Implement Task 7: move-out settlement, deposit release, returns, forfeits"
prompt: |
  You are implementing Task 7 of a 9-task plan (PG rent payments): settlementNet (pure),
  the settle/forfeit zod schemas, and RentSettlementService — statement, settle, forfeit.

  Read your task brief first — code verbatim: <workspace>/task-7-brief.md

  ## Context (spec §6.11)
  statement() runs generation first so the final cut period exists. settle() in one
  transaction: refuse while a re-proration suggestion is pending; write the uncollected
  deposit down; create or REPLACE the settlement invoice's deduction lines; release the
  deposit as a non-cash inflow allocated FIFO (settlement last); fund the optional return
  from credit; ledger everything. Reversal order is enforced by invariant 15 (reverse the
  refund before the release).

  ## Interfaces on disk
  Task 4 releaseDeposit(client, ctx) and (added here) recordRefundInTransaction; Task 5's
  insertInvoice (you add the public insertSettlementInvoice wrapper the brief specifies);
  Task 3 unallocatedCredit / applyUnallocatedCredit.

  ## Non-negotiable
  - The two cross-service additions (insertSettlementInvoice, recordRefundInTransaction) are
    part of THIS task; implement them with the exact signatures the brief gives.
  - `maintenance_prefills` reads pg_maintenance_requests.chargeable_damage and
    resolution_cost_paise (verified to exist in 0064).
  - Every test ends with assertRentInvariants.

  ## Report
  <workspace>/task-7-report.md. Reply with status, commits, test summary, concerns, report path.
```

### Task 8

```
model: haiku
description: "Implement Task 8: payment, invoice-action, settlement and tenant-claim controllers"
prompt: |
  You are implementing Task 8 of a 9-task plan (PG rent payments): four controllers whose
  handlers are route → zod schema → service call, following the one fully written handler
  in the brief.

  Read your task brief first: <workspace>/task-8-brief.md

  ## Non-negotiable
  - Declare `payments/confirm-bulk` BEFORE `payments/:id/confirm` or Nest matches
    "confirm-bulk" as an id.
  - Money-creating routes (POST /payments, POST /refunds, POST /invoices, POST …/settle) use
    requireIdempotencyKey + IdempotencyService.run AND pass the key to the service, which
    stores it on the row. Both, not one.
  - For POST /invoices, strip `source` from the body before parsing with the chosen schema.
  - Every handler starts with assertRentFlag().

  ## Report
  <workspace>/task-8-report.md. Reply with status, commits, test summary, concerns, report path.
```

### Task 9

```
model: sonnet
description: "Implement Task 9: slice 1b verification and PR notes"
prompt: |
  You are running Task 9 of a 9-task plan: full verification of slice 1b.

  Read your task brief first: <workspace>/task-9-brief.md

  ## Non-negotiable
  - Step 2 adds an assertRentInvariants sweep over every fixture property to each
    integration suite's afterAll — do it, re-run, and paste the summary lines (the brief
    expects 140 pg-rent tests).
  - Step 3's grep must show no DTO output field named *_paise, pay_token or share_token.
  - Step 4: verify the two owner-only event types are in spec §4.10 (pre-added) and run
    `graphify update .`.
  - Do NOT open the PR — write title and body into the report.

  ## Report
  <workspace>/task-9-report.md. Reply with status, commits, test summary, concerns, report path.
```

## Slice acceptance

- 140 pg-rent tests green; every suite's `afterAll` invariant sweep passes.
- `grep -rn "receipt_number" apps/api/src/modules/pg-rent/services/rent-payment.service.ts` shows no numbering logic outside `RentReceiptService.mint` (one mint path).
- A backfill payment leaves no `pg_rent_receipts` row; a deposit release leaves none.
- Worker boots with the flag on and logs no error; `.hbs` files are present under `apps/api/dist/…/receipt/templates/` after `pnpm --filter @cribliv/api build`.
