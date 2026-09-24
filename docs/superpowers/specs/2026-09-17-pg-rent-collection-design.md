# PG Rent Collection — Design Spec

**Date:** 2026-09-17
**Status:** Approved (brainstorming, sections 1–10 reviewed with the owner) · **Revised 2026-09-17** after the critical review in §19 — every finding there has a disposition, and the sections it touches are updated in place. D16–D20 record the decisions the owner made during that review.
**Scope:** Rent collection management for PG operators (invoices, payments, receipts, reminders, expenses, analytics, export), **move-out settlement (deposit − dues − damages, refunds)**, the tenant-side rent experience, and the structural lift of the existing PG management surfaces into a Property Workspace. Online payment through Cribliv is **out of scope now** and designed for as a future rail.
**Feature flags:** `NEXT_PUBLIC_FF_PG_WORKSPACE_V2` (shell), `FF_PG_RENT_COLLECTION` + `NEXT_PUBLIC_FF_PG_RENT_COLLECTION` (module), `FF_PG_RENT_GATEWAY` (future), `FF_PG_RENT_AUTO_REMINDERS` (future).
**Related:** `2026-07-15-pg-operator-management-ux-design.md` (light `--d-*` tokens, toast/menu/skeleton primitives, bed tiles), `2026-07-12-pg-operations-v2-plan.md`, `2026-07-14-maintenance-ops-v2-plan.md`, `2026-07-15-pg-tenant-residence-redesign-design.md`.

---

## 0. Decisions log (locked during brainstorming)

| #   | Decision                                                                                                                                                                                                                                                                                                                                                                                                                                      | Rationale                                                                                                                                                                             |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | **No money flows through Cribliv now.** Tenants pay the owner directly (UPI to the owner's VPA, bank transfer, cash). A gateway (Razorpay) is a _future rail_ behind `FF_PG_RENT_GATEWAY`; settings shows a disabled "coming soon" card.                                                                                                                                                                                                      | Owner's call; keeps fees at zero and avoids merchant onboarding; the model must not need a migration when the gateway arrives.                                                        |
| D2  | **Paise in the DB, rupees everywhere a human or the web touches.** New tables store `*_paise bigint` (codebase invariant; the invoice's rent is copied from three existing paise columns). API DTOs and UI use whole-rupee integers with an `_inr` suffix. Every computed amount is rounded to the nearest whole rupee.                                                                                                                       | One conversion point at the module boundary instead of three read paths where a `/100` can be forgotten.                                                                              |
| D3  | **WhatsApp is click-to-chat (`wa.me`) in both directions, with owner-customisable messages.** No automated sends now.                                                                                                                                                                                                                                                                                                                         | Automated WABA sends require Meta-approved fixed wording; customisation and auto-send are mutually exclusive. The app computes D-3/D-0/D+1 states and presents a queue; a human taps. |
| D4  | **Billing cycle is a per-property setting (`calendar_month` or `anniversary`) with a per-tenant due-day override.** Analytics are always calendar-month buckets.                                                                                                                                                                                                                                                                              | Both cycles exist in real PGs; owners still think in months.                                                                                                                          |
| D5  | **A tenant's "I've paid" claim never counts as collected until the owner confirms.** Both paths (owner records; tenant claims → owner confirms) ship from day one.                                                                                                                                                                                                                                                                            | The owner's bank account is the only source of truth without a gateway.                                                                                                               |
| D6  | **Late fee policy is entirely under the owner's control:** per property (on/off, grace, kind, amount, cap, auto-apply), per tenant (exempt, override), waive per invoice, bulk waive. `auto_apply` defaults to **false** (the sweep _suggests_, the owner adds with a tap). Policy ships off by default.                                                                                                                                      | Nothing changes a tenant's bill without a tap until the owner opts in.                                                                                                                |
| D7  | **Invoices are editable until paid; partial payments, overpayment → credit, and advance payments are supported from day one.** Every edit is logged and visible to the tenant.                                                                                                                                                                                                                                                                | A ledger that can't do partials is a ledger owners stop trusting.                                                                                                                     |
| D8  | **Existing tenants are invoiced from the current cycle forward only.** Owners back-enter history explicitly. Nothing is auto-invented as overdue.                                                                                                                                                                                                                                                                                             | Production has active tenants who paid in cash.                                                                                                                                       |
| D9  | **Tenants not on Cribliv are fully supported** via `occupant_phone_e164`; signing up with the same phone links them (existing phone-match precedent).                                                                                                                                                                                                                                                                                         | Nothing blocks the owner.                                                                                                                                                             |
| D10 | **Expenses are in scope** (minimal log with categories, bills, units × rate for electricity, "split across tenants").                                                                                                                                                                                                                                                                                                                         | A revenue dashboard without expenses is not a P&L.                                                                                                                                    |
| D11 | **Customisation is bounded:** policies as settings, message templates with merge fields, widget board, saved views, column chooser, free-text expense categories. No formula builder, no custom statuses, no per-tenant custom fields.                                                                                                                                                                                                        | "My dashboard, my rules" without building a BI tool.                                                                                                                                  |
| D12 | **Analytics must be meaningful:** every metric has an accountant-reproducible definition and leads to a filtered view or an action. Two lenses (billing / cash), never mixed in one tile.                                                                                                                                                                                                                                                     |                                                                                                                                                                                       |
| D13 | **Rent becomes its own NestJS module (`pg-rent`)**, DB-required like `pg-operations` (no in-memory twin).                                                                                                                                                                                                                                                                                                                                     | `pg-operations` maintenance service is already 2,300 lines; a ledger with two behaviours is a liability.                                                                              |
| D14 | **Nothing financial is ever deleted.** Mistakes are reversed (payments) or cancelled (invoices) with a reason; receipts are voided, not removed.                                                                                                                                                                                                                                                                                              | Audit trail is the product.                                                                                                                                                           |
| D15 | **The management surfaces move under a Property Workspace shell** (tabs), shipped first behind its own flag.                                                                                                                                                                                                                                                                                                                                  | Management is currently unreachable from the header nav.                                                                                                                              |
| D16 | **Billing timing is a per-property setting: `advance` (default) or `arrears`.** Advance: the period's rent is due inside the period (October rent due 5 Oct). Arrears: due in the month after the period ends (September rent due 5 Oct).                                                                                                                                                                                                     | §19 #4 — the original spec used both conventions in different sections. Both are common in Indian PGs; one engine with one extra fixture set.                                         |
| D17 | **Move-out settlement ships in the MVP.** Deposit held + credit − open dues − deductions (damages, cleaning) = net; net > 0 is returned as a logged **outflow** payment, net < 0 stays collectible. Payments carry a `direction` (`inflow`/`outflow`); an outflow is funded from specific inflows' credit through allocation rows, so returned money can never be applied twice.                                                              | §19 #6 — without an outflow the ledger lies from the first move-out ("Deposits held" silently drops, credit is stranded, refunds are invisible).                                      |
| D18 | **Final-period re-proration is owner-tapped, never automatic.** Notice / move-out puts a "Tenant leaving on X — re-prorate to ₹Y?" row in the queue; nothing changes a bill until the owner taps; a cancelled notice removes the row.                                                                                                                                                                                                         | §19 #5 — `notice_end_date` is tenant-set and format-validated only; it must not drive a paid-invoice reduction.                                                                       |
| D19 | **Backfill payments never mint receipts.** They are ledger-only ("recorded from history"); receipt numbers stay in issue order.                                                                                                                                                                                                                                                                                                               | §19 #12 — entering history must not burn numbers or render PDFs.                                                                                                                      |
| D20 | **An ownership transfer pauses rent collection and clears payee details.** The new operator confirms VPA / bank / WhatsApp and resumes; pending claims wait for the new operator.                                                                                                                                                                                                                                                             | §19 #1 — settings travel with the property; the old owner's VPA must never keep receiving rent after a transfer.                                                                      |
| D21 | **A cancelled rent period is never re-issued.** Cancelling is a deliberate operator act (waiver, duplicate, goodwill month); the sweep must not silently regenerate it. Invariant 11 is therefore contiguity over non-cancelled periods, with a gap permitted exactly where a cancellation exists — which is what makes it expressible in `assertRentInvariants`. _Decided 2026-09-23 at the slice-1a boundary; binds 1b's §5.7 cancel flow._ |
| D22 | **`settled_on` is cleared when an invoice re-opens.** It means "currently settled" and is derived from status, so a date on an invoice that again carries a balance would be a lie every report inherits. It stays write-once _while_ settled (`COALESCE`), and the event log remains the audit trail for when settlement happened. _Decided 2026-09-23; confirms the behaviour already in `recomputeInvoice`; binds 1b's reversal paths._    |
| D23 | **An explicit `0` deposit means no deposit; NULL means "use the chain".** The assignment → room type → listing walk stops at the first non-NULL value, so an operator who waives a tenant's deposit no longer silently inherits the room-type default. _Decided 2026-09-23; implemented in slice 1a `resolveDeposit`._                                                                                                                        |

---

## 1. Problem, goals, non-goals

### Problem

The PG management dashboard (tenants, beds, maintenance) is live but rent — the operator's daily job — is untracked. Operators use notebooks or paid apps. Cribliv's positioning is _fewer rupees, not fewer features_: the rent module must match what paid PG software does (reminders, per-bed status, receipts, revenue dashboard) with zero transaction fees, and with a UX that beats them.

### Goals

- An owner can, in under a minute a day, see who owes what, chase them on WhatsApp, and record what came in.
- Every rupee is traceable: invoice → payment → receipt → event.
- Tenants see exactly what they owe, pay the owner directly, mark it paid, and get a numbered PDF receipt.
- Month-wise, bed-wise, room-wise, tenant-wise numbers that mean something, exportable as CSV for any date range.
- The owner controls policy (cycle, due day, billing timing, late fee, messages, receipts) and layout (widgets, views) without the app dictating one workflow.
- A tenant leaving is settled in-app: deposit − dues − deductions, the refund recorded, both sides see the statement.
- The gateway can be added later as a third payment rail with **no new tables** (an `initiated` payment status may be added then; see §6.9).
- The existing management UI is lifted to a coherent workspace while building this.

### Non-goals (this MVP)

- Money movement through Cribliv, payouts, KYC.
- Automated WhatsApp/SMS/push/email sends (no push or email infrastructure exists; email has no column on `users`).
- Staff/manager roles and permissions (none exist; the event model leaves the slot).
- Settlement **statement PDF** (the settlement itself is in scope, §6.11; the printable statement is a follow-up).
- Meter-reading ledger, CSV import of history, agreement generation, GST invoicing.
- Any change to the marketing dashboard beyond one "Manage property" card.
- Relaxing `uq_pg_active_assignment_per_tenant` (one linked user ↔ one active bed). The rent module reads across every assignment a user matches (§9) but cannot _link_ a second one; that index change is a pg-operations follow-up (§18).

---

## 2. Grounding — what exists and is reused (verified in code)

| Piece                              | Where                                                                                                                                                                                                                                                                                                | How it's used                                                                                                                                                                            |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Assignment lifecycle & rent fields | `pg_bed_assignments` (0062): `monthly_rent_paise` (override, null = inherit), `security_deposit_paise`, `move_in_date` (**nullable**), `notice_end_date`, `move_out_date`, statuses `reserved → active → notice_served → move_out_requested → move_out_pending_confirmation → moved_out / cancelled` | Invoices hang off assignments; billing window per §5.2 (status-aware — `cancelMoveOut` at `pg-bed-assignment.service.ts:753` returns to `active` **without clearing `notice_end_date`**) |
| Assignment date writers            | `pg-bed-assignment.service.ts:543, :574` (`move_in_date = COALESCE($n, CURRENT_DATE)`), `:653` and the tenant twin (`move_out_date = CURRENT_DATE` on `moved_out`), `:915` (`notice_served_date = CURRENT_DATE`). No session timezone is pinned anywhere → `CURRENT_DATE` is UTC on Azure            | **Changed in slice 0** (§19 #10): these become IST dates, and operator move-out accepts an explicit `move_out_date`                                                                      |
| Effective rent resolution          | `pg-residence.service.ts:135`: `COALESCE(a.monthly_rent_paise, rt.monthly_rent_paise, pl.starting_rent_paise)`                                                                                                                                                                                       | Reused, with `rent_source` recorded and the `listing` fallback forced to `draft`                                                                                                         |
| Deposit resolution                 | `a.security_deposit_paise` → **`pg_room_types.security_deposit_paise` (0065, per-sharing)** → `pg_details.security_deposit_paise`. The residence service skips the room-type step (`pg-residence.service.ts:137`) — a pre-existing gap, noted in §17                                                 | Deposit invoices (§5.5)                                                                                                                                                                  |
| Listing-level terms                | `pg_details.rent_due_day` (1–28), `electricity_mode`, `late_fee_policy` (free-form jsonb, never shaped)                                                                                                                                                                                              | `rent_due_day` seeds the property setting once; `late_fee_policy` stays marketing copy                                                                                                   |
| Tenant ↔ user linking              | `lockTenantAssignment` (phone match, auto-links `tenant_user_id`); `queryResidence` (`pg-residence.service.ts:180`) resolves **one** assignment (`LIMIT 1`); `uq_pg_active_assignment_per_tenant` allows one active bed per linked user                                                              | Rent tenant endpoints read across **all** matching assignments and never auto-link on read (§9)                                                                                          |
| Ownership transfer                 | `admin/admin-pg-transfer.service.ts:181` re-points `pg_properties.operator_id`; every child table moves untouched                                                                                                                                                                                    | Gains a rent hook (§11.2, D20)                                                                                                                                                           |
| Ownership guard                    | `assertManagedOwnership(operatorId, propertyId)` in pg-operations (also requires `manage_enabled = true`)                                                                                                                                                                                            | Every operator call                                                                                                                                                                      |
| Transactions                       | `apps/api/src/common/transaction.ts`                                                                                                                                                                                                                                                                 | All multi-row writes                                                                                                                                                                     |
| Notifications queue                | `outbound_events` with `dedupe_key` (0004)                                                                                                                                                                                                                                                           | Reserved for the future auto-reminder rail                                                                                                                                               |
| WhatsApp client                    | `notifications/whatsapp.client.ts` (D7/Meta/mock)                                                                                                                                                                                                                                                    | Not used now (D3); future rail                                                                                                                                                           |
| PDF pipeline                       | `rent-agreement/pdf/browser-pool.ts`, `puppeteer-pdf-renderer.ts`, `azure-pdf-storage.ts`; `rent-agreement/downloads/azure-sas-issuer.ts`                                                                                                                                                            | Receipts reuse browser pool, renderer style, storage, SAS downloads. `PdfJobQueueService` is hard-wired to `agreementId` — **not** reused; the receipts table is its own queue           |
| Sweep claim pattern                | `worker/maintenance-sweeps.ts` (`FOR UPDATE SKIP LOCKED`, batch, per-batch transaction)                                                                                                                                                                                                              | Receipt render queue and invoice sweep copy it                                                                                                                                           |
| Rate limiting                      | `common/conditional-throttler.guard.ts` (Nest throttler, disabled outside prod via `DISABLE_RATE_LIMIT`)                                                                                                                                                                                             | Public pay / receipt endpoints                                                                                                                                                           |
| Amount in words                    | `rent-agreement/format/words.format.ts` `numberToIndianWords`                                                                                                                                                                                                                                        | Receipts                                                                                                                                                                                 |
| Photo uploads                      | `owner/azure-blob-photo-storage.service.ts` (`validatePresignRequest`, presign/complete) — injected into maintenance                                                                                                                                                                                 | Claim screenshots, expense bills, receipt logo                                                                                                                                           |
| Webhook rail                       | `payments.controller.ts` (HMAC, dedupe, `FOR UPDATE`)                                                                                                                                                                                                                                                | Future gateway branch                                                                                                                                                                    |
| Worker                             | `apps/api/src/worker/worker.ts` + per-domain sweep files                                                                                                                                                                                                                                             | `pg-rent-sweeps.ts`                                                                                                                                                                      |
| Feature flags                      | `config/feature-flags.ts` (`readFeatureFlags`), `apps/web/lib/feature-flags.ts` (`useFlag`: env or PostHog)                                                                                                                                                                                          | Per-user dogfooding via PostHog before env flip                                                                                                                                          |
| UI primitives                      | `components/ui/toast`, `ui/menu`, `ui/skeleton`; light `--d-*` tokens; `PgBedChip`/`PgBedGrid`                                                                                                                                                                                                       | Extended, not forked                                                                                                                                                                     |
| Telemetry                          | `common/telemetry` `logTelemetry`                                                                                                                                                                                                                                                                    | All sweeps and money events                                                                                                                                                              |
| Cache                              | `pg-operator/services/bounded-ttl-cache.ts`                                                                                                                                                                                                                                                          | Fallback if summary gets hot (not used initially)                                                                                                                                        |
| i18n                               | `apps/web/lib/i18n.ts` inline dictionary (en/hi)                                                                                                                                                                                                                                                     | All new strings                                                                                                                                                                          |
| Middleware                         | `apps/web/middleware.ts` — the `matcher` (`:296`) lists protected and content-negotiated paths only; `/{locale}/pay` is not matched, so it is public without an entry in `PUBLIC_PREFIXES`                                                                                                           | Pay page needs no middleware change; it is listed here so nobody adds one                                                                                                                |

**Does not exist:** push notifications, email, operator preferences/settings tables, a QR library, staff roles, bed-status history, user deletion or phone-change paths (so `pg_properties.operator_id ON DELETE CASCADE` — which would cascade into every rent table — has no live trigger; D14 relies on that staying true).

---

## 3. Domain model

```
Settings  ──decide when & how much──▶  Invoice ──made of──▶ Lines
                                          ▲
Payment(inflow) ──Allocation──────────────┘   (one payment ↔ many invoices, one invoice ↔ many payments)
   │      │  unallocated remainder = tenant credit
   │      └──Allocation──▶ Payment(outflow)   (a refund is *funded* from specific inflows' credit, FIFO)
   └── confirmed ──mints──▶ Receipt (immutable snapshot, voidable; not for backfill / deposit-release)
Payment(outflow) = money returned to the tenant; it is the target of allocations, never their source; no receipt
Settlement = a `settlement` invoice (deductions) + a deposit-release inflow (method `deposit`) allocated to open dues + an outflow funded from the remainder
Expense  (beside, for net)
Event    (every mutation, same transaction)
Derived, never stored: overdue, days-late, tenant credit, deposit held, reminder state, every analytic.
```

### Invariants (enforced in service transactions; each is a test)

1. `invoice.total_paise = Σ lines.amount_paise` and `≥ 0`.
2. `invoice.amount_paid_paise = Σ allocations.amount_paise` over allocations _to that invoice_ whose payment is `confirmed`. Pending claims allocate nothing.
3. `Σ allocations of an inflow (to invoices and to outflows) ≤ inflow.amount_paise`; the remainder is that inflow's unallocated credit. **Tenant credit** = Σ unallocated credit over the assignment's confirmed inflows.
4. `status` is a pure function of `(draft, cancelled, total, amount_paid)`: `draft`; `cancelled`; `paid` iff `amount_paid = total`; `partially_paid` iff `0 < amount_paid < total`; else `issued`. No other combination can be written. (Equality, not `≥`, because of invariant 14.)
5. At most one non-cancelled `rent` invoice per `(assignment_id, period_start)`, and **no two non-cancelled `rent` invoices of one assignment overlap in `[period_start, period_end]`** (service check under the assignment-row lock; see §4.4). At most one non-cancelled `deposit` and one non-cancelled `settlement` invoice per assignment.
6. Lines of a `paid` invoice are immutable at commit boundaries (see §6.6); receipts are immutable (voidable).
7. Nothing is ever "marked paid": cash is a payment row with `method = cash`.
8. Every mutation writes a `pg_rent_events` row in the same transaction.
9. Every computed amount is rounded to the nearest whole rupee (100 paise). No fractional-rupee amount exists in the module. When one amount is split across N parties, largest-remainder rounding makes the parts sum exactly to the whole.
10. All date logic uses the IST calendar date (`(now() AT TIME ZONE 'Asia/Kolkata')::date`), never UTC — including the assignment dates the engine consumes, which slice 0 makes IST at the writer (§2).
11. For any assignment, generated billing periods are **contiguous**: the next period starts the day after the last issued period ended (or on move-in). The cycle mode only decides where a period _ends_; `billing_timing` only decides where the due date _falls_.
12. `billing_starts_on` is a **floor**: periods whose _natural_ due date is below it are never auto-generated (they are backfill territory). Contiguity applies among generated periods.
13. Policy changes never retroactively edit issued invoices; the owner acts explicitly (waive, extend, edit line).
14. **`amount_paid_paise ≤ total_paise` always.** Any mutation that would reduce `total` below `amount_paid` (line removed or reduced, fee removed by Extend-due, fee waived, re-proration, cancellation) de-allocates the excess in the same transaction — newest allocation first — and that excess becomes the payment's unallocated credit. §6.6 is the procedure; this invariant is why it applies to _every_ total-reducing mutation, not only to `paid` invoices.
15. An outflow (`direction = outflow`) is **fully funded**: `Σ allocations targeting it = outflow.amount_paise`, sourced FIFO from the assignment's confirmed inflows' unallocated credit. So an outflow can never exceed tenant credit, money returned is never auto-applied again, and reversing an outflow (its allocations go) restores the credit. An inflow that funds a confirmed outflow cannot be reversed until the outflow is (409 `reverse_outflow_first`). Outflows never mint receipts.
16. `late_fee` lines exist only on `rent` invoices with `late_fee_eligible = true`; the sweep never touches `backfill` invoices, drafts, deposits, adhoc or settlement invoices.

---

## 4. Data model — migration `0072_pg_rent_collection.sql` (+ `.rollback.sql`)

Conventions from 0062/0064: uuid ids, Postgres `ENUM` types via `DO $$ … EXCEPTION WHEN duplicate_object`, `*_paise bigint`, jsonb for blob path lists, `trigger_set_updated_at`, partial unique indexes. All tables carry `pg_property_id` (`ON DELETE CASCADE`, matching maintenance); links to assignments/invoices/payments are `ON DELETE RESTRICT`. Additive only.

### 4.1 Enums

```
pg_rent_cycle_mode          ('calendar_month','anniversary')
pg_rent_billing_timing      ('advance','arrears')
pg_rent_proration_mode      ('actual_days','flat_30')
pg_rent_late_fee_kind       ('flat','per_day','percent')
pg_rent_invoice_kind        ('rent','deposit','adhoc','settlement')
pg_rent_invoice_status      ('draft','issued','partially_paid','paid','cancelled')
pg_rent_invoice_source      ('auto','manual','backfill')
pg_rent_rent_source         ('assignment','room_type','listing','none')
pg_rent_line_kind           ('rent','deposit','late_fee','electricity','meals','maintenance','damage','cleaning','forfeit','other','discount','adjustment')
pg_rent_line_source         ('system','operator','default_item','expense_split')
pg_rent_payment_direction   ('inflow','outflow')
pg_rent_payment_method      ('cash','upi','bank_transfer','cheque','card','gateway','deposit','other')
pg_rent_payment_source      ('operator','tenant_claim','gateway','backfill','deposit_release')
pg_rent_payment_status      ('pending_confirmation','confirmed','rejected','reversed')
pg_rent_receipt_pdf_status  ('pending','ready','failed')
pg_rent_pause_reason        ('owner','transfer')
```

`method = deposit` / `source = deposit_release` is the non-cash inflow that moves a held deposit onto open dues at settlement (§6.11); it is excluded from every cash metric.

### 4.2 `pg_rent_settings` — one row per property; its existence = rent collection enabled

| Column                                                                | Type                                                    | Notes                                                                                                                                                                                                                                                                                           |
| --------------------------------------------------------------------- | ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pg_property_id`                                                      | uuid PK → `pg_properties`                               |                                                                                                                                                                                                                                                                                                 |
| `paused_at`                                                           | timestamptz                                             | "Pause automatic invoicing"; null = running                                                                                                                                                                                                                                                     |
| `pause_reason`                                                        | `pg_rent_pause_reason`                                  | set with `paused_at`; `transfer` drives the new operator's banner (§11.2)                                                                                                                                                                                                                       |
| `enabled_on`                                                          | date NOT NULL                                           | the day rent collection was first enabled; never changes; deposit eligibility floor (§5.5)                                                                                                                                                                                                      |
| `billing_starts_on`                                                   | date NOT NULL                                           | rent-period floor (invariant 12); chosen (with preview) on enable and on resume, default today                                                                                                                                                                                                  |
| `cycle_mode`                                                          | `pg_rent_cycle_mode` NOT NULL DEFAULT `calendar_month`  |                                                                                                                                                                                                                                                                                                 |
| `billing_timing`                                                      | `pg_rent_billing_timing` NOT NULL DEFAULT `advance`     | D16; where the due date falls relative to the period (§5.3)                                                                                                                                                                                                                                     |
| `due_day`                                                             | smallint NOT NULL CHECK 1..28                           | seeded from `pg_details.rent_due_day` else 1; ignored in anniversary mode                                                                                                                                                                                                                       |
| `proration_mode`                                                      | `pg_rent_proration_mode` NOT NULL DEFAULT `actual_days` |                                                                                                                                                                                                                                                                                                 |
| `prorate_move_out`                                                    | boolean NOT NULL DEFAULT false                          |                                                                                                                                                                                                                                                                                                 |
| `invoice_lead_days`                                                   | smallint NOT NULL DEFAULT 5 CHECK 0..15                 |                                                                                                                                                                                                                                                                                                 |
| `reminder_offsets_days`                                               | smallint[] NOT NULL DEFAULT `{-3,0,1}`                  | 1–5 values in −15..30, normalised (sorted, deduped) on save                                                                                                                                                                                                                                     |
| `late_fee_enabled`                                                    | boolean NOT NULL DEFAULT false                          |                                                                                                                                                                                                                                                                                                 |
| `late_fee_grace_days`                                                 | smallint NOT NULL DEFAULT 3 CHECK 0..30                 |                                                                                                                                                                                                                                                                                                 |
| `late_fee_kind`                                                       | `pg_rent_late_fee_kind` NOT NULL DEFAULT `flat`         |                                                                                                                                                                                                                                                                                                 |
| `late_fee_amount_paise`                                               | bigint NOT NULL DEFAULT 10000 CHECK 100..1000000        | flat / per day                                                                                                                                                                                                                                                                                  |
| `late_fee_percent_bp`                                                 | smallint NOT NULL DEFAULT 200 CHECK 50..1000            | basis points of unpaid balance                                                                                                                                                                                                                                                                  |
| `late_fee_cap_paise`                                                  | bigint CHECK ≤ 5000000                                  | null = no cap                                                                                                                                                                                                                                                                                   |
| `late_fee_auto_apply`                                                 | boolean NOT NULL DEFAULT false                          | false = suggest only                                                                                                                                                                                                                                                                            |
| `upi_vpa`                                                             | text                                                    | `^[\w.-]{2,256}@[a-zA-Z]{2,64}$`                                                                                                                                                                                                                                                                |
| `upi_payee_name`                                                      | text                                                    | ≤ 50                                                                                                                                                                                                                                                                                            |
| `bank_details`                                                        | jsonb                                                   | `{account_name, account_number, ifsc, bank_name}` validated at the edge                                                                                                                                                                                                                         |
| `whatsapp_phone_e164`                                                 | text                                                    | null → operator's phone at read time                                                                                                                                                                                                                                                            |
| `msg_reminder`, `msg_overdue`, `msg_tenant_paid`, `msg_receipt_share` | text                                                    | ≤ 600 chars; null → code default in operator locale                                                                                                                                                                                                                                             |
| `receipt_prefix`                                                      | text NOT NULL                                           | 2–6 `[A-Z0-9]`; default from `pg_properties.internal_code` or initials                                                                                                                                                                                                                          |
| `receipt_business_name`, `receipt_address`, `receipt_footer`          | text                                                    | ≤ 80 / 200 / 200                                                                                                                                                                                                                                                                                |
| `receipt_logo_path`                                                   | text                                                    | blob path                                                                                                                                                                                                                                                                                       |
| `default_line_items`                                                  | jsonb NOT NULL DEFAULT `[]`                             | `[{key, kind, label, amount_paise}]`, ≤ 10, kind ∉ {rent, deposit, late_fee}                                                                                                                                                                                                                    |
| `electricity_unit_rate_paise`                                         | integer                                                 | 50..5000 (₹0.50–₹50). A _rate_, not an amount: the DTO field is `electricity_unit_rate_inr` as a decimal with two places (e.g. `8.5`) — the one deliberate exception to whole-rupee DTOs (§19 #49). Line amounts derived from it (`units × rate`) are rounded to the rupee like everything else |
| `created_at`, `updated_at`                                            | timestamptz                                             | `updated_at` is the optimistic-concurrency token for PATCH. Only the owner's PATCH, `enable`, `pause`, `resume` and the transfer hook write this row, so the token only moves when settings actually change                                                                                     |

### 4.2b `pg_rent_counters` — sequence counters, deliberately not on the settings row

`pg_property_id uuid PK → pg_properties CASCADE`, `next_invoice_seq integer NOT NULL DEFAULT 1`, `next_receipt_seq integer NOT NULL DEFAULT 1`. No `updated_at`, no trigger. Bumped under `SELECT … FOR UPDATE` inside the issuing transaction (a rolled-back issue rolls the bump back too, so numbers have no gaps from failures); never reset. Created with the settings row. (§19 #7: every invoice and receipt used to touch the settings row, which would have 409'd every open Settings form.)

### 4.3 `pg_bed_assignments` — additive columns (same "null = inherit" precedent as `monthly_rent_paise`)

| Column                    | Type                           | Notes                                                                                                                                 |
| ------------------------- | ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------- |
| `rent_due_day`            | smallint CHECK 1..28           | calendar mode: due day in the month; anniversary mode: the cycle anchor day (period starts on it). One meaning: _the day rent is due_ |
| `late_fee_exempt`         | boolean NOT NULL DEFAULT false |                                                                                                                                       |
| `late_fee_override_paise` | bigint                         | flat amount applied once, replaces the computed fee                                                                                   |
| `default_item_overrides`  | jsonb NOT NULL DEFAULT `{}`    | `{exclude: [key, …]}` — default line items this tenant doesn't get                                                                    |

### 4.4 `pg_rent_invoices`

| Column                                                              | Type                                 | Notes                                                                                                                                                                       |
| ------------------------------------------------------------------- | ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`                                                                | uuid PK                              |                                                                                                                                                                             |
| `pg_property_id`                                                    | uuid NOT NULL → properties CASCADE   |                                                                                                                                                                             |
| `assignment_id`                                                     | uuid NOT NULL → assignments RESTRICT |                                                                                                                                                                             |
| `bed_id`, `room_id`                                                 | uuid → beds / rooms SET NULL         | snapshot for grouping                                                                                                                                                       |
| `room_number`, `bed_label`                                          | text NOT NULL                        | snapshot for CSV/receipts                                                                                                                                                   |
| `kind`                                                              | `pg_rent_invoice_kind` NOT NULL      |                                                                                                                                                                             |
| `invoice_number`                                                    | text NOT NULL                        | `{prefix}-INV-{seq:04}`; UNIQUE `(pg_property_id, invoice_number)`                                                                                                          |
| `period_start`, `period_end`                                        | date                                 | null for deposit/adhoc/settlement; CHECK `period_end ≥ period_start`                                                                                                        |
| `billing_month`                                                     | date NOT NULL                        | first of month of `period_start`, else of `due_date`; indexed. Unaffected by `billing_timing` — "September rent" is September in both timings                               |
| `due_date`                                                          | date NOT NULL                        | editable ("Extend due date")                                                                                                                                                |
| `status`                                                            | `pg_rent_invoice_status` NOT NULL    |                                                                                                                                                                             |
| `source`                                                            | `pg_rent_invoice_source` NOT NULL    |                                                                                                                                                                             |
| `total_paise`, `amount_paid_paise`                                  | bigint NOT NULL DEFAULT 0            | denormalised, recomputed in every mutating transaction; CHECK `amount_paid_paise <= total_paise` (invariant 14, also at the DB)                                             |
| `rent_snapshot_paise`                                               | bigint                               | resolved monthly rent at generation                                                                                                                                         |
| `rent_source`                                                       | `pg_rent_rent_source`                | `listing`/`none` ⇒ created as `draft`                                                                                                                                       |
| `proration_factor`                                                  | numeric(9,6)                         | null when not prorated                                                                                                                                                      |
| `late_fee_eligible`                                                 | boolean NOT NULL DEFAULT true        | false for `backfill` and for `deposit`/`adhoc`/`settlement`; owner may toggle on a rent invoice (invariant 16)                                                              |
| `suggested_late_fee_paise`                                          | bigint                               | when `auto_apply = false`                                                                                                                                                   |
| `late_fee_computed_at`                                              | timestamptz                          | freeze point for flat/percent                                                                                                                                               |
| `late_fee_waived_at`, `late_fee_waived_by`, `late_fee_waive_reason` |                                      | sweep skips when set                                                                                                                                                        |
| `reprorate_suggestion`                                              | jsonb                                | `{leave_on, from_paise, to_paise, mode:'reprorate'\|'restore'}` while a §5.8 suggestion or restore prompt is open; null otherwise (the queue reads this, not the event log) |
| `pay_token`                                                         | text UNIQUE                          | 32 random bytes base64url                                                                                                                                                   |
| `pay_token_expires_at`                                              | timestamptz                          | issued + 45 days; expired on `paid`; regenerated on demand and automatically when a reversal reopens a `paid` invoice                                                       |
| `tenant_note`, `internal_note`                                      | text                                 |                                                                                                                                                                             |
| `issued_at`, `paid_at`, `cancelled_at`                              | timestamptz                          | `paid_at` = system time the balance first reached zero                                                                                                                      |
| `settled_on`                                                        | date                                 | `paid_on` of the payment that brought the balance to zero (**this**, not `paid_at`, feeds days-to-pay / on-time rate — §19 #18); cleared if a reversal reopens the invoice  |
| `cancel_reason`                                                     | text                                 |                                                                                                                                                                             |
| `idempotency_key`                                                   | text                                 | `POST /invoices` Idempotency-Key (manual + backfill), migration 0074; NULL for engine (`auto`), settlement and forfeit invoices                                             |
| `created_by`                                                        | uuid → users                         | null = system                                                                                                                                                               |
| `created_at`, `updated_at`                                          |                                      |                                                                                                                                                                             |

Indexes: UNIQUE partial `(assignment_id, period_start) WHERE kind='rent' AND status<>'cancelled'`; UNIQUE partial `(assignment_id) WHERE kind='deposit' AND status<>'cancelled'`; UNIQUE partial `(assignment_id) WHERE kind='settlement' AND status<>'cancelled'`; `(pg_property_id, status, due_date)`; `(pg_property_id, billing_month)`; `(assignment_id, due_date)`; `(pay_token)`; UNIQUE partial `(pg_property_id, idempotency_key) WHERE idempotency_key IS NOT NULL` (0074, a duplicate → 409 `duplicate_invoice`).

**Period overlap** (invariant 5): every transaction that inserts a `rent` invoice first takes `SELECT … FROM pg_bed_assignments WHERE id = $1 FOR UPDATE`, then checks `NOT EXISTS (… kind='rent' AND status<>'cancelled' AND daterange(period_start, period_end, '[]') && daterange($start, $end, '[]'))` and refuses with 409 `period_overlap`. An `EXCLUDE USING gist` constraint would be stronger but needs `btree_gist`, which is not allow-listed on the Azure server; if ops adds it, the constraint becomes a follow-up migration.

### 4.5 `pg_rent_invoice_lines`

`id`, `invoice_id` (CASCADE), `kind` (`pg_rent_line_kind`), `label` text ≤ 40, `amount_paise` bigint (negative allowed only for `discount`/`adjustment`), `meta` jsonb DEFAULT `{}` (e.g. `{units, rate_paise, period_label}`), `source` (`pg_rent_line_source`), `expense_id` uuid → `pg_rent_expenses` SET NULL (set for `expense_split` lines so the expense can show "split into N lines"), `sort_order` smallint, `created_by`, `created_at`. Hard-delete on removal — the `invoice.line_removed` event carries the full line, which is the audit record D14 requires. UNIQUE partial `(invoice_id) WHERE kind='late_fee'`. Index `(expense_id) WHERE expense_id IS NOT NULL`.

### 4.6 `pg_rent_payments`

| Column                                                                                                  | Notes                                                                                                                                                                     |
| ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`, `pg_property_id`, `assignment_id` (RESTRICT)                                                      | whose money; `reserved` assignments are allowed (booking amounts, §6.12)                                                                                                  |
| `direction` `pg_rent_payment_direction` NOT NULL DEFAULT `inflow`                                       | `outflow` = money returned to the tenant (refund of deposit / credit, §6.11); the _target_ of funding allocations (§4.7), never their source; never receipted             |
| `amount_paise` bigint CHECK 100..100000000                                                              | ₹1–₹10,00,000                                                                                                                                                             |
| `method` `pg_rent_payment_method`, `source` `pg_rent_payment_source`, `status` `pg_rent_payment_status` | CHECK: `method='deposit' ⇔ source='deposit_release'`; `direction='outflow' ⇒ source='operator' AND status IN ('confirmed','reversed')`                                    |
| `claimed_invoice_id` uuid → invoices SET NULL                                                           | tenant's hint / operator's target                                                                                                                                         |
| `paid_on` date NOT NULL                                                                                 | ≤ today IST                                                                                                                                                               |
| `reference` text ≤ 64                                                                                   | UTR / cheque no.                                                                                                                                                          |
| `proof_paths` jsonb DEFAULT `[]`                                                                        | ≤ 3 blob paths                                                                                                                                                            |
| `note` text ≤ 200                                                                                       | for outflows this is the mandatory reason ("deposit returned at move-out")                                                                                                |
| `idempotency_key` text                                                                                  | UNIQUE partial `(pg_property_id, idempotency_key) WHERE idempotency_key IS NOT NULL`; **required** for operator records, tenant claims and outflows (uuid per sheet open) |
| `recorded_by` uuid → users                                                                              | operator or tenant                                                                                                                                                        |
| `confirmed_by`, `confirmed_at`                                                                          |                                                                                                                                                                           |
| `rejected_reason` text                                                                                  | required on reject                                                                                                                                                        |
| `reversed_by`, `reversed_at`, `reversed_reason`                                                         |                                                                                                                                                                           |
| `gateway_order_id`, `gateway_payment_id` text                                                           | UNIQUE partial each; future rail                                                                                                                                          |
| `created_at`, `updated_at`                                                                              |                                                                                                                                                                           |

Indexes: `(pg_property_id, status, paid_on)`; `(assignment_id, paid_on)`; `(assignment_id, direction, status)`; UNIQUE partial `(claimed_invoice_id) WHERE status='pending_confirmation' AND source='tenant_claim'` (one pending claim per invoice); UNIQUE partial `(assignment_id) WHERE source='deposit_release' AND status='confirmed'` (one live deposit release per assignment).

### 4.7 `pg_rent_payment_allocations`

`id`, `payment_id` (CASCADE — always an **inflow**), `invoice_id` uuid → invoices RESTRICT, `refund_payment_id` uuid → payments RESTRICT (an **outflow**), `amount_paise` bigint CHECK > 0, `created_at`. CHECK exactly one of `invoice_id` / `refund_payment_id` is set. UNIQUE partial `(payment_id, invoice_id) WHERE invoice_id IS NOT NULL`, UNIQUE partial `(payment_id, refund_payment_id) WHERE refund_payment_id IS NOT NULL`. Indexes on all three FKs. Service refuses an allocation whose source is an outflow, whose source and target belong to different assignments, whose invoice is `draft`/`cancelled`, or whose target outflow is not `confirmed`. "Allocation to an invoice" and "funding of an outflow" are the same row type so that one query answers "how much of this payment is still credit" (invariant 3).

### 4.8 `pg_rent_receipts` — one per confirmed inflow with `source ∈ {operator, tenant_claim, gateway}`; also the render queue

`id`, `pg_property_id`, `payment_id` UNIQUE (RESTRICT), `assignment_id`, `receipt_number` text (`{prefix}-{seq:04}`, UNIQUE per property), `amount_paise`, `snapshot` jsonb NOT NULL (everything needed to re-render: tenant, room/bed, property branding, amount in figures and words, method + reference, `[{invoice_number, period_label, allocated_paise, remaining_paise}]`, `credit_paise` "held as credit towards future dues"), `pdf_path` text, `pdf_status` DEFAULT `pending`, `attempts` smallint DEFAULT 0, `next_attempt_at` timestamptz DEFAULT now(), `last_error` text, `generated_at`, `voided_at`, `void_reason`, `superseded_by` uuid → receipts (set when a manual re-allocation re-mints, §6.7), `share_token` text UNIQUE, `share_token_expires_at`, `created_at`. Index `(pdf_status, next_attempt_at) WHERE pdf_status <> 'ready'`. `payment_id UNIQUE` is relaxed to UNIQUE partial `(payment_id) WHERE voided_at IS NULL` so a re-mint can coexist with the voided original. Backfill and deposit-release payments never get a row (D19).

### 4.9 `pg_rent_expenses`

`id`, `pg_property_id`, `category` text NOT NULL ≤ 40 (free text; suggested list in code: electricity, water, internet, staff, food, repairs, cleaning, rent_to_landlord, tax, other), `label` text ≤ 80, `amount_paise` bigint CHECK > 0, `spent_on` date NOT NULL, `note` text ≤ 200, `meta` jsonb DEFAULT `{}` (`{units, rate_paise}`), `bill_paths` jsonb DEFAULT `[]` (≤ 3), `maintenance_request_id` uuid → `pg_maintenance_requests` SET NULL, `split_at` timestamptz (set by §8.6 split; an expense edited or deleted after `split_at` warns "N invoice lines were created from this expense and are not changed"), `recorded_by`, `deleted_at`, `created_at`, `updated_at`. Index `(pg_property_id, spent_on) WHERE deleted_at IS NULL`.

### 4.10 `pg_rent_events`

`id` bigserial, `pg_property_id`, `entity_type` text CHECK IN (`invoice`,`payment`,`expense`,`settings`,`assignment`,`receipt`), `entity_id` uuid, `event_type` text, `actor_user_id` uuid, `actor_role` text CHECK IN (`tenant`,`pg_operator`,`admin`,`system`), `payload` jsonb DEFAULT `{}`, `created_at`. Indexes `(entity_type, entity_id, created_at)`, `(pg_property_id, created_at DESC)`.

Event types: `settings.enabled`, `settings.updated` (`{diff}`), `settings.paused`, `settings.resumed`, `settings.transferred` (`{from_operator, to_operator, cleared:[…]}`), `invoice.issued`, `invoice.draft_created`, `invoice.confirmed_amount`, `invoice.line_added`, `invoice.line_updated`, `invoice.line_removed`, `invoice.due_extended`, `invoice.cancelled`, `invoice.reprorated`, `invoice.final_reprorate_suggested` (`{leave_on, from_paise, to_paise}`), `invoice.restore_suggested`, `invoice.reprorate_dismissed`, `invoice.pay_token_regenerated`, `invoice.excess_deallocated` (`{payment_id, paise}` — invariant 14), `late_fee.suggested`, `late_fee.applied`, `late_fee.updated`, `late_fee.removed`, `late_fee.waived`, `late_fee.eligibility_changed`, `payment.recorded`, `payment.claimed`, `payment.claim_cancelled`, `payment.confirmed`, `payment.rejected`, `payment.reversed`, `refund.recorded`, `refund.reversed`, `deposit.released`, `settlement.created`, `settlement.cancelled`, `allocation.changed`, `receipt.generated`, `receipt.failed`, `receipt.voided`, `receipt.reminted`, `reminder.opened` (`{stage, channel}`), `rent.changed`, `assignment.override_updated`, `assignment.move_in_date_set`, `expense.added`, `expense.updated`, `expense.deleted`, `expense.split`.

Tenant-visible subset: `invoice.issued|confirmed_amount|line_added|line_updated|line_removed|due_extended|cancelled|reprorated|excess_deallocated` on invoices that are not `draft` and only events at or after `issued_at` (drafts and their edits are invisible, §19 #24), except `internal_note` changes; `late_fee.applied|updated|removed|waived`; `payment.*`, `refund.*`, `deposit.released`, `settlement.*` on their own assignment; `receipt.generated|voided|reminted`; `rent.changed`. Owner-only: `invoice.draft_created`, `invoice.final_reprorate_suggested`, `invoice.restore_suggested`, `invoice.reprorate_dismissed`, `invoice.pay_token_regenerated`, `reminder.opened`; payloads shown to the tenant carry no `_paise` key and no `rent_source`.

### 4.11 `pg_operator_preferences`

`user_id` uuid PK → users CASCADE, `rent_dashboard` jsonb NOT NULL DEFAULT `{"v":1}`, `updated_at`. Shape (zod at the edge): `{v:1, widgets:[{id, visible, order}], defaultView:'queue'|'beds'|'ledger', savedFilters:[{propertyId, name, filter}], ledgerColumns:string[], chartWindow:3|6|12, compareMode:'mom'|'yoy', density:'compact'|'comfortable'}`. Widgets, columns and windows are per user across properties; **saved filters are keyed by `propertyId`** because they reference rooms (§19 #25). Unknown widget ids dropped on read.

### 4.12 Not added, on purpose

Bed-status history (vacancy is derived from assignment dates), a credit table (allocations), a deposit ledger (deposit held = paid deposit invoices − deposit release; credit is net of refunds via funding allocations, §6.11), a notifications table (banners are derived), a reminders table (`reminder.opened` events), stored `overdue` (derived), a settlement table (a `settlement` invoice + a `deposit_release` payment + outflows are the settlement).

---

## 5. Invoice engine & billing cycles

### 5.1 Entry points

`generateInvoicesForProperty(propertyId, todayIST)` — a single function called by (a) the worker sweep `runPgRentSweep` (hourly; idempotent; only properties with non-paused settings) and (b) the owner's **Generate now** (rate-limited once per 5 min per property). It generates **rent periods and deposit invoices** (§5.5) — both idempotent, neither depends on a lifecycle hook firing. Each invoice is its own transaction; a crash mid-batch leaves N good invoices and the next run completes the rest (invariant 5).

### 5.2 Eligible assignments and the billing window

Every assignment except `reserved` and `cancelled` walks its billing window: `active`, `notice_served`, `move_out_requested`, `move_out_pending_confirmation` **and `moved_out`**. `reserved` gets no rent periods until move-in (it may hold a booking amount as credit, §6.12). `moved_out` is eligible because its last period is often not yet created when the tenant leaves — in `arrears` it _never_ is (the invoice would be created after the period ends) — so the window end, not the status, is what stops generation (§19 #37). **Open invoices stay open and collectible** ("Former tenants with dues").

Billing window start = `move_in_date`. Window end is **status-aware** (§19 #2 — production rows exist where `cancelMoveOut` left `notice_end_date` populated on an `active` row; slice 0 stops that happening again, §8.9, but the rule protects the old rows):

| Status                                                                 | Window end                                       |
| ---------------------------------------------------------------------- | ------------------------------------------------ |
| `active`                                                               | none (open-ended) — `notice_end_date` is ignored |
| `notice_served`, `move_out_requested`, `move_out_pending_confirmation` | `notice_end_date` if set, else open-ended        |
| `moved_out`                                                            | `move_out_date`                                  |

A period is generated only if its start ≤ window end. **A period whose natural end is after the window end is generated already cut to the window end** when `prorate_move_out` is on (prorated, `proration_factor` recorded, event `invoice.issued` — this is creation, not a change, so D18 is untouched); with `prorate_move_out` off the natural full period is generated. If the notice is later cancelled, contiguity simply continues from the cut period's end (§5.3), so nothing has to be undone. Periods generated for a `moved_out` assignment are due on the creation date (the tenant is gone; the owner is settling now).

**`move_in_date IS NULL`** (legacy rows): no walk is possible; the assignment is surfaced in the queue as "Needs your confirmation — set move-in date" and `PATCH /tenants/:assignmentId {move_in_date}` (allowed only while null) starts it (`assignment.move_in_date_set`).

**Notice that ended without a move-out**: an assignment whose window end < today and whose status is still in the notice family gets a queue row "Notice ended N days ago — **Confirm move-out** · **They're staying**" (§8.3; "They're staying" calls the new `cancelNotice` transition, §8.9); generation stays stopped until the operator acts.

### 5.3 Period computation

Walk from `move_in_date` (invariant 11): `period_start = move_in_date` for the first natural period, else `last_period_end + 1`. `period_end` by mode:

- **calendar_month:** end of the month containing `period_start`.
- **anniversary:** the day before the anchor day of the next month, where anchor = tenant `rent_due_day` override if set, else `day(move_in_date)`. Day 29–31 anchors clamp to month-end in shorter months. **Each period end is computed from the stored anchor, never chained from the previous end** (Jan 31 → Feb 28 → Mar 31, not Mar 28).

**Due date by `billing_timing` (D16):**

|                                                              | `advance` (default)                                        | `arrears`                                                                    |
| ------------------------------------------------------------ | ---------------------------------------------------------- | ---------------------------------------------------------------------------- |
| calendar_month, natural period                               | `due_day` (tenant override wins) of the **period's** month | `due_day` of the month **after** the period's month                          |
| calendar_month, **cut** period (bridge, move-in, leave date) | same as natural (then "never in the past")                 | `period_end + 1` (a cut period is due as soon as it ends, not a month later) |
| anniversary                                                  | `period_start`                                             | `period_end + 1`                                                             |

`billing_month` is the period's month in both timings; only the due date moves.

**Floor (invariant 12):** the first _generated_ period is the first natural period whose **floor date** ≥ `billing_starts_on`, where floor date = `max(natural due date, period_start)` — a period cannot be due before it begins, so a tenant who moves in on Sep 20 (advance, due day 5) has a floor date of Sep 20, not Sep 5, and their Sep 20–30 stay is billed (§19 #48). Earlier periods are never auto-generated. After that, contiguity applies. Consequences: a tenant who moved in before the floor gets a full first period (the prorated move-in period fell below the floor); mode switches produce one partial **bridge** period, prorated. Because the floor is tested against the due date, in `arrears` the period _being lived in_ at enablement is normally the first one generated — which is what an arrears owner expects.

**Enable / resume preview (§19 #16):** `POST /enable` and `POST /resume` take `billing_starts_on` (default today) and the wizard shows, before committing, "First invoice: **October 2026** (full) · due 5 Oct · for 14 tenants — September is not invoiced; add it from history if it is owed". Moving the floor earlier regenerates the preview. Nothing is issued until the owner confirms.

**Due date never in the past:** if a computed due date < the creation date (mid-period move-in, late enablement, bridge), `due_date = creation date`. The floor test uses the _natural_ due date, before this adjustment. The same rule applies when a `draft` is issued: `due_date = max(stored due, issue date)` unless the owner types a due date in the issue sheet.

**Proration** (rounded to the rupee): applies to any partial period. `actual_days`: `rent × days_in_period ÷ natural_full_period_days` (calendar: days in the period's month; anniversary: the length of the uncut period **that the partial period belongs to** — for a bridge, the anniversary period that would have contained `period_start`). `flat_30`: `rent × days ÷ 30`. First-period proration never happens in anniversary mode (the period starts on move-in). Last-period proration only if `prorate_move_out`, and only by the owner's tap (D18, §5.8).

Worked example, ₹9,000, move-in **Sep 12**, enabled before Sep:

- Calendar, advance, due 5, actual days: Sep 12–30 = ₹9,000 × 19/30 = **₹5,700**, due = creation date (Sep 5 is past). Oct 1–31 = ₹9,000 due Oct 5.
- Calendar, **arrears**, due 5: Sep 12–30 = ₹5,700 due **Oct 5**. Oct 1–31 = ₹9,000 due Nov 5.
- Anniversary, advance: Sep 12–Oct 11 = ₹9,000 due Sep 12; Oct 12–Nov 11 = ₹9,000 due Oct 12. Arrears: the same periods due Oct 12 and Nov 12.
- Enabled on Sep 17, advance, due day 5: September's natural due (Sep 5) < floor → skipped; October is first (full). The wizard says so; the owner may backfill September.
- Enabled on Sep 17, **arrears**, due day 5: September's natural due (Oct 5) ≥ floor → September is first (full, ₹9,000 — the tenant lived the whole month).

### 5.4 What's on a generated rent invoice

1. Resolve rent (`assignment → room_type → listing`), record `rent_source` and `rent_snapshot_paise`. If `listing` or `none`: create as **`draft`** (event `invoice.draft_created`), surfaced as "Needs your confirmation"; no pay token, no reminder, no late fee, invisible to the tenant.
2. `rent` line (prorated if applicable, `proration_factor` recorded).
3. `default_line_items` minus the tenant's `default_item_overrides.exclude`, each `source = default_item`.
4. Credit auto-apply (skipped for drafts; runs when a draft is issued): unallocated confirmed amounts for this assignment are allocated FIFO to this invoice now (event `allocation.changed`).
5. Number, pay token (45 days), `status` per invariant 4, `issued_at`, event `invoice.issued`.

Created `invoice_lead_days` before the due date (so the D-3 state has a real invoice and pay link), or immediately when the window has already ended (move-out) or the due date is already past.

### 5.5 Deposit invoice (sweep-generated, idempotent)

In the same `generateInvoicesForProperty` run, for every eligible assignment with `move_in_date ≥ enabled_on` (the date the property first enabled rent — **not** the floor, which moves on resume; a pause must not make deposits vanish for tenants who moved in during it) and **no non-cancelled `deposit` invoice** (unique partial index, §4.4): resolve the deposit `assignment.security_deposit_paise → pg_room_types.security_deposit_paise → pg_details.security_deposit_paise` (§2); if it resolves to > 0, issue a `deposit` invoice due on the move-in date (or the creation date if that is later). The post-move-in hook (§5.8) merely triggers an early run of the same function; if the hook is lost the next sweep issues it (§19 #9). No deposit resolves → nothing, and the tenant profile shows "No deposit set". The resume preview lists "N tenants moved in while paused — their deposits will be invoiced now; record what you already collected".

For tenants who moved in before the floor, the owner records **Deposit held ₹X** in one step: backfill `deposit` invoice + backfill payment + allocation (no receipt, D19). Deposit amount is editable on the tenant only while the deposit invoice is unpaid (or new amount ≥ paid).

### 5.6 Late-fee sweep (same hourly run)

For each `issued`/`partially_paid` **`rent`** invoice with `late_fee_eligible = true` and `due_date + grace_days < today`, where the property policy is enabled, the tenant is not `late_fee_exempt`, `late_fee_waived_at` is null, and **no pending claim exists** for the invoice:

- **Chargeable balance** = unpaid balance **excluding** any existing `late_fee` line. If it is zero (the tenant has paid everything but the fee), the fee is **frozen** at its current amount and the sweep stops touching the invoice (§19 #11a).
- Compute: `flat` → amount; `per_day` → amount × days past grace (see "as-of date" below); `percent` → `percent_bp` of the chargeable balance; tenant override → override amount once; cap applied; rounded to the rupee.
- `flat`/`percent`/override are computed **once** (`late_fee_computed_at`) and frozen; `per_day` is recomputed each run until the chargeable balance is zero, waived or capped.
- **As-of date:** the sweep counts to _today_. When a payment with `paid_on` earlier than today settles the chargeable balance, `finalizeConfirmed` first re-evaluates the fee **as of `paid_on`** before allocating (§19 #11b): if `paid_on ≤ due_date + grace_days` the tenant was never late — an applied fee line is removed and a suggestion cleared (`late_fee.removed {reason:'paid_within_grace'}`), for every fee kind; otherwise a `per_day` fee is recomputed for the days up to `paid_on` (`late_fee.updated`), and `flat`/`percent`/override stand. Fees are never recomputed upward by a payment.
- `auto_apply = true`: upsert the single `late_fee` line (`late_fee.applied` / `late_fee.updated`), recompute totals.
- `auto_apply = false`: write `suggested_late_fee_paise` (`late_fee.suggested`); nothing changes the total until the owner taps **Add fee** (which creates the line).
- A rejected claim resumes the sweep, counting from the original due date.
- `backfill` invoices are never swept (`late_fee_eligible = false` at creation); the owner can flip eligibility on a rent invoice (`late_fee.eligibility_changed`) if a backfilled arrear should accrue.
- Policy changes (disable, grace, exempt) never remove existing fees (invariant 13); the owner waives, individually or with **Waive all outstanding fees**.

### 5.7 Status machine and editing

`draft → issued` (owner confirms amount; due date per §5.3 "never in the past") · `issued ⇄ partially_paid ⇄ paid` (allocations only, both directions via reversal or invariant-14 de-allocation) · `draft | issued | partially_paid → cancelled` (reason) · `paid → cancelled` refused when `amount_paid > 0` (reverse payments first); a ₹0 `paid` invoice (nothing was ever collected) cancels normally. **Cancelling a `partially_paid` invoice releases its allocations** to the payments' credit in the same transaction (`invoice.excess_deallocated` per payment); the tenant sees "₹X moved to credit". Lines editable in `draft | issued | partially_paid`; every change is an event the tenant sees. An issued invoice whose lines are edited down to `total = 0` becomes `paid` by invariant 4 (nothing left to collect); the UI warns "This invoice is now ₹0 and counts as settled — cancel it instead if it shouldn't exist". Any edit that would push `total` below `amount_paid` runs §6.6 first (invariant 14).

**Extend due date** (`issued`/`partially_paid`): sets `due_date`; if the new `due + grace ≥ today`, an applied fee line is removed (via §6.6 if the fee was already covered) and a suggestion cleared (`late_fee.removed {reason:'due_date_extended'}`); reminder states recompute; the pay link is unchanged.

**Change rent from next cycle**: writes `pg_bed_assignments.monthly_rent_paise`, event `rent.changed {from, to}`; issued invoices keep their snapshot; a `draft` confirms at the new amount.

### 5.8 Assignment-lifecycle hooks (called after the assignment transaction commits, best-effort like `notify()`; never inside it)

Hooks only **trigger runs and suggestions**; they never change a bill (D18).

- `move_in` → early `generateInvoicesForProperty` run (deposit invoice now instead of at the next hourly sweep).
- `serve_notice` (tenant), `operator_move_out_request`, `confirm_move_out`, `direct_move_out` → run generation for that assignment (so a not-yet-created final period is created, already cut per §5.2), then: if `prorate_move_out` is on and the leave date (`notice_end_date` or `move_out_date`) is earlier than the end of an **already-issued** period, write `invoice.final_reprorate_suggested {leave_on, from_paise, to_paise}` on that invoice. The queue shows **"Tenant leaving on 15 Oct — re-prorate October to ₹4,355?"** → **Re-prorate** (runs `invoice.reprorated`, via §6.6 if the invoice is paid, credit shown as "return at settlement") or **Keep full month**. A leave date that is before `move_in_date` or before the period start is refused as a suggestion (the row says "check the notice date").
- `cancel_move_out` / `cancel_notice` (back to `active`) → an unactioned suggestion disappears; an _applied_ re-proration is not undone automatically — the row becomes "Tenant is staying — restore October to ₹9,000?" → **Restore** (puts the rent line and `period_end` back to their pre-proration values — kept in the rent line's `meta.reprorated` — `invoice.line_updated {reason:'reprorate_restored'}`, then re-applies the assignment's unallocated credit to this invoice FIFO in the same transaction so the money that §6.6 released comes straight back; rent stays a rent line so analytics never see a synthetic adjustment).

  By the time the owner taps Restore, the staying transition's own generation run has usually already issued an `auto` rent invoice for leave date + 1 … the original period end, often paid from the credit §6.6 released. **Restore absorbs that invoice** in the same transaction (owner decision 2026-09-24):
  - its allocations go back to credit (`invoice.excess_deallocated`);
  - it is cancelled (`invoice.cancelled {reason:'restore_absorbed', restored_invoice_id}`);
  - that credit then flows to the restored invoice as above;
  - receipts are untouched (§6.7), and a pending claim on it falls back to FIFO on confirm (§6.10).

  Only an engine-issued invoice that lies entirely inside that gap is absorbed. Otherwise Restore is refused:
  - any other overlapping invoice → 409 `period_overlap`;
  - a gap invoice carrying a late fee or an operator-added line → 409 `restore_gap_edited`, until the owner waives or removes it;
  - a cancelled invoice's leftover Restore card → 409 `invoice_cancelled`.

- `cancel_reservation` → nothing (any booking credit is handled in §6.12).

### 5.9 Failure modes

| Case                                              | Behaviour                                                                                                                                                             |
| ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Sweep runs twice / two workers                    | Unique `(assignment, period_start)` + overlap check under the assignment lock → no-op / 409 swallowed as no-op                                                        |
| Rent unresolvable / room type deleted mid-tenancy | `draft` + "Needs your confirmation"                                                                                                                                   |
| `move_in_date` null                               | Skipped + "set move-in date" queue row (§5.2)                                                                                                                         |
| Tenant moved out owing                            | Invoices stay open; "Former tenants" list                                                                                                                             |
| Notice ended, status never moved                  | Generation stops at `notice_end_date`; "Notice ended N days ago" queue row (§5.2)                                                                                     |
| Move-out cancelled after notice                   | `active` ⇒ `notice_end_date` ignored; generation resumes contiguously; missed periods are generated by the next run with due = creation date                          |
| Enable mid-month                                  | Floor rule; wizard preview names the first period; nothing retroactive                                                                                                |
| Move-in date edited after invoices exist          | No such endpoint today; `PATCH /tenants/:id {move_in_date}` only works while null. Existing invoices untouched by any future edit; owner cancels/re-issues explicitly |
| Deposit hook lost                                 | Next sweep issues the deposit invoice                                                                                                                                 |
| Worker down for days                              | Catch-up run generates everything missed; due dates unchanged                                                                                                         |
| `invoice_lead_days` longer than a bridge period   | At most one period ahead (bound 15)                                                                                                                                   |
| Pause → resume                                    | Floor chosen on resume (default today) with the same preview; the gap is backfill                                                                                     |
| Ownership transfer while running                  | Paused with `pause_reason = transfer`, payee cleared (§11.2); resume requires payee details                                                                           |

---

## 6. Payments, allocation, confirmation, reversal, receipts

### 6.1 Rail abstraction (three narrow interfaces)

- **Intake** (how a payment row is born): `recordByOperator()` → `confirmed` at birth; `claimByTenant()` → `pending_confirmation`; `recordBackfill()` → `confirmed`, `source = backfill`, no receipt; `releaseDeposit()` → `confirmed`, `method = deposit`, `source = deposit_release`, no receipt (§6.11); later `recordFromGateway()` → `confirmed` (webhook). All inflows converge on private `finalizeConfirmed(payment)` — recompute a `per_day` fee as of `paid_on` if it settles the chargeable balance (§5.6), allocate, recompute invoices, mint receipt (when the source earns one), log — **the only code path that can make an invoice paid**.
- **Outflow**: `recordRefund()` → `direction = outflow`, `confirmed` at birth, funded in the same transaction by allocation rows drawn FIFO (oldest `paid_on` first) from the assignment's inflows with unallocated credit; 400 `refund_exceeds_credit` if the credit is short (invariant 15). No receipt. `reverse()` works on it like any payment (its funding allocations go, credit returns).
- **`finalizeConfirmed`** also sets `settled_on = payment.paid_on` on every invoice whose balance reaches zero in that call, and never overwrites an existing `settled_on`.
- **Verifier**: the operator today; the gateway webhook later. No third option.
- **PayInstruction**: `buildPayInstruction(invoice, settings)` → `{mode:'upi_intent', upiUri, qrSvg, payeeName, vpa}` | `{mode:'bank_details', …}` | `{mode:'manual'}` (no payee configured — the page says "the owner is updating payment details; pay as you usually do and mark it paid") | later `{mode:'gateway', checkoutUrl}` (flag).

### 6.2 Allocation

On confirmation: (1) targeted invoice(s) first (`claimed_invoice_id` or operator-picked); (2) remainder FIFO across the **same assignment's** open invoices by `due_date` (deposit before rent on ties; `settlement` last); `draft` never allocatable; (3) remainder = credit (unallocated), auto-applied at the next generation or manually to an existing invoice. Operator may override the split in the record/confirm sheet; the server recomputes and refuses splits exceeding the payment, an invoice balance, or crossing assignments (§4.7). Credit never crosses assignments: a tenant who changes bed (a new assignment) has their old credit returned or forfeited through §6.11/§6.12, never silently carried.

### 6.3 Tenant claim → owner confirm

Tenant (logged in): amount (prefilled balance), method, `paid_on` (≤ today), reference (12-digit UTR soft-validated, never blocked), ≤ 3 screenshots (presign via `AzureBlobPhotoStorageService`), note, `idempotency_key` (uuid per sheet open — a claim with no `claimed_invoice_id`, i.e. an advance, is deduplicated by this alone) → `pending_confirmation`, `payment.claimed`. One pending claim per invoice (unique partial index) → second attempt gets 409 `claim_pending`. Tenant may cancel their own pending claim (`payment.claim_cancelled`).

Owner: "Awaiting your confirmation" queue → **Confirm** sheet with editable amount/date/method (original values kept in the event payload), screenshot viewer; **Reject** with mandatory reason; **Confirm all** (per-item results `{confirmed:[ids], failed:[{id, code}]}` — one conflict never fails the batch). `FOR UPDATE` + status check → concurrent confirm gets 409. Claims untouched 2 days badge the owner's dashboard. Nothing auto-confirms.

While a claim is pending: the invoice is not shown as overdue, Remind becomes "Confirm payment", the late-fee sweep skips it.

### 6.4 Operator recording and backfill

Record sheet: tenant (preselected from row/tile; `reserved` tenants allowed — the money becomes credit, §6.12), amount (prefilled balance), method, date (today), reference, note, optional proof photo, allocation preview; `idempotency_key` (uuid per form submission; duplicate → the original response, not a second payment). Backfill ("Sept rent ₹9,000 · paid Sep 3 · cash"): one transaction creates a `backfill` invoice (`late_fee_eligible = false`) + `backfill` payment + allocation, **no receipt** (D19). An _unpaid_ past invoice is entered as a `backfill` invoice alone; it is collectible, reminded, and fee-exempt until the owner flips eligibility. Totals include backfill; behavioural analytics exclude it.

### 6.5 Reversal

`reverse(payment, reason)` — only from `confirmed`; refused with 409 `reverse_outflow_first` if the payment funds a confirmed outflow (invariant 15); deletes its allocations, recomputes touched invoices (status can walk back; `settled_on` cleared; an expired pay token is regenerated), **voids** the receipt (`voided_at`, PDF kept), `payment.reversed`; tenant sees "Payment of ₹X reversed — reason". Terminal; the fix is a new payment. The Record toast's **Undo (8 s)** calls this with reason `undo`. Reversing a `deposit_release` payment un-settles (§6.11); reversing an outflow (`refund.reversed`) deletes the allocations that funded it, so the credit is held again.

### 6.6 Excess de-allocation (procedure; invariant 14)

Whenever a mutation would leave `amount_paid > total` on any invoice — final-period re-proration, waiving or removing a fee the tenant already covered, removing or reducing a line on a `partially_paid` invoice, cancelling a `partially_paid` invoice: in one transaction, reduce that invoice's allocations by the excess, **newest allocation first**, then apply the edit, recompute, and write `invoice.excess_deallocated {payment_id, paise}` per touched payment. The released amount is the payment's unallocated credit (auto-applied at the next generation, returnable via §6.11). For a `paid` invoice this is the "paid-invoice reduction": it leaves `paid` at the smaller total. Invariant 6 holds at commit; nothing is deleted.

### 6.7 Receipts

Minted in `finalizeConfirmed` for `operator`/`tenant_claim`/`gateway` inflows with `pdf_status = pending` and the full `snapshot` (amount in words via `numberToIndianWords`; `credit_paise` shown as "held as credit towards future dues"). Render is decoupled: immediate best-effort attempt after commit, plus `runPgRentReceiptSweep` (every 2 min) retrying `pending`/`failed` with backoff (`attempts`, `next_attempt_at`, max 5 → `failed`, owner sees **Retry receipt**). **Both renderers claim rows with `SELECT … FOR UPDATE SKIP LOCKED`** (the `maintenance-sweeps.ts` pattern) so the API's immediate attempt and the worker never render the same receipt twice (§19 #27). Template `pg-rent/receipt/templates/receipt.hbs` (en/hi), rendered with the existing browser pool and stored via the Azure PDF storage; downloads via 15-minute SAS URLs; sharing via `GET /v1/public/pg-rent/receipts/:share_token` (30-day token, rate-limited) → 302 to a fresh SAS URL. Content: receipt number, date, property branding, tenant name, room/bed, amount (figures + words), method + reference, invoices/periods covered with allocated amounts, remaining balance if partial, credit held, "computer-generated" footer. Voided receipts render a VOID banner on re-download.

**Receipts vs later allocation changes (§19 #13):** a receipt is proof of money received and states the allocation _at issue_. Credit auto-applied later by generation, and invariant-14 de-allocation caused by an invoice edit, do not touch it (the invoice timeline shows those moves; the receipt already says "₹X held as credit" where applicable). A **manual** re-allocation (`PATCH /payments/:id/allocations`) is the one case where the owner is restating what the money was for, so it voids the receipt with `void_reason = reallocated`, mints a new one (next number, `superseded_by` on the old row, `receipt.reminted`), and the tenant's history shows both.

### 6.8 Validation at the boundary

Whole-rupee integers; `1 ≤ amount ≤ ₹10,00,000`; `paid_on ≤ today` IST; VPA regex; allocations recomputed server-side; client totals never trusted; proof images via the storage port's type/size checks; every operator call `assertManagedOwnership`; every tenant call resolves the assignment via `tenant_user_id` or phone match (§9). Outflows: amount ≤ what the property holds for that assignment (invariant 15), reason required.

### 6.9 Gateway later (no new tables)

Webhook consumer gains a branch: `payment.captured` with a `gateway_order_id` matching a rent invoice → `recordFromGateway()` inside the existing `FOR UPDATE` transaction → allocation, receipt, event. Pay page returns `{mode:'gateway'}`. The order created before capture needs a home: that migration will most likely add an `initiated` value to `pg_rent_payment_status` (an enum add, no table). Payouts are a separate settlement concern.

### 6.10 Edge cases

| Case                                                             | Behaviour                                                                     |
| ---------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| Two months in one transfer                                       | One claim, FIFO covers both, one receipt listing both                         |
| Paid before the invoice exists                                   | Credit → auto-applied; never reminded                                         |
| Wrong amount confirmed                                           | Reverse → new payment; both in history                                        |
| Claim for a cancelled invoice                                    | Confirm sheet warns; FIFO/credit                                              |
| Moved out, then pays                                             | Recording works on `moved_out`; "Former tenants"                              |
| Screenshot upload fails                                          | Claim submits; proof optional                                                 |
| Receipt fails 5×                                                 | `failed`; **Retry receipt**; money untouched                                  |
| Tenant pays rent but not the fee                                 | `partially_paid`, balance = fee; sweep freezes the fee (§5.6); waive → `paid` |
| Cash received Oct 3, recorded Oct 6, `per_day` fee               | Fee recomputed as of Oct 3 before allocation → `paid`, not `partially_paid`   |
| Line removed from a `partially_paid` invoice below what was paid | §6.6 releases the excess to credit; status `paid` at the new total            |
| `partially_paid` invoice cancelled                               | Allocations released to credit; tenant sees "₹X moved to credit"              |
| Payment reversed after its credit was auto-applied elsewhere     | All its allocations go; every touched invoice walks back                      |
| Owner re-allocates a payment after the receipt was shared        | Old receipt VOID (reallocated), new receipt minted; both visible              |

### 6.11 Move-out settlement (D17)

**When:** an assignment in `notice_served`, `move_out_requested`, `move_out_pending_confirmation` or `moved_out`. The tenant profile and the "Leaving" queue section show **Settle**. An assignment is _settled_ when a non-cancelled `settlement` invoice exists; a "Leaving" row also clears by itself when deposit held, credit and open dues are all ₹0 and there is nothing to deduct (nothing to settle).

**Before the statement:** `GET /settlement` runs `generateInvoicesForProperty` for this assignment first (so the final, cut period exists — §5.2) and reports any unactioned §5.8 suggestion; the Settle sheet asks the owner to act on it (Re-prorate / Keep) before continuing.

**Statement (computed live, rupees):**

```
Deposit held        = Σ amount_paid of non-cancelled `deposit` invoices − Σ confirmed `deposit_release` amounts
+ Credit            = Σ unallocated credit of the assignment's confirmed inflows (invariant 3; already net of refunds)
− Open dues         = Σ (total − amount_paid) of non-cancelled, non-draft `rent` / `adhoc` / `settlement` invoices
                      (the `deposit` invoice is *not* a due: an unpaid deposit at move-out is money that was never collected,
                       so settlement writes it down — step 1 below — rather than chasing it)
− Deductions        = lines the owner enters now: damage, cleaning, forfeit, other (each with label; maintenance tickets with `chargeable_damage` are offered as prefills)
= Net               (> 0: return to tenant · < 0: tenant owes · 0: settled)
```

**Settle sheet → one transaction (`POST /tenants/:assignmentId/settle`, idempotent by key):**

0. If the `deposit` invoice is not fully paid, reduce its total to `amount_paid` with an `adjustment` line (`invoice.line_added {reason:'deposit_settled'}`) so it reads `paid`; the tenant sees "Deposit ₹18,000 — ₹6,000 was never collected". (Re-running Settle on an assignment that already has a non-cancelled `settlement` invoice — e.g. after a reversed deposit release — updates that invoice's deduction lines instead of creating another; every line change is an event.)
1. Create the `settlement` invoice (unique per assignment) with the deduction lines; total may be ₹0 (then it is `paid` at birth and simply anchors the statement). `late_fee_eligible = false`.
2. Create the **deposit-release** payment: `direction = inflow`, `method = deposit`, `source = deposit_release`, amount = deposit held, `paid_on = today`. `finalizeConfirmed` allocates it FIFO to open invoices (oldest due first, `settlement` last). No receipt. After this, "Deposit held" is ₹0 and whatever was not needed for dues is credit.
3. That credit is **returnable**. If the owner records the return now (amount ≤ credit, method, reference, date ≤ today, reason prefilled "deposit returned at move-out"), an outflow is created and funded from the credit FIFO (`refund.recorded`, invariant 15). Otherwise the tenant profile shows "**₹X to return**" until it is recorded — nothing is auto-assumed returned, and because the credit is still unallocated it would be auto-applied to any _later_ invoice for this assignment, which is the correct behaviour for a tenant who owes something new.
4. Net < 0: the shortfall stays on the open invoices / settlement invoice; the tenant is in "Former tenants with dues" with a pay link on the settlement invoice.
5. Events: `settlement.created {deposit_held, credit, dues, deductions, net}`, `deposit.released`, `allocation.changed`, `refund.recorded`.

**Undo / mistakes:** reverse the outflow first if one exists (its funding allocations go, credit is back), then reverse the deposit-release payment (`settlement.cancelled` when the settlement invoice is also cancelled with reason) — allocations unwind, deposit is held again. The order is enforced by invariant 15. Nothing is deleted.

**Tenant view:** "Move-out settlement · Deposit ₹18,000 − October dues ₹4,355 − cleaning ₹800 = **₹12,845 returned** on 5 Oct · UPI ref …" with each line tappable; or "₹12,845 to be returned by the owner"; or "You owe ₹1,200 · Pay". A printable statement PDF is a follow-up (§1 non-goals).

**Metrics:** "Deposits held" (§10.2) = the same formula summed over current assignments. Outflows appear in the cash lens as **Returned**; `Net = Received − Returned − Expenses`. Deposit-release inflows are excluded from every cash figure (they are not money received).

### 6.12 Booking amounts and reservations

An operator may record a payment against a `reserved` assignment (booking / token amount). It has no invoice to land on, so it is credit, auto-applied to the deposit and first rent invoice at move-in. If the reservation is **cancelled** with credit outstanding, the reservation row in the queue shows "**₹X booking amount held** — Return · Forfeit": Return = outflow (§6.11 step 3); Forfeit = an `adhoc` invoice with a `forfeit` line for ≤ the credit, allocated from it (`expense.split`-style one-tap, event `allocation.changed`). Until one is chosen the amount stays visible as held.

---

## 7. WhatsApp click-to-chat, templates, pay link, reminder queue

### 7.1 Constraint on record

Automated WhatsApp sends can only use Meta-approved templates with fixed wording. Click-to-chat (`https://wa.me/<E.164 digits, no +>?text=<urlencoded>`) can say anything. We choose customisation + a human tap now. A future `FF_PG_RENT_AUTO_REMINDERS` uses our approved wording via `outbound_events` (`dedupe_key = pg_rent_reminder:<invoice_id>:<offset>`); the owner's custom text stays click-to-chat.

### 7.2 Reminder states (computed)

For open `issued`/`partially_paid` invoices without a pending claim: `upcoming` (not in queue), `due_soon` (today ≥ due + earliest negative offset), `due_today`, `overdue` (due < today). **One definition of overdue everywhere** (§19 #22): the KPI, the queue and the tenant hero all use `due_date < today`; "in grace" is a _tag_ on an overdue row (`today ≤ due + grace`, so no fee yet), not a separate state. `{due_phrase}` renders "due in 3 days" / "due today" / "overdue by 4 days". Offsets earlier than `invoice_lead_days` are warned at save (the invoice doesn't exist yet). All-positive offsets ⇒ queue = overdue only (valid).

### 7.3 Collection Queue sections (urgency order)

1. **Awaiting your confirmation** (claims) → ✓ / ✗ / Confirm all
2. **Needs your confirmation** — `draft` invoices, "set move-in date" rows (§5.2), "notice ended N days ago" rows (§5.2), final re-proration suggestions and restore prompts (§5.8), "₹X booking amount held" on cancelled reservations (§6.12)
3. **Leaving** — assignments in the notice family or `moved_out` within 30 days that are not yet settled → **Settle** (§6.11); after settlement with money to return → "₹X to return" → **Record return**
4. **Overdue** — ranked by ₹ × days; balance, days late, "in grace" tag, applied/suggested fee, last reminded → **Remind · Record · Copy pay link · ⋯** (view, add charge, add/waive fee, extend due, reminded by call)
5. **Due today**, 6. **Due soon**

Every Remind tap logs `reminder.opened {stage, channel:'whatsapp'}`; **Reminded by call** logs `channel:'call'`. "Remind all overdue" is a stepper (1 of N → opens chat → Next), each step logged — never presented as a broadcast.

### 7.4 Templates & merge fields

Four owner-editable templates (reminder, overdue, tenant-paid, receipt-share), ≤ 600 chars, live preview against a real tenant, reset to default, defaults in en/hi. Fields: `{tenant_name} {owner_name} {property_name} {room} {bed} {period} {amount} {balance} {due_date} {due_phrase} {days_overdue} {late_fee} {invoice_no} {pay_link} {upi_id} {receipt_link} {utr}`. Unknown fields stay literal and are flagged in the preview; `{upi_id}` with no VPA renders "(not set)" with a warning; merged text truncated at 900 chars with "…". Amounts Indian-grouped. Recipient: `occupant_phone_e164` (tenant) or `whatsapp_phone_e164 ?? operator phone` (owner).

Default reminder (en): `Hi {tenant_name}, rent of {amount} for {period} (Room {room}, Bed {bed}) is {due_phrase}. Pay here: {pay_link} — {owner_name}, {property_name}`
Default tenant-paid (en): `Hi {owner_name}, I've paid {amount} for {period} rent, Room {room}/Bed {bed}. UTR: {utr} — {tenant_name}`

### 7.5 Tenant → owner

After the in-app claim, **Notify owner on WhatsApp** opens the owner's chat with the tenant-paid template (`{utr}` from the claim). From the public pay page the button works without a record and the page says so.

### 7.6 Owner → tenant beyond reminders

**Share pay link** (`{pay_link}`), **Share receipt** (`{receipt_link}`), **Show QR** (full-screen).

### 7.7 Pay page — `/{locale}/pay/{token}` (public, `PUBLIC_PREFIXES`, `noindex`)

Shows property name, "Rent for September 2026 · Room 102 / Bed A", tenant **first name only**, balance, "You're paying **{payee} · {vpa}**", **QR** (server-rendered SVG of `upi://pay?pa=&pn=&am=&tn=&tr=&cu=INR`, `tn` ≤ 50, `tr` = the invoice number with non-alphanumerics stripped, ≤ 35 chars), **Pay in UPI app** (mobile only), **Pay a different amount** (regenerates without `am`), bank details accordion, **Notify owner on WhatsApp**, "Sign in to track your rent" → OTP → auto-link → residence Rent tab with `?tab=rent&invoice=<id>`. Cannot submit an in-app claim (would allow spam). Token: 32 random bytes base64url; expires on `paid` or +45 days; IP rate-limited; expired/paid → friendly states. Reads **settings** live (never `pg_details`). No payee configured (fresh enable, or after a transfer) → `{mode:'manual'}` copy (§6.1). If the API flag is off the endpoint 404s; the web page renders "This link is temporarily unavailable — contact your owner" rather than a bare error (links live in tenants' WhatsApp for weeks).

### 7.8 In-app notices for the tenant

Derived banners on the residence page: persistent — new invoice, due in N days, overdue by N; dismissable per session — confirmed/receipt ready, rejected (reason), reversed, charge added. No notifications table.

### 7.9 Gaps surfaced

`pg_details.late_fee_policy`/`payment_modes` are marketing text; the module never reads them. A wrong `occupant_phone_e164` does worse than misdirect reminders: whoever signs up with that number is auto-linked by the existing phone-match precedent and sees the tenant's invoices (§19 #14). Mitigations: tenants linked to a Cribliv user show "verified ✓"; unverified numbers get a warning on the first Remind; the tenant Rent tab carries "Not your PG? Tell the owner" which opens WhatsApp to the operator with fixed text and logs `assignment.override_updated {flag:'identity_disputed'}` so the operator's tenant row shows a ⚠ with **Resolved** (logs `{flag:'identity_dispute_cleared'}`; the badge is derived from the latest of the two events). Claims from a disputed assignment are still accepted (the owner confirms them, D5), so nothing is blocked.

---

## 8. Owner UX

### 8.1 Property Workspace (shell) — `NEXT_PUBLIC_FF_PG_WORKSPACE_V2`

Header gets **Manage** → `/{locale}/pg-operator/properties/{propertyId}` (a property switcher renders only when >1 managed property). Tabs: **Overview · Rent · Tenants · Beds · Maintenance · Expenses · Settings** (desktop tabs; mobile bottom bar Overview · Rent · Tenants · Beds · More). Existing Beds/Tenants/Maintenance/Layout pages move under the shell unchanged in logic. The marketing dashboard stays and gains one "Manage property" card with a collection snapshot.

### 8.2 Principles

1. Action-first: each row shows the one action its state demands.
2. Money never ambiguous: balance vs total, paid vs pending, period named, `₹1,20,000`.
3. Thumb-first: bottom sheets, sticky CTA, bottom tabs, large numeric entry.
4. Feedback names the outcome (`₹8,000 recorded · Rahul · September` + **Share receipt**), using the shipped toast system.
5. Undo where money allows (8 s, via logged reversal).
6. Defaults over configuration; 3-step setup, everything else discoverable.
7. Status never colour-only; AA; focus order; light `--d-*` tokens; extend existing primitives.
8. Fast: optimistic updates, skeletons, `R` record / `/` search on desktop.

### 8.3 Rent tab

Header: `‹ September 2026 ›` + **Record payment**. KPI tiles (tappable filters): Collected (ring = collection rate of Expected), Outstanding, Overdue (tenants + ₹), Awaiting (claims + ₹). Views: **Queue** (default; desktop table with sticky action column, mobile cards with swipe Record / Remind), **Beds** (the bed grid with a **Rent layer** toggle: tiles tinted paid / partial / due / overdue / awaiting, balance on tile, tap → Record), **Ledger** (all invoices and payments for the month; filter chips status · room · method · source; column chooser; **Export CSV** honouring filters and range). Meaningful empty states.

### 8.4 Record payment sheet (≤ 3 taps in the common case)

Tenant (preselected, searchable) · Amount (prefilled balance; numeric keypad) · Method chips · Date (Today; quick Yesterday) · Reference · "Applies to September ₹8,000 ✓" (tap to split / credit) · + photo · **Record ₹8,000**. Post-record toast: **Undo · Share receipt**. Confirm-claim sheet = same layout prefilled with the claim, editable amount, screenshot viewer, Reject requires reason.

### 8.5 Invoice detail & tenant ledger

Invoice: header (period, due, status, balance) → lines (`Electricity · 112 units × ₹8 = ₹896`, late fee with Waive / Add) → payments → timeline (events). Actions: Add charge, Extend due date, Share pay link, Show QR, Late fee eligible on/off, Cancel. Tenant ledger (from any tenant row): running statement with balance, credit, deposit held, **money to return**, overrides (rent from next cycle, due day, late fee, default charges, deposit, move-in date while null), **Settle** / **Record return** (§6.11), Export.

### 8.6 Expenses tab

Month list grouped by category with totals; Add expense sheet (amount, category chips from the owner's own history, date, note, bill photo, units × rate helper); **Split across tenants** on electricity expenses → `electricity` lines (`source = expense_split`, `expense_id` set, `meta.period_label` = the expense month) on the current open rent invoices of the chosen rooms — equal split among tenants active on the expense date with **largest-remainder rounding** so the lines sum to the expense exactly (₹1,000 ÷ 3 = 334 + 333 + 333; owner adjusts) — or a new `adhoc` invoice (due +7 days) when the tenant's invoice is already paid. The expense shows "split into N lines"; editing or deleting it afterwards warns that the lines stay (§4.9).

### 8.7 Overview tab — customisable board

Widget catalogue: collection ring, outstanding, overdue list, awaiting claims, occupancy, vacancy loss, upcoming move-ins/outs, maintenance SLA, expenses vs collected, 6-month trend, insights strip. Reorder (drag on desktop, ↑↓ on mobile), hide/show, per-user persistence, Reset to defaults.

### 8.8 Settings tab

First run: **Rent setup** (1) cycle, **billing timing** (advance / arrears, with one-line examples) & due day — with "N tenants have no rent set — set now" and "N tenants have no move-in date — set now" inline if rent / move-in doesn't resolve; (2) UPI ID / bank details + "test with ₹1"; (3) late fee (default off); (4) **Preview** — first period per tenant, floor date editable ("Start billing from"), "N deposits will be invoiced" — then **Enable & generate**. Sections afterwards: messages, receipt branding, default charges + electricity rate, reminder offsets, pause/resume (resume shows the same preview), "Online payments via Cribliv — coming soon" (disabled card). After an ownership transfer the tab opens on a banner: "Rent collection is paused since the property changed hands on 3 Oct — confirm where tenants should pay, then resume" (§11.2).

### 8.9 Lifting existing surfaces

| Surface               | Change                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Header                | **Manage**; property switcher when >1                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Tenants               | Search; rent status column; tenant profile drawer (stay, rent, ledger, maintenance); reserve/move-in as sheets, not an inline form; move-out sheets gain a **date** field (§19 #10)                                                                                                                                                                                                                                                                                                                                                                                       |
| Bed detail            | Show _resolved_ rent (bug fix); rent status; quick Record                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Bed grid              | Rent layer toggle; "Available now" for past `available_from` (bug fix)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Maintenance           | Unchanged; under the shell                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| pg-operations service | `CURRENT_DATE` → IST date in the four assignment date writers (§2); `confirmMoveOut` / `operatorDirectMoveOut` accept optional `move_out_date` (≤ today IST, ≥ `move_in_date`); `cancelMoveOut` now also clears `notice_served_date` / `notice_end_date`; new operator transition **`cancelNotice`** (`notice_served` \| `move_out_requested` → `active`, clears both notice fields, event `notice_cancelled`) — today the only way back from `notice_served` is request-move-out-then-cancel. The rent window stays status-aware (§5.2) for rows written before this fix |

---

## 9. Tenant UX

The residence page's **Money** tab becomes **Rent**:

1. **Status hero** — one of: Due (advance: `₹9,000 · October · due 5 Oct · in 3 days`; arrears: `₹9,000 · September · due 5 Oct · in 3 days` — the period label always names the month lived, D16), Overdue (`includes ₹300 late fee`; "in grace" is not shown to tenants), Partially paid (`₹4,000 remaining of ₹9,000`), Awaiting (`You marked this paid on 3 Oct · awaiting owner confirmation` → Notify owner · Edit / cancel), Paid (`September paid ✓ · Receipt #BPG-0042` → Download · Share), Nothing due (`Next: October rent, invoice arrives 30 Sep` — the gap between a paid period and the next invoice), Settled / Leaving (§6.11 statement), plus a Credit line when applicable. With **several open invoices**, the hero shows the oldest-due one and a "+ ₹X across N more" link into History. Drafts never appear; a suggested (unapplied) late fee is invisible.
2. **Pay panel** (balance > 0) — payee name + VPA shown for verification, QR ≥ 220 px, Pay in UPI app (mobile), copy UPI ID, bank details, Pay a different amount → **I've paid** sheet → **Notify owner on WhatsApp** (record first, message second). No payee configured → "Pay the way you usually do and mark it paid here".
3. **This invoice** — lines as the owner sees them, invoice number, period, tenant-visible change log ("Electricity ₹896 added · 2 Oct"; "₹1,000 moved to credit · 4 Oct" for §6.6).
4. **History** — past invoices with receipts (Download / Share; superseded receipts marked), payments with method/reference, history-recorded payments ("recorded from history", no receipt), rejected claims with reason + Submit again, reversals with reason, money returned.
5. **Deposit** — "Deposit held ₹18,000 · paid 3 Sep" · after settlement the §6.11 statement.
6. **Terms** — the four existing facts, moved to the bottom.
7. **Ask owner** on any line → WhatsApp with "Question about INV-0042 · Late fee ₹300" prefilled (fixed system text in the tenant's locale; not one of the four owner templates). **Not your PG?** → §7.9.

Edge states: rent not enabled → static facts + "Your owner hasn't set up rent tracking yet"; phone unmatched → existing "No active PG residence"; moved out with dues → existing past-stay section gains open invoices + pay panel + settlement statement; second claim → "You already marked this paid — waiting for owner".

**Which assignment(s)?** (§19 #14) The rent endpoints resolve **every** `pg_bed_assignments` row where `tenant_user_id = me OR (tenant_user_id IS NULL AND occupant_phone_e164 = my phone)`, in any status, **without auto-linking on read** (`queryResidence`'s `LIMIT 1` is not reused). `GET /summary` returns `residences: [{assignment, property, hero, …}]` ordered current-first; the page renders one Rent tab per residence when there are several (a parent paying for two children sees both). Writes (claims) call the existing `lockTenantAssignment` for the target assignment; if linking fails on `uq_pg_active_assignment_per_tenant` (second active bed for one user) the claim still proceeds phone-matched, unlinked — the "verified ✓" badge simply stays off for that one.

Tenant API: `GET /v1/tenant/pg-rent/summary`, `GET …/history?assignment=`, `GET …/invoices/:id`, `POST …/claims` (`idempotency_key`), `DELETE …/claims/:id`, `GET …/receipts/:id/download`, `POST …/identity-dispute` (§7.9). All rupees; all scoped via assignment ownership. Strings in `lib/i18n.ts` en + hi.

---

## 10. Analytics & export

### 10.1 Time model

IST calendar months. Presets: This month · Last month · Last 3 months · Current FY · Last FY (April–March) · Custom (≤ 36 months). Lenses: **billing** (invoices by `billing_month`) and **cash** (payments by `paid_on`, expenses by `spent_on`); labelled _September rent_ vs _Received in September_; never mixed in one tile.

### 10.2 Definitions

| Metric                | Lens    | Definition                                                                                                                                                                                                                 | Leads to          |
| --------------------- | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------- |
| Expected              | billing | Σ `total` of `rent` **and `adhoc`** invoices in period, excluding draft/cancelled (so an electricity split lands here whether it became a line or an adhoc invoice — §19 #17). Sub-split shown: rent · charges · late fees | Ledger            |
| Collected             | billing | Σ `amount_paid` of those invoices                                                                                                                                                                                          | Ledger (paid)     |
| Outstanding           | billing | Expected − Collected                                                                                                                                                                                                       | Queue             |
| Overdue               | billing | Outstanding with `due_date < today` (one definition, §7.2); tenants + ₹                                                                                                                                                    | Queue › Overdue   |
| Collection rate       | billing | Collected ÷ Expected; current month also _pace_ vs same day last month                                                                                                                                                     | —                 |
| Awaiting confirmation | —       | Σ pending claims + count                                                                                                                                                                                                   | Queue › Awaiting  |
| Other billed          | billing | `deposit` + `settlement` invoices in period                                                                                                                                                                                | Ledger            |
| Received              | cash    | Σ confirmed **inflows** by `paid_on`, excluding `method = deposit`; by method; by source                                                                                                                                   | Ledger (payments) |
| Returned              | cash    | Σ confirmed outflows by `paid_on`                                                                                                                                                                                          | Ledger (payments) |
| Expenses              | cash    | Σ by category                                                                                                                                                                                                              | Expenses          |
| Net                   | cash    | Received − Returned − Expenses                                                                                                                                                                                             | —                 |
| Late fees             | billing | accrued · waived · collected (fee lines on paid invoices)                                                                                                                                                                  | Queue › Overdue   |
| Deposits held         | —       | §6.11 formula (paid deposit − released) over current assignments; **To return** = tenant credit (invariant 3) on assignments that are settled or `moved_out`/`cancelled`                                                   | Tenants › Leaving |

### 10.3 Breakdowns (billing lens)

By room / floor: expected, collected, outstanding, rate, occupied bed-days. By bed: + current tenant, revenue per bed, trailing-12 sparkline (feeds the Rent layer). By tenant: expected, paid, outstanding, avg days-to-pay, on-time rate, late count, late fees, **chronic-late** (late in ≥ 3 of last 6 rent invoices).

### 10.4 Behaviour (excludes `backfill`)

Days-to-pay = `settled_on − due_date` (negative = early; `settled_on` is the `paid_on` of the settling payment, so a slow owner does not make a tenant look late — §19 #18): median + distribution (early · on time · 1–3 · 4–7 · 8–15 · 15+). On-time rate = settled on/before due ÷ settled. **Reminder effect** = share of invoices with a `reminder.opened` event whose `settled_on` is within 2 days after the last reminder.

### 10.5 Occupancy-linked (from assignment dates; no bed-status history)

Occupied on day _d_ iff an assignment covers _d_. Occupancy % = occupied bed-days ÷ (active beds × days). **Vacancy loss** = Σ `vacant_days ÷ days_in_month × room-type rent` (per room; a room whose rent does not resolve is shown as "rent not set" and excluded from the ₹ total, with the count of such rooms stated). RevPAB = Collected ÷ active beds; RevPOB ÷ occupied beds. Blocked beds count as vacant (stated in-product).

### 10.6 Trends, comparisons, insights

12-month series for expected, collected, received, expenses, net, rate, occupancy. Each KPI: Δ vs last month and vs same month last year, with absolute base on hover/long-press. Insights are rule-based callouts with a destination (rate behind pace; N overdue > 7 days; claims waiting > 2 days; room vacant N days · ₹ lost; tenant late k of 6; UPI share → gateway coming soon; expenses up X% · top category). Thresholds hard-coded for launch. Empty strip is valid.

### 10.7 Export (server-generated CSV, UTF-8 BOM, streamed, `cribliv-rent-<property>-<from>-<to>.csv`)

Kinds: invoices (row per line + header columns), payments (row per payment, `direction` column; optional allocation rows), expenses, tenant statement (includes settlement and returns), monthly summary. Filters: range + lens, status, room, method, source, direction. Rupees, ISO dates. The web fetches it with the bearer header and saves the blob (`fetchApi` cannot be an `<a href>`); a `Content-Disposition` filename is still sent for direct-URL use.

### 10.8 API & performance

`GET …/rent/summary` (KPIs + insights), `GET …/rent/analytics?period&lens` (trends, breakdowns, behaviour, occupancy), `GET …/rent/export.csv?kind&…`, `GET /v1/pg-operator/rent/portfolio`. Computed live from §4 indexes; no rollups or cache until measured (`BoundedTtlCache` is the fallback).

Deliberately not shown: projected revenue, "profit", tenant scores.

---

## 11. Settings & customisation — bounds, defaults, effect timing

See §4.2 for bounds. Effect timing: `cycle_mode` → next period (bridge); `billing_timing` → next _generated_ invoice (issued invoices keep their due date; switching advance → arrears means the next period's due date jumps a month later, and the preview says so); `due_day` → next invoice; `proration_mode` → next partial period; `prorate_move_out` → next move-out suggestion; `invoice_lead_days` → next sweep; `billing_starts_on` earlier → preview ("will generate N past invoices for M tenants"), those get due = today; later → only tenants with no invoices affected. Late-fee settings → next sweep, never retro. VPA change → prompt "tenants pay to the new ID from now — test with ₹1"; pay pages update live. Prefix → future receipts; numbering never resets. Default items / electricity rate → next generated invoice / new lines.

**Tenant overrides** (tenant profile, logged): rent from next cycle · due day · late-fee exempt / override · excluded default items · deposit amount (while unpaid or ≥ paid) · move-in date (only while null).

**Per-user preferences** (§4.11), Reset to defaults.

**Pause / resume**: pause sets `paused_at` + `pause_reason = owner` — sweeps stop, no new invoices/fees/reminder states; everything existing stays visible, payable, confirmable, exportable on both sides. Resume clears both, takes `billing_starts_on` (default today) with the §5.3 preview.

**Concurrency**: settings PATCH carries `updated_at`; mismatch → 409. Counters live in `pg_rent_counters` (§4.2b) so system activity never moves the token.

**Who**: the property's operator only. Admin read-only view: later. Staff: later (`actor_role` slot exists).

### 11.2 Ownership transfer hook (D20)

`AdminPgTransferService.transfer()` already runs in one transaction with `pg_properties … FOR UPDATE` (`admin-pg-transfer.service.ts:104`). Inside that transaction, after `operator_id` is re-pointed, it calls `RentSettingsService.onOwnershipTransferred(client, propertyId, fromOperatorId, toOperatorId)` which, **only if a `pg_rent_settings` row exists**:

1. Sets `paused_at = now()`, `pause_reason = transfer`.
2. Nulls `upi_vpa`, `upi_payee_name`, `bank_details`, `whatsapp_phone_e164` (the old owner's payee identity must not survive the transfer; receipt branding — business name, address, logo, footer — is the PG's and stays; the new owner can edit it).
3. Writes `settings.transferred {from_operator, to_operator, cleared:[…]}` with `actor_role = admin`.

Consequences, stated so nobody reports them as bugs: pay pages immediately switch to `{mode:'manual'}` (§6.1); open invoices, credits and deposits stay exactly as they are and now belong to the new operator's ledger; pending claims wait for the new operator; the old operator loses access (`assertManagedOwnership`); the new operator's Settings tab opens on the transfer banner (§8.8) and **Resume** is blocked until a VPA or bank details are entered. Money the _old_ owner received before the transfer is already recorded as confirmed payments — the transfer never rewrites history. `pg_operator_preferences` are per user and untouched. A transfer of a property with **no** settings row does nothing new.

### 11.1 Combination rules (each is an engine test fixture)

| Combination                                                        | Behaviour                                                                                                |
| ------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------- |
| anniversary + property `due_day`                                   | ignored; due = period start                                                                              |
| anniversary + tenant `rent_due_day`                                | anchor day; period starts on it (bridge on change)                                                       |
| move-in 29–31, anniversary                                         | clamps to month-end in short months                                                                      |
| tenant moved in before the floor                                   | first period is full                                                                                     |
| tenant moves in mid-month _after_ the floor, `advance`, due day 5  | first period is the prorated move-in period (floor date = period start), due on creation                 |
| `arrears` + enable mid-month                                       | the month being lived is the first invoice (natural due is next month ≥ floor)                           |
| `advance` → `arrears` switch                                       | issued invoices keep their due; next period's due moves a month later; preview says so                   |
| anniversary + arrears                                              | due = `period_end + 1`                                                                                   |
| move-out mid-period, `prorate_move_out=false`                      | full period stands; no suggestion row                                                                    |
| `prorate_move_out=true`, final invoice paid                        | suggestion row → owner taps → §6.6 → credit "return at settlement"                                       |
| tenant sets `notice_end_date` before period start / before move-in | suggestion refused ("check the notice date"); bill untouched                                             |
| notice served, then move-out cancelled                             | window open-ended again; unactioned suggestion disappears; applied re-proration gets a Restore prompt    |
| anniversary actual-days denominator                                | uncut period containing `period_start`; `flat_30` → 30                                                   |
| anchor 31 across Feb                                               | Jan 31–Feb 27, Feb 28–Mar 30, Mar 31–Apr 29 (computed from the anchor, no drift)                         |
| `move_in_date` null                                                | skipped; "set move-in date" row; PATCH allowed once                                                      |
| enabled + `auto_apply=false` + exempt                              | no suggestion                                                                                            |
| `per_day` without cap                                              | soft warning at save                                                                                     |
| fee applied, rent-only payment                                     | `partially_paid`, balance = fee; fee frozen (chargeable balance 0)                                       |
| `per_day`, cash paid Oct 3 recorded Oct 6                          | fee as of Oct 3; invoice `paid`                                                                          |
| fee applied, then policy disabled / exempt / grace changed         | fee stays; bulk waive available                                                                          |
| fee on deposit / adhoc / settlement / backfill                     | never (`late_fee_eligible = false`)                                                                      |
| backfill arrear should accrue                                      | owner flips eligibility on that invoice                                                                  |
| draft issued 20 days after its natural due                         | due = issue date unless typed                                                                            |
| fee vs pending claim                                               | paused; resumes on rejection                                                                             |
| percent fee then partial payment                                   | frozen at first computation                                                                              |
| line removed from `partially_paid` below amount paid               | §6.6 excess → credit; `paid` at new total                                                                |
| `partially_paid` cancelled                                         | allocations → credit                                                                                     |
| offsets unsorted / duplicated                                      | normalised                                                                                               |
| earliest offset before lead days                                   | warning + suggestion                                                                                     |
| `{pay_link}` with no VPA                                           | works (bank / manual); `{upi_id}` "(not set)"                                                            |
| VPA changed with links out                                         | live; old _screenshots_ pay old VPA (noted)                                                              |
| ownership transferred                                              | paused (`transfer`), payee cleared, banner; resume needs payee                                           |
| prefix changed                                                     | seq continues; no collisions                                                                             |
| settings saved while a sweep issued invoices                       | no 409 (counters are separate)                                                                           |
| logo removed / name blank                                          | snapshots untouched; property name fallback                                                              |
| default item a tenant shouldn't get                                | `default_item_overrides.exclude`                                                                         |
| electricity split, invoice paid                                    | new adhoc invoice due +7                                                                                 |
| electricity split, vacant beds                                     | equal split among active tenants, largest-remainder rounding                                             |
| expense edited after split                                         | lines stay; warning shown                                                                                |
| overrides on `reserved`                                            | stored, used at first invoice                                                                            |
| booking amount on `reserved`, then move-in                         | credit auto-applied to deposit then rent                                                                 |
| booking amount, reservation cancelled                              | "held" row → Return (outflow) or Forfeit (adhoc `forfeit` line)                                          |
| rent change with a `draft` open                                    | draft confirms at new amount                                                                             |
| deposit edit after partial payment                                 | allowed iff new ≥ paid                                                                                   |
| deposit resolves from room type only                               | invoiced from `pg_room_types.security_deposit_paise`                                                     |
| settlement with net < 0                                            | shortfall stays on open + settlement invoices; pay link on settlement                                    |
| settlement, then deposit release reversed                          | allocations unwind; deposit held again; statement reopens; re-Settle updates the same settlement invoice |
| refund larger than credit                                          | 400 `refund_exceeds_credit` (invariant 15)                                                               |
| refund recorded, then the funding inflow reversed                  | 409 `reverse_outflow_first`; reverse the refund first                                                    |
| refund recorded, then next invoice generated                       | nothing auto-applied (the credit was consumed by the funding allocation)                                 |
| `arrears`, tenant moves out Oct 15, October not yet invoiced       | October generated at move-out, cut to Oct 15 if `prorate_move_out`, due on creation                      |
| `advance`, tenant moves out Oct 15, October already issued         | suggestion row; owner taps                                                                               |
| deposit invoice unpaid at settlement                               | written down to what was paid; not a due                                                                 |
| moved in during a pause                                            | deposit invoiced on resume (`enabled_on` floor); rent from the new floor                                 |
| fee applied by sweep, cash `paid_on` inside grace recorded late    | fee removed (`paid_within_grace`)                                                                        |
| ₹0 settlement invoice cancelled                                    | allowed (nothing collected)                                                                              |
| tenant changes bed (new assignment) with old credit                | old assignment shows "₹X to return / forfeit"; never carried silently                                    |
| one phone, two beds                                                | both residences returned; second cannot link (unique index); claims still work phone-matched             |
| tenants with no resolvable rent                                    | setup step 1 inline fix                                                                                  |
| owner abroad                                                       | IST regardless                                                                                           |
| saved filter → deleted room                                        | chip stays, results empty (filters are per property)                                                     |
| settings edited mid-sweep                                          | next run                                                                                                 |

---

## 12. API surface (all under `/v1`; rupees in every DTO; `_inr` suffix)

**Operator** — `AuthGuard` + `RolesGuard(pg_operator)` + `assertManagedOwnership`, base `/pg-operator/properties/:propertyId/rent`:

| Method & path                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | Purpose            |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------ |
| `POST /enable` (`billing_starts_on`, settings) · `GET /enable/preview` · `GET/PATCH /settings` · `POST /pause` · `POST /resume` (`billing_starts_on`) · `GET /resume/preview` · `POST /generate-now`                                                                                                                                                                                                                                                                                                                                                   | settings lifecycle |
| `GET /summary` · `GET /analytics` · `GET /export.csv` · `GET /queue`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | dashboards         |
| `GET /invoices` · `POST /invoices` (manual / adhoc / backfill / deposit-held) · `GET /invoices/:id` · `GET /invoices/:id/events` · `GET /invoices/:id/messages` (rendered templates + `wa.me` links + pay link)                                                                                                                                                                                                                                                                                                                                        | invoices           |
| `POST /invoices/:id/issue` (draft → issued with amount, optional due) · `POST/PATCH/DELETE /invoices/:id/lines[/:lineId]` · `POST /invoices/:id/extend-due` · `POST /invoices/:id/cancel` · `POST /invoices/:id/late-fee/apply` · `POST /invoices/:id/late-fee/waive` · `PATCH /invoices/:id/late-fee/eligibility` · `POST /invoices/:id/reprorate` (apply the §5.8 suggestion) · `POST /invoices/:id/reprorate/dismiss` · `POST /invoices/:id/reprorate/restore` · `POST /invoices/:id/pay-token` (regenerate) · `POST /invoices/:id/reminder-opened` | invoice actions    |
| `POST /late-fees/waive-all` · `POST /invoices/bulk-lines`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | bulk               |
| `GET /payments` · `POST /payments` (record; `idempotency_key`) · `POST /payments/:id/confirm` · `POST /payments/:id/reject` · `POST /payments/:id/reverse` · `POST /payments/confirm-bulk` (per-item results) · `PATCH /payments/:id/allocations` (voids + re-mints the receipt) · `POST /refunds` (outflow; `idempotency_key`)                                                                                                                                                                                                                        | payments           |
| `GET /receipts/:id/download` · `POST /receipts/:id/retry` · `POST /receipts/:id/share-token`                                                                                                                                                                                                                                                                                                                                                                                                                                                           | receipts           |
| `GET/POST /expenses` · `PATCH/DELETE /expenses/:id` · `POST /expenses/:id/split` · `GET /expenses/categories`                                                                                                                                                                                                                                                                                                                                                                                                                                          | expenses           |
| `GET /tenants/:assignmentId/ledger` · `PATCH /tenants/:assignmentId` (overrides, rent from next cycle, `move_in_date` while null) · `GET /tenants/:assignmentId/settlement` (live statement) · `POST /tenants/:assignmentId/settle` (§6.11; `idempotency_key`) · `POST /tenants/:assignmentId/forfeit` (§6.12) · `POST /tenants/:assignmentId/identity-dispute/resolve` (§7.9, logs `{flag:'identity_dispute_cleared'}`)                                                                                                                               | tenants            |
| `GET/PUT /pg-operator/preferences/rent-dashboard` · `GET /pg-operator/rent/portfolio`                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | user-level         |

**Tenant** — `AuthGuard` + `RolesGuard(tenant)`, base `/tenant/pg-rent`: `GET /summary` (all residences), `GET /history?assignment=`, `GET /invoices/:id`, `POST /claims` (`idempotency_key`), `DELETE /claims/:id`, `GET /receipts/:id/download`, `POST /identity-dispute`, `POST /claims/:id/notify-message` (the §7.5 tenant-paid text + `wa.me` link). Operator side also has `POST …/rent/messages/preview` (the §7.4 live editor preview).

**Internal (no HTTP)** — `RentSettingsService.onOwnershipTransferred(client, …)` called by `AdminPgTransferService` (§11.2); `RentInvoiceEngineService.onAssignmentEvent(event)` called by `PgBedAssignmentService` after commit (§5.8).

**pg-operations additions (slice 0, existing controller)** — `POST …/assignments/:id/cancel-notice` (`cancelNotice`, §8.9); `POST …/assignments/:id/confirm-move-out` and `…/move-out` gain an optional `move_out_date` body field.

**Public** — no auth, rate-limited: `GET /public/pg-rent/pay/:token` (page data + QR SVG), `GET /public/pg-rent/receipts/:shareToken` (302 to SAS).

When `FF_PG_RENT_COLLECTION` is off, all `pg-rent` routes return 404 `{code:'feature_disabled'}`.

---

## 13. Module architecture & code layout

**API** — `apps/api/src/modules/pg-rent/`

```
pg-rent.module.ts
controllers/  pg-rent-settings.controller.ts  pg-rent-invoices.controller.ts  pg-rent-payments.controller.ts
              pg-rent-expenses.controller.ts  pg-rent-analytics.controller.ts  pg-rent-tenant.controller.ts
              pg-rent-public.controller.ts    pg-rent-preferences.controller.ts
services/     rent-settings.service.ts        rent-invoice-engine.service.ts   rent-invoice.service.ts
              rent-payment.service.ts         rent-receipt.service.ts          rent-message.service.ts
              rent-pay-instruction.service.ts rent-expense.service.ts          rent-analytics.service.ts
              rent-export.service.ts          rent-tenant.service.ts           rent-preferences.service.ts
              rent-settlement.service.ts      rent-events.ts (writer)          rent-guards.ts (ownership / tenant resolution)
pure/         rent-period.ts  rent-proration.ts  rent-late-fee.ts  rent-allocation.ts  rent-status.ts
              rent-money.ts (paise↔inr, rounding, largest-remainder split)  rent-template.ts (merge)  rent-upi.ts (uri + limits)
              rent-reminder-state.ts  rent-insights.ts  rent-settlement.ts (statement math)  rent-window.ts (status-aware window)
receipt/      receipt-renderer.ts  templates/receipt.en.hbs  templates/receipt.hi.hbs
dto/          zod schemas for every input; `_inr` ⇄ paise mapping lives here and nowhere else
__tests__/    unit (pure), engine fixtures, integration (DB-gated)
```

Worker: `apps/api/src/worker/pg-rent-sweeps.ts` → `runPgRentSweep(pool, todayIST)`, `runPgRentReceiptSweep(pool)`; wired in `worker.ts` behind the flag (hourly / 2 min; **not** on startup, per the stale-sweep precedent at `worker.ts:1252`). Shared types: `packages/shared-types/src/pg-rent.ts`. Dependencies added to the API: `qrcode` (SVG string output). DB-required (D13): throws `ServiceUnavailableException {code:'rent_requires_db'}` when `DATABASE_URL` is unset.

Touched outside the module (slice 0 / slice 1): `pg-operations/services/pg-bed-assignment.service.ts` (IST dates, `move_out_date` input, post-commit `onAssignmentEvent` call — same place `notify()` is called), `admin/admin-pg-transfer.service.ts` (`onOwnershipTransferred` inside its transaction), `common/date.ts` (new `todayIst()` / SQL fragment constant shared by both). `PgRentModule` exports the two internal services; `PgOperationsModule` and `AdminModule` import `PgRentModule` — no circular import because `pg-rent` never imports those modules' services (it reads their tables directly, as maintenance does). Both hooks are **data-driven, not flag-driven**: they no-op when `DATABASE_URL` is unset or the property has no `pg_rent_settings` row, and they run regardless of `FF_PG_RENT_COLLECTION` — a flag flip must never leave a transferred property with the old owner's VPA or a moved-in tenant without a pending sweep. The HTTP 404 gate applies to controllers only.

**Web** — `apps/web/`

```
app/[locale]/pg-operator/properties/[propertyId]/layout.tsx        ← workspace shell (tabs, switcher)
app/[locale]/pg-operator/properties/[propertyId]/page.tsx          ← Overview (widgets)
app/[locale]/pg-operator/properties/[propertyId]/beds/page.tsx     ← today's property page content
app/[locale]/pg-operator/properties/[propertyId]/rent/page.tsx
app/[locale]/pg-operator/properties/[propertyId]/rent/invoices/[invoiceId]/page.tsx
app/[locale]/pg-operator/properties/[propertyId]/expenses/page.tsx
app/[locale]/pg-operator/properties/[propertyId]/settings/page.tsx
app/[locale]/pay/[token]/page.tsx                                   ← public
components/pg-operator/workspace/   WorkspaceShell, PropertySwitcher, BottomTabs
components/pg-operator/rent/        RentHeader, KpiTiles, CollectionQueue, RecordPaymentSheet, ConfirmClaimSheet,
                                    InvoiceDetail, LedgerTable, RentBedLayer, TenantLedger, ExpensesList,
                                    AddExpenseSheet, SplitExpenseSheet, OverviewBoard (+ widgets), RentSetupWizard,
                                    SettingsSections, MessageTemplateEditor
components/tenant/pg-rent/          RentHero, PayPanel, ClaimSheet, InvoiceLines, RentHistory, RentBanners
lib/pg-rent-api.ts                  typed wrappers over fetchApi (rupees)
lib/i18n.ts                         new keys en + hi
```

---

## 14. Security & validation

- Operator scope on every call (`assertManagedOwnership`); tenant scope via `tenant_user_id` or phone match; a tenant can only read/claim their own assignment's invoices; operators of other properties get 403 (tested).
- Public endpoints expose the minimum (first name, amount, payee), are `noindex`, IP rate-limited, token-based (unguessable, expiring), and cannot create in-app records.
- All input via zod at the controller edge; amounts whole rupees within bounds; dates ≤ today IST; regexes for VPA/IFSC/phone; string length caps; blob uploads through the storage port only.
- Money math server-side only; allocations recomputed and confined to one assignment; idempotency keys on recording, claiming, refunding and settling; `FOR UPDATE` on confirm/reverse/issue/settle and on the assignment row for every rent-invoice insert; optimistic concurrency on settings.
- Outflows bounded by what the property holds for that assignment (invariant 15); a reason is mandatory; they are reversible and logged like any payment.
- Tenant-supplied dates (`notice_end_date`, claim `paid_on`) never change a bill by themselves; the owner confirms every reduction (D18, D5).
- No secrets in code; UPI/bank details are the owner's own public payee information, not credentials — and they are cleared on ownership transfer (§11.2).
- Audit: every mutation logged with actor and role; nothing financial deleted.

---

## 15. Rollout, flags, migration, launch, observability

**Flags** (declared in `feature-flags.ts`, `.env.example`, and the Azure app-settings runbook): `NEXT_PUBLIC_FF_PG_WORKSPACE_V2`, `FF_PG_RENT_COLLECTION` / `NEXT_PUBLIC_FF_PG_RENT_COLLECTION`, `FF_PG_RENT_GATEWAY`, `FF_PG_RENT_AUTO_REMINDERS` — all default off. Web flags also resolve via PostHog for per-user dogfooding.

**Tenant-side gating (§19 #19):** `NEXT_PUBLIC_FF_PG_RENT_COLLECTION` gates only the _owner_ surfaces. The tenant Rent tab renders iff `GET /tenant/pg-rent/summary` reports a residence whose property has a settings row (and 404 `feature_disabled` ⇒ old Money tab). So the web flag can be on for everyone from day one without any tenant seeing rent UI until _their_ owner enables it — pilot operators' tenants get it, nobody else notices.

**Migration** 0072 + rollback, additive, safe before code deploy; rollback only if the flag was never enabled in that environment. Local `db:seed` gains a rent scenario (settings + tenants across states, one arrears property, one settled move-out, one reserved with booking credit).

**Slices** (each a PR, flagged, reviewed upward, e2e'd): 0 shell + nav + tenant list lift + two bug fixes + **IST assignment dates + move-out date input** · 1 backend core (settings, counters, engine incl. deposit + window, payments incl. direction/outflow, allocation + invariant 14, receipts, events, transfer hook) · 2 owner Rent tab + setup wizard with preview + queue (incl. Needs-confirmation and Leaving rows) + WhatsApp/pay link + pay page · 3 tenant Rent tab (multi-residence) + claims + receipts + identity dispute · 4 **settlement + refunds + booking amounts** + tenant ledger · 5 expenses + analytics + export + overview + preferences · 6 bed grid rent layer + bed detail + polish + full e2e.

**Launch**: apply 0072 → deploy API + worker + web (flags off; verify the worker carries the sweep build — the prod worker has lagged the API before) → API flag on → web flag on for our account via PostHog → run the seeded property through a cycle incl. one settlement → pilot 2–3 operators for one real cycle → env flag on. Rollback at any step = flags off, data untouched; pay links held by tenants show the "temporarily unavailable" page while off.

**Observability**: `logTelemetry` — `pg_rent.sweep_run {properties, invoices, deposits, fees, ms}`, `invoice_generated`, `payment_recorded`, `claim_submitted`, `claim_confirmed`, `claim_rejected`, `refund_recorded`, `settlement_created`, `excess_deallocated`, `receipt_rendered`, `receipt_failed`, `export_generated`, `transfer_paused`. PostHog funnel: setup completed → first invoice → first payment recorded → first claim → first receipt shared → first settlement. Alerts: receipt failures > 5/h, sweep errors, a sweep generating > 3× a property's bed count in one run, any `assertRentInvariants` failure in the nightly check (§16).

**Housekeeping**: CLAUDE.md "next free migration is 0055" → 0072; `.env.example` flags + sweep intervals; launch runbook in `docs/superpowers/`.

**Risks**: Puppeteer on the API host (rent-agreement already uses it — verify on the day); owner-typed tenant phones (§7.9); worker clock (IST pinned by test); click-to-chat on desktop needs WhatsApp Web linked; `btree_gist` not allow-listed (overlap is a service check, §4.4).

---

## 16. Testing strategy

- **Pure functions** (no DB), 100 % branch on `rent-period`, `rent-proration`, `rent-window`, `rent-allocation`, `rent-late-fee`, `rent-status`, `rent-money`, `rent-settlement`: both modes × both timings, bridges, clamping (anchor 31 across Feb, no drift), floor, denominators; status-aware window incl. `active` with stale `notice_end_date`; three fee kinds, cap, freeze, override, exempt, chargeable-balance freeze, as-of-`paid_on` recompute; targeted → FIFO → credit, over-allocation refused, cross-assignment refused, excess de-allocation newest-first; every status combination incl. `amount_paid = total` only; rounding and largest-remainder split; settlement statement math incl. net < 0; template merge (unknown fields, truncation, encoding); UPI URI limits (`tr` stripping); reminder states (single overdue definition); insight rules.
- **Engine fixtures**: `{settings, tenants, today} → expected invoices (rent + deposit)`; every §11.1 row is a fixture, including the arrears rows and the transfer row.
- **DB integration** (vitest, `describe.skipIf(!DATABASE_URL)`): `assertRentInvariants(propertyId)` after every test (all 16 invariants, incl. `amount_paid ≤ total` and outflow bounds); sweep twice → no diff; deposit invoice issued by sweep without the hook; overlap insert → 409; concurrent confirm → one 409; reversal walks status back and clears `settled_on`; excess de-allocation on line removal / cancel / waive → credit; contiguity across mode switch and across cancelled notice; floor on enable/pause/resume with preview; IST midnight with frozen clock **including assignment dates written by the pg-operations service**; pending claim pauses fees; extend-due removes fee; operator A vs B 403; tenant phone-match scoping across two assignments; idempotency keys on record / claim / refund / settle; receipt row + snapshot + void + re-mint on re-allocation; two renderers on one receipt → one PDF; settlement end-to-end (deposit release → allocation → refund funded by allocations → next generation applies nothing → reverse refund → credit back → reverse release → held again; reversing the release first → 409); unpaid deposit written down at settlement; `moved_out` final period generated cut and due on creation in both timings; deposit invoiced on resume for a mid-pause move-in; booking credit on `reserved` → applied at move-in; `cancelNotice` clears notice fields and the window reopens; ownership transfer → paused, payee cleared, old operator 403, new operator resume blocked until payee set; settings PATCH not 409'd by a concurrent sweep.
- **Analytics**: exact rupees on a seeded month; lens separation; `Received` excludes `method = deposit`; `Returned` and `Net`; backfill excluded from behaviour; days-to-pay from `settled_on`; vacancy loss from assignment dates with an unresolvable room; CSV bytes (BOM, columns, rupees, direction). **Contract**: no `_paise` key escapes any `pg-rent` response.
- **Receipts**: template render vs snapshot (unit); one real Puppeteer render (integration, skipped without Chromium).
- **Web unit** (vitest + RTL, en + hi, axe): hero states incl. Nothing due, multi-invoice, settled, multi-residence; Record sheet prefill + allocation preview + idempotency key per submit + undo toast; Confirm sheet editable amount + mandatory reject reason; queue Needs-confirmation and Leaving rows with their actions; settle sheet math and "to return"; setup wizard preview with editable floor; settings validation + template preview; pay page (QR present, intent button mobile-only, expired/paid, no-payee, flag-off); preferences reorder + persistence with per-property filters.
- **Playwright** `tests/pg-operator/rent.spec.ts` (seeded scenario, `tests/utils` DB guard): enable (preview) → generate now → queue → record cash → receipt → tenant sees paid; tenant claim → owner confirm; overdue → Remind asserts `wa.me` href; notice → suggestion → re-prorate → settle → record return → tenant sees statement; CSV download; mobile viewport (bottom tabs, sheets).
- **Sweeps**: run against DB with frozen "today", twice. **Nightly** (worker, behind the flag): `assertRentInvariants` over every property → telemetry alert on failure. **Performance**: 200 beds × 12 months seeded, analytics < 300 ms locally.

---

## 17. Bugs and gaps found during design (disposition)

| #   | Finding                                                                                                                                                                                            | Disposition                                                                                                                                          |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | CLAUDE.md says next free migration is 0055; real next is 0072                                                                                                                                      | Fix in slice 0                                                                                                                                       |
| 2   | Rent falls back to the listing's _starting_ rent when a room has no room type (`pg_rooms.room_type_id ON DELETE SET NULL`); residence page shows the cheapest advertised rent as the tenant's rent | Engine: `rent_source = listing` ⇒ `draft`; residence page unchanged (out of scope) but noted                                                         |
| 3   | No endpoint edits an assignment's rent after move-in                                                                                                                                               | "Change rent from next cycle" in the rent module                                                                                                     |
| 4   | Bed detail shows "Monthly rent: Not set" while the tenant's page resolves a number                                                                                                                 | Fix in slice 0/5 (show resolved rent + source)                                                                                                       |
| 5   | Vacant bed shows `Available 2026-09-03` (a past date)                                                                                                                                              | Fix in slice 0 ("Available now")                                                                                                                     |
| 6   | Management surfaces unreachable from the header nav                                                                                                                                                | Workspace shell + Manage entry (slice 0)                                                                                                             |
| 7   | `pg_details.late_fee_policy` is an unshaped jsonb; `payment_modes` marketing-only                                                                                                                  | Left as marketing; module never reads them; documented                                                                                               |
| 8   | Owner-typed `occupant_phone_e164` may be wrong                                                                                                                                                     | "verified ✓" on linked tenants; warning on first Remind; tenant-side "Not your PG?" dispute (§7.9)                                                   |
| 9   | Residence page skips `pg_room_types.security_deposit_paise` (0065) in its deposit COALESCE (`pg-residence.service.ts:137`)                                                                         | Rent module resolves the full chain (§2); residence page fix is a one-line follow-up outside this spec                                               |
| 10  | Assignment dates are written with `CURRENT_DATE` (UTC on Azure); `move_out_date` is always the click day                                                                                           | Fixed in slice 0 (§8.9)                                                                                                                              |
| 11  | `cancelMoveOut` leaves `notice_end_date` on an `active` row; there is no direct `notice_served → active` transition at all                                                                         | Slice 0: `cancelMoveOut` clears the notice fields; new `cancelNotice` transition (§8.9). The rent window stays status-aware (§5.2) for existing rows |

---

## 18. Deferred extensions & open items

**Deferred (candidate follow-ups, in rough value order):** settlement **statement PDF** (the settlement itself is in, §6.11); meter-reading ledger per room; automated WhatsApp/SMS reminders (`FF_PG_RENT_AUTO_REMINDERS`); gateway rail (`FF_PG_RENT_GATEWAY`, will add an `initiated` payment status); CSV import of history; admin read-only view of rent settings; staff roles; "copy settings from another property"; insight thresholds as settings; relaxing `uq_pg_active_assignment_per_tenant` so one user can link two beds (pg-operations); `EXCLUDE USING gist` on rent periods once `btree_gist` is allow-listed; residence-page deposit COALESCE fix (§17 #9).

**Open items:** none blocking. Mockups of the Rent tab, Record sheet and Settle sheet may be produced during planning if the owner wants to see them before implementation.

---

## 19. Critical review (2026-09-17) — findings and dispositions

A line-by-line review of the approved spec against the code it grounds itself in. Severity: **C** = wrong money or silently stopped billing · **H** = wrong behaviour an owner would hit in the first month · **M** = confusing or inconsistent · **L** = nit. Every row is resolved in the section named; nothing here is deferred without saying so.

| #   | Sev | Finding (with the evidence)                                                                                                                                                                                                                               | Disposition                                                                                                                                                        |
| --- | --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | C   | Ownership transfer (`admin-pg-transfer.service.ts:181`) moves the property with all children; `pg_rent_settings` (VPA, bank, WhatsApp fallback) would travel to the new operator and tenants would keep paying the old owner                              | **D20**; §11.2 transfer hook: pause with `pause_reason = transfer`, clear payee, event, banner, resume blocked until payee set                                     |
| 2   | C   | `cancelMoveOut` (`pg-bed-assignment.service.ts:753`) returns to `active` without clearing `notice_end_date`; the window `coalesce(move_out_date, notice_end_date)` would stop invoicing a tenant who stays                                                | §5.2 status-aware window (`active` ignores `notice_end_date`); "notice ended" queue row; §17 #11 follow-up                                                         |
| 3   | C   | No invariant `amount_paid ≤ total`; `≥` in the status function hid it. Any total reduction on a `partially_paid` invoice (line removed, fee removed by Extend-due, waive) strands money; cancelling a `partially_paid` invoice left allocations undefined | **Invariant 14** + DB CHECK; §6.6 generalised to every total-reducing mutation, newest allocation first; cancel releases allocations to credit                     |
| 4   | C   | §5.3 billed in advance (Oct rent due Oct 5), §9's example billed in arrears (Sep rent due Oct 5); no setting existed                                                                                                                                      | **D16** `billing_timing`; §5.3 due-date table, worked examples for both, floor behaviour explained, wizard shows it                                                |
| 5   | C   | `serveNotice` (`:896`) is a tenant action validated for format only; §5.8 let it re-prorate a paid invoice into credit                                                                                                                                    | **D18** owner-tap suggestions only (§5.8); leave dates before period start / move-in refused; Restore prompt after a cancelled notice                              |
| 6   | C   | No outflow: deposit refunds, credit returns and booking forfeits could not be recorded; "Deposits held" silently dropped at move-out; tenant history showed "held" forever                                                                                | **D17** full settlement in MVP: `direction`, `deposit_release`, §6.11 settlement, §6.12 booking amounts, invariant 15, Returned/Net metrics, Leaving queue section |
| 7   | H   | `next_*_seq` lived on the settings row whose `updated_at` is the PATCH token; every invoice/receipt would 409 an open Settings form                                                                                                                       | §4.2b `pg_rent_counters`                                                                                                                                           |
| 8   | H   | Deposit chain skipped `pg_room_types.security_deposit_paise` (0065) — copied the residence service's gap                                                                                                                                                  | §2 / §5.5 full chain; §17 #9                                                                                                                                       |
| 9   | H   | Deposit invoice was hook-only ("best-effort"); a lost hook meant no deposit ever                                                                                                                                                                          | §5.5 sweep-generated, unique partial index, hook only triggers an early run                                                                                        |
| 10  | H   | Invariant 10 pinned IST but assignment dates are `CURRENT_DATE` in an unpinned (UTC) session (`:543`, `:574`, `:653`, `:915`); `move_out_date` is always the click day                                                                                    | Slice 0: IST writers + optional `move_out_date` on operator move-out (§8.9); invariant 10 reworded                                                                 |
| 11  | H   | (a) `per_day` accrued forever on a fee-only balance; (b) fee computed to today, not `paid_on`; (c) drafts issued late / backfilled arrears instantly overdue with fees                                                                                    | §5.6 chargeable balance + freeze; as-of-`paid_on` recompute in `finalizeConfirmed`; `late_fee_eligible` (invariant 16); issue-date rule in §5.3                    |
| 12  | H   | Backfill payments minted receipts: hundreds of PDFs and out-of-order numbers when entering history                                                                                                                                                        | **D19**; §4.8 / §6.4                                                                                                                                               |
| 13  | H   | Receipts were "immutable" but re-allocation and credit auto-apply changed what they claimed                                                                                                                                                               | §6.7: manual re-allocation voids + re-mints (`superseded_by`); auto-apply never touches a receipt; `credit_paise` on the snapshot                                  |
| 14  | H   | One phone, two beds: `uq_pg_active_assignment_per_tenant` + `queryResidence LIMIT 1` hid the second; a wrong phone auto-linked a stranger who could claim                                                                                                 | §9 multi-residence resolution without auto-link on read; §7.9 dispute path; index relaxation deferred (§18)                                                        |
| 15  | H   | Unique index on `(assignment, period_start)` did not prevent overlapping backfill/manual periods                                                                                                                                                          | §4.4 overlap check under the assignment lock; `btree_gist` constraint deferred                                                                                     |
| 16  | M   | Floor = today skipped the current month whenever `due_day < today` with no warning (enable Sep 17 → October first)                                                                                                                                        | §5.3 / §8.8 enable & resume preview with editable `billing_starts_on`; arrears explained                                                                           |
| 17  | M   | Electricity split: rounding drift, no expense → line link, same charge landed in Expected or Other billed depending on timing                                                                                                                             | Invariant 9 largest-remainder; `expense_id` on lines, `split_at` on expenses; Expected = rent + adhoc (§10.2)                                                      |
| 18  | M   | Days-to-pay used `paid_at` (confirmation time), penalising tenants for slow owners                                                                                                                                                                        | `settled_on` (§4.4); §10.4                                                                                                                                         |
| 19  | M   | Tenant-side web flag could not be dogfooded per user; API flag off killed held pay links                                                                                                                                                                  | §15 tenant gating by property settings; friendly flag-off pay page (§7.7)                                                                                          |
| 20  | M   | Booking amounts on `reserved` and cancelled reservations with money held were unspecified                                                                                                                                                                 | §6.12                                                                                                                                                              |
| 21  | M   | `move_in_date` is nullable; the walk had no start for legacy rows                                                                                                                                                                                         | §5.2 skip + queue row + `PATCH move_in_date` while null                                                                                                            |
| 22  | M   | Two definitions of overdue (KPI vs queue `in_grace`)                                                                                                                                                                                                      | §7.2 one definition; "in grace" is a tag                                                                                                                           |
| 23  | M   | Tenant claims without `claimed_invoice_id` had no idempotency                                                                                                                                                                                             | §6.3 `idempotency_key` required on claims                                                                                                                          |
| 24  | M   | `invoice.*` events were tenant-visible even for invisible drafts                                                                                                                                                                                          | §4.10 visibility rule                                                                                                                                              |
| 25  | M   | Saved filters (room ids) shared across a multi-property operator's properties                                                                                                                                                                             | §4.11 keyed by `propertyId`                                                                                                                                        |
| 26  | M   | "Gateway needs no migration" ignored the pre-capture order                                                                                                                                                                                                | §6.9 / §1: no new tables; an `initiated` status may be added                                                                                                       |
| 27  | M   | API immediate render and worker sweep could render one receipt twice                                                                                                                                                                                      | §6.7 `FOR UPDATE SKIP LOCKED`                                                                                                                                      |
| 28  | M   | Anniversary anchor drift (Jan 31 → Feb 28 → Mar 28) and bridge denominator unpinned                                                                                                                                                                       | §5.3 computed from the anchor; §11.1 fixtures                                                                                                                      |
| 29  | L   | `downloads/azure-sas-issuer.ts` path wrong                                                                                                                                                                                                                | §2 corrected                                                                                                                                                       |
| 30  | L   | `/en/pay` is not in the middleware matcher; `PUBLIC_PREFIXES` entry would be a no-op                                                                                                                                                                      | §2 states it; no change needed                                                                                                                                     |
| 31  | L   | UPI `tr ≤ 35 alphanumerics` vs invoice numbers with hyphens                                                                                                                                                                                               | §7.7 strip non-alphanumerics                                                                                                                                       |
| 32  | L   | Line hard-delete contradicted D14's wording                                                                                                                                                                                                               | §4.5 states the event is the audit record                                                                                                                          |
| 33  | L   | `confirm-bulk` partial-failure semantics unspecified                                                                                                                                                                                                      | §6.3 per-item results                                                                                                                                              |
| 34  | L   | `GET /export.csv` behind bearer auth cannot be an `<a href>`                                                                                                                                                                                              | §10.7 fetch + blob                                                                                                                                                 |
| 35  | L   | `pg_properties.operator_id ON DELETE CASCADE` would cascade into every rent table                                                                                                                                                                         | §2 states it; no deletion path exists; D14 relies on that                                                                                                          |
| 36  | L   | Hero had no "nothing due yet" state and no rule for several open invoices                                                                                                                                                                                 | §9 Nothing due + oldest-first with "+ ₹X across N more"                                                                                                            |

### 19.1 Re-audit of the revision (same day, fresh read of §3–§6, §11)

The first revision introduced or exposed these; all are fixed in place.

| #   | Sev | Finding                                                                                                                                                                                                               | Disposition                                                                                                                                                                                     |
| --- | --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 37  | C   | `moved_out` was not an eligible status, so a final period not yet created at move-out was never invoiced — in `arrears` that is **every tenant's last month**                                                         | §5.2: every status except `reserved`/`cancelled` walks the window; the window end stops generation; final periods are created cut (when `prorate_move_out`) and due on creation for `moved_out` |
| 38  | C   | Outflows reduced "credit" but allocations only linked inflows to invoices, so a refunded deposit remainder still looked unallocated and would be auto-applied to the next invoice                                     | §4.7 allocations may target an outflow (`refund_payment_id`); invariant 15 restated as "an outflow is fully funded"; reversal ordering enforced (`reverse_outflow_first`)                       |
| 39  | H   | Settlement counted an _unpaid_ deposit invoice as a due, so a tenant who never paid the deposit would be billed for it at move-out                                                                                    | §6.11 step 0 writes the uncollected remainder down; deposit invoices are excluded from Open dues                                                                                                |
| 40  | H   | Deposit eligibility used `billing_starts_on`, which resets on resume — tenants who moved in during a pause would never get a deposit invoice                                                                          | `enabled_on` (§4.2) is the deposit floor; resume preview names them                                                                                                                             |
| 41  | H   | A fee applied by the sweep stood even when a late-recorded payment's `paid_on` was inside the grace period                                                                                                            | §5.6 as-of rule removes the fee (`paid_within_grace`) for every kind                                                                                                                            |
| 42  | M   | No direct `notice_served → active` transition exists in pg-operations; the "notice ended" row had no sane second action                                                                                               | Slice 0 `cancelNotice` + `cancelMoveOut` clears notice fields (§8.9, §17 #11)                                                                                                                   |
| 43  | M   | `paid → cancelled` was refused unconditionally, which blocked cancelling ₹0 invoices (including a ₹0 settlement)                                                                                                      | §5.7: refused only when `amount_paid > 0`                                                                                                                                                       |
| 44  | M   | Restore after a cancelled notice re-added the amount but left the credit §6.6 had released floating                                                                                                                   | §5.8 Restore re-applies the credit in the same transaction                                                                                                                                      |
| 45  | M   | A calendar bridge or cut period in `arrears` would be due a month after a mid-month end                                                                                                                               | §5.3 cut periods are due `period_end + 1`                                                                                                                                                       |
| 46  | M   | Re-running Settle after a reversed deposit release hit the one-settlement-per-assignment index                                                                                                                        | §6.11 step 0: updates the existing settlement invoice's lines                                                                                                                                   |
| 47  | L   | Settlement could be computed before the final period existed; "Leaving" rows never cleared for tenants with nothing to settle; identity-dispute badge had no way to clear; credit auto-apply was ambiguous for drafts | §6.11 generation-first + auto-clear; §7.9 Resolved; §5.4 step 4                                                                                                                                 |

### 19.2 Found while writing the implementation plan (period math at code level)

| #   | Sev | Finding                                                                                                                                                                                                                          | Disposition                                                                                                        |
| --- | --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| 48  | C   | The floor tested the _natural due date_, which for an advance-billed mid-month move-in is before the move-in itself (Sep 20 move-in, due day 5 → Sep 5 < floor Sep 17), so the tenant's first partial period was never generated | §5.3 floor date = `max(natural due, period_start)`; fixture added                                                  |
| 49  | L   | `electricity_unit_rate_paise` allows ₹0.50/unit, which no whole-rupee `_inr` integer can carry                                                                                                                                   | §4.2: the rate DTO is a two-place decimal, the one stated exception; derived line amounts still round to the rupee |
| 50  | L   | The deposit invoice had no line kind to carry its single line                                                                                                                                                                    | `deposit` added to `pg_rent_line_kind` (§4.1); excluded from default items                                         |

**Consistency checks performed:** every event type in §4.10 has a producer in §5/§6/§7/§11; every endpoint in §12 has a service in §13; every column added in §4 has a named writer; every §19 row names the section that resolves it; §11.1 has a fixture row for every C/H finding. Remaining known limitations are in §18, not hidden: one user cannot _link_ two beds; period overlap is a service check, not a constraint; the settlement statement has no PDF yet.
