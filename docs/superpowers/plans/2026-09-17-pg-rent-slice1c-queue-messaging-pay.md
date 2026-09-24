# PG Rent — Slice 1c: Queue, messaging, pay page API, tenant reads Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Everything the owner's Rent tab, the tenant's Rent tab and the public pay page will read: reminder states and the collection queue, owner-editable WhatsApp templates rendered into `wa.me` links, the UPI pay instruction with a server-rendered QR, the public pay and receipt-share endpoints, the tenant summary (multi-residence hero) and history, identity dispute, the month KPI summary and the portfolio snapshot.

**Architecture:** Pure functions for reminder state, template merge and UPI/`wa.me` URI building (`pure/`), each with 100 % branch coverage. Four read-mostly services: `RentPayInstructionService` (UPI intent + QR, pay links, public pay page data), `RentMessageService` (templates + merge + `wa.me`), `RentQueueService` (queue sections, month summary, portfolio), `RentTenantService` (tenant-scoped reads across every matching assignment, no auto-link, no writes on read). Public endpoints are token-based, `@Throttle`d, and expose the minimum. No new tables; one new column (`pg_rent_invoices.idempotency_key`, migration **0074**, Task 7). New event types written: `reminder.opened`, `invoice.pay_token_regenerated`; `assignment.override_updated` gains the `{flag}` dispute payloads; Task 8 reuses `invoice.cancelled` / `invoice.excess_deallocated`. Tasks 7–8 carry two owner decisions of 2026-09-24 (invoice idempotency key; Restore absorbs the gap invoice).

**Tech Stack:** NestJS 10, `pg`, zod 4, `qrcode` (already a dependency — SVG string output), `@nestjs/throttler` (`@Throttle`), vitest + supertest.

**Spec:** `docs/superpowers/specs/2026-09-17-pg-rent-collection-design.md` — §7 (7.1–7.9), §9 (tenant API, "Which assignment(s)?"), §10.2 (Expected / Collected / Outstanding / Overdue / Awaiting only — the rest is slice 5), §12 (tenant, public, `/messages`, `/reminder-opened`, `/pay-token`, `/portfolio`), §14.

## Global Constraints

Everything in `docs/superpowers/plans/2026-09-17-pg-rent-00-index.md`. Specific to this slice:

- **Depends on slice 1b merged** (payments, receipts, settlement, `resolveTenantAssignmentIds`, `reprorate_suggestion`).
- **Migrations:** this slice adds exactly one, `0074_pg_rent_invoice_idempotency.sql` (+ `.rollback.sql`), in Task 7. The last migration before this slice is `0073_pg_rent_alloc_seq.sql`; after it the next free number is **0075**.
- **Test fixtures and the real clock:** `RentSettingsService.enable()` stamps `enabled_on = todayIst()`, and `planDeposit` only bills a deposit when `move_in_date >= enabled_on` — a suite that needs deposit invoices for a past move-in uses `enableRentAsOf(...)` from `__tests__/helpers/rent-fixtures.ts`. The engine sets `due_date = today` for any period whose natural due date is already past (and for every moved-out tenant's cut period), so fixtures generate at the date they want the due date to land on. `RentPaymentService` refuses a `paid_on` after the real IST date. Fixed test phones must be unused by every other suite (`users.phone_e164` is UNIQUE and files run in parallel; `+917700000055/77/88/99` are taken); a user may have only one linked active assignment (`uq_pg_active_assignment_per_tenant`).
- Public endpoints: no auth, `@Throttle({ default: { ttl: 60_000, limit: 30 } })`, respond only with the fields §7.7 lists (first name only, never the phone, never the pay token itself, never internal notes), `Cache-Control: no-store`.
- `pay_token` only ever leaves the API inside a `pay_link` URL: `GET /invoices/:id/messages`, `POST /invoices/:id/pay-token` (operator), and `GET /tenant/pg-rent/summary|history|invoices/:id` (the tenant may share their own link). Never as a bare field, never in invoice DTOs, never on the public page.
- All money in rupees with `_inr`; amounts inside message text are Indian-grouped (`₹1,20,000`).
- Reminder states and "overdue" use one definition (`due_date < today`, spec §7.2); "in grace" is a tag.
- Tenant reads never call `lockTenantAssignment` (no auto-link on read, spec §9) and never write: the tenant hero uses `RentSettlementService.computeStatement` (read-only), not `statement()` (which generates first).
- Tenant-facing event payloads go through `toEventDto` (no `_paise`) and drop `rent_source` (owner-only).

---

## File structure

| File                                                                               | Responsibility                                                                                                                                                                 |
| ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `packages/shared-types/src/pg-rent.ts` (modify)                                    | queue, message, pay-instruction, tenant summary/history, portfolio, month summary types                                                                                        |
| `apps/api/src/modules/pg-rent/pure/rent-reminder-state.ts`                         | `reminderState`, `duePhrase`                                                                                                                                                   |
| `apps/api/src/modules/pg-rent/pure/rent-template.ts`                               | `mergeTemplate`, `formatInrGrouped`, `DEFAULT_TEMPLATES`                                                                                                                       |
| `apps/api/src/modules/pg-rent/pure/rent-upi.ts`                                    | `buildUpiUri`, `sanitizeTr`, `buildWaMeLink`                                                                                                                                   |
| `apps/api/src/modules/pg-rent/services/rent-message.service.ts`                    | template resolution, merge fields for an invoice, `wa.me` links, `reminderOpened`, pay-token regenerate                                                                        |
| `apps/api/src/modules/pg-rent/services/rent-pay-instruction.service.ts`            | `buildPayInstruction` (+ QR SVG), public pay page data                                                                                                                         |
| `apps/api/src/modules/pg-rent/services/rent-queue.service.ts`                      | `queue`, `monthSummary`, `portfolio`                                                                                                                                           |
| `apps/api/src/modules/pg-rent/services/rent-tenant.service.ts`                     | `summary`, `history`, `invoice`, `identityDispute`; operator `resolveDispute`                                                                                                  |
| `apps/api/src/modules/pg-rent/dto/tenant-reads.dto.ts`                             | tenant invoice/hero mappers, dispute schema                                                                                                                                    |
| `apps/api/src/modules/pg-rent/controllers/pg-rent-queue.controller.ts`             | `GET /queue`, `GET /summary`, `GET /invoices/:id/messages`, `POST /invoices/:id/reminder-opened`, `POST /invoices/:id/pay-token`, `POST /tenants/:id/identity-dispute/resolve` |
| `apps/api/src/modules/pg-rent/controllers/pg-rent-portfolio.controller.ts`         | `GET /pg-operator/rent/portfolio`                                                                                                                                              |
| `apps/api/src/modules/pg-rent/controllers/pg-rent-tenant.controller.ts`            | `GET /tenant/pg-rent/summary`, `GET …/history`, `GET …/invoices/:id`, `POST …/identity-dispute`                                                                                |
| `apps/api/src/modules/pg-rent/controllers/pg-rent-public.controller.ts`            | `GET /public/pg-rent/pay/:token`, `GET /public/pg-rent/receipts/:shareToken`                                                                                                   |
| `apps/api/src/modules/pg-rent/pg-rent.module.ts` (modify)                          | providers + controllers                                                                                                                                                        |
| `apps/api/src/modules/pg-rent/services/rent-settlement.service.ts` (modify)        | Task 5: read-only `computeStatement` for tenant reads                                                                                                                          |
| `infra/migrations/0074_pg_rent_invoice_idempotency.sql` (+ `.rollback.sql`)        | Task 7: `pg_rent_invoices.idempotency_key` + `uq_pg_rent_invoice_idem`                                                                                                         |
| `apps/api/src/modules/pg-rent/services/rent-invoice.service.ts` (modify)           | Task 7: key stored by `createManual`/`createBackfill`; Task 8: `restoreReprorate` absorbs the gap invoice                                                                      |
| `apps/api/src/modules/pg-rent/controllers/pg-rent-invoices.controller.ts` (modify) | Task 7: passes `Idempotency-Key` to the service                                                                                                                                |
| `docs/superpowers/specs/2026-09-17-pg-rent-collection-design.md` (modify)          | Tasks 7, 8, 9: §4.4, §5.8, §4.10, §12                                                                                                                                          |
| `apps/api/src/modules/pg-rent/__tests__/*.test.ts`                                 | suites per task                                                                                                                                                                |

---

### Task 1: Shared types

**Files:**

- Modify: `packages/shared-types/src/pg-rent.ts` (append)

**Interfaces:** every type below; consumed by Tasks 3–6 and by web slices 2–4.

- [ ] **Step 1: Append the types**

```ts
// packages/shared-types/src/pg-rent.ts — append (slice 1c)

export type PgRentReminderState = "upcoming" | "due_soon" | "due_today" | "overdue";

export interface PgRentQueueInvoiceRow {
  invoice_id: string;
  invoice_number: string;
  assignment_id: string;
  occupant_name: string;
  occupant_phone_verified: boolean;
  room_number: string;
  bed_label: string;
  kind: PgRentInvoiceKind;
  period_label: string;
  due_date: string;
  balance_inr: number;
  total_inr: number;
  state: PgRentReminderState;
  in_grace: boolean;
  days_overdue: number;
  applied_fee_inr: number | null;
  suggested_fee_inr: number | null;
  last_reminded_at: string | null;
  last_reminded_channel: "whatsapp" | "call" | null;
  /** ₹ × days, the Overdue section sort key */
  urgency: number;
}

export interface PgRentQueueClaimRow {
  payment_id: string;
  assignment_id: string;
  occupant_name: string;
  room_number: string;
  bed_label: string;
  amount_inr: number;
  method: PgRentPaymentMethod;
  paid_on: string;
  reference: string | null;
  proof_count: number;
  claimed_invoice_id: string | null;
  claimed_invoice_number: string | null;
  waiting_since: string;
  waiting_days: number;
}

export type PgRentAttentionKind =
  | "draft_invoice"
  | "set_move_in_date"
  | "notice_ended"
  | "reprorate_suggested"
  | "restore_suggested"
  | "booking_held"
  | "identity_disputed";

export interface PgRentAttentionRow {
  kind: PgRentAttentionKind;
  assignment_id: string;
  occupant_name: string;
  room_number: string;
  bed_label: string;
  invoice_id: string | null;
  /** kind-specific: draft total, suggestion from/to, booking credit, days since notice end */
  amount_inr: number | null;
  secondary_inr: number | null;
  date: string | null;
  days: number | null;
}

export interface PgRentLeavingRow {
  assignment_id: string;
  occupant_name: string;
  room_number: string;
  bed_label: string;
  status: PgRentSettlementStatus;
  leave_on: string | null;
  deposit_held_inr: number;
  to_return_inr: number;
  open_dues_inr: number;
}

export interface PgRentFormerTenantRow {
  assignment_id: string;
  occupant_name: string;
  room_number: string;
  bed_label: string;
  moved_out_on: string;
  balance_inr: number;
  invoice_ids: string[];
}

export interface PgRentQueue {
  as_of: string;
  awaiting_confirmation: PgRentQueueClaimRow[];
  needs_attention: PgRentAttentionRow[];
  leaving: PgRentLeavingRow[];
  overdue: PgRentQueueInvoiceRow[];
  due_today: PgRentQueueInvoiceRow[];
  due_soon: PgRentQueueInvoiceRow[];
  former_tenants: PgRentFormerTenantRow[];
}

export interface PgRentMonthSummary {
  /** `YYYY-MM-01` */
  month: string;
  expected_inr: number;
  collected_inr: number;
  outstanding_inr: number;
  overdue_inr: number;
  overdue_tenants: number;
  awaiting_inr: number;
  awaiting_count: number;
  collection_rate: number;
}

export interface PgRentPortfolioRow {
  property_id: string;
  display_name: string;
  enabled: boolean;
  paused: boolean;
  summary: PgRentMonthSummary | null;
  queue_counts: { awaiting: number; attention: number; overdue: number; leaving: number } | null;
}

export type PgRentTemplateKey = "reminder" | "overdue" | "tenant_paid" | "receipt_share";

export interface PgRentMergeFields {
  tenant_name: string;
  owner_name: string;
  property_name: string;
  room: string;
  bed: string;
  period: string;
  amount: string;
  balance: string;
  due_date: string;
  due_phrase: string;
  days_overdue: string;
  late_fee: string;
  invoice_no: string;
  pay_link: string;
  upi_id: string;
  receipt_link: string;
  utr: string;
}

export interface PgRentRenderedMessage {
  key: PgRentTemplateKey;
  text: string;
  /** merge fields the template used that are not known (left literal) */
  unknown_fields: string[];
  truncated: boolean;
  wa_me_url: string | null;
  recipient_e164: string | null;
}

export interface PgRentInvoiceMessages {
  invoice_id: string;
  pay_link: string;
  reminder: PgRentRenderedMessage;
  overdue: PgRentRenderedMessage;
  receipt_share: PgRentRenderedMessage | null;
  warnings: string[];
}

export interface PgRentTemplatePreviewInput {
  key: PgRentTemplateKey;
  text: string;
  invoice_id?: string;
}

export type PgRentPayInstruction =
  | {
      mode: "upi_intent";
      upi_uri: string;
      qr_svg: string;
      payee_name: string;
      vpa: string;
      bank: PgRentBankDetails | null;
    }
  | { mode: "bank_details"; bank: PgRentBankDetails }
  | { mode: "manual" };

export interface PgRentPublicPayPage {
  state: "payable" | "paid" | "expired";
  property_name: string;
  tenant_first_name: string;
  period_label: string;
  room_number: string;
  bed_label: string;
  invoice_number: string;
  balance_inr: number;
  total_inr: number;
  due_date: string;
  instruction: PgRentPayInstruction | null;
  /** same payee, no `am` — for "Pay a different amount" (spec §7.7) */
  instruction_open_amount: PgRentPayInstruction | null;
  /** owner's WhatsApp for "Notify owner" — digits only, for wa.me */
  owner_wa_digits: string | null;
  notify_text: string | null;
}

export type PgRentHeroState =
  | "due"
  | "overdue"
  | "partially_paid"
  | "awaiting"
  | "paid"
  | "nothing_due"
  | "leaving"
  | "settled"
  | "not_enabled";

export interface PgRentTenantHero {
  state: PgRentHeroState;
  invoice: PgRentTenantInvoice | null;
  more_open_count: number;
  more_open_inr: number;
  pending_claim: PgRentPayment | null;
  credit_inr: number;
  last_receipt: PgRentReceipt | null;
  next_invoice_expected_on: string | null;
  settlement: PgRentSettlementStatement | null;
}

export interface PgRentTenantInvoice extends Omit<
  PgRentInvoice,
  | "internal_note"
  | "rent_snapshot_inr"
  | "rent_source"
  | "suggested_late_fee_inr"
  | "reprorate_suggestion"
> {
  pay_link: string | null;
  instruction: PgRentPayInstruction | null;
  /** tenant-visible change log (spec §4.10) */
  changes: PgRentEvent[];
}

export interface PgRentTenantResidence {
  assignment_id: string;
  property_id: string;
  property_name: string;
  room_number: string;
  bed_label: string;
  assignment_status: string;
  identity_disputed: boolean;
  enabled: boolean;
  payee: { name: string | null; vpa: string | null; bank: PgRentBankDetails | null } | null;
  owner_wa_digits: string | null;
  hero: PgRentTenantHero;
  deposit: { held_inr: number; paid_on: string | null; uncollected_inr: number } | null;
}

export interface PgRentTenantSummary {
  residences: PgRentTenantResidence[];
}

export interface PgRentTenantHistory {
  assignment_id: string;
  invoices: PgRentTenantInvoice[];
  payments: PgRentPayment[];
  receipts: PgRentReceipt[];
}

export interface PgRentIdentityDisputeInput {
  assignment_id: string;
}
```

- [ ] **Step 2: Build and typecheck**

```bash
pnpm --filter @cribliv/shared-types build && pnpm --filter @cribliv/api typecheck
```

Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add packages/shared-types/src/pg-rent.ts
git commit -m "feat(pg-rent): queue, messaging, pay-page and tenant read wire types"
```

---

### Task 2: Pure — reminder state, template merge, UPI and `wa.me` links

**Files:**

- Create: `apps/api/src/modules/pg-rent/pure/rent-reminder-state.ts`
- Create: `apps/api/src/modules/pg-rent/pure/rent-template.ts`
- Create: `apps/api/src/modules/pg-rent/pure/rent-upi.ts`
- Test: `apps/api/src/modules/pg-rent/__tests__/rent-reminder-template-upi.test.ts`

**Interfaces:**

```ts
// rent-reminder-state.ts
export function reminderState(i: {
  dueDate: string;
  today: string;
  offsets: number[];
  graceDays: number;
}): { state: PgRentReminderState; inGrace: boolean; daysOverdue: number; daysUntilDue: number }; // on the due date: "due_today" only when some offset ≤ 0, else "upcoming" (spec §7.2)
export function duePhrase(i: { dueDate: string; today: string }, locale: "en" | "hi"): string; // "due in 3 days" | "due today" | "overdue by 4 days"

// rent-template.ts
export const DEFAULT_TEMPLATES: Record<"en" | "hi", Record<PgRentTemplateKey, string>>;
export const MERGE_FIELD_NAMES: ReadonlyArray<keyof PgRentMergeFields>;
export const MAX_TEMPLATE_CHARS = 600;
export const MAX_MERGED_CHARS = 900;
export function formatInrGrouped(inr: number): string; // "₹1,20,000"
export function mergeTemplate(
  template: string,
  fields: PgRentMergeFields
): { text: string; unknownFields: string[]; truncated: boolean };

// rent-upi.ts
export function sanitizeTr(invoiceNumber: string): string; // alnum only, ≤ 35
export function buildUpiUri(i: {
  vpa: string;
  payeeName: string;
  amountInr: number | null;
  note: string;
  tr: string;
}): string; // upi://pay?pa=&pn=&am=&tn=&tr=&cu=INR ; tn ≤ 50; am omitted when null
export function waDigits(e164: string): string; // "+919876543210" → "919876543210"
export function buildWaMeLink(e164: string, text: string): string; // https://wa.me/<digits>?text=<urlencoded>
```

- [ ] **Step 1: Write the failing tests**

```ts
// apps/api/src/modules/pg-rent/__tests__/rent-reminder-template-upi.test.ts
import { describe, expect, it } from "vitest";

import { duePhrase, reminderState } from "../pure/rent-reminder-state";
import {
  DEFAULT_TEMPLATES,
  MERGE_FIELD_NAMES,
  formatInrGrouped,
  mergeTemplate
} from "../pure/rent-template";
import { buildUpiUri, buildWaMeLink, sanitizeTr, waDigits } from "../pure/rent-upi";

describe("reminderState (spec §7.2, one definition of overdue)", () => {
  const base = { dueDate: "2026-10-05", offsets: [-3, 0, 1], graceDays: 3 };
  it("walks upcoming → due_soon → due_today → overdue (in grace) → overdue", () => {
    expect(reminderState({ ...base, today: "2026-10-01" })).toEqual({
      state: "upcoming",
      inGrace: false,
      daysOverdue: 0,
      daysUntilDue: 4
    });
    expect(reminderState({ ...base, today: "2026-10-02" })).toEqual({
      state: "due_soon",
      inGrace: false,
      daysOverdue: 0,
      daysUntilDue: 3
    });
    expect(reminderState({ ...base, today: "2026-10-05" })).toEqual({
      state: "due_today",
      inGrace: false,
      daysOverdue: 0,
      daysUntilDue: 0
    });
    expect(reminderState({ ...base, today: "2026-10-07" })).toEqual({
      state: "overdue",
      inGrace: true,
      daysOverdue: 2,
      daysUntilDue: 0
    });
    expect(reminderState({ ...base, today: "2026-10-09" })).toEqual({
      state: "overdue",
      inGrace: false,
      daysOverdue: 4,
      daysUntilDue: 0
    });
  });
  it("all-positive offsets never produce due_soon or due_today (queue = overdue only)", () => {
    expect(reminderState({ ...base, offsets: [1, 3], today: "2026-10-03" }).state).toBe("upcoming");
    expect(reminderState({ ...base, offsets: [1, 3], today: "2026-10-05" }).state).toBe("upcoming");
  });
});

describe("duePhrase", () => {
  it("en and hi", () => {
    expect(duePhrase({ dueDate: "2026-10-05", today: "2026-10-02" }, "en")).toBe("due in 3 days");
    expect(duePhrase({ dueDate: "2026-10-05", today: "2026-10-04" }, "en")).toBe("due tomorrow");
    expect(duePhrase({ dueDate: "2026-10-05", today: "2026-10-05" }, "en")).toBe("due today");
    expect(duePhrase({ dueDate: "2026-10-05", today: "2026-10-09" }, "en")).toBe(
      "overdue by 4 days"
    );
    expect(duePhrase({ dueDate: "2026-10-05", today: "2026-10-06" }, "en")).toBe(
      "overdue by 1 day"
    );
    expect(duePhrase({ dueDate: "2026-10-05", today: "2026-10-05" }, "hi")).toBe("आज देय");
  });
});

describe("mergeTemplate (spec §7.4)", () => {
  const fields = {
    tenant_name: "Rahul",
    owner_name: "Sunil",
    property_name: "Sunrise PG",
    room: "102",
    bed: "A",
    period: "September 2026",
    amount: "₹9,000",
    balance: "₹9,000",
    due_date: "5 Oct 2026",
    due_phrase: "due in 3 days",
    days_overdue: "0",
    late_fee: "₹0",
    invoice_no: "SUN-INV-0007",
    pay_link: "https://cribliv.com/en/pay/abc",
    upi_id: "sun@okaxis",
    receipt_link: "",
    utr: ""
  };
  it("merges every known field, leaves unknown ones literal and reports them", () => {
    const r = mergeTemplate(DEFAULT_TEMPLATES.en.reminder, fields);
    expect(r.text).toBe(
      "Hi Rahul, rent of ₹9,000 for September 2026 (Room 102, Bed A) is due in 3 days. Pay here: https://cribliv.com/en/pay/abc — Sunil, Sunrise PG"
    );
    expect(r).toMatchObject({ unknownFields: [], truncated: false });
    const u = mergeTemplate("Hello {tenant_name} {nope} {also_nope}", fields);
    expect(u.text).toBe("Hello Rahul {nope} {also_nope}");
    expect(u.unknownFields).toEqual(["nope", "also_nope"]);
  });
  it("truncates merged text at 900 chars with an ellipsis", () => {
    const r = mergeTemplate("x".repeat(600) + " {tenant_name} " + "y".repeat(400), fields);
    expect(r.text.length).toBe(900);
    expect(r.text.endsWith("…")).toBe(true);
    expect(r.truncated).toBe(true);
  });
  it("exposes the field list the editor shows, and Indian grouping", () => {
    expect(MERGE_FIELD_NAMES).toContain("due_phrase");
    expect(MERGE_FIELD_NAMES).toHaveLength(17);
    expect(formatInrGrouped(120000)).toBe("₹1,20,000");
    expect(formatInrGrouped(900)).toBe("₹900");
    expect(formatInrGrouped(0)).toBe("₹0");
  });
});

describe("rent-upi (spec §7.7)", () => {
  it("sanitizes tr to alphanumerics ≤ 35", () => {
    expect(sanitizeTr("SUN-INV-0007")).toBe("SUNINV0007");
    expect(sanitizeTr("A".repeat(50) + "-1")).toHaveLength(35);
  });
  it("builds the intent URI with and without amount, caps tn at 50", () => {
    const uri = buildUpiUri({
      vpa: "sun@okaxis",
      payeeName: "Sunrise PG",
      amountInr: 9000,
      note: "Rent September 2026 Room 102 Bed A and a lot more text here",
      tr: "SUNINV0007"
    });
    expect(uri).toMatch(/^upi:\/\/pay\?/);
    const params = new URLSearchParams(uri.slice("upi://pay?".length));
    expect(params.get("pa")).toBe("sun@okaxis");
    expect(params.get("pn")).toBe("Sunrise PG");
    expect(params.get("am")).toBe("9000");
    expect(params.get("tn")!.length).toBeLessThanOrEqual(50);
    expect(params.get("tr")).toBe("SUNINV0007");
    expect(params.get("cu")).toBe("INR");
    const open = buildUpiUri({
      vpa: "sun@okaxis",
      payeeName: "Sunrise PG",
      amountInr: null,
      note: "Rent",
      tr: "X"
    });
    expect(new URLSearchParams(open.slice("upi://pay?".length)).has("am")).toBe(false);
  });
  it("builds wa.me links with digits only and encoded text", () => {
    expect(waDigits("+919876543210")).toBe("919876543210");
    expect(buildWaMeLink("+919876543210", "Hi Rahul — ₹9,000")).toBe(
      "https://wa.me/919876543210?text=Hi%20Rahul%20%E2%80%94%20%E2%82%B99%2C000"
    );
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @cribliv/api exec vitest run src/modules/pg-rent/__tests__/rent-reminder-template-upi.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement the three pure files**

```ts
// apps/api/src/modules/pg-rent/pure/rent-reminder-state.ts
import type { PgRentReminderState } from "@cribliv/shared-types";

import { addDays, compareIso, daysInclusive } from "./rent-dates";

/** Spec §7.2. `overdue` is `due_date < today`, full stop; grace is a tag on it. */
export function reminderState(i: {
  dueDate: string;
  today: string;
  offsets: number[];
  graceDays: number;
}): {
  state: PgRentReminderState;
  inGrace: boolean;
  daysOverdue: number;
  daysUntilDue: number;
} {
  const cmp = compareIso(i.today, i.dueDate);
  if (cmp > 0) {
    const daysOverdue = daysInclusive(i.dueDate, i.today) - 1;
    return { state: "overdue", inGrace: daysOverdue <= i.graceDays, daysOverdue, daysUntilDue: 0 };
  }
  const daysUntilDue = daysInclusive(i.today, i.dueDate) - 1;
  // Spec §7.2: all-positive offsets ⇒ the queue shows overdue only, so no due_today either.
  if (cmp === 0)
    return {
      state: i.offsets.some((o) => o <= 0) ? "due_today" : "upcoming",
      inGrace: false,
      daysOverdue: 0,
      daysUntilDue: 0
    };
  const earliestNegative = Math.min(...i.offsets.filter((o) => o < 0), 0);
  const dueSoonFrom = addDays(i.dueDate, earliestNegative);
  const state: PgRentReminderState =
    earliestNegative < 0 && compareIso(i.today, dueSoonFrom) >= 0 ? "due_soon" : "upcoming";
  return { state, inGrace: false, daysOverdue: 0, daysUntilDue };
}

export function duePhrase(i: { dueDate: string; today: string }, locale: "en" | "hi"): string {
  const cmp = compareIso(i.today, i.dueDate);
  if (cmp === 0) return locale === "hi" ? "आज देय" : "due today";
  if (cmp < 0) {
    const n = daysInclusive(i.today, i.dueDate) - 1;
    if (locale === "hi") return n === 1 ? "कल देय" : `${n} दिनों में देय`;
    return n === 1 ? "due tomorrow" : `due in ${n} days`;
  }
  const n = daysInclusive(i.dueDate, i.today) - 1;
  if (locale === "hi") return `${n} दिन से बकाया`;
  return `overdue by ${n} ${n === 1 ? "day" : "days"}`;
}
```

```ts
// apps/api/src/modules/pg-rent/pure/rent-template.ts
import type { PgRentMergeFields, PgRentTemplateKey } from "@cribliv/shared-types";

export const MAX_TEMPLATE_CHARS = 600;
export const MAX_MERGED_CHARS = 900;

export const MERGE_FIELD_NAMES = [
  "tenant_name",
  "owner_name",
  "property_name",
  "room",
  "bed",
  "period",
  "amount",
  "balance",
  "due_date",
  "due_phrase",
  "days_overdue",
  "late_fee",
  "invoice_no",
  "pay_link",
  "upi_id",
  "receipt_link",
  "utr"
] as const satisfies ReadonlyArray<keyof PgRentMergeFields>;

/** Spec §7.4 defaults. Owners edit these; a null column means "use this". */
export const DEFAULT_TEMPLATES: Record<"en" | "hi", Record<PgRentTemplateKey, string>> = {
  en: {
    reminder:
      "Hi {tenant_name}, rent of {amount} for {period} (Room {room}, Bed {bed}) is {due_phrase}. Pay here: {pay_link} — {owner_name}, {property_name}",
    overdue:
      "Hi {tenant_name}, rent of {balance} for {period} (Room {room}, Bed {bed}) is {due_phrase}{late_fee_clause}. Pay here: {pay_link} — {owner_name}, {property_name}",
    tenant_paid:
      "Hi {owner_name}, I've paid {amount} for {period} rent, Room {room}/Bed {bed}. UTR: {utr} — {tenant_name}",
    receipt_share:
      "Hi {tenant_name}, here is your receipt for {amount} ({period}): {receipt_link} — {owner_name}, {property_name}"
  },
  hi: {
    reminder:
      "नमस्ते {tenant_name}, {period} का किराया {amount} (कमरा {room}, बेड {bed}) {due_phrase}। यहाँ भुगतान करें: {pay_link} — {owner_name}, {property_name}",
    overdue:
      "नमस्ते {tenant_name}, {period} का किराया {balance} (कमरा {room}, बेड {bed}) {due_phrase}{late_fee_clause}। यहाँ भुगतान करें: {pay_link} — {owner_name}, {property_name}",
    tenant_paid:
      "नमस्ते {owner_name}, मैंने {period} का किराया {amount} चुका दिया है, कमरा {room}/बेड {bed}। UTR: {utr} — {tenant_name}",
    receipt_share:
      "नमस्ते {tenant_name}, {amount} ({period}) की रसीद: {receipt_link} — {owner_name}, {property_name}"
  }
};

export function formatInrGrouped(inr: number): string {
  return `₹${new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 }).format(inr)}`;
}

const FIELD_RE = /\{([a-z_]+)\}/g;

/**
 * Spec §7.4: known fields merge; unknown fields stay literal and are reported;
 * `{late_fee_clause}` is a derived helper (", including ₹300 late fee" or "")
 * so the overdue default reads naturally. Output capped at 900 chars.
 */
export function mergeTemplate(
  template: string,
  fields: PgRentMergeFields
): { text: string; unknownFields: string[]; truncated: boolean } {
  const unknown: string[] = [];
  const derived: Record<string, string> = {
    late_fee_clause:
      fields.late_fee && fields.late_fee !== "₹0" ? `, including ${fields.late_fee} late fee` : ""
  };
  let text = template.replace(FIELD_RE, (whole, name: string) => {
    if (name in derived) return derived[name];
    if ((MERGE_FIELD_NAMES as readonly string[]).includes(name))
      return fields[name as keyof PgRentMergeFields] ?? "";
    if (!unknown.includes(name)) unknown.push(name);
    return whole;
  });
  let truncated = false;
  if (text.length > MAX_MERGED_CHARS) {
    text = `${text.slice(0, MAX_MERGED_CHARS - 1)}…`;
    truncated = true;
  }
  return { text, unknownFields: unknown, truncated };
}
```

```ts
// apps/api/src/modules/pg-rent/pure/rent-upi.ts
/** Spec §7.7: `tr` ≤ 35 alphanumerics — invoice numbers carry hyphens, so strip them. */
export function sanitizeTr(invoiceNumber: string): string {
  return invoiceNumber.replace(/[^A-Za-z0-9]/g, "").slice(0, 35);
}

/** upi://pay intent. `am` omitted for "pay a different amount"; `tn` ≤ 50 chars. */
export function buildUpiUri(i: {
  vpa: string;
  payeeName: string;
  amountInr: number | null;
  note: string;
  tr: string;
}): string {
  const params = new URLSearchParams();
  params.set("pa", i.vpa);
  params.set("pn", i.payeeName.slice(0, 50));
  if (i.amountInr !== null) params.set("am", String(i.amountInr));
  params.set("tn", i.note.slice(0, 50));
  params.set("tr", sanitizeTr(i.tr));
  params.set("cu", "INR");
  return `upi://pay?${params.toString()}`;
}

export function waDigits(e164: string): string {
  return e164.replace(/\D/g, "");
}

export function buildWaMeLink(e164: string, text: string): string {
  return `https://wa.me/${waDigits(e164)}?text=${encodeURIComponent(text)}`;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @cribliv/api exec vitest run src/modules/pg-rent/__tests__/rent-reminder-template-upi.test.ts`
Expected: PASS, 9 tests. (`URLSearchParams` encodes spaces as `+`; UPI apps accept both `+` and `%20` in `tn`/`pn`. If a real-device check later prefers `%20`, swap `params.toString()` for a manual `encodeURIComponent` join — the test reads via `URLSearchParams`, which decodes either.)

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/pg-rent/pure/rent-reminder-state.ts apps/api/src/modules/pg-rent/pure/rent-template.ts apps/api/src/modules/pg-rent/pure/rent-upi.ts apps/api/src/modules/pg-rent/__tests__/rent-reminder-template-upi.test.ts
git commit -m "feat(pg-rent): pure reminder state, template merge, UPI and wa.me builders"
```

---

### Task 3: Message service and pay-instruction service

**Files:**

- Create: `apps/api/src/modules/pg-rent/services/rent-message.service.ts`
- Create: `apps/api/src/modules/pg-rent/services/rent-pay-instruction.service.ts`
- Modify: `apps/api/src/modules/pg-rent/pg-rent.module.ts`
- Test: `apps/api/src/modules/pg-rent/__tests__/rent-message-pay.integration.test.ts`

**Interfaces:**

```ts
// rent-pay-instruction.service.ts
@Injectable()
export class RentPayInstructionService {
  buildPayInstruction(i: {
    settings: Pick<RentSettingsRow, "upi_vpa" | "upi_payee_name" | "bank_details">;
    amountInr: number | null;
    note: string;
    tr: string;
  }): Promise<PgRentPayInstruction>; // QR via qrcode.toString(uri, { type: "svg", margin: 1 })
  payLinkFor(locale: "en" | "hi", token: string): string; // `${SITE_URL()}/${locale}/pay/${token}`; exported SITE_URL() = NEXT_PUBLIC_SITE_URL ?? "https://cribliv.com" (apex — never www)
  async publicPayPage(token: string): Promise<PgRentPublicPayPage>; // 404 pay_link_not_found (unknown or replaced token); state paid | expired (token expired or invoice cancelled) | payable; first name only, also inside notify_text
}

// rent-message.service.ts
@Injectable()
export class RentMessageService {
  async messagesForInvoice(operatorId, propertyId, invoiceId): Promise<PgRentInvoiceMessages>;
  async preview(
    operatorId,
    propertyId,
    input: PgRentTemplatePreviewInput
  ): Promise<PgRentRenderedMessage>; // live editor preview against a real invoice (or a sample)
  async reminderOpened(
    operatorId,
    propertyId,
    invoiceId,
    input: { stage: PgRentReminderState; channel: "whatsapp" | "call" }
  ): Promise<void>;
  async regeneratePayToken(
    operatorId,
    propertyId,
    invoiceId
  ): Promise<{ pay_link: string; expires_at: string }>;
  async tenantPaidMessage(userId, paymentId): Promise<PgRentRenderedMessage>; // for "Notify owner on WhatsApp" after a claim
  async fieldsForInvoice(
    q: Queryable,
    invoiceId: string,
    opts?: { utr?: string; today?: string }
  ): Promise<{
    fields: PgRentMergeFields;
    locale: "en" | "hi";
    row: FieldsRow;
    state: ReturnType<typeof reminderState>;
    tenantPhone: string;
    ownerPhone: string | null;
    verified: boolean;
    payLink: string;
    templates: Record<PgRentTemplateKey, string | null>;
  }>; // receipt_link = `${NEXT_PUBLIC_API_BASE_URL || SITE_URL()/v1}/public/pg-rent/receipts/<share token>`
}
```

- [ ] **Step 1: Write the failing tests**

```ts
// apps/api/src/modules/pg-rent/__tests__/rent-message-pay.integration.test.ts
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { DatabaseService } from "../../../common/database.service";
import { DevApiSasIssuer } from "../../rent-agreement/downloads/dev-api-sas-issuer";
import { InMemoryPdfStorage } from "../../rent-agreement/pdf/in-memory-pdf-storage";
import { RentAllocationService } from "../services/rent-allocation.service";
import { RentInvoiceEngineService } from "../services/rent-invoice-engine.service";
import { RentMessageService } from "../services/rent-message.service";
import { RentPayInstructionService } from "../services/rent-pay-instruction.service";
import { RentPaymentService } from "../services/rent-payment.service";
import { RentReceiptService } from "../services/rent-receipt.service";
import { RentSettingsService } from "../services/rent-settings.service";
import { RentFixtures } from "./helpers/rent-fixtures";

const HAS_DB = Boolean(process.env.DATABASE_URL);

describe("RentPayInstructionService.buildPayInstruction", () => {
  const svc = new RentPayInstructionService({ isEnabled: () => false } as DatabaseService);
  it("prefers UPI intent with a QR, then bank details, then manual", async () => {
    const upi = await svc.buildPayInstruction({
      settings: { upi_vpa: "sun@okaxis", upi_payee_name: "Sunrise", bank_details: null },
      amountInr: 9000,
      note: "Rent September 2026",
      tr: "SUN-INV-0007"
    });
    expect(upi.mode).toBe("upi_intent");
    if (upi.mode === "upi_intent") {
      expect(upi.upi_uri).toContain("pa=sun%40okaxis");
      expect(upi.qr_svg.startsWith("<svg")).toBe(true);
      expect(upi.bank).toBeNull();
    }
    const bank = await svc.buildPayInstruction({
      settings: {
        upi_vpa: null,
        upi_payee_name: null,
        bank_details: {
          account_name: "A",
          account_number: "1",
          ifsc: "HDFC0001234",
          bank_name: "HDFC"
        }
      },
      amountInr: 1,
      note: "",
      tr: "X"
    });
    expect(bank.mode).toBe("bank_details");
    expect(
      (
        await svc.buildPayInstruction({
          settings: { upi_vpa: null, upi_payee_name: null, bank_details: null },
          amountInr: 1,
          note: "",
          tr: "X"
        })
      ).mode
    ).toBe("manual");
  });
  it("pay links use the apex site URL and the locale", () => {
    expect(svc.payLinkFor("hi", "abc")).toMatch(/^https:\/\/cribliv\.com\/hi\/pay\/abc$/);
  });
});

describe.skipIf(!HAS_DB)("RentMessageService + public pay page", () => {
  let db: DatabaseService;
  let fx: RentFixtures;
  let operatorId: string;
  let tenantUserId: string;
  let propertyId: string;
  let assignmentId: string;
  let invoiceId: string;
  let messages: RentMessageService;
  let pay: RentPayInstructionService;
  let payments: RentPaymentService;

  beforeAll(async () => {
    db = new DatabaseService();
    fx = new RentFixtures(db, randomUUID().replace(/-/g, ""));
    await fx.setup();
    operatorId = await fx.createUser("pg_operator", "+917700000011");
    await db.query(`UPDATE users SET full_name = 'Sunil Owner' WHERE id = $1::uuid`, [operatorId]);
    tenantUserId = await fx.createUser("tenant", "+917700000022");
    propertyId = await fx.createProperty(operatorId, {
      internalCode: "SUN",
      displayName: "Sunrise PG"
    });
    const listingId = await fx.createListingWithDetails(propertyId, operatorId);
    const roomTypeId = await fx.createRoomType(listingId, { rentPaise: 900000 });
    const roomId = await fx.createRoom(propertyId, { roomTypeId, roomNumber: "102" });
    const settings = new RentSettingsService(db);
    await settings.enable(operatorId, propertyId, {
      billing_starts_on: "2026-09-01",
      due_day: 5,
      upi_vpa: "sun@okaxis",
      upi_payee_name: "Sunrise PG",
      late_fee_enabled: true,
      late_fee_amount_inr: 300
    });
    const bedId = await fx.createBed(roomId, "A");
    assignmentId = await fx.createAssignment(propertyId, bedId, {
      createdBy: operatorId,
      moveIn: "2026-09-01",
      occupantName: "Rahul Verma",
      occupantPhone: "+917700000022",
      tenantUserId
    });
    const alloc = new RentAllocationService();
    await new RentInvoiceEngineService(db, settings, alloc).generateInvoicesForProperty(
      propertyId,
      "2026-09-01"
    );
    invoiceId = (
      await db.query<{ id: string }>(
        `SELECT id::text FROM pg_rent_invoices WHERE assignment_id = $1::uuid AND kind = 'rent'`,
        [assignmentId]
      )
    ).rows[0].id;
    pay = new RentPayInstructionService(db);
    messages = new RentMessageService(db, pay);
    payments = new RentPaymentService(
      db,
      settings,
      alloc,
      new RentReceiptService(
        db,
        { render: async () => Buffer.from("%PDF") },
        new InMemoryPdfStorage(),
        new DevApiSasIssuer()
      )
    );
  });
  afterAll(async () => {
    await fx.teardown();
    await db.onModuleDestroy();
  });

  it("renders the four templates with real fields and wa.me links; unknown fields and no-VPA are warned", async () => {
    const m = await messages.messagesForInvoice(operatorId, propertyId, invoiceId);
    expect(m.pay_link).toMatch(/\/en\/pay\/[A-Za-z0-9_-]{43}$/);
    expect(m.reminder.text).toBe(
      `Hi Rahul Verma, rent of ₹9,000 for September 2026 (Room 102, Bed A) is overdue by ${daysSince("2026-09-05")} days. Pay here: ${m.pay_link} — Sunil Owner, Sunrise PG`
    );
    expect(m.reminder.wa_me_url).toMatch(/^https:\/\/wa\.me\/917700000022\?text=/);
    expect(m.reminder.recipient_e164).toBe("+917700000022");
    expect(m.overdue.text).toContain("₹9,000");
    expect(m.receipt_share).toBeNull(); // no receipt yet
    expect(m.warnings).toEqual([]);

    await db.query(
      `UPDATE pg_rent_settings SET msg_reminder = 'Hey {tenant_name} pay {amount} via {upi_id} {typo}' , upi_vpa = NULL WHERE pg_property_id = $1::uuid`,
      [propertyId]
    );
    const m2 = await messages.messagesForInvoice(operatorId, propertyId, invoiceId);
    expect(m2.reminder.text).toBe("Hey Rahul Verma pay ₹9,000 via (not set) {typo}");
    expect(m2.reminder.unknown_fields).toEqual(["typo"]);
    expect(m2.warnings).toEqual(
      expect.arrayContaining([expect.stringMatching(/UPI ID/), expect.stringMatching(/typo/)])
    );
    await db.query(
      `UPDATE pg_rent_settings SET msg_reminder = NULL, upi_vpa = 'sun@okaxis' WHERE pg_property_id = $1::uuid`,
      [propertyId]
    );
  });

  it("preview merges arbitrary text against the invoice; reminder-opened logs stage + channel", async () => {
    const p = await messages.preview(operatorId, propertyId, {
      key: "overdue",
      text: "{tenant_name}: {balance} {due_phrase}",
      invoice_id: invoiceId
    });
    expect(p.text).toMatch(/^Rahul Verma: ₹9,000 overdue by \d+ days$/);
    await messages.reminderOpened(operatorId, propertyId, invoiceId, {
      stage: "overdue",
      channel: "whatsapp"
    });
    await messages.reminderOpened(operatorId, propertyId, invoiceId, {
      stage: "overdue",
      channel: "call"
    });
    const ev = await db.query<{ payload: Record<string, unknown> }>(
      `SELECT payload FROM pg_rent_events WHERE entity_id = $1::uuid AND event_type = 'reminder.opened' ORDER BY id`,
      [invoiceId]
    );
    expect(ev.rows.map((e) => e.payload)).toEqual([
      { stage: "overdue", channel: "whatsapp" },
      { stage: "overdue", channel: "call" }
    ]);
  });

  it("tenant-paid message for a claim carries the UTR and targets the owner", async () => {
    const claim = await payments.claimByTenant(tenantUserId, {
      assignment_id: assignmentId,
      amount_inr: 100,
      method: "upi",
      paid_on: "2026-09-07",
      reference: "123456789012",
      idempotency_key: randomUUID()
    });
    const m = await messages.tenantPaidMessage(tenantUserId, claim.id);
    expect(m.text).toBe(
      "Hi Sunil Owner, I've paid ₹100 for September 2026 rent, Room 102/Bed A. UTR: 123456789012 — Rahul Verma"
    );
    expect(m.wa_me_url).toMatch(/^https:\/\/wa\.me\/917700000011\?text=/);
  });

  it("public pay page: payable → paid → expired/regenerated; exposes first name only", async () => {
    const token = (
      await db.query<{ t: string }>(
        `SELECT pay_token AS t FROM pg_rent_invoices WHERE id = $1::uuid`,
        [invoiceId]
      )
    ).rows[0].t;
    const page = await pay.publicPayPage(token);
    expect(page).toMatchObject({
      state: "payable",
      property_name: "Sunrise PG",
      tenant_first_name: "Rahul",
      period_label: "September 2026",
      room_number: "102",
      bed_label: "A",
      balance_inr: 9000,
      owner_wa_digits: "917700000011"
    });
    expect(page.instruction?.mode).toBe("upi_intent");
    expect(page.notify_text).toContain("— Rahul");
    expect(JSON.stringify(page)).not.toContain("Verma");
    expect(JSON.stringify(page)).not.toContain("7700000022");
    await expect(pay.publicPayPage("nope")).rejects.toMatchObject({
      response: { code: "pay_link_not_found" }
    });

    const regen = await messages.regeneratePayToken(operatorId, propertyId, invoiceId);
    expect(regen.pay_link).toMatch(/\/pay\/[A-Za-z0-9_-]{43}$/);
    await expect(pay.publicPayPage(token)).rejects.toMatchObject({
      response: { code: "pay_link_not_found" }
    }); // the old link stops working
    const fresh = regen.pay_link.slice(regen.pay_link.lastIndexOf("/") + 1);
    await db.query(
      `UPDATE pg_rent_invoices SET pay_token_expires_at = now() - interval '1 minute' WHERE id = $1::uuid`,
      [invoiceId]
    );
    expect((await pay.publicPayPage(fresh)).state).toBe("expired");
    await db.query(
      `UPDATE pg_rent_invoices SET pay_token_expires_at = now() + interval '45 days' WHERE id = $1::uuid`,
      [invoiceId]
    );
    await payments.recordByOperator(
      operatorId,
      propertyId,
      { assignment_id: assignmentId, amount_inr: 9000, method: "upi", paid_on: "2026-09-06" },
      randomUUID()
    );
    expect((await pay.publicPayPage(fresh)).state).toBe("paid");
  });
});

function daysSince(iso: string): number {
  const today = new Date();
  const ist = new Date(today.getTime() + 5.5 * 60 * 60 * 1000);
  const t = Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate());
  const d = Date.UTC(
    Number(iso.slice(0, 4)),
    Number(iso.slice(5, 7)) - 1,
    Number(iso.slice(8, 10))
  );
  return Math.round((t - d) / 86400000);
}
```

Note: the reminder text asserts "overdue by N days" because the fixture's September invoice is generated at 2026-09-01 (so its due date is the natural 2026-09-05) and the test runs on the real clock (on 2026-09-24 the phrase is "overdue by 19 days"). If the test ever runs before 2026-09-06 the phrase differs — the `daysSince` helper keeps the assertion honest either way except for `due today`/`due in`; accept that edge. Test order matters: the tenant-paid test runs before the pay-page test pays September in full (a claim without `invoice_id` resolves to the oldest _open_ invoice), and the pay token is regenerated while the invoice is still payable (`regeneratePayToken` only accepts `issued`/`partially_paid`; the replaced token then 404s, it does not read "expired").

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @cribliv/api exec vitest run src/modules/pg-rent/__tests__/rent-message-pay.integration.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Pay-instruction service**

```ts
// apps/api/src/modules/pg-rent/services/rent-pay-instruction.service.ts
import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import * as QRCode from "qrcode";
import type {
  PgRentBankDetails,
  PgRentPayInstruction,
  PgRentPublicPayPage
} from "@cribliv/shared-types";

import { DatabaseService } from "../../../common/database.service";
import { paiseToInr } from "../dto/money";
import type { RentSettingsRow } from "../dto/settings.dto";
import { periodLabel } from "../pure/rent-period";
import { DEFAULT_TEMPLATES, formatInrGrouped, mergeTemplate } from "../pure/rent-template";
import { buildUpiUri, waDigits } from "../pure/rent-upi";
import { requireDb } from "./rent-guards";

/** Apex site origin (never www); the same fallback modules/openapi/openapi.document.ts:11 uses. */
export const SITE_URL = () =>
  (process.env.NEXT_PUBLIC_SITE_URL ?? "https://cribliv.com").replace(/\/$/, "");

@Injectable()
export class RentPayInstructionService {
  constructor(@Inject(DatabaseService) private readonly db: DatabaseService) {}

  payLinkFor(locale: "en" | "hi", token: string): string {
    return `${SITE_URL()}/${locale}/pay/${token}`;
  }

  /** Spec §6.1 PayInstruction. UPI first, bank second, manual when no payee (fresh enable / after transfer). */
  async buildPayInstruction(i: {
    settings: Pick<RentSettingsRow, "upi_vpa" | "upi_payee_name" | "bank_details">;
    amountInr: number | null;
    note: string;
    tr: string;
  }): Promise<PgRentPayInstruction> {
    const bank = (i.settings.bank_details as PgRentBankDetails | null) ?? null;
    if (i.settings.upi_vpa) {
      const upi_uri = buildUpiUri({
        vpa: i.settings.upi_vpa,
        payeeName: i.settings.upi_payee_name ?? "",
        amountInr: i.amountInr,
        note: i.note,
        tr: i.tr
      });
      const qr_svg = await QRCode.toString(upi_uri, {
        type: "svg",
        margin: 1,
        errorCorrectionLevel: "M"
      });
      return {
        mode: "upi_intent",
        upi_uri,
        qr_svg,
        payee_name: i.settings.upi_payee_name ?? "",
        vpa: i.settings.upi_vpa,
        bank
      };
    }
    if (bank) return { mode: "bank_details", bank };
    return { mode: "manual" };
  }

  /** Spec §7.7. Reads settings live; first name only; never the tenant phone. */
  async publicPayPage(token: string): Promise<PgRentPublicPayPage> {
    requireDb(this.db);
    const r = await this.db.query<{
      id: string;
      invoice_number: string;
      kind: string;
      status: string;
      period_start: string | null;
      period_end: string | null;
      due_date: string;
      total_paise: string;
      amount_paid_paise: string;
      expired: boolean;
      occupant_name: string;
      room_number: string;
      bed_label: string;
      property_name: string;
      upi_vpa: string | null;
      upi_payee_name: string | null;
      bank_details: PgRentBankDetails | null;
      whatsapp_phone_e164: string | null;
      operator_phone: string;
      operator_name: string | null;
      cycle_mode: "calendar_month" | "anniversary";
      msg_tenant_paid: string | null;
      locale: string;
    }>(
      `SELECT i.id::text, i.invoice_number, i.kind::text, i.status::text, to_char(i.period_start,'YYYY-MM-DD') AS period_start, to_char(i.period_end,'YYYY-MM-DD') AS period_end,
              to_char(i.due_date,'YYYY-MM-DD') AS due_date, i.total_paise::text, i.amount_paid_paise::text, (i.pay_token_expires_at <= now()) AS expired,
              a.occupant_name, i.room_number, i.bed_label, p.display_name AS property_name,
              s.upi_vpa, s.upi_payee_name, s.bank_details, s.whatsapp_phone_e164, op.phone_e164 AS operator_phone, op.full_name AS operator_name,
              s.cycle_mode::text, s.msg_tenant_paid, COALESCE(op.preferred_language, 'en') AS locale
         FROM pg_rent_invoices i
         JOIN pg_bed_assignments a ON a.id = i.assignment_id
         JOIN pg_properties p ON p.id = i.pg_property_id
         JOIN users op ON op.id = p.operator_id
         JOIN pg_rent_settings s ON s.pg_property_id = i.pg_property_id
        WHERE i.pay_token = $1 AND i.status <> 'draft'`,
      [token]
    );
    const x = r.rows[0];
    if (!x) throw new NotFoundException({ code: "pay_link_not_found" });
    const balance = paiseToInr(Number(x.total_paise) - Number(x.amount_paid_paise));
    const period =
      x.period_start && x.period_end
        ? periodLabel(
            { start: x.period_start, end: x.period_end },
            { cycleMode: x.cycle_mode, anchorDay: 1 }
          )
        : x.kind === "deposit"
          ? "Security deposit"
          : x.invoice_number;
    const state: PgRentPublicPayPage["state"] =
      x.status === "paid"
        ? "paid"
        : x.status === "cancelled" || x.expired // cancel() expires the token too
          ? "expired"
          : "payable";
    const firstName = x.occupant_name.trim().split(/\s+/)[0] ?? "";
    const ownerPhone = x.whatsapp_phone_e164 ?? x.operator_phone;
    const locale = x.locale === "hi" ? "hi" : "en";
    const notify = mergeTemplate(x.msg_tenant_paid ?? DEFAULT_TEMPLATES[locale].tenant_paid, {
      tenant_name: firstName,
      owner_name: x.operator_name ?? "",
      property_name: x.property_name,
      room: x.room_number,
      bed: x.bed_label,
      period,
      amount: formatInrGrouped(balance),
      balance: formatInrGrouped(balance),
      due_date: x.due_date,
      due_phrase: "",
      days_overdue: "",
      late_fee: "",
      invoice_no: x.invoice_number,
      pay_link: "",
      upi_id: x.upi_vpa ?? "",
      receipt_link: "",
      utr: ""
    }).text;
    return {
      state,
      property_name: x.property_name,
      tenant_first_name: firstName,
      period_label: period,
      room_number: x.room_number,
      bed_label: x.bed_label,
      invoice_number: x.invoice_number,
      balance_inr: balance,
      total_inr: paiseToInr(x.total_paise),
      due_date: x.due_date,
      instruction:
        state === "payable"
          ? await this.buildPayInstruction({
              settings: x,
              amountInr: balance,
              note: `${period} Room ${x.room_number}`,
              tr: x.invoice_number
            })
          : null,
      instruction_open_amount:
        state === "payable"
          ? await this.buildPayInstruction({
              settings: x,
              amountInr: null,
              note: `${period} Room ${x.room_number}`,
              tr: x.invoice_number
            })
          : null,
      owner_wa_digits: ownerPhone ? waDigits(ownerPhone) : null,
      notify_text: state === "payable" ? notify : null
    };
  }
}
```

- [ ] **Step 4: Message service**

```ts
// apps/api/src/modules/pg-rent/services/rent-message.service.ts
import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException
} from "@nestjs/common";
import type {
  PgRentInvoiceMessages,
  PgRentMergeFields,
  PgRentReminderState,
  PgRentRenderedMessage,
  PgRentTemplateKey,
  PgRentTemplatePreviewInput
} from "@cribliv/shared-types";

import { DatabaseService } from "../../../common/database.service";
import { todayIst } from "../../../common/date";
import { transaction } from "../../../common/transaction";
import { paiseToInr } from "../dto/money";
import { periodLabel } from "../pure/rent-period";
import { duePhrase, reminderState } from "../pure/rent-reminder-state";
import {
  DEFAULT_TEMPLATES,
  MAX_TEMPLATE_CHARS,
  formatInrGrouped,
  mergeTemplate
} from "../pure/rent-template";
import { buildWaMeLink } from "../pure/rent-upi";
import { writeRentEvent } from "./rent-events";
import {
  assertManagedOwnership,
  requireDb,
  resolveTenantAssignmentIds,
  type Queryable
} from "./rent-guards";
import { newPayToken } from "./rent-numbering";
import { RentPayInstructionService, SITE_URL } from "./rent-pay-instruction.service";

interface FieldsRow {
  id: string;
  pg_property_id: string;
  assignment_id: string;
  invoice_number: string;
  kind: string;
  status: string;
  period_start: string | null;
  period_end: string | null;
  due_date: string;
  total_paise: string;
  amount_paid_paise: string;
  pay_token: string | null;
  fee_line: string | null;
  occupant_name: string;
  occupant_phone_e164: string;
  tenant_user_id: string | null;
  room_number: string;
  bed_label: string;
  property_name: string;
  operator_name: string | null;
  operator_phone: string;
  whatsapp_phone_e164: string | null;
  upi_vpa: string | null;
  cycle_mode: "calendar_month" | "anniversary";
  reminder_offsets_days: number[];
  late_fee_grace_days: number;
  locale: string;
  msg_reminder: string | null;
  msg_overdue: string | null;
  msg_tenant_paid: string | null;
  msg_receipt_share: string | null;
  receipt_id: string | null;
  receipt_share_token: string | null;
  receipt_amount_paise: string | null;
}

const FIELDS_SQL = `
  SELECT i.id::text, i.pg_property_id::text, i.assignment_id::text, i.invoice_number, i.kind::text, i.status::text,
         to_char(i.period_start,'YYYY-MM-DD') AS period_start, to_char(i.period_end,'YYYY-MM-DD') AS period_end, to_char(i.due_date,'YYYY-MM-DD') AS due_date,
         i.total_paise::text, i.amount_paid_paise::text, i.pay_token,
         (SELECT l.amount_paise::text FROM pg_rent_invoice_lines l WHERE l.invoice_id = i.id AND l.kind = 'late_fee') AS fee_line,
         a.occupant_name, a.occupant_phone_e164, a.tenant_user_id::text, i.room_number, i.bed_label,
         p.display_name AS property_name, op.full_name AS operator_name, op.phone_e164 AS operator_phone, s.whatsapp_phone_e164, s.upi_vpa,
         s.cycle_mode::text, s.reminder_offsets_days, s.late_fee_grace_days, COALESCE(op.preferred_language,'en') AS locale,
         s.msg_reminder, s.msg_overdue, s.msg_tenant_paid, s.msg_receipt_share,
         r.id::text AS receipt_id, r.share_token AS receipt_share_token, r.amount_paise::text AS receipt_amount_paise
    FROM pg_rent_invoices i
    JOIN pg_bed_assignments a ON a.id = i.assignment_id
    JOIN pg_properties p ON p.id = i.pg_property_id
    JOIN users op ON op.id = p.operator_id
    JOIN pg_rent_settings s ON s.pg_property_id = i.pg_property_id
    LEFT JOIN LATERAL (
      SELECT r.id, r.share_token, r.amount_paise FROM pg_rent_receipts r JOIN pg_rent_payment_allocations al ON al.payment_id = r.payment_id
       WHERE al.invoice_id = i.id AND r.voided_at IS NULL AND r.pdf_status = 'ready'
         AND r.share_token IS NOT NULL AND r.share_token_expires_at > now()
       ORDER BY r.created_at DESC LIMIT 1
    ) r ON true
   WHERE i.id = $1::uuid`;

@Injectable()
export class RentMessageService {
  constructor(
    @Inject(DatabaseService) private readonly db: DatabaseService,
    @Inject(RentPayInstructionService) private readonly pay: RentPayInstructionService
  ) {}

  /** Spec §7.4 merge fields for one invoice. Shared with the tenant service. */
  async fieldsForInvoice(
    q: Queryable,
    invoiceId: string,
    opts: { utr?: string; today?: string } = {}
  ) {
    const r = await q.query<FieldsRow>(FIELDS_SQL, [invoiceId]);
    const x = r.rows[0];
    if (!x) throw new NotFoundException({ code: "invoice_not_found" });
    const today = opts.today ?? todayIst();
    const locale: "en" | "hi" = x.locale === "hi" ? "hi" : "en";
    const balance = paiseToInr(Number(x.total_paise) - Number(x.amount_paid_paise));
    const state = reminderState({
      dueDate: x.due_date,
      today,
      offsets: x.reminder_offsets_days,
      graceDays: x.late_fee_grace_days
    });
    const period =
      x.period_start && x.period_end
        ? periodLabel(
            { start: x.period_start, end: x.period_end },
            { cycleMode: x.cycle_mode, anchorDay: 1 }
          )
        : x.kind === "deposit"
          ? "Security deposit"
          : x.invoice_number;
    const payLink =
      x.pay_token && x.status !== "paid" && x.status !== "cancelled"
        ? this.pay.payLinkFor(locale, x.pay_token)
        : "";
    const fields: PgRentMergeFields = {
      tenant_name: x.occupant_name,
      owner_name: x.operator_name ?? "",
      property_name: x.property_name,
      room: x.room_number,
      bed: x.bed_label,
      period,
      amount: formatInrGrouped(paiseToInr(x.total_paise)),
      balance: formatInrGrouped(balance),
      due_date: x.due_date,
      due_phrase: duePhrase({ dueDate: x.due_date, today }, locale),
      days_overdue: String(state.daysOverdue),
      late_fee: formatInrGrouped(x.fee_line === null ? 0 : paiseToInr(x.fee_line)),
      invoice_no: x.invoice_number,
      pay_link: payLink,
      upi_id: x.upi_vpa ?? "(not set)",
      receipt_link: x.receipt_share_token
        ? `${(process.env.NEXT_PUBLIC_API_BASE_URL || `${SITE_URL()}/v1`).replace(/\/$/, "")}/public/pg-rent/receipts/${x.receipt_share_token}`
        : "",
      utr: opts.utr ?? ""
    };
    return {
      fields,
      locale,
      row: x,
      state,
      tenantPhone: x.occupant_phone_e164,
      ownerPhone: x.whatsapp_phone_e164 ?? x.operator_phone,
      verified: x.tenant_user_id !== null,
      payLink,
      templates: {
        reminder: x.msg_reminder,
        overdue: x.msg_overdue,
        tenant_paid: x.msg_tenant_paid,
        receipt_share: x.msg_receipt_share
      }
    };
  }

  private render(
    key: PgRentTemplateKey,
    template: string | null,
    locale: "en" | "hi",
    fields: PgRentMergeFields,
    recipient: string | null
  ): PgRentRenderedMessage {
    const merged = mergeTemplate(template ?? DEFAULT_TEMPLATES[locale][key], fields);
    return {
      key,
      text: merged.text,
      unknown_fields: merged.unknownFields,
      truncated: merged.truncated,
      wa_me_url: recipient ? buildWaMeLink(recipient, merged.text) : null,
      recipient_e164: recipient
    };
  }

  /** Spec §12 `GET /invoices/:id/messages`. Owner → tenant messages; receipt share only when a ready receipt exists. */
  async messagesForInvoice(
    operatorId: string,
    propertyId: string,
    invoiceId: string
  ): Promise<PgRentInvoiceMessages> {
    requireDb(this.db);
    await assertManagedOwnership(this.db, operatorId, propertyId);
    const f = await this.fieldsForInvoice(this.db, invoiceId);
    if (f.row.pg_property_id !== propertyId)
      throw new NotFoundException({ code: "invoice_not_found" });
    const reminder = this.render(
      "reminder",
      f.templates.reminder,
      f.locale,
      f.fields,
      f.tenantPhone
    );
    const overdue = this.render("overdue", f.templates.overdue, f.locale, f.fields, f.tenantPhone);
    // {amount} in the receipt message is what the receipt covers, not the invoice total.
    const receipt = f.row.receipt_share_token
      ? this.render(
          "receipt_share",
          f.templates.receipt_share,
          f.locale,
          { ...f.fields, amount: formatInrGrouped(paiseToInr(f.row.receipt_amount_paise ?? 0)) },
          f.tenantPhone
        )
      : null;
    const warnings: string[] = [];
    if (!f.row.upi_vpa)
      warnings.push(
        'No UPI ID is set — {upi_id} renders as "(not set)"; tenants see bank details or a manual note instead'
      );
    for (const m of [reminder, overdue, receipt])
      for (const u of m?.unknown_fields ?? [])
        warnings.push(`Unknown merge field {${u}} is sent literally`);
    if (!f.verified)
      warnings.push(
        "This tenant's number is not linked to a Cribliv account — double-check it before the first reminder"
      );
    return {
      invoice_id: invoiceId,
      pay_link: f.payLink,
      reminder,
      overdue,
      receipt_share: receipt,
      warnings
    };
  }

  /** Live editor preview (spec §7.4). Text is validated to ≤ 600 chars; the invoice is optional (sample fields otherwise). */
  async preview(
    operatorId: string,
    propertyId: string,
    input: PgRentTemplatePreviewInput
  ): Promise<PgRentRenderedMessage> {
    requireDb(this.db);
    await assertManagedOwnership(this.db, operatorId, propertyId);
    if (input.text.length > MAX_TEMPLATE_CHARS)
      throw new BadRequestException({ code: "template_too_long" });
    if (input.invoice_id) {
      const f = await this.fieldsForInvoice(this.db, input.invoice_id);
      if (f.row.pg_property_id !== propertyId)
        throw new NotFoundException({ code: "invoice_not_found" });
      return this.render(
        input.key,
        input.text,
        f.locale,
        f.fields,
        input.key === "tenant_paid" ? f.ownerPhone : f.tenantPhone
      );
    }
    const sample: PgRentMergeFields = {
      tenant_name: "Rahul",
      owner_name: "Owner",
      property_name: "Your PG",
      room: "101",
      bed: "A",
      period: "September 2026",
      amount: "₹9,000",
      balance: "₹9,000",
      due_date: "2026-10-05",
      due_phrase: "due in 3 days",
      days_overdue: "0",
      late_fee: "₹0",
      invoice_no: "PG-INV-0001",
      pay_link: this.pay.payLinkFor("en", "sample"),
      upi_id: "owner@upi",
      receipt_link: "",
      utr: "123456789012"
    };
    return this.render(input.key, input.text, "en", sample, null);
  }

  /** Spec §7.3: every Remind tap is logged; never a broadcast. */
  async reminderOpened(
    operatorId: string,
    propertyId: string,
    invoiceId: string,
    input: { stage: PgRentReminderState; channel: "whatsapp" | "call" }
  ): Promise<void> {
    requireDb(this.db);
    await transaction(this.db, async (client) => {
      await assertManagedOwnership(client, operatorId, propertyId);
      const inv = await client.query(
        `SELECT 1 FROM pg_rent_invoices WHERE id = $1::uuid AND pg_property_id = $2::uuid`,
        [invoiceId, propertyId]
      );
      if (!inv.rowCount) throw new NotFoundException({ code: "invoice_not_found" });
      await writeRentEvent(client, {
        propertyId,
        entityType: "invoice",
        entityId: invoiceId,
        eventType: "reminder.opened",
        actor: { id: operatorId, role: "pg_operator" },
        payload: { stage: input.stage, channel: input.channel }
      });
    });
  }

  /** Spec §12 `POST /invoices/:id/pay-token`: a fresh 45-day token; the old link stops working. */
  async regeneratePayToken(
    operatorId: string,
    propertyId: string,
    invoiceId: string
  ): Promise<{ pay_link: string; expires_at: string }> {
    requireDb(this.db);
    return transaction(this.db, async (client) => {
      await assertManagedOwnership(client, operatorId, propertyId, true);
      const token = newPayToken();
      const r = await client.query<{ locale: string }>(
        `UPDATE pg_rent_invoices i SET pay_token = $3, pay_token_expires_at = $4 FROM pg_properties p JOIN users op ON op.id = p.operator_id
          WHERE i.id = $1::uuid AND i.pg_property_id = $2::uuid AND p.id = i.pg_property_id AND i.status IN ('issued','partially_paid')
          RETURNING COALESCE(op.preferred_language,'en') AS locale`,
        [invoiceId, propertyId, token.token, token.expiresAt]
      );
      if (!r.rows[0]) throw new NotFoundException({ code: "invoice_not_open" });
      await writeRentEvent(client, {
        propertyId,
        entityType: "invoice",
        entityId: invoiceId,
        eventType: "invoice.pay_token_regenerated",
        actor: { id: operatorId, role: "pg_operator" }
      });
      return {
        pay_link: this.pay.payLinkFor(r.rows[0].locale === "hi" ? "hi" : "en", token.token),
        expires_at: token.expiresAt.toISOString()
      };
    });
  }

  /** Spec §7.5: tenant → owner after an in-app claim. Scoped to the tenant's own payment. */
  async tenantPaidMessage(tenantUserId: string, paymentId: string): Promise<PgRentRenderedMessage> {
    requireDb(this.db);
    const mine = await resolveTenantAssignmentIds(this.db, tenantUserId);
    const p = await this.db.query<{
      claimed_invoice_id: string | null;
      assignment_id: string;
      reference: string | null;
      amount_paise: string;
    }>(
      `SELECT claimed_invoice_id::text, assignment_id::text, reference, amount_paise::text FROM pg_rent_payments WHERE id = $1::uuid AND assignment_id = ANY($2::uuid[])`,
      [paymentId, mine]
    );
    if (!p.rows[0]) throw new ForbiddenException({ code: "forbidden" });
    const invoiceId =
      p.rows[0].claimed_invoice_id ??
      (
        await this.db.query<{ id: string }>(
          `SELECT id::text FROM pg_rent_invoices WHERE assignment_id = $1::uuid AND status IN ('issued','partially_paid') ORDER BY due_date LIMIT 1`,
          [p.rows[0].assignment_id]
        )
      ).rows[0]?.id;
    if (!invoiceId) throw new NotFoundException({ code: "invoice_not_found" });
    const f = await this.fieldsForInvoice(this.db, invoiceId, { utr: p.rows[0].reference ?? "" });
    const fields = { ...f.fields, amount: formatInrGrouped(paiseToInr(p.rows[0].amount_paise)) };
    return this.render("tenant_paid", f.templates.tenant_paid, f.locale, fields, f.ownerPhone);
  }
}
```

In `apps/api/src/modules/pg-rent/pg-rent.module.ts`:

1. Delete the stale three-line comment above `@Module` (`// Providers and controllers are appended by later tasks …`).
2. Add, below `import { RentSettlementService } from "./services/rent-settlement.service";`:

```ts
import { RentMessageService } from "./services/rent-message.service";
import { RentPayInstructionService } from "./services/rent-pay-instruction.service";
```

3. In `providers`, directly after `RentSettlementService,` add `RentPayInstructionService,` and `RentMessageService,`.

`invoice.pay_token_regenerated` is an owner-only event type (listed in spec §4.10; Task 9 aligns the spec's tenant-visible wording).

- [ ] **Step 5: Run to verify it passes**

Run: `pnpm --filter @cribliv/api exec vitest run src/modules/pg-rent/__tests__/rent-message-pay.integration.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/pg-rent/services/rent-message.service.ts apps/api/src/modules/pg-rent/services/rent-pay-instruction.service.ts apps/api/src/modules/pg-rent/pg-rent.module.ts apps/api/src/modules/pg-rent/__tests__/rent-message-pay.integration.test.ts
git commit -m "feat(pg-rent): message templates, wa.me links, pay instruction with QR, public pay page data"
```

---

### Task 4: Queue service — sections, month summary, portfolio

**Files:**

- Create: `apps/api/src/modules/pg-rent/services/rent-queue.service.ts`
- Modify: `apps/api/src/modules/pg-rent/pg-rent.module.ts`
- Test: `apps/api/src/modules/pg-rent/__tests__/rent-queue.integration.test.ts`

**Interfaces:**

```ts
@Injectable()
export class RentQueueService {
  constructor(db, settlement: RentSettlementService);
  async queue(operatorId, propertyId, today?: string): Promise<PgRentQueue>;
  async monthSummary(
    operatorId,
    propertyId,
    month: string /* YYYY-MM-01 */,
    today?: string
  ): Promise<PgRentMonthSummary>; // spec §10.2 billing lens, rent+adhoc
  async portfolio(operatorId, today?: string): Promise<PgRentPortfolioRow[]>; // every property with manage_enabled; summary null when not enabled
}
```

Section rules (spec §7.3):

1. `awaiting_confirmation`: `pending_confirmation` claims, oldest first.
2. `needs_attention`: `draft_invoice` (draft rent invoices), `set_move_in_date` (eligible-status assignments with null move-in), `notice_ended` (notice family with `notice_end_date < today`), `reprorate_suggested` / `restore_suggested` (from `reprorate_suggestion.mode`, on invoices that are **not cancelled** — `cancel()` never clears the suggestion), `booking_held` (`reserved`/`cancelled` assignments with credit > 0 and no live deposit-release), `identity_disputed` (latest dispute event newer than its clear).
3. `leaving`: settlement status `leaving` (statement per assignment in the notice family / moved out ≤ 30 days) and settled-with-`to_return > 0`.
4. `overdue` (sorted by `urgency = balance_inr × days_overdue` desc), `due_today`, `due_soon` — open `issued`/`partially_paid` invoices of non-draft kinds **without a pending claim** (per invoice: a tenant's other, unclaimed invoices still appear), states from `reminderState`.
5. `former_tenants`: `moved_out` assignments with open balance, grouped, newest move-out first.

- [ ] **Step 1: Write the failing test**

```ts
// apps/api/src/modules/pg-rent/__tests__/rent-queue.integration.test.ts
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { DatabaseService } from "../../../common/database.service";
import { DevApiSasIssuer } from "../../rent-agreement/downloads/dev-api-sas-issuer";
import { InMemoryPdfStorage } from "../../rent-agreement/pdf/in-memory-pdf-storage";
import { RentAllocationService } from "../services/rent-allocation.service";
import { RentInvoiceEngineService } from "../services/rent-invoice-engine.service";
import { RentInvoiceService } from "../services/rent-invoice.service";
import { RentPaymentService } from "../services/rent-payment.service";
import { RentQueueService } from "../services/rent-queue.service";
import { RentReceiptService } from "../services/rent-receipt.service";
import { RentSettlementService } from "../services/rent-settlement.service";
import { RentSettingsService } from "../services/rent-settings.service";
import { RentFixtures } from "./helpers/rent-fixtures";

const HAS_DB = Boolean(process.env.DATABASE_URL);

describe.skipIf(!HAS_DB)("RentQueueService", () => {
  let db: DatabaseService;
  let fx: RentFixtures;
  let operatorId: string;
  let tenantUserId: string;
  let propertyId: string;
  let roomId: string;
  let settings: RentSettingsService;
  let engine: RentInvoiceEngineService;
  let payments: RentPaymentService;
  let queue: RentQueueService;
  const A: Record<string, string> = {};
  let bInv: string;

  async function tenant(label: string, opts: Record<string, unknown> = {}) {
    const bedId = await fx.createBed(roomId, label);
    A[label] = await fx.createAssignment(propertyId, bedId, {
      createdBy: operatorId,
      moveIn: "2026-09-01",
      occupantName: `Tenant ${label}`,
      ...opts
    });
    return A[label];
  }

  beforeAll(async () => {
    db = new DatabaseService();
    fx = new RentFixtures(db, randomUUID().replace(/-/g, ""));
    await fx.setup();
    operatorId = await fx.createUser("pg_operator");
    tenantUserId = await fx.createUser("tenant", "+917700000033");
    propertyId = await fx.createProperty(operatorId, { internalCode: "QUE" });
    const listingId = await fx.createListingWithDetails(propertyId, operatorId);
    const roomTypeId = await fx.createRoomType(listingId, {
      rentPaise: 900000,
      depositPaise: 1800000
    });
    roomId = await fx.createRoom(propertyId, { roomTypeId, roomNumber: "301" });
    settings = new RentSettingsService(db);
    await settings.enable(operatorId, propertyId, {
      billing_starts_on: "2026-09-01",
      due_day: 5,
      late_fee_enabled: true,
      late_fee_grace_days: 7,
      prorate_move_out: true
    });
    const alloc = new RentAllocationService();
    const receipts = new RentReceiptService(
      db,
      { render: async () => Buffer.from("%PDF") },
      new InMemoryPdfStorage(),
      new DevApiSasIssuer()
    );
    engine = new RentInvoiceEngineService(db, settings, alloc);
    payments = new RentPaymentService(db, settings, alloc, receipts);
    const invoices = new RentInvoiceService(db, alloc, payments, engine);
    const settlement = new RentSettlementService(db, alloc, payments, invoices, engine);
    queue = new RentQueueService(db, settlement);

    // No deposits: enabled_on is the real date, after these 2026-09-01 move-ins. A: overdue. B: claim on Sep. C: no move-in. D: draft (bare room → listing rent). E: notice (Oct re-prorate suggestion). F: former tenant. G: paid.
    await tenant("A");
    await tenant("B", { tenantUserId, occupantPhone: "+917700000033" });
    await tenant("C", { moveIn: null });
    await tenant("G");
    const bareRoom = await fx.createRoom(propertyId, { roomTypeId: null, roomNumber: "302" });
    const bedD = await fx.createBed(bareRoom, "A");
    A.D = await fx.createAssignment(propertyId, bedD, {
      createdBy: operatorId,
      moveIn: "2026-09-01",
      occupantName: "Tenant D"
    });
    await tenant("E"); // before the first run, so E's full October exists when notice is served
    await engine.generateInvoicesForProperty(propertyId, "2026-09-30"); // Sep (due 09-30: natural 09-05 is past) + Oct (due 10-05) for A/B/E/G; drafts for D
    bInv = (
      await db.query<{ id: string }>(
        `SELECT id::text FROM pg_rent_invoices WHERE assignment_id = $1::uuid AND kind = 'rent' ORDER BY period_start LIMIT 1`,
        [A.B]
      )
    ).rows[0].id;
    await payments.claimByTenant(tenantUserId, {
      assignment_id: A.B,
      invoice_id: bInv,
      amount_inr: 9000,
      method: "upi",
      paid_on: "2026-09-04",
      idempotency_key: randomUUID()
    });
    await payments.recordByOperator(
      operatorId,
      propertyId,
      { assignment_id: A.G, amount_inr: 36000, method: "cash", paid_on: "2026-09-02" },
      randomUUID()
    );
    await db.query(
      `UPDATE pg_bed_assignments SET status = 'notice_served', notice_end_date = '2026-10-15' WHERE id = $1::uuid`,
      [A.E]
    );
    await engine.onAssignmentEvent({ type: "notice_served", propertyId, assignmentId: A.E });
    await tenant("F");
    await db.query(
      `UPDATE pg_bed_assignments SET status = 'moved_out', move_out_date = '2026-09-20' WHERE id = $1::uuid`,
      [A.F]
    );
    await engine.generateInvoicesForProperty(propertyId, "2026-10-10");
  });
  afterAll(async () => {
    await fx.teardown();
    await db.onModuleDestroy();
  });

  it("builds every section as of Oct 10", async () => {
    const q = await queue.queue(operatorId, propertyId, "2026-10-10");
    expect(q.as_of).toBe("2026-10-10");
    expect(q.awaiting_confirmation).toHaveLength(1);
    expect(q.awaiting_confirmation[0]).toMatchObject({
      assignment_id: A.B,
      amount_inr: 9000,
      waiting_days: expect.any(Number)
    });
    expect(q.needs_attention.map((r) => [r.kind, r.assignment_id])).toEqual(
      expect.arrayContaining([
        ["draft_invoice", A.D],
        ["set_move_in_date", A.C],
        ["reprorate_suggested", A.E]
      ])
    );
    expect(q.leaving.map((r) => r.assignment_id)).toContain(A.E);
    const overdueIds = q.overdue.map((r) => r.assignment_id);
    expect(overdueIds).toContain(A.A);
    expect(q.overdue.map((r) => r.invoice_id)).not.toContain(bInv); // pending claim → that invoice leaves the reminder sections
    expect(overdueIds).not.toContain(A.G); // paid
    const a = q.overdue.filter((r) => r.assignment_id === A.A);
    expect(a.map((r) => r.in_grace)).toEqual(expect.arrayContaining([true, false])); // Sep due 09-30 (10 days, past grace 7); Oct due 10-05 (5 days, in grace)
    expect(q.overdue.every((r, i, arr) => i === 0 || arr[i - 1].urgency >= r.urgency)).toBe(true);
    expect(q.former_tenants.map((r) => r.assignment_id)).toContain(A.F);
    expect(q.former_tenants.find((r) => r.assignment_id === A.F)!.balance_inr).toBeGreaterThan(0);
    expect(JSON.stringify(q)).not.toMatch(/_paise/);
  });

  it("month summary uses the billing lens for rent + adhoc only", async () => {
    const s = await queue.monthSummary(operatorId, propertyId, "2026-09-01", "2026-10-10");
    // September rent for A, B, E, G (9000 each) + F's prorated Sep 1–20 → expected; G paid 9000 of it; deposits excluded
    expect(s.expected_inr).toBe(9000 * 4 + 6000);
    expect(s.collected_inr).toBe(9000);
    expect(s.outstanding_inr).toBe(s.expected_inr - 9000);
    expect(s.overdue_inr).toBe(s.outstanding_inr - 6000); // F's cut September is due 2026-10-10 (moved_out → due on the run day), not yet overdue
    expect(s.awaiting_count).toBe(1);
    expect(s.awaiting_inr).toBe(9000);
    expect(s.collection_rate).toBeCloseTo(9000 / s.expected_inr, 4);
  });

  it("portfolio lists every managed property, enabled or not", async () => {
    const bare = await fx.createProperty(operatorId, { displayName: "No rent yet" });
    const rows = await queue.portfolio(operatorId, "2026-10-10");
    const mine = rows.find((r) => r.property_id === propertyId)!;
    expect(mine).toMatchObject({ enabled: true, paused: false });
    expect(mine.summary?.expected_inr).toBeGreaterThan(0);
    expect(mine.queue_counts).toMatchObject({ awaiting: 1 });
    expect(rows.find((r) => r.property_id === bare)).toMatchObject({
      enabled: false,
      summary: null,
      queue_counts: null
    });
  });
});
```

`6000` = 900000 × 20/30 = 600000 paise → F's cut September (moved out Sep 20 with `prorate_move_out`). Its due date is the day of the run that issued it (2026-10-10: a moved-out tenant's period is due on the run day), so it is outstanding but not yet overdue on 2026-10-10 — hence `overdue_inr = outstanding_inr − 6000`. E is created before the first run so its full October exists when notice is served; `onAssignmentEvent` then writes the re-proration suggestion on it.

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @cribliv/api exec vitest run src/modules/pg-rent/__tests__/rent-queue.integration.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// apps/api/src/modules/pg-rent/services/rent-queue.service.ts
import { Inject, Injectable } from "@nestjs/common";
import type {
  PgRentAttentionRow,
  PgRentFormerTenantRow,
  PgRentLeavingRow,
  PgRentMonthSummary,
  PgRentPortfolioRow,
  PgRentQueue,
  PgRentQueueClaimRow,
  PgRentQueueInvoiceRow
} from "@cribliv/shared-types";

import { DatabaseService } from "../../../common/database.service";
import { todayIst } from "../../../common/date";
import { paiseToInr } from "../dto/money";
import { toIsoTs } from "../dto/common";
import { daysInclusive, firstOfMonth } from "../pure/rent-dates";
import { periodLabel } from "../pure/rent-period";
import { reminderState } from "../pure/rent-reminder-state";
import { assertManagedOwnership, requireDb, type Queryable } from "./rent-guards";
import { RentSettlementService } from "./rent-settlement.service";

@Injectable()
export class RentQueueService {
  constructor(
    @Inject(DatabaseService) private readonly db: DatabaseService,
    @Inject(RentSettlementService) private readonly settlement: RentSettlementService
  ) {}

  async queue(operatorId: string, propertyId: string, today = todayIst()): Promise<PgRentQueue> {
    requireDb(this.db);
    await assertManagedOwnership(this.db, operatorId, propertyId);
    const [awaiting, attention, leaving, invoices, former] = await Promise.all([
      this.claims(this.db, propertyId, today),
      this.attention(this.db, propertyId, today),
      this.leaving(operatorId, propertyId, today),
      this.openInvoices(this.db, propertyId, today),
      this.formerTenants(this.db, propertyId)
    ]);
    return {
      as_of: today,
      awaiting_confirmation: awaiting,
      needs_attention: attention,
      leaving,
      overdue: invoices.filter((r) => r.state === "overdue").sort((a, b) => b.urgency - a.urgency),
      due_today: invoices.filter((r) => r.state === "due_today"),
      due_soon: invoices.filter((r) => r.state === "due_soon"),
      former_tenants: former
    };
  }

  private async claims(
    q: Queryable,
    propertyId: string,
    today: string
  ): Promise<PgRentQueueClaimRow[]> {
    const r = await q.query<{
      payment_id: string;
      assignment_id: string;
      occupant_name: string;
      room_number: string;
      bed_label: string;
      amount_paise: string;
      method: PgRentQueueClaimRow["method"];
      paid_on: string;
      reference: string | null;
      proof_count: number;
      claimed_invoice_id: string | null;
      claimed_invoice_number: string | null;
      created_at: Date;
    }>(
      `SELECT p.id::text AS payment_id, p.assignment_id::text, a.occupant_name, r.room_number, b.bed_label, p.amount_paise::text, p.method::text,
              to_char(p.paid_on,'YYYY-MM-DD') AS paid_on, p.reference, jsonb_array_length(p.proof_paths) AS proof_count,
              p.claimed_invoice_id::text, i.invoice_number AS claimed_invoice_number, p.created_at
         FROM pg_rent_payments p
         JOIN pg_bed_assignments a ON a.id = p.assignment_id JOIN pg_beds b ON b.id = a.bed_id JOIN pg_rooms r ON r.id = b.room_id
         LEFT JOIN pg_rent_invoices i ON i.id = p.claimed_invoice_id
        WHERE p.pg_property_id = $1::uuid AND p.status = 'pending_confirmation' ORDER BY p.created_at`,
      [propertyId]
    );
    return r.rows.map((x) => ({
      payment_id: x.payment_id,
      assignment_id: x.assignment_id,
      occupant_name: x.occupant_name,
      room_number: x.room_number,
      bed_label: x.bed_label,
      amount_inr: paiseToInr(x.amount_paise),
      method: x.method,
      paid_on: x.paid_on,
      reference: x.reference,
      proof_count: Number(x.proof_count),
      claimed_invoice_id: x.claimed_invoice_id,
      claimed_invoice_number: x.claimed_invoice_number,
      waiting_since: toIsoTs(x.created_at) as string,
      waiting_days: daysInclusive(todayIst(x.created_at), today) - 1
    }));
  }

  private async attention(
    q: Queryable,
    propertyId: string,
    today: string
  ): Promise<PgRentAttentionRow[]> {
    const r = await q.query<{
      kind: PgRentAttentionRow["kind"];
      assignment_id: string;
      occupant_name: string;
      room_number: string;
      bed_label: string;
      invoice_id: string | null;
      amount_paise: string | null;
      secondary_paise: string | null;
      date: string | null;
      days: number | null;
    }>(
      `WITH base AS (
         SELECT a.id, a.status::text, a.occupant_name, r.room_number, b.bed_label, a.move_in_date, a.notice_end_date
           FROM pg_bed_assignments a JOIN pg_beds b ON b.id = a.bed_id JOIN pg_rooms r ON r.id = b.room_id
          WHERE a.pg_property_id = $1::uuid
       )
       SELECT 'draft_invoice' AS kind, i.assignment_id::text, x.occupant_name, x.room_number, x.bed_label, i.id::text AS invoice_id,
              i.total_paise::text AS amount_paise, NULL AS secondary_paise, to_char(i.due_date,'YYYY-MM-DD') AS date, NULL::int AS days
         FROM pg_rent_invoices i JOIN base x ON x.id = i.assignment_id WHERE i.pg_property_id = $1::uuid AND i.status = 'draft'
       UNION ALL
       SELECT 'set_move_in_date', x.id::text, x.occupant_name, x.room_number, x.bed_label, NULL, NULL, NULL, NULL, NULL
         FROM base x WHERE x.status NOT IN ('reserved','cancelled','moved_out') AND x.move_in_date IS NULL
       UNION ALL
       SELECT 'notice_ended', x.id::text, x.occupant_name, x.room_number, x.bed_label, NULL, NULL, NULL, to_char(x.notice_end_date,'YYYY-MM-DD'), ($2::date - x.notice_end_date)::int
         FROM base x WHERE x.status IN ('notice_served','move_out_requested','move_out_pending_confirmation') AND x.notice_end_date < $2::date
       UNION ALL
       SELECT CASE WHEN i.reprorate_suggestion->>'mode' = 'restore' THEN 'restore_suggested' ELSE 'reprorate_suggested' END, i.assignment_id::text, x.occupant_name, x.room_number, x.bed_label, i.id::text,
              (i.reprorate_suggestion->>'from_paise'), (i.reprorate_suggestion->>'to_paise'), i.reprorate_suggestion->>'leave_on', NULL
         FROM pg_rent_invoices i JOIN base x ON x.id = i.assignment_id WHERE i.pg_property_id = $1::uuid AND i.reprorate_suggestion IS NOT NULL AND i.status <> 'cancelled'
       UNION ALL
       SELECT 'booking_held', x.id::text, x.occupant_name, x.room_number, x.bed_label, NULL, c.credit::text, NULL, NULL, NULL
         FROM base x JOIN LATERAL (
           SELECT SUM(p.amount_paise - COALESCE(al.s, 0)) AS credit FROM pg_rent_payments p
             LEFT JOIN (SELECT payment_id, SUM(amount_paise) AS s FROM pg_rent_payment_allocations GROUP BY payment_id) al ON al.payment_id = p.id
            WHERE p.assignment_id = x.id AND p.direction = 'inflow' AND p.status = 'confirmed'
         ) c ON true
        WHERE x.status IN ('reserved','cancelled') AND c.credit > 0
       UNION ALL
       SELECT 'identity_disputed', x.id::text, x.occupant_name, x.room_number, x.bed_label, NULL, NULL, NULL, NULL, NULL
         FROM base x WHERE (
           SELECT e.payload->>'flag' FROM pg_rent_events e WHERE e.entity_type = 'assignment' AND e.entity_id = x.id
              AND e.payload->>'flag' IN ('identity_disputed','identity_dispute_cleared') ORDER BY e.id DESC LIMIT 1
         ) = 'identity_disputed'`,
      [propertyId, today]
    );
    return r.rows.map((x) => ({
      kind: x.kind,
      assignment_id: x.assignment_id,
      occupant_name: x.occupant_name,
      room_number: x.room_number,
      bed_label: x.bed_label,
      invoice_id: x.invoice_id,
      amount_inr: x.amount_paise === null ? null : paiseToInr(x.amount_paise),
      secondary_inr: x.secondary_paise === null ? null : paiseToInr(x.secondary_paise),
      date: x.date,
      days: x.days === null ? null : Number(x.days)
    }));
  }

  private async leaving(
    operatorId: string,
    propertyId: string,
    today: string
  ): Promise<PgRentLeavingRow[]> {
    const r = await this.db.query<{
      id: string;
      occupant_name: string;
      room_number: string;
      bed_label: string;
      leave_on: string | null;
    }>(
      `SELECT a.id::text, a.occupant_name, r.room_number, b.bed_label, to_char(COALESCE(a.move_out_date, a.notice_end_date),'YYYY-MM-DD') AS leave_on
         FROM pg_bed_assignments a JOIN pg_beds b ON b.id = a.bed_id JOIN pg_rooms r ON r.id = b.room_id
        WHERE a.pg_property_id = $1::uuid AND (
          a.status IN ('notice_served','move_out_requested','move_out_pending_confirmation')
          OR (a.status = 'moved_out' AND a.move_out_date >= $2::date - 30)
        ) ORDER BY leave_on NULLS LAST`,
      [propertyId, today]
    );
    const out: PgRentLeavingRow[] = [];
    for (const x of r.rows) {
      const st = await this.settlement.statement(operatorId, propertyId, x.id);
      if (st.status === "nothing_to_settle") continue;
      if (st.status === "settled" && st.to_return_inr === 0) continue;
      out.push({
        assignment_id: x.id,
        occupant_name: x.occupant_name,
        room_number: x.room_number,
        bed_label: x.bed_label,
        status: st.status,
        leave_on: x.leave_on,
        deposit_held_inr: st.deposit_held_inr,
        to_return_inr: st.to_return_inr,
        open_dues_inr: st.open_dues_inr
      });
    }
    return out;
  }

  private async openInvoices(
    q: Queryable,
    propertyId: string,
    today: string
  ): Promise<PgRentQueueInvoiceRow[]> {
    const r = await q.query<{
      invoice_id: string;
      invoice_number: string;
      assignment_id: string;
      occupant_name: string;
      verified: boolean;
      room_number: string;
      bed_label: string;
      kind: PgRentQueueInvoiceRow["kind"];
      period_start: string | null;
      period_end: string | null;
      due_date: string;
      total_paise: string;
      amount_paid_paise: string;
      fee_line: string | null;
      suggested: string | null;
      last_reminded_at: Date | null;
      last_channel: string | null;
      offsets: number[];
      grace: number;
      cycle_mode: "calendar_month" | "anniversary";
    }>(
      `SELECT i.id::text AS invoice_id, i.invoice_number, i.assignment_id::text, a.occupant_name, (a.tenant_user_id IS NOT NULL) AS verified, i.room_number, i.bed_label, i.kind::text,
              to_char(i.period_start,'YYYY-MM-DD') AS period_start, to_char(i.period_end,'YYYY-MM-DD') AS period_end, to_char(i.due_date,'YYYY-MM-DD') AS due_date,
              i.total_paise::text, i.amount_paid_paise::text,
              (SELECT l.amount_paise::text FROM pg_rent_invoice_lines l WHERE l.invoice_id = i.id AND l.kind = 'late_fee') AS fee_line, i.suggested_late_fee_paise::text AS suggested,
              e.created_at AS last_reminded_at, e.payload->>'channel' AS last_channel, s.reminder_offsets_days AS offsets, s.late_fee_grace_days AS grace, s.cycle_mode::text
         FROM pg_rent_invoices i
         JOIN pg_bed_assignments a ON a.id = i.assignment_id
         JOIN pg_rent_settings s ON s.pg_property_id = i.pg_property_id
         LEFT JOIN LATERAL (SELECT created_at, payload FROM pg_rent_events WHERE entity_type = 'invoice' AND entity_id = i.id AND event_type = 'reminder.opened' ORDER BY id DESC LIMIT 1) e ON true
        WHERE i.pg_property_id = $1::uuid AND i.status IN ('issued','partially_paid') AND a.status <> 'moved_out'
          AND NOT EXISTS (SELECT 1 FROM pg_rent_payments p WHERE p.claimed_invoice_id = i.id AND p.status = 'pending_confirmation')
        ORDER BY i.due_date`,
      [propertyId]
    );
    return r.rows.map((x) => {
      const st = reminderState({
        dueDate: x.due_date,
        today,
        offsets: x.offsets,
        graceDays: x.grace
      });
      const balance = paiseToInr(Number(x.total_paise) - Number(x.amount_paid_paise));
      return {
        invoice_id: x.invoice_id,
        invoice_number: x.invoice_number,
        assignment_id: x.assignment_id,
        occupant_name: x.occupant_name,
        occupant_phone_verified: x.verified,
        room_number: x.room_number,
        bed_label: x.bed_label,
        kind: x.kind,
        period_label:
          x.period_start && x.period_end
            ? periodLabel(
                { start: x.period_start, end: x.period_end },
                { cycleMode: x.cycle_mode, anchorDay: 1 }
              )
            : x.kind === "deposit"
              ? "Security deposit"
              : x.invoice_number,
        due_date: x.due_date,
        balance_inr: balance,
        total_inr: paiseToInr(x.total_paise),
        state: st.state,
        in_grace: st.inGrace,
        days_overdue: st.daysOverdue,
        applied_fee_inr: x.fee_line === null ? null : paiseToInr(x.fee_line),
        suggested_fee_inr: x.suggested === null ? null : paiseToInr(x.suggested),
        last_reminded_at: toIsoTs(x.last_reminded_at),
        last_reminded_channel: (x.last_channel as "whatsapp" | "call" | null) ?? null,
        urgency: balance * Math.max(1, st.daysOverdue)
      };
    });
  }

  private async formerTenants(q: Queryable, propertyId: string): Promise<PgRentFormerTenantRow[]> {
    const r = await q.query<{
      id: string;
      occupant_name: string;
      room_number: string;
      bed_label: string;
      moved_out_on: string;
      balance: string;
      invoice_ids: string[];
    }>(
      `SELECT a.id::text, a.occupant_name, r.room_number, b.bed_label, to_char(a.move_out_date,'YYYY-MM-DD') AS moved_out_on,
              SUM(i.total_paise - i.amount_paid_paise)::text AS balance, array_agg(i.id::text ORDER BY i.due_date) AS invoice_ids
         FROM pg_bed_assignments a JOIN pg_beds b ON b.id = a.bed_id JOIN pg_rooms r ON r.id = b.room_id
         JOIN pg_rent_invoices i ON i.assignment_id = a.id AND i.status IN ('issued','partially_paid')
        WHERE a.pg_property_id = $1::uuid AND a.status = 'moved_out'
        GROUP BY a.id, a.occupant_name, r.room_number, b.bed_label, a.move_out_date HAVING SUM(i.total_paise - i.amount_paid_paise) > 0
        ORDER BY a.move_out_date DESC`,
      [propertyId]
    );
    return r.rows.map((x) => ({
      assignment_id: x.id,
      occupant_name: x.occupant_name,
      room_number: x.room_number,
      bed_label: x.bed_label,
      moved_out_on: x.moved_out_on,
      balance_inr: paiseToInr(x.balance),
      invoice_ids: x.invoice_ids
    }));
  }

  /** Spec §10.2 billing lens for one month: rent + adhoc invoices by billing_month, excluding draft/cancelled. */
  async monthSummary(
    operatorId: string,
    propertyId: string,
    month: string,
    today = todayIst()
  ): Promise<PgRentMonthSummary> {
    requireDb(this.db);
    await assertManagedOwnership(this.db, operatorId, propertyId);
    return this.summaryFor(this.db, propertyId, firstOfMonth(month), today);
  }

  private async summaryFor(
    q: Queryable,
    propertyId: string,
    month: string,
    today: string
  ): Promise<PgRentMonthSummary> {
    const r = await q.query<{
      expected: string;
      collected: string;
      overdue: string;
      overdue_tenants: string;
      awaiting: string;
      awaiting_count: string;
    }>(
      `SELECT COALESCE(SUM(i.total_paise),0)::text AS expected, COALESCE(SUM(i.amount_paid_paise),0)::text AS collected,
              COALESCE(SUM(CASE WHEN i.due_date < $3::date THEN i.total_paise - i.amount_paid_paise ELSE 0 END),0)::text AS overdue,
              COUNT(DISTINCT CASE WHEN i.due_date < $3::date AND i.total_paise > i.amount_paid_paise THEN i.assignment_id END)::text AS overdue_tenants,
              (SELECT COALESCE(SUM(p.amount_paise),0) FROM pg_rent_payments p WHERE p.pg_property_id = $1::uuid AND p.status = 'pending_confirmation')::text AS awaiting,
              (SELECT COUNT(*) FROM pg_rent_payments p WHERE p.pg_property_id = $1::uuid AND p.status = 'pending_confirmation')::text AS awaiting_count
         FROM pg_rent_invoices i
        WHERE i.pg_property_id = $1::uuid AND i.billing_month = $2::date AND i.kind IN ('rent','adhoc') AND i.status NOT IN ('draft','cancelled')`,
      [propertyId, month, today]
    );
    const x = r.rows[0];
    const expected = paiseToInr(x.expected);
    const collected = paiseToInr(x.collected);
    return {
      month,
      expected_inr: expected,
      collected_inr: collected,
      outstanding_inr: expected - collected,
      overdue_inr: paiseToInr(x.overdue),
      overdue_tenants: Number(x.overdue_tenants),
      awaiting_inr: paiseToInr(x.awaiting),
      awaiting_count: Number(x.awaiting_count),
      collection_rate: expected === 0 ? 0 : collected / expected
    };
  }

  /** Spec §12 `GET /pg-operator/rent/portfolio`: one row per managed property. */
  async portfolio(operatorId: string, today = todayIst()): Promise<PgRentPortfolioRow[]> {
    requireDb(this.db);
    const props = await this.db.query<{
      id: string;
      display_name: string;
      enabled: boolean;
      paused: boolean;
    }>(
      `SELECT p.id::text, p.display_name, (s.pg_property_id IS NOT NULL) AS enabled, (s.paused_at IS NOT NULL) AS paused
         FROM pg_properties p LEFT JOIN pg_rent_settings s ON s.pg_property_id = p.id
        WHERE p.operator_id = $1::uuid AND p.manage_enabled = true ORDER BY p.display_name`,
      [operatorId]
    );
    const out: PgRentPortfolioRow[] = [];
    for (const p of props.rows) {
      if (!p.enabled) {
        out.push({
          property_id: p.id,
          display_name: p.display_name,
          enabled: false,
          paused: false,
          summary: null,
          queue_counts: null
        });
        continue;
      }
      const [summary, q] = await Promise.all([
        this.summaryFor(this.db, p.id, firstOfMonth(today), today),
        this.queue(operatorId, p.id, today)
      ]);
      out.push({
        property_id: p.id,
        display_name: p.display_name,
        enabled: true,
        paused: p.paused,
        summary,
        queue_counts: {
          awaiting: q.awaiting_confirmation.length,
          attention: q.needs_attention.length,
          overdue: q.overdue.length,
          leaving: q.leaving.length
        }
      });
    }
    return out;
  }
}
```

In `pg-rent.module.ts` add `import { RentQueueService } from "./services/rent-queue.service";` below the Task 3 imports and `RentQueueService,` to `providers` after `RentMessageService,`. Note `leaving()` calls `settlement.statement` per row, which runs generation for that assignment first (on the real clock) — acceptable for the queue (a handful of leaving tenants, owner context), and it guarantees the cut final period exists before the owner sees "Settle".

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @cribliv/api exec vitest run src/modules/pg-rent/__tests__/rent-queue.integration.test.ts`
Expected: PASS, 3 tests. The month-summary `expected_inr` arithmetic depends on F's cut period existing — it is generated by the Oct 10 run because F's window ended Sep 20 (`windowEnded` → immediate). If `expected_inr` is off, investigate the window, do not change the literal.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/pg-rent/services/rent-queue.service.ts apps/api/src/modules/pg-rent/pg-rent.module.ts apps/api/src/modules/pg-rent/__tests__/rent-queue.integration.test.ts
git commit -m "feat(pg-rent): collection queue, month summary and portfolio"
```

---

### Task 5: Tenant service — summary (multi-residence hero), history, invoice, identity dispute

**Files:**

- Create: `apps/api/src/modules/pg-rent/dto/tenant-reads.dto.ts`
- Create: `apps/api/src/modules/pg-rent/services/rent-tenant.service.ts`
- Modify: `apps/api/src/modules/pg-rent/services/rent-settlement.service.ts` (new read-only `computeStatement`)
- Modify: `apps/api/src/modules/pg-rent/pg-rent.module.ts`
- Test: `apps/api/src/modules/pg-rent/__tests__/rent-tenant.integration.test.ts`

**Interfaces:**

```ts
// dto/tenant-reads.dto.ts
export const IdentityDisputeSchema: z.ZodType<PgRentIdentityDisputeInput>;
export function toTenantInvoiceDto(
  dto: PgRentInvoice,
  extras: {
    pay_link: string | null;
    instruction: PgRentPayInstruction | null;
    changes: PgRentEvent[];
  }
): PgRentTenantInvoice; // strips internal_note, rent_snapshot_inr, rent_source, suggested_late_fee_inr, reprorate_suggestion

// services/rent-tenant.service.ts
@Injectable()
export class RentTenantService {
  constructor(
    db,
    alloc: RentAllocationService,
    pay: RentPayInstructionService,
    settlement: RentSettlementService
  );
  async summary(userId: string, today?: string): Promise<PgRentTenantSummary>; // every matching assignment, current-first; hero per residence
  async history(userId: string, assignmentId: string): Promise<PgRentTenantHistory>;
  async invoice(userId: string, invoiceId: string): Promise<PgRentTenantInvoice>; // 404 when not theirs or draft
  async identityDispute(
    userId: string,
    assignmentId: string
  ): Promise<{ wa_me_url: string | null }>; // event flag identity_disputed + fixed-text WhatsApp to the operator
  async resolveDispute(operatorId: string, propertyId: string, assignmentId: string): Promise<void>; // flag identity_dispute_cleared
}

// services/rent-settlement.service.ts (1b) — new, read-only
async computeStatement(propertyId: string, assignmentId: string): Promise<PgRentSettlementStatement>; // requireDb + this.compute(this.db, …): no generation, no ownership check, no writes
```

Hero rules (spec §9): `not_enabled` (no settings row) · `settled`/`leaving` when the read-only settlement statement (`computeStatement`) says so (leaving family) · `awaiting` when a pending claim exists · else the oldest-due open non-draft invoice: `overdue` / `partially_paid` / `due` · else `paid` when the last invoice is paid (with its receipt) · else `nothing_due`. For `paid`/`nothing_due`, `next_invoice_expected_on` = the next period's natural due date (`nextPeriod` + `naturalDueDate` with the engine's `specFor` rule) − `invoice_lead_days`. `more_open_count/inr` = the other open invoices. The tenant-visible change log goes through `toEventDto` and drops `rent_source`; payment allocations are ordered `al.created_at, al.seq` (0073).

- [ ] **Step 1: Write the failing tests**

```ts
// apps/api/src/modules/pg-rent/__tests__/rent-tenant.integration.test.ts
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { DatabaseService } from "../../../common/database.service";
import { DevApiSasIssuer } from "../../rent-agreement/downloads/dev-api-sas-issuer";
import { InMemoryPdfStorage } from "../../rent-agreement/pdf/in-memory-pdf-storage";
import { RentAllocationService } from "../services/rent-allocation.service";
import { RentInvoiceEngineService } from "../services/rent-invoice-engine.service";
import { RentInvoiceService } from "../services/rent-invoice.service";
import { RentPayInstructionService } from "../services/rent-pay-instruction.service";
import { RentPaymentService } from "../services/rent-payment.service";
import { RentReceiptService } from "../services/rent-receipt.service";
import { RentSettlementService } from "../services/rent-settlement.service";
import { RentSettingsService } from "../services/rent-settings.service";
import { RentTenantService } from "../services/rent-tenant.service";
import { RentFixtures, enableRentAsOf } from "./helpers/rent-fixtures";

const HAS_DB = Boolean(process.env.DATABASE_URL);

describe.skipIf(!HAS_DB)("RentTenantService", () => {
  let db: DatabaseService;
  let fx: RentFixtures;
  let operatorId: string;
  let parentUserId: string;
  let settings: RentSettingsService;
  let engine: RentInvoiceEngineService;
  let payments: RentPaymentService;
  let tenants: RentTenantService;

  async function property(name: string, enable = true) {
    const propertyId = await fx.createProperty(operatorId, { displayName: name });
    const listingId = await fx.createListingWithDetails(propertyId, operatorId);
    const roomTypeId = await fx.createRoomType(listingId, {
      rentPaise: 900000,
      depositPaise: 1800000
    });
    const roomId = await fx.createRoom(propertyId, { roomTypeId });
    if (enable)
      await enableRentAsOf(db, settings, operatorId, propertyId, "2026-09-01", {
        billing_starts_on: "2026-09-01",
        due_day: 5,
        upi_vpa: "own@okaxis",
        upi_payee_name: "Owner"
      });
    return { propertyId, roomId };
  }

  beforeAll(async () => {
    db = new DatabaseService();
    fx = new RentFixtures(db, randomUUID().replace(/-/g, ""));
    await fx.setup();
    operatorId = await fx.createUser("pg_operator", "+917700000044");
    parentUserId = await fx.createUser("tenant", "+917700000066"); // one phone, two beds (spec §19 #14)
    settings = new RentSettingsService(db);
    const alloc = new RentAllocationService();
    const receipts = new RentReceiptService(
      db,
      { render: async () => Buffer.from("%PDF") },
      new InMemoryPdfStorage(),
      new DevApiSasIssuer({ baseUrl: "http://api.test" })
    );
    engine = new RentInvoiceEngineService(db, settings, alloc);
    payments = new RentPaymentService(db, settings, alloc, receipts);
    const invoices = new RentInvoiceService(db, alloc, payments, engine);
    const settlement = new RentSettlementService(db, alloc, payments, invoices, engine);
    const pay = new RentPayInstructionService(db);
    tenants = new RentTenantService(db, alloc, pay, settlement);
  });
  afterAll(async () => {
    await fx.teardown();
    await db.onModuleDestroy();
  });

  it("returns every residence the phone matches without auto-linking, with a hero per residence", async () => {
    const p1 = await property("PG One");
    const p2 = await property("PG Two");
    const p3 = await property("No rent", false);
    const bed1 = await fx.createBed(p1.roomId, "A");
    const bed2 = await fx.createBed(p2.roomId, "A");
    const bed3 = await fx.createBed(p3.roomId, "A");
    const a1 = await fx.createAssignment(p1.propertyId, bed1, {
      createdBy: operatorId,
      moveIn: "2026-09-01",
      occupantPhone: "+917700000066",
      tenantUserId: parentUserId,
      occupantName: "Kid One"
    });
    const a2 = await fx.createAssignment(p2.propertyId, bed2, {
      createdBy: operatorId,
      moveIn: "2026-09-01",
      occupantPhone: "+917700000066",
      occupantName: "Kid Two"
    }); // unlinked, phone-matched
    await fx.createAssignment(p3.propertyId, bed3, {
      createdBy: operatorId,
      moveIn: "2026-09-01",
      occupantPhone: "+917700000066",
      occupantName: "Kid Three"
    });
    for (const run of ["2026-09-01", "2026-10-01"]) {
      await engine.generateInvoicesForProperty(p1.propertyId, run);
      await engine.generateInvoicesForProperty(p2.propertyId, run);
    }
    await payments.recordByOperator(
      operatorId,
      p2.propertyId,
      { assignment_id: a2, amount_inr: 36000, method: "cash", paid_on: "2026-09-20" },
      randomUUID()
    );

    const s = await tenants.summary(parentUserId, "2026-10-10");
    expect(s.residences.map((r) => r.property_name).sort()).toEqual([
      "No rent",
      "PG One",
      "PG Two"
    ]);
    const one = s.residences.find((r) => r.assignment_id === a1)!;
    expect(one.hero.state).toBe("overdue");
    expect(one.hero.invoice).toMatchObject({ kind: "deposit", balance_inr: 18000 }); // oldest due first (deposit due Sep 1)
    expect(one.hero.more_open_count).toBe(2); // Sep + Oct rent
    expect(one.hero.invoice!.pay_link).toMatch(/\/pay\//);
    expect(one.hero.invoice!.instruction?.mode).toBe("upi_intent");
    expect(one.payee).toEqual({ name: "Owner", vpa: "own@okaxis", bank: null });
    expect(one.owner_wa_digits).toBe("917700000044");
    expect(JSON.stringify(one)).not.toMatch(
      /internal_note|rent_source|suggested_late_fee|reprorate_suggestion|_paise/
    );
    const two = s.residences.find((r) => r.assignment_id === a2)!;
    expect(two.hero.state).toBe("paid");
    expect(two.hero.last_receipt).not.toBeNull();
    expect(two.deposit).toMatchObject({ held_inr: 18000, uncollected_inr: 0 });
    const three = s.residences.find((r) => r.property_name === "No rent")!;
    expect(three).toMatchObject({ enabled: false, hero: { state: "not_enabled" } });
    const linked = await db.query<{ t: string | null }>(
      `SELECT tenant_user_id::text AS t FROM pg_bed_assignments WHERE id = $1::uuid`,
      [a2]
    );
    expect(linked.rows[0].t).toBeNull(); // reads never auto-link
  });

  it("awaiting beats due; history lists invoices, payments and receipts; a foreign invoice is 404", async () => {
    const p = await property("PG Claim");
    const bed = await fx.createBed(p.roomId, "A");
    const a = await fx.createAssignment(p.propertyId, bed, {
      createdBy: operatorId,
      moveIn: "2026-09-01",
      occupantPhone: "+917700000066"
    }); // phone-matched: the parent's one linked active bed is a1 (uq_pg_active_assignment_per_tenant)
    await engine.generateInvoicesForProperty(p.propertyId, "2026-09-01");
    const sep = (
      await db.query<{ id: string }>(
        `SELECT id::text FROM pg_rent_invoices WHERE assignment_id = $1::uuid AND kind = 'rent'`,
        [a]
      )
    ).rows[0].id;
    await payments.claimByTenant(parentUserId, {
      assignment_id: a,
      invoice_id: sep,
      amount_inr: 9000,
      method: "upi",
      paid_on: "2026-09-03",
      idempotency_key: randomUUID()
    });
    const s = await tenants.summary(parentUserId, "2026-09-04");
    const res = s.residences.find((r) => r.assignment_id === a)!;
    expect(res.hero.state).toBe("awaiting");
    expect(res.hero.pending_claim?.amount_inr).toBe(9000);

    const h = await tenants.history(parentUserId, a);
    expect(h.invoices.map((i) => i.kind).sort()).toEqual(["deposit", "rent"]);
    expect(h.payments).toHaveLength(1);
    const inv = await tenants.invoice(parentUserId, sep);
    expect(inv.changes.map((c) => c.event_type)).toContain("invoice.issued");
    const other = await fx.createUser("tenant");
    await expect(tenants.invoice(other, sep)).rejects.toMatchObject({
      response: { code: "invoice_not_found" }
    });
    await expect(tenants.history(other, a)).rejects.toMatchObject({
      response: { code: "forbidden" }
    });
  });

  it("identity dispute flags the assignment until the operator resolves it", async () => {
    const p = await property("PG Dispute");
    const bed = await fx.createBed(p.roomId, "A");
    const a = await fx.createAssignment(p.propertyId, bed, {
      createdBy: operatorId,
      moveIn: "2026-09-01",
      occupantPhone: "+917700000066"
    }); // phone-matched: the parent's one linked active bed is a1 (uq_pg_active_assignment_per_tenant)
    const r = await tenants.identityDispute(parentUserId, a);
    expect(r.wa_me_url).toMatch(/^https:\/\/wa\.me\/917700000044\?text=/);
    expect(
      (await tenants.summary(parentUserId)).residences.find((x) => x.assignment_id === a)!
        .identity_disputed
    ).toBe(true);
    await tenants.resolveDispute(operatorId, p.propertyId, a);
    expect(
      (await tenants.summary(parentUserId)).residences.find((x) => x.assignment_id === a)!
        .identity_disputed
    ).toBe(false);
    const flags = await db.query<{ f: string }>(
      `SELECT payload->>'flag' AS f FROM pg_rent_events WHERE entity_id = $1::uuid ORDER BY id`,
      [a]
    );
    expect(flags.rows.map((x) => x.f)).toEqual(["identity_disputed", "identity_dispute_cleared"]);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @cribliv/api exec vitest run src/modules/pg-rent/__tests__/rent-tenant.integration.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: DTO helpers**

```ts
// apps/api/src/modules/pg-rent/dto/tenant-reads.dto.ts
import { z } from "zod";
import type {
  PgRentEvent,
  PgRentIdentityDisputeInput,
  PgRentInvoice,
  PgRentPayInstruction,
  PgRentTenantInvoice
} from "@cribliv/shared-types";

export const IdentityDisputeSchema = z.object({
  assignment_id: z.string().uuid()
}) satisfies z.ZodType<PgRentIdentityDisputeInput, PgRentIdentityDisputeInput>;

/** Spec §9: the tenant sees the invoice the owner sees, minus owner-only fields. */
export function toTenantInvoiceDto(
  dto: PgRentInvoice,
  extras: {
    pay_link: string | null;
    instruction: PgRentPayInstruction | null;
    changes: PgRentEvent[];
  }
): PgRentTenantInvoice {
  const {
    internal_note: _i,
    rent_snapshot_inr: _r,
    rent_source: _s,
    suggested_late_fee_inr: _f,
    reprorate_suggestion: _p,
    ...rest
  } = dto;
  return {
    ...rest,
    pay_link: extras.pay_link,
    instruction: extras.instruction,
    changes: extras.changes
  };
}

/** Spec §4.10 tenant-visible subset. */
export const TENANT_VISIBLE_EVENT_SQL = `
  e.event_type IN ('invoice.issued','invoice.confirmed_amount','invoice.line_added','invoice.line_updated','invoice.line_removed','invoice.due_extended','invoice.cancelled','invoice.reprorated','invoice.excess_deallocated',
                   'late_fee.applied','late_fee.updated','late_fee.removed','late_fee.waived')
  AND NOT (e.event_type = 'invoice.line_updated' AND e.payload ? 'internal_note')`;
```

- [ ] **Step 3b: Read-only settlement statement**

In `apps/api/src/modules/pg-rent/services/rent-settlement.service.ts`, add this method directly after `statement(` (between its closing `}` and `private async compute(`). No import changes (`PgRentSettlementStatement` and `requireDb` are already imported):

```ts
  /**
   * Slice 1c tenant reads: the same statement without generating first and without an
   * ownership check (the caller already scoped the assignment to the tenant). A tenant GET
   * must not write, and must not log engine events as the operator; the owner-side
   * statement() above keeps generating so the final cut period exists before Settle.
   */
  async computeStatement(
    propertyId: string,
    assignmentId: string
  ): Promise<PgRentSettlementStatement> {
    requireDb(this.db);
    return this.compute(this.db, propertyId, assignmentId);
  }
```

None of this task's tests needs a generated cut period (no residence in them is leaving), so nothing depends on `statement()`'s generation side effect.

- [ ] **Step 4: Tenant service**

```ts
// apps/api/src/modules/pg-rent/services/rent-tenant.service.ts
import { ForbiddenException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import type {
  PgRentBankDetails,
  PgRentHeroState,
  PgRentSettlementStatement,
  PgRentTenantHero,
  PgRentTenantHistory,
  PgRentTenantInvoice,
  PgRentTenantResidence,
  PgRentTenantSummary
} from "@cribliv/shared-types";

import { DatabaseService } from "../../../common/database.service";
import { todayIst } from "../../../common/date";
import { transaction } from "../../../common/transaction";
import {
  INVOICE_SELECT,
  LINE_SELECT,
  toEventDto,
  toInvoiceDto,
  type RentEventRow,
  type RentInvoiceRow,
  type RentLineRow
} from "../dto/invoice.dto";
import { paiseToInr } from "../dto/money";
import {
  PAYMENT_SELECT,
  ALLOCATION_SELECT,
  toPaymentDto,
  type RentAllocationRow,
  type RentPaymentRow
} from "../dto/payment.dto";
import { RECEIPT_SELECT, toReceiptDto, type RentReceiptRow } from "../dto/receipt.dto";
import { TENANT_VISIBLE_EVENT_SQL, toTenantInvoiceDto } from "../dto/tenant-reads.dto";
import { addDays, dayOf } from "../pure/rent-dates";
import { naturalDueDate, nextPeriod, type DueSpec, type PeriodSpec } from "../pure/rent-period";
import { reminderState } from "../pure/rent-reminder-state";
import { buildWaMeLink } from "../pure/rent-upi";
import { RentAllocationService } from "./rent-allocation.service";
import { writeRentEvent } from "./rent-events";
import { assertManagedOwnership, requireDb, resolveTenantAssignmentIds } from "./rent-guards";
import { RentPayInstructionService } from "./rent-pay-instruction.service";
import { RentSettlementService } from "./rent-settlement.service";

const LEAVING = [
  "notice_served",
  "move_out_requested",
  "move_out_pending_confirmation",
  "moved_out"
];

@Injectable()
export class RentTenantService {
  constructor(
    @Inject(DatabaseService) private readonly db: DatabaseService,
    @Inject(RentAllocationService) private readonly alloc: RentAllocationService,
    @Inject(RentPayInstructionService) private readonly pay: RentPayInstructionService,
    @Inject(RentSettlementService) private readonly settlement: RentSettlementService
  ) {}

  async summary(userId: string, today = todayIst()): Promise<PgRentTenantSummary> {
    requireDb(this.db);
    const ids = await resolveTenantAssignmentIds(this.db, userId);
    if (ids.length === 0) return { residences: [] };
    const rows = await this.db.query<{
      id: string;
      pg_property_id: string;
      property_name: string;
      room_number: string;
      bed_label: string;
      status: string;
      enabled: boolean;
      upi_payee_name: string | null;
      upi_vpa: string | null;
      bank_details: PgRentBankDetails | null;
      whatsapp_phone_e164: string | null;
      operator_phone: string;
      locale: string;
      invoice_lead_days: number | null;
      disputed: boolean;
    }>(
      `SELECT a.id::text, a.pg_property_id::text, p.display_name AS property_name, r.room_number, b.bed_label, a.status::text,
              (s.pg_property_id IS NOT NULL) AS enabled, s.upi_payee_name, s.upi_vpa, s.bank_details, s.whatsapp_phone_e164, op.phone_e164 AS operator_phone,
              COALESCE(op.preferred_language,'en') AS locale, s.invoice_lead_days,
              COALESCE((SELECT e.payload->>'flag' FROM pg_rent_events e WHERE e.entity_type = 'assignment' AND e.entity_id = a.id AND e.payload->>'flag' IN ('identity_disputed','identity_dispute_cleared') ORDER BY e.id DESC LIMIT 1) = 'identity_disputed', false) AS disputed
         FROM pg_bed_assignments a JOIN pg_beds b ON b.id = a.bed_id JOIN pg_rooms r ON r.id = b.room_id JOIN pg_properties p ON p.id = a.pg_property_id JOIN users op ON op.id = p.operator_id
         LEFT JOIN pg_rent_settings s ON s.pg_property_id = a.pg_property_id
        WHERE a.id = ANY($1::uuid[])
        ORDER BY CASE a.status::text WHEN 'active' THEN 1 WHEN 'notice_served' THEN 2 WHEN 'move_out_requested' THEN 3 WHEN 'move_out_pending_confirmation' THEN 4 WHEN 'reserved' THEN 5 WHEN 'moved_out' THEN 6 ELSE 7 END, a.updated_at DESC`,
      [ids]
    );
    const residences: PgRentTenantResidence[] = [];
    for (const x of rows.rows) {
      const ownerPhone = x.whatsapp_phone_e164 ?? x.operator_phone;
      const base = {
        assignment_id: x.id,
        property_id: x.pg_property_id,
        property_name: x.property_name,
        room_number: x.room_number,
        bed_label: x.bed_label,
        assignment_status: x.status,
        identity_disputed: x.disputed,
        owner_wa_digits: ownerPhone ? ownerPhone.replace(/\D/g, "") : null
      };
      if (!x.enabled) {
        residences.push({
          ...base,
          enabled: false,
          payee: null,
          hero: this.emptyHero("not_enabled"),
          deposit: null
        });
        continue;
      }
      residences.push({
        ...base,
        enabled: true,
        payee: { name: x.upi_payee_name, vpa: x.upi_vpa, bank: x.bank_details },
        hero: await this.hero(
          x.id,
          x.pg_property_id,
          x.status,
          x.locale === "hi" ? "hi" : "en",
          today,
          x.invoice_lead_days ?? 5,
          x
        ),
        deposit: await this.deposit(x.id)
      });
    }
    return { residences };
  }

  private emptyHero(state: PgRentHeroState): PgRentTenantHero {
    return {
      state,
      invoice: null,
      more_open_count: 0,
      more_open_inr: 0,
      pending_claim: null,
      credit_inr: 0,
      last_receipt: null,
      next_invoice_expected_on: null,
      settlement: null
    };
  }

  private async hero(
    assignmentId: string,
    propertyId: string,
    status: string,
    locale: "en" | "hi",
    today: string,
    leadDays: number,
    settingsRow: {
      upi_vpa: string | null;
      upi_payee_name: string | null;
      bank_details: PgRentBankDetails | null;
    }
  ): Promise<PgRentTenantHero> {
    const credit = paiseToInr(await this.alloc.unallocatedCredit(this.db, assignmentId));
    const pending = await this.db.query<RentPaymentRow>(
      `SELECT ${PAYMENT_SELECT} FROM pg_rent_payments p JOIN pg_bed_assignments a ON a.id = p.assignment_id WHERE p.assignment_id = $1::uuid AND p.status = 'pending_confirmation' ORDER BY p.created_at DESC LIMIT 1`,
      [assignmentId]
    );
    const open = await this.db.query<RentInvoiceRow>(
      `SELECT ${INVOICE_SELECT} FROM pg_rent_invoices i JOIN pg_bed_assignments a ON a.id = i.assignment_id WHERE i.assignment_id = $1::uuid AND i.status IN ('issued','partially_paid') ORDER BY i.due_date, i.created_at`,
      [assignmentId]
    );
    const openDtos = await this.withLines(open.rows);
    const first = openDtos[0] ?? null;
    const rest = openDtos.slice(1);
    // Read-only statement: a tenant GET never generates invoices or writes events.
    const settlement: PgRentSettlementStatement | null = LEAVING.includes(status)
      ? await this.settlement.computeStatement(propertyId, assignmentId)
      : null;
    let state: PgRentHeroState;
    if (settlement && settlement.status === "settled") state = "settled";
    else if (settlement && settlement.status === "leaving") state = "leaving";
    else if (pending.rows[0]) state = "awaiting";
    else if (first) {
      const st = reminderState({
        dueDate: first.due_date,
        today,
        offsets: [-3, 0, 1],
        graceDays: 0
      });
      state =
        first.status === "partially_paid"
          ? "partially_paid"
          : st.state === "overdue"
            ? "overdue"
            : "due";
    } else {
      const last = await this.db.query<{ id: string }>(
        `SELECT id::text FROM pg_rent_invoices WHERE assignment_id = $1::uuid AND status = 'paid' ORDER BY due_date DESC LIMIT 1`,
        [assignmentId]
      );
      state = last.rows[0] ? "paid" : "nothing_due";
    }
    const invoice = first ?? (state === "paid" ? await this.lastPaid(assignmentId) : null);
    const lastReceipt = await this.db.query<RentReceiptRow>(
      `SELECT ${RECEIPT_SELECT} FROM pg_rent_receipts r WHERE r.assignment_id = $1::uuid AND r.voided_at IS NULL ORDER BY r.created_at DESC LIMIT 1`,
      [assignmentId]
    );
    // Spec §9: the next invoice appears on the next period's due date minus the lead days
    // (the engine's own specFor rule: tenant rent_due_day overrides, anchor = move-in day).
    const next = await this.db.query<{
      last_end: string | null;
      cycle_mode: "calendar_month" | "anniversary";
      billing_timing: "advance" | "arrears";
      due_day: number;
      rent_due_day: number | null;
      move_in_date: string | null;
    }>(
      `SELECT (SELECT to_char(MAX(i.period_end), 'YYYY-MM-DD') FROM pg_rent_invoices i
                WHERE i.assignment_id = a.id AND i.kind = 'rent' AND i.status <> 'cancelled') AS last_end,
              s.cycle_mode::text AS cycle_mode, s.billing_timing::text AS billing_timing, s.due_day,
              a.rent_due_day, to_char(a.move_in_date, 'YYYY-MM-DD') AS move_in_date
         FROM pg_bed_assignments a JOIN pg_rent_settings s ON s.pg_property_id = a.pg_property_id
        WHERE a.id = $1::uuid`,
      [assignmentId]
    );
    const n = next.rows[0];
    let nextExpected: string | null = null;
    if (n?.last_end && (state === "paid" || state === "nothing_due")) {
      const spec: PeriodSpec = {
        cycleMode: n.cycle_mode,
        anchorDay: n.rent_due_day ?? (n.move_in_date ? dayOf(n.move_in_date) : 1)
      };
      const due: DueSpec = { timing: n.billing_timing, dueDay: n.rent_due_day ?? n.due_day };
      nextExpected = addDays(naturalDueDate(nextPeriod(n.last_end, spec), spec, due), -leadDays);
    }
    return {
      state,
      invoice: invoice ? await this.decorate(invoice, locale, settingsRow) : null,
      more_open_count: rest.length,
      more_open_inr: rest.reduce((s, i) => s + i.balance_inr, 0),
      pending_claim: pending.rows[0] ? (await this.paymentsDto(pending.rows))[0] : null,
      credit_inr: credit,
      last_receipt: lastReceipt.rows[0] ? toReceiptDto(lastReceipt.rows[0]) : null,
      next_invoice_expected_on: nextExpected,
      settlement
    };
  }

  private async lastPaid(assignmentId: string) {
    const r = await this.db.query<RentInvoiceRow>(
      `SELECT ${INVOICE_SELECT} FROM pg_rent_invoices i JOIN pg_bed_assignments a ON a.id = i.assignment_id WHERE i.assignment_id = $1::uuid AND i.status = 'paid' ORDER BY i.due_date DESC LIMIT 1`,
      [assignmentId]
    );
    return (await this.withLines(r.rows))[0] ?? null;
  }

  private async withLines(rows: RentInvoiceRow[]) {
    if (!rows.length) return [];
    const lines = await this.db.query<RentLineRow>(
      `SELECT ${LINE_SELECT} FROM pg_rent_invoice_lines l WHERE l.invoice_id = ANY($1::uuid[])`,
      [rows.map((r) => r.id)]
    );
    return rows.map((r) => toInvoiceDto(r, lines.rows));
  }

  private async paymentsDto(rows: RentPaymentRow[]) {
    if (!rows.length) return [];
    const allocs = await this.db.query<RentAllocationRow>(
      `SELECT ${ALLOCATION_SELECT} FROM pg_rent_payment_allocations al LEFT JOIN pg_rent_invoices i ON i.id = al.invoice_id WHERE al.payment_id = ANY($1::uuid[]) ORDER BY al.created_at, al.seq`,
      [rows.map((r) => r.id)]
    );
    return rows.map((r) => toPaymentDto(r, allocs.rows));
  }

  /** Attach pay link + instruction + tenant-visible change log. */
  private async decorate(
    dto: ReturnType<typeof toInvoiceDto>,
    locale: "en" | "hi",
    settingsRow: {
      upi_vpa: string | null;
      upi_payee_name: string | null;
      bank_details: PgRentBankDetails | null;
    }
  ): Promise<PgRentTenantInvoice> {
    const token = await this.db.query<{ t: string | null; live: boolean }>(
      `SELECT pay_token AS t, (pay_token_expires_at > now()) AS live FROM pg_rent_invoices WHERE id = $1::uuid`,
      [dto.id]
    );
    const payable = dto.status === "issued" || dto.status === "partially_paid";
    const link =
      payable && token.rows[0]?.t && token.rows[0].live
        ? this.pay.payLinkFor(locale, token.rows[0].t)
        : null;
    const instruction = payable
      ? await this.pay.buildPayInstruction({
          settings: settingsRow,
          amountInr: dto.balance_inr,
          note: `${dto.period_start ? dto.invoice_number : dto.kind} Room ${dto.room_number}`,
          tr: dto.invoice_number
        })
      : null;
    const ev = await this.db.query<RentEventRow>(
      `SELECT e.id::text, e.entity_type, e.entity_id::text, e.event_type, e.actor_user_id::text, e.actor_role, e.payload, e.created_at
         FROM pg_rent_events e JOIN pg_rent_invoices i ON i.id = e.entity_id
        WHERE e.entity_type = 'invoice' AND e.entity_id = $1::uuid AND i.issued_at IS NOT NULL AND e.created_at >= i.issued_at AND ${TENANT_VISIBLE_EVENT_SQL} ORDER BY e.id`,
      [dto.id]
    );
    return toTenantInvoiceDto(dto, {
      pay_link: link,
      instruction,
      // owner-only keys never reach the tenant, even inside an event payload (spec §9)
      changes: ev.rows.map(toEventDto).map((e) => {
        const { rent_source: _rentSource, ...payload } = e.payload;
        return { ...e, payload };
      })
    });
  }

  private async deposit(assignmentId: string) {
    const r = await this.db.query<{ paid: string; total: string; paid_on: string | null }>(
      `SELECT COALESCE(SUM(i.amount_paid_paise),0)::text AS paid, COALESCE(SUM(i.total_paise),0)::text AS total, to_char(MAX(i.settled_on),'YYYY-MM-DD') AS paid_on
         FROM pg_rent_invoices i WHERE i.assignment_id = $1::uuid AND i.kind = 'deposit' AND i.status <> 'cancelled'`,
      [assignmentId]
    );
    const released = await this.db.query<{ v: string }>(
      `SELECT COALESCE(SUM(amount_paise),0)::text AS v FROM pg_rent_payments WHERE assignment_id = $1::uuid AND source = 'deposit_release' AND status = 'confirmed'`,
      [assignmentId]
    );
    if (Number(r.rows[0].total) === 0) return null;
    return {
      held_inr: paiseToInr(Number(r.rows[0].paid) - Number(released.rows[0].v)),
      paid_on: r.rows[0].paid_on,
      uncollected_inr: paiseToInr(Number(r.rows[0].total) - Number(r.rows[0].paid))
    };
  }

  async history(userId: string, assignmentId: string): Promise<PgRentTenantHistory> {
    requireDb(this.db);
    const mine = await resolveTenantAssignmentIds(this.db, userId);
    if (!mine.includes(assignmentId)) throw new ForbiddenException({ code: "forbidden" });
    const ctx = await this.db.query<{
      locale: string;
      upi_vpa: string | null;
      upi_payee_name: string | null;
      bank_details: PgRentBankDetails | null;
    }>(
      `SELECT COALESCE(op.preferred_language,'en') AS locale, s.upi_vpa, s.upi_payee_name, s.bank_details FROM pg_bed_assignments a JOIN pg_properties p ON p.id = a.pg_property_id JOIN users op ON op.id = p.operator_id LEFT JOIN pg_rent_settings s ON s.pg_property_id = p.id WHERE a.id = $1::uuid`,
      [assignmentId]
    );
    const locale = ctx.rows[0]?.locale === "hi" ? "hi" : "en";
    const inv = await this.db.query<RentInvoiceRow>(
      `SELECT ${INVOICE_SELECT} FROM pg_rent_invoices i JOIN pg_bed_assignments a ON a.id = i.assignment_id WHERE i.assignment_id = $1::uuid AND i.status <> 'draft' ORDER BY i.due_date DESC`,
      [assignmentId]
    );
    const invoices: PgRentTenantInvoice[] = [];
    for (const dto of await this.withLines(inv.rows))
      invoices.push(await this.decorate(dto, locale, ctx.rows[0]));
    const pays = await this.db.query<RentPaymentRow>(
      `SELECT ${PAYMENT_SELECT} FROM pg_rent_payments p JOIN pg_bed_assignments a ON a.id = p.assignment_id WHERE p.assignment_id = $1::uuid ORDER BY p.paid_on DESC, p.created_at DESC`,
      [assignmentId]
    );
    const rec = await this.db.query<RentReceiptRow>(
      `SELECT ${RECEIPT_SELECT} FROM pg_rent_receipts r WHERE r.assignment_id = $1::uuid ORDER BY r.created_at DESC`,
      [assignmentId]
    );
    return {
      assignment_id: assignmentId,
      invoices,
      payments: await this.paymentsDto(pays.rows),
      receipts: rec.rows.map(toReceiptDto)
    };
  }

  async invoice(userId: string, invoiceId: string): Promise<PgRentTenantInvoice> {
    requireDb(this.db);
    const mine = await resolveTenantAssignmentIds(this.db, userId);
    const r = await this.db.query<
      RentInvoiceRow & {
        locale: string;
        upi_vpa: string | null;
        upi_payee_name: string | null;
        bank_details: PgRentBankDetails | null;
      }
    >(
      `SELECT ${INVOICE_SELECT}, COALESCE(op.preferred_language,'en') AS locale, s.upi_vpa, s.upi_payee_name, s.bank_details
         FROM pg_rent_invoices i JOIN pg_bed_assignments a ON a.id = i.assignment_id JOIN pg_properties p ON p.id = i.pg_property_id JOIN users op ON op.id = p.operator_id LEFT JOIN pg_rent_settings s ON s.pg_property_id = p.id
        WHERE i.id = $1::uuid AND i.assignment_id = ANY($2::uuid[]) AND i.status <> 'draft'`,
      [invoiceId, mine]
    );
    if (!r.rows[0]) throw new NotFoundException({ code: "invoice_not_found" });
    const dto = (await this.withLines([r.rows[0]]))[0];
    return this.decorate(dto, r.rows[0].locale === "hi" ? "hi" : "en", r.rows[0]);
  }

  /** Spec §7.9. Fixed system text; logs the flag; never blocks anything. */
  async identityDispute(
    userId: string,
    assignmentId: string
  ): Promise<{ wa_me_url: string | null }> {
    requireDb(this.db);
    const mine = await resolveTenantAssignmentIds(this.db, userId);
    if (!mine.includes(assignmentId)) throw new ForbiddenException({ code: "forbidden" });
    const r = await this.db.query<{
      pg_property_id: string;
      property_name: string;
      room_number: string;
      bed_label: string;
      owner_phone: string;
      locale: string;
    }>(
      `SELECT a.pg_property_id::text, p.display_name AS property_name, r.room_number, b.bed_label, COALESCE(s.whatsapp_phone_e164, op.phone_e164) AS owner_phone, COALESCE(op.preferred_language,'en') AS locale
         FROM pg_bed_assignments a JOIN pg_beds b ON b.id = a.bed_id JOIN pg_rooms r ON r.id = b.room_id JOIN pg_properties p ON p.id = a.pg_property_id JOIN users op ON op.id = p.operator_id LEFT JOIN pg_rent_settings s ON s.pg_property_id = p.id
        WHERE a.id = $1::uuid`,
      [assignmentId]
    );
    const x = r.rows[0];
    await transaction(this.db, (client) =>
      writeRentEvent(client, {
        propertyId: x.pg_property_id,
        entityType: "assignment",
        entityId: assignmentId,
        eventType: "assignment.override_updated",
        actor: { id: userId, role: "tenant" },
        payload: { flag: "identity_disputed" }
      })
    );
    const text =
      x.locale === "hi"
        ? `नमस्ते, Cribliv पर ${x.property_name} (कमरा ${x.room_number}, बेड ${x.bed_label}) मेरे नंबर से जुड़ा दिख रहा है, लेकिन मैं वहाँ नहीं रहता/रहती। कृपया जाँच लें।`
        : `Hi, Cribliv shows ${x.property_name} (Room ${x.room_number}, Bed ${x.bed_label}) linked to my number, but I don't live there. Please check.`;
    return { wa_me_url: x.owner_phone ? buildWaMeLink(x.owner_phone, text) : null };
  }

  async resolveDispute(
    operatorId: string,
    propertyId: string,
    assignmentId: string
  ): Promise<void> {
    requireDb(this.db);
    await transaction(this.db, async (client) => {
      await assertManagedOwnership(client, operatorId, propertyId, true);
      const a = await client.query(
        `SELECT 1 FROM pg_bed_assignments WHERE id = $1::uuid AND pg_property_id = $2::uuid`,
        [assignmentId, propertyId]
      );
      if (!a.rowCount) throw new NotFoundException({ code: "assignment_not_found" });
      await writeRentEvent(client, {
        propertyId,
        entityType: "assignment",
        entityId: assignmentId,
        eventType: "assignment.override_updated",
        actor: { id: operatorId, role: "pg_operator" },
        payload: { flag: "identity_dispute_cleared" }
      });
    });
  }
}
```

The hero uses the property's reminder offsets only for `due_soon`, which the hero does not distinguish (spec §9 hero states have no "due soon"), so a fixed `[-3,0,1]` is fine there; the queue uses the real settings. In `pg-rent.module.ts` add `import { RentTenantService } from "./services/rent-tenant.service";` below the Task 4 import and `RentTenantService,` to `providers` after `RentQueueService,`.

- [ ] **Step 5: Run to verify it passes**

Run: `pnpm --filter @cribliv/api exec vitest run src/modules/pg-rent/__tests__/rent-tenant.integration.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/pg-rent/dto/tenant-reads.dto.ts apps/api/src/modules/pg-rent/services/rent-tenant.service.ts apps/api/src/modules/pg-rent/services/rent-settlement.service.ts apps/api/src/modules/pg-rent/pg-rent.module.ts apps/api/src/modules/pg-rent/__tests__/rent-tenant.integration.test.ts
git commit -m "feat(pg-rent): tenant summary across residences, history, invoice view, identity dispute"
```

---

### Task 6: Controllers — queue/messages/summary/portfolio, tenant reads, public pay + receipt share

**Files:**

- Create: `apps/api/src/modules/pg-rent/controllers/pg-rent-queue.controller.ts`
- Create: `apps/api/src/modules/pg-rent/controllers/pg-rent-portfolio.controller.ts`
- Create: `apps/api/src/modules/pg-rent/controllers/pg-rent-tenant.controller.ts`
- Create: `apps/api/src/modules/pg-rent/controllers/pg-rent-public.controller.ts`
- Modify: `apps/api/src/modules/pg-rent/pg-rent.module.ts`
- Test: `apps/api/src/modules/pg-rent/__tests__/pg-rent-read-controllers.integration.test.ts`

**Routes:**

| Route                                                        | Guard                                               | Handler                                                                           |
| ------------------------------------------------------------ | --------------------------------------------------- | --------------------------------------------------------------------------------- |
| `GET /pg-operator/properties/:propertyId/rent/queue`         | operator                                            | `queue.queue(user.id, propertyId)`                                                |
| `GET …/rent/summary?month=YYYY-MM-01`                        | operator                                            | `queue.monthSummary` (default: current IST month)                                 |
| `GET …/rent/invoices/:id/messages`                           | operator                                            | `messages.messagesForInvoice`                                                     |
| `POST …/rent/messages/preview`                               | operator                                            | `messages.preview` (body `{ key, text, invoice_id? }`, zod: key enum, text ≤ 600) |
| `POST …/rent/invoices/:id/reminder-opened`                   | operator                                            | body `{ stage, channel }` (zod enums) → `messages.reminderOpened`                 |
| `POST …/rent/invoices/:id/pay-token`                         | operator                                            | `messages.regeneratePayToken`                                                     |
| `POST …/rent/tenants/:assignmentId/identity-dispute/resolve` | operator                                            | `tenants.resolveDispute`                                                          |
| `GET /pg-operator/rent/portfolio`                            | operator                                            | `queue.portfolio(user.id)`                                                        |
| `GET /tenant/pg-rent/summary`                                | tenant                                              | `tenants.summary(user.id)`                                                        |
| `GET /tenant/pg-rent/history?assignment=`                    | tenant                                              | `tenants.history` (assignment uuid required)                                      |
| `GET /tenant/pg-rent/invoices/:id`                           | tenant                                              | `tenants.invoice`                                                                 |
| `POST /tenant/pg-rent/identity-dispute`                      | tenant                                              | `IdentityDisputeSchema` → `tenants.identityDispute`                               |
| `POST /tenant/pg-rent/claims/:id/notify-message`             | tenant                                              | `messages.tenantPaidMessage`                                                      |
| `GET /public/pg-rent/pay/:token`                             | none, `@Throttle 30/min`, `Cache-Control: no-store` | `pay.publicPayPage`                                                               |
| `GET /public/pg-rent/receipts/:shareToken`                   | none, `@Throttle 30/min`                            | `receipts.resolveShareToken` → **302** to the SAS URL                             |

Every operator/tenant handler calls `assertRentFlag()` first; public handlers too (flag off → 404 `feature_disabled`, which the web pay page renders as "temporarily unavailable", spec §7.7).

- [ ] **Step 1: Write the failing tests**

The whole file (bootstrap like 1b's `pg-rent-money-controllers` test: guard override with `operator`, `other`, `tenant` identities, `FF_PG_RENT_COLLECTION=true`). The tenant is created with the fixture's per-run phone (never a fixed one — `+917700000055` belongs to another suite, and a phone shared across parallel suites leaks their assignments into this tenant's summary). `PG_RENT_RECEIPT_RENDERER` is overridden so no Chromium is needed; storage/SAS fall back to in-memory/dev automatically when Azure env is absent. The tenant regexes include the owner-only keys so a payload leak fails here too.

```ts
// apps/api/src/modules/pg-rent/__tests__/pg-rent-read-controllers.integration.test.ts
import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";

import { AppModule } from "../../../app.module";
import { AuthGuard } from "../../../common/auth.guard";
import { DatabaseService } from "../../../common/database.service";
import type { Role } from "../../../common/types";
import { PG_RENT_RECEIPT_RENDERER } from "../services/rent-receipt.service";
import { assertRentInvariants } from "./helpers/assert-rent-invariants";
import { RentFixtures } from "./helpers/rent-fixtures";

const HAS_DB = Boolean(process.env.DATABASE_URL);

describe.skipIf(!HAS_DB)("pg-rent read controllers", () => {
  let app: INestApplication;
  let db: DatabaseService;
  let fx: RentFixtures;
  let operatorId: string;
  let tenantUserId: string;
  let propertyId: string;
  let assignmentId: string;
  const prevFlag = process.env.FF_PG_RENT_COLLECTION;
  const as = (identity: string) => ({ "x-test-identity": identity });

  beforeAll(async () => {
    process.env.FF_PG_RENT_COLLECTION = "true";
    db = new DatabaseService();
    fx = new RentFixtures(db, randomUUID().replace(/-/g, ""));
    await fx.setup();
    operatorId = await fx.createUser("pg_operator");
    tenantUserId = await fx.createUser("tenant");
    const phone = (
      await db.query<{ p: string }>(`SELECT phone_e164 AS p FROM users WHERE id = $1::uuid`, [
        tenantUserId
      ])
    ).rows[0].p;
    propertyId = await fx.createProperty(operatorId, { internalCode: "RDC" });
    const listingId = await fx.createListingWithDetails(propertyId, operatorId);
    const roomTypeId = await fx.createRoomType(listingId, { rentPaise: 900000 });
    const roomId = await fx.createRoom(propertyId, { roomTypeId, roomNumber: "101" });
    const bedId = await fx.createBed(roomId, "A");
    assignmentId = await fx.createAssignment(propertyId, bedId, {
      createdBy: operatorId,
      moveIn: "2026-09-01",
      occupantPhone: phone,
      occupantName: "Rahul Verma"
    });
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideGuard(AuthGuard)
      .useValue({
        canActivate: (ctx: {
          switchToHttp: () => {
            getRequest: () => { headers: Record<string, string | undefined>; user?: unknown };
          };
        }) => {
          const req = ctx.switchToHttp().getRequest();
          const identities: Record<string, { id: string; role: Role }> = {
            operator: { id: operatorId, role: "pg_operator" },
            tenant: { id: tenantUserId, role: "tenant" },
            other: { id: randomUUID(), role: "pg_operator" }
          };
          const identity = identities[req.headers["x-test-identity"] ?? ""];
          if (!identity) return false;
          req.user = identity;
          return true;
        }
      })
      .overrideProvider(PG_RENT_RECEIPT_RENDERER)
      .useValue({ render: async () => Buffer.from("%PDF") })
      .compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix("v1");
    await app.init();
    await request(app.getHttpServer())
      .post(`/v1/pg-operator/properties/${propertyId}/rent/enable`)
      .set(as("operator"))
      .send({ billing_starts_on: "2026-09-01", upi_vpa: "sun@okaxis", upi_payee_name: "Sun" });
    await request(app.getHttpServer())
      .post(`/v1/pg-operator/properties/${propertyId}/rent/generate-now`)
      .set(as("operator"))
      .send({});
  }, 30_000);

  afterAll(async () => {
    if (prevFlag === undefined) delete process.env.FF_PG_RENT_COLLECTION;
    else process.env.FF_PG_RENT_COLLECTION = prevFlag;
    if (app) await app.close();
    for (const id of fx.propertyIds) await assertRentInvariants(db, id);
    await fx.teardown();
    await db.onModuleDestroy();
  });

  const base = () => `/v1/pg-operator/properties/${propertyId}/rent`;

  it("operator reads: queue, summary, messages, preview, reminder-opened, pay-token, portfolio", async () => {
    const q = await request(app.getHttpServer()).get(`${base()}/queue`).set(as("operator"));
    expect(q.status).toBe(200);
    expect(q.body.data).toHaveProperty("overdue");
    expect(q.body.data).toHaveProperty("needs_attention");
    const s = await request(app.getHttpServer())
      .get(`${base()}/summary?month=2026-09-01`)
      .set(as("operator"));
    expect(s.status).toBe(200);
    expect(s.body.data.month).toBe("2026-09-01");
    const inv = (
      await request(app.getHttpServer()).get(`${base()}/invoices?kind=rent`).set(as("operator"))
    ).body.data[0];
    const m = await request(app.getHttpServer())
      .get(`${base()}/invoices/${inv.id}/messages`)
      .set(as("operator"));
    expect(m.status).toBe(200);
    expect(m.body.data.reminder.wa_me_url).toMatch(/^https:\/\/wa\.me\//);
    expect(JSON.stringify(m.body)).toMatch(/\/pay\//); // the one place the token may appear
    const pv = await request(app.getHttpServer())
      .post(`${base()}/messages/preview`)
      .set(as("operator"))
      .send({ key: "reminder", text: "{tenant_name} {nope}", invoice_id: inv.id });
    expect(pv.body.data.unknown_fields).toEqual(["nope"]);
    expect(
      (
        await request(app.getHttpServer())
          .post(`${base()}/messages/preview`)
          .set(as("operator"))
          .send({ key: "reminder", text: "x".repeat(601) })
      ).status
    ).toBe(400);
    expect(
      (
        await request(app.getHttpServer())
          .post(`${base()}/invoices/${inv.id}/reminder-opened`)
          .set(as("operator"))
          .send({ stage: "overdue", channel: "whatsapp" })
      ).status
    ).toBe(201);
    expect(
      (
        await request(app.getHttpServer())
          .post(`${base()}/invoices/${inv.id}/reminder-opened`)
          .set(as("operator"))
          .send({ stage: "later", channel: "fax" })
      ).status
    ).toBe(400);
    const tok = await request(app.getHttpServer())
      .post(`${base()}/invoices/${inv.id}/pay-token`)
      .set(as("operator"));
    expect(tok.body.data.pay_link).toMatch(/\/pay\//);
    const pf = await request(app.getHttpServer())
      .get(`/v1/pg-operator/rent/portfolio`)
      .set(as("operator"));
    expect(pf.status).toBe(200);
    expect(pf.body.data.some((r: { property_id: string }) => r.property_id === propertyId)).toBe(
      true
    );
    expect(
      (await request(app.getHttpServer()).get(`${base()}/queue`).set(as("other"))).status
    ).toBe(403);
  });

  it("tenant reads: summary, history, invoice, dispute; tenant cannot read operator routes", async () => {
    const s = await request(app.getHttpServer())
      .get(`/v1/tenant/pg-rent/summary`)
      .set(as("tenant"));
    expect(s.status).toBe(200);
    expect(s.body.data.residences).toHaveLength(1);
    const res = s.body.data.residences[0];
    expect(JSON.stringify(s.body)).not.toMatch(
      /internal_note|_paise|share_token"|rent_source|rent_snapshot|suggested_late_fee|reprorate_suggestion/
    );
    const h = await request(app.getHttpServer())
      .get(`/v1/tenant/pg-rent/history?assignment=${res.assignment_id}`)
      .set(as("tenant"));
    expect(h.status).toBe(200);
    expect(h.body.data.invoices.length).toBeGreaterThan(0);
    expect(JSON.stringify(h.body)).not.toMatch(
      /internal_note|_paise|share_token"|rent_source|rent_snapshot|suggested_late_fee|reprorate_suggestion/
    );
    expect(
      (await request(app.getHttpServer()).get(`/v1/tenant/pg-rent/history`).set(as("tenant")))
        .status
    ).toBe(400);
    const one = await request(app.getHttpServer())
      .get(`/v1/tenant/pg-rent/invoices/${h.body.data.invoices[0].id}`)
      .set(as("tenant"));
    expect(one.status).toBe(200);
    expect(one.body.data).toHaveProperty("changes");
    expect(
      (
        await request(app.getHttpServer())
          .post(`/v1/tenant/pg-rent/identity-dispute`)
          .set(as("tenant"))
          .send({ assignment_id: res.assignment_id })
      ).status
    ).toBe(201);
    expect(
      (
        await request(app.getHttpServer())
          .post(`${base()}/tenants/${res.assignment_id}/identity-dispute/resolve`)
          .set(as("operator"))
      ).status
    ).toBe(201);
    expect(
      (await request(app.getHttpServer()).get(`${base()}/queue`).set(as("tenant"))).status
    ).toBe(403);
  });

  it("public pay page and receipt share work without auth and hide everything but the minimum", async () => {
    const token = (
      await db.query<{ t: string }>(
        `SELECT pay_token AS t FROM pg_rent_invoices WHERE assignment_id = $1::uuid AND kind = 'rent' ORDER BY period_start LIMIT 1`,
        [assignmentId]
      )
    ).rows[0].t;
    const page = await request(app.getHttpServer()).get(`/v1/public/pg-rent/pay/${token}`);
    expect(page.status).toBe(200);
    expect(page.headers["cache-control"]).toContain("no-store");
    expect(page.body.data).toMatchObject({
      state: "payable",
      tenant_first_name: expect.any(String)
    });
    expect(JSON.stringify(page.body)).not.toMatch(/phone|occupant_phone|internal_note|_paise/);
    expect(
      (await request(app.getHttpServer()).get(`/v1/public/pg-rent/pay/not-a-token`)).status
    ).toBe(404);

    // receipt share: mint a receipt via a recorded payment, force it ready, then follow the redirect
    const paid = await request(app.getHttpServer())
      .post(`${base()}/payments`)
      .set(as("operator"))
      .set("idempotency-key", randomUUID())
      .send({
        assignment_id: assignmentId,
        amount_inr: 100,
        method: "cash",
        paid_on: "2026-09-02"
      });
    await db.query(
      `UPDATE pg_rent_receipts SET pdf_status = 'ready', pdf_path = 'x/y.pdf' WHERE id = $1::uuid`,
      [paid.body.data.receipt_id]
    );
    const share = (
      await db.query<{ t: string }>(
        `SELECT share_token AS t FROM pg_rent_receipts WHERE id = $1::uuid`,
        [paid.body.data.receipt_id]
      )
    ).rows[0].t;
    const rs = await request(app.getHttpServer()).get(`/v1/public/pg-rent/receipts/${share}`);
    expect(rs.status).toBe(302);
    expect(rs.headers.location).toBeTruthy();
    expect(
      (await request(app.getHttpServer()).get(`/v1/public/pg-rent/receipts/nope`)).status
    ).toBe(404);
  });

  it("everything 404s when the flag is off, including public routes", async () => {
    process.env.FF_PG_RENT_COLLECTION = "false";
    expect((await request(app.getHttpServer()).get(`/v1/public/pg-rent/pay/whatever`)).status).toBe(
      404
    );
    expect(
      (await request(app.getHttpServer()).get(`/v1/tenant/pg-rent/summary`).set(as("tenant")))
        .status
    ).toBe(404);
    process.env.FF_PG_RENT_COLLECTION = "true";
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @cribliv/api exec vitest run src/modules/pg-rent/__tests__/pg-rent-read-controllers.integration.test.ts`
Expected: FAIL — 404s.

- [ ] **Step 3: Implement**

```ts
// apps/api/src/modules/pg-rent/controllers/pg-rent-queue.controller.ts
import { Body, Controller, Get, Inject, Param, Post, Query, UseGuards } from "@nestjs/common";
import { z } from "zod";

import { AuthGuard } from "../../../common/auth.guard";
import { AuthUser } from "../../../common/auth-user.decorator";
import { isIsoDate, todayIst } from "../../../common/date";
import { ok } from "../../../common/response";
import { Roles } from "../../../common/roles.decorator";
import { RolesGuard } from "../../../common/roles.guard";
import type { UserContext } from "../../../common/types";
import { parseOrThrow } from "../dto/common";
import { firstOfMonth } from "../pure/rent-dates";
import { assertRentFlag } from "../services/rent-guards";
import { RentMessageService } from "../services/rent-message.service";
import { RentQueueService } from "../services/rent-queue.service";
import { RentTenantService } from "../services/rent-tenant.service";

@Controller("pg-operator/properties/:propertyId/rent")
@UseGuards(AuthGuard, RolesGuard)
@Roles("pg_operator")
export class PgRentQueueController {
  constructor(
    @Inject(RentQueueService) private readonly queue: RentQueueService,
    @Inject(RentMessageService) private readonly messages: RentMessageService,
    @Inject(RentTenantService) private readonly tenants: RentTenantService
  ) {}
  @Get("queue") async getQueue(
    @AuthUser() user: UserContext,
    @Param("propertyId") propertyId: string
  ) {
    assertRentFlag();
    return ok(await this.queue.queue(user.id, propertyId));
  }
  @Get("summary") async summary(
    @AuthUser() user: UserContext,
    @Param("propertyId") propertyId: string,
    @Query("month") month?: string
  ) {
    assertRentFlag();
    const m =
      parseOrThrow(z.object({ month: z.string().refine(isIsoDate).optional() }), { month }).month ??
      firstOfMonth(todayIst());
    return ok(await this.queue.monthSummary(user.id, propertyId, m));
  }
  @Get("invoices/:id/messages") async messagesFor(
    @AuthUser() user: UserContext,
    @Param("propertyId") propertyId: string,
    @Param("id") id: string
  ) {
    assertRentFlag();
    return ok(await this.messages.messagesForInvoice(user.id, propertyId, id));
  }
  @Post("messages/preview") async preview(
    @AuthUser() user: UserContext,
    @Param("propertyId") propertyId: string,
    @Body() body: unknown
  ) {
    assertRentFlag();
    const input = parseOrThrow(
      z.object({
        key: z.enum(["reminder", "overdue", "tenant_paid", "receipt_share"]),
        text: z.string().max(600),
        invoice_id: z.string().uuid().optional()
      }),
      body
    );
    return ok(await this.messages.preview(user.id, propertyId, input));
  }
  @Post("invoices/:id/reminder-opened") async reminderOpened(
    @AuthUser() user: UserContext,
    @Param("propertyId") propertyId: string,
    @Param("id") id: string,
    @Body() body: unknown
  ) {
    assertRentFlag();
    const input = parseOrThrow(
      z.object({
        stage: z.enum(["upcoming", "due_soon", "due_today", "overdue"]),
        channel: z.enum(["whatsapp", "call"])
      }),
      body
    );
    await this.messages.reminderOpened(user.id, propertyId, id, input);
    return ok({ ok: true });
  }
  @Post("invoices/:id/pay-token") async payToken(
    @AuthUser() user: UserContext,
    @Param("propertyId") propertyId: string,
    @Param("id") id: string
  ) {
    assertRentFlag();
    return ok(await this.messages.regeneratePayToken(user.id, propertyId, id));
  }
  @Post("tenants/:assignmentId/identity-dispute/resolve") async resolveDispute(
    @AuthUser() user: UserContext,
    @Param("propertyId") propertyId: string,
    @Param("assignmentId") assignmentId: string
  ) {
    assertRentFlag();
    await this.tenants.resolveDispute(user.id, propertyId, assignmentId);
    return ok({ ok: true });
  }
}
```

```ts
// apps/api/src/modules/pg-rent/controllers/pg-rent-portfolio.controller.ts
import { Controller, Get, Inject, UseGuards } from "@nestjs/common";

import { AuthGuard } from "../../../common/auth.guard";
import { AuthUser } from "../../../common/auth-user.decorator";
import { ok } from "../../../common/response";
import { Roles } from "../../../common/roles.decorator";
import { RolesGuard } from "../../../common/roles.guard";
import type { UserContext } from "../../../common/types";
import { assertRentFlag } from "../services/rent-guards";
import { RentQueueService } from "../services/rent-queue.service";

@Controller("pg-operator/rent")
@UseGuards(AuthGuard, RolesGuard)
@Roles("pg_operator")
export class PgRentPortfolioController {
  constructor(@Inject(RentQueueService) private readonly queue: RentQueueService) {}
  @Get("portfolio") async portfolio(@AuthUser() user: UserContext) {
    assertRentFlag();
    return ok(await this.queue.portfolio(user.id));
  }
}
```

```ts
// apps/api/src/modules/pg-rent/controllers/pg-rent-tenant.controller.ts
import { Body, Controller, Get, Inject, Param, Post, Query, UseGuards } from "@nestjs/common";
import { z } from "zod";

import { AuthGuard } from "../../../common/auth.guard";
import { AuthUser } from "../../../common/auth-user.decorator";
import { ok } from "../../../common/response";
import { Roles } from "../../../common/roles.decorator";
import { RolesGuard } from "../../../common/roles.guard";
import type { UserContext } from "../../../common/types";
import { parseOrThrow } from "../dto/common";
import { IdentityDisputeSchema } from "../dto/tenant-reads.dto";
import { assertRentFlag } from "../services/rent-guards";
import { RentMessageService } from "../services/rent-message.service";
import { RentTenantService } from "../services/rent-tenant.service";

@Controller("tenant/pg-rent")
@UseGuards(AuthGuard, RolesGuard)
@Roles("tenant")
export class PgRentTenantController {
  constructor(
    @Inject(RentTenantService) private readonly tenants: RentTenantService,
    @Inject(RentMessageService) private readonly messages: RentMessageService
  ) {}
  @Get("summary") async summary(@AuthUser() user: UserContext) {
    assertRentFlag();
    return ok(await this.tenants.summary(user.id));
  }
  @Get("history") async history(
    @AuthUser() user: UserContext,
    @Query("assignment") assignment?: string
  ) {
    assertRentFlag();
    const { assignment: id } = parseOrThrow(z.object({ assignment: z.string().uuid() }), {
      assignment
    });
    return ok(await this.tenants.history(user.id, id));
  }
  @Get("invoices/:id") async invoice(@AuthUser() user: UserContext, @Param("id") id: string) {
    assertRentFlag();
    return ok(await this.tenants.invoice(user.id, id));
  }
  @Post("identity-dispute") async dispute(@AuthUser() user: UserContext, @Body() body: unknown) {
    assertRentFlag();
    const input = parseOrThrow(IdentityDisputeSchema, body);
    return ok(await this.tenants.identityDispute(user.id, input.assignment_id));
  }
  @Post("claims/:id/notify-message") async notify(
    @AuthUser() user: UserContext,
    @Param("id") id: string
  ) {
    assertRentFlag();
    return ok(await this.messages.tenantPaidMessage(user.id, id));
  }
}
```

```ts
// apps/api/src/modules/pg-rent/controllers/pg-rent-public.controller.ts
import { Controller, Get, Header, Inject, NotFoundException, Param, Res } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import type { Response } from "express";

import { ok } from "../../../common/response";
import { assertRentFlag } from "../services/rent-guards";
import { RentPayInstructionService } from "../services/rent-pay-instruction.service";
import { RentReceiptService } from "../services/rent-receipt.service";

@Controller("public/pg-rent")
export class PgRentPublicController {
  constructor(
    @Inject(RentPayInstructionService) private readonly pay: RentPayInstructionService,
    @Inject(RentReceiptService) private readonly receipts: RentReceiptService
  ) {}

  @Get("pay/:token")
  @Throttle({ default: { ttl: 60_000, limit: 30 } })
  @Header("Cache-Control", "no-store")
  async payPage(@Param("token") token: string) {
    assertRentFlag();
    if (!/^[A-Za-z0-9_-]{43}$/.test(token))
      throw new NotFoundException({ code: "pay_link_not_found" });
    return ok(await this.pay.publicPayPage(token));
  }

  @Get("receipts/:shareToken")
  @Throttle({ default: { ttl: 60_000, limit: 30 } })
  @Header("Cache-Control", "no-store")
  async receipt(@Param("shareToken") shareToken: string, @Res() res: Response) {
    assertRentFlag();
    if (!/^[A-Za-z0-9_-]{43}$/.test(shareToken))
      throw new NotFoundException({ code: "receipt_not_found" });
    const dl = await this.receipts.resolveShareToken(shareToken);
    res.redirect(302, dl.url);
  }
}
```

In `pg-rent.module.ts` add, below `import { PgRentTenantClaimsController } …`:

```ts
import { PgRentPortfolioController } from "./controllers/pg-rent-portfolio.controller";
import { PgRentPublicController } from "./controllers/pg-rent-public.controller";
import { PgRentQueueController } from "./controllers/pg-rent-queue.controller";
import { PgRentTenantController } from "./controllers/pg-rent-tenant.controller";
```

and append `PgRentQueueController, PgRentPortfolioController, PgRentTenantController, PgRentPublicController` to `controllers` after `PgRentTenantClaimsController`. The `@Res()` handler must not also `return` a value (Nest would hang the response) — `res.redirect` ends it.

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @cribliv/api exec vitest run src/modules/pg-rent/__tests__/pg-rent-read-controllers.integration.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/pg-rent/controllers/pg-rent-queue.controller.ts apps/api/src/modules/pg-rent/controllers/pg-rent-portfolio.controller.ts apps/api/src/modules/pg-rent/controllers/pg-rent-tenant.controller.ts apps/api/src/modules/pg-rent/controllers/pg-rent-public.controller.ts apps/api/src/modules/pg-rent/pg-rent.module.ts apps/api/src/modules/pg-rent/__tests__/pg-rent-read-controllers.integration.test.ts
git commit -m "feat(pg-rent): queue, messaging, tenant and public controllers"
```

---

### Task 7: Invoice idempotency key — migration 0074 (owner decision 2026-09-24)

`POST /rent/invoices` requires `Idempotency-Key` and runs through `IdempotencyService.run`, but the key never reaches the row. That cache is check-then-act, so two truly concurrent identical requests create two invoices. This task stores the key on the invoice and lets a partial unique index refuse the duplicate, exactly as `pg_rent_payments` already does (`uq_pg_rent_payment_idem` in 0072; `RentPaymentService.recordByOperator`).

**Files:**

- Create: `infra/migrations/0074_pg_rent_invoice_idempotency.sql`
- Create: `infra/migrations/0074_pg_rent_invoice_idempotency.rollback.sql`
- Modify: `apps/api/src/modules/pg-rent/services/rent-invoice.service.ts` (`insertInvoice`, `insertSettlementInvoice`, new private `findByIdempotencyKey`, `createManual`, `createBackfill`)
- Modify: `apps/api/src/modules/pg-rent/controllers/pg-rent-invoices.controller.ts` (`create`)
- Modify: `docs/superpowers/specs/2026-09-17-pg-rent-collection-design.md` (§4.4)
- Test: `apps/api/src/modules/pg-rent/__tests__/schema.integration.test.ts`, `apps/api/src/modules/pg-rent/__tests__/rent-invoice-actions.integration.test.ts`, `apps/api/src/modules/pg-rent/__tests__/pg-rent-money-controllers.integration.test.ts`

**Interfaces:**

```ts
// RentInvoiceService — new optional trailing parameter (default null). The controller always passes
// the Idempotency-Key; RentSettlementService.forfeit (no key on that route) and existing tests pass nothing.
async createManual(operatorId: string, propertyId: string, input: PgRentManualInvoiceInput, idempotencyKey?: string | null): Promise<PgRentInvoice>;
async createBackfill(operatorId: string, propertyId: string, input: PgRentBackfillInput, idempotencyKey?: string | null): Promise<PgRentInvoice>;
// private insertInvoice(client, v) — `v` gains `idempotencyKey: string | null` (required field; settlement passes null)
// private findByIdempotencyKey(propertyId: string, idempotencyKey: string | null): Promise<string | null>
```

Behaviour (mirrors `recordByOperator`, `rent-payment.service.ts:124-186`):

- **Key already stored for this property:** return that invoice via `get()` (ownership-checked). No second insert.
- **Concurrent duplicate that misses the lookup:** the INSERT hits `uq_pg_rent_invoice_idem`, `transaction(…, { uniqueViolationCode: "duplicate_invoice" })` maps the 23505, and the caller gets **409 `duplicate_invoice`**.
- **Rows without a key:** engine-issued invoices (their own INSERTs in `rent-invoice-engine.service.ts`), settlement invoices and forfeit invoices store NULL.

Do **not** touch:

- `RentInvoiceEngineService`, `RentSettlementService`, `RentPaymentService` or shared-types.
- `CLAUDE.md`: it has unrelated uncommitted edits, and its "next free migration" note is updated separately.

- [ ] **Step 1: Write the migration pair**

```sql
-- infra/migrations/0074_pg_rent_invoice_idempotency.sql
-- Store the Idempotency-Key of POST /rent/invoices (manual + backfill) on the
-- invoice row, the same way pg_rent_payments.idempotency_key does (0072).
--
-- The controller already requires the header and wraps the call in
-- IdempotencyService.run, but that cache is check-then-act: two truly
-- concurrent first requests both miss it and both insert. The partial unique
-- index is what makes the second insert fail (23505 → 409 duplicate_invoice),
-- mirroring uq_pg_rent_payment_idem.
--
-- Engine-generated (source 'auto'), settlement and forfeit invoices carry no
-- key; NULL rows are outside the partial index. Additive only: the table ships
-- with the pg-rent feature branch, so the index build is instant.
ALTER TABLE pg_rent_invoices
  ADD COLUMN IF NOT EXISTS idempotency_key text;
CREATE UNIQUE INDEX IF NOT EXISTS uq_pg_rent_invoice_idem
  ON pg_rent_invoices(pg_property_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
```

```sql
-- infra/migrations/0074_pg_rent_invoice_idempotency.rollback.sql
DROP INDEX IF EXISTS uq_pg_rent_invoice_idem;
ALTER TABLE pg_rent_invoices DROP COLUMN IF EXISTS idempotency_key;
DELETE FROM schema_migrations WHERE filename = '0074_pg_rent_invoice_idempotency.sql';
```

- [ ] **Step 2: Write the failing schema test**

In `apps/api/src/modules/pg-rent/__tests__/schema.integration.test.ts`, add this `it` as the last test inside the `describe`, after `"declares the partial unique indexes the engine relies on"`:

```ts
it("0074: invoices store an idempotency key behind a partial unique index per property", async () => {
  const column = await db.query<{ data_type: string; is_nullable: string }>(
    `SELECT data_type, is_nullable FROM information_schema.columns
        WHERE table_name = 'pg_rent_invoices' AND column_name = 'idempotency_key'`
  );
  expect(column.rows).toEqual([{ data_type: "text", is_nullable: "YES" }]);
  const index = await db.query<{ indexdef: string }>(
    `SELECT indexdef FROM pg_indexes WHERE tablename = 'pg_rent_invoices' AND indexname = 'uq_pg_rent_invoice_idem'`
  );
  expect(index.rows).toHaveLength(1);
  expect(index.rows[0].indexdef).toContain("UNIQUE INDEX");
  expect(index.rows[0].indexdef).toContain("(pg_property_id, idempotency_key)");
  expect(index.rows[0].indexdef).toContain("WHERE (idempotency_key IS NOT NULL)");
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `pnpm --filter @cribliv/api exec vitest run src/modules/pg-rent/__tests__/schema.integration.test.ts`
Expected: FAIL, `1 failed | 4 passed (5)` — `expected [] to deeply equal [ { data_type: 'text', …(1) } ]` (the column does not exist yet).

- [ ] **Step 4: Apply the migration and re-run**

Run: `pnpm db:migrate` → prints `Applied 0074_pg_rent_invoice_idempotency.sql`.
Run: `pnpm --filter @cribliv/api exec vitest run src/modules/pg-rent/__tests__/schema.integration.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Write the failing service test**

In `apps/api/src/modules/pg-rent/__tests__/rent-invoice-actions.integration.test.ts`:

(a) Add this import directly below `import { randomUUID } from "node:crypto";`:

```ts
import type { PgRentBackfillInput, PgRentManualInvoiceInput } from "@cribliv/shared-types";
```

(b) Add this helper inside the `describe`, directly above `beforeAll(async () => {` (i.e. after the `tenantWithSeptember` helper):

```ts
/** Polls until `n` backends wait (directly or transitively) on `blockerPid`'s locks. */
async function waitForBlockedBehind(blockerPid: number, n: number): Promise<void> {
  for (let i = 0; i < 250; i += 1) {
    const rows = await db.query<{ pid: number; blockers: number[] }>(
      `SELECT pid, pg_blocking_pids(pid) AS blockers FROM pg_stat_activity
          WHERE datname = current_database() AND cardinality(pg_blocking_pids(pid)) > 0`
    );
    const behind = new Set<number>([blockerPid]);
    let grew = true;
    while (grew) {
      grew = false;
      for (const r of rows.rows) {
        if (!behind.has(r.pid) && r.blockers.some((b) => behind.has(b))) {
          behind.add(r.pid);
          grew = true;
        }
      }
    }
    if (behind.size - 1 >= n) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`expected ${n} transactions blocked behind pid ${blockerPid}`);
}
```

(c) Add this test directly **above** the test titled `"re-proration: notice writes a suggestion, owner applies it (paid invoice → credit), cancelled notice offers restore"` (i.e. right after the `"backfill: paid history has no receipt …"` test):

```ts
it("manual and backfill invoices store their idempotency key: a replay returns the original, a concurrent duplicate never creates a second invoice", async () => {
  const p = await property();
  const { a } = await tenantWithSeptember(p);
  const manual: PgRentManualInvoiceInput = {
    assignment_id: a,
    kind: "adhoc",
    due_date: "2026-09-20",
    lines: [{ kind: "other", label: "Key", amount_inr: 200 }]
  };
  const manualKey = randomUUID();
  const first = await invoices.createManual(operatorId, p.propertyId, manual, manualKey);
  const replay = await invoices.createManual(operatorId, p.propertyId, manual, manualKey);
  expect(replay.id).toBe(first.id);

  const backfill: PgRentBackfillInput = {
    assignment_id: a,
    kind: "rent",
    period_start: "2026-08-01",
    period_end: "2026-08-31",
    due_date: "2026-08-05",
    lines: [{ kind: "rent", label: "Rent · August 2026", amount_inr: 9000 }]
  };
  const backfillKey = randomUUID();
  const aug = await invoices.createBackfill(operatorId, p.propertyId, backfill, backfillKey);
  // Without the stored key the replay is a second insert and dies on period_overlap.
  const augReplay = await invoices.createBackfill(operatorId, p.propertyId, backfill, backfillKey);
  expect(augReplay.id).toBe(aug.id);

  const stored = await db.query<{ id: string; idempotency_key: string | null }>(
    `SELECT id::text, idempotency_key FROM pg_rent_invoices WHERE id = ANY($1::uuid[])`,
    [[first.id, aug.id]]
  );
  expect(Object.fromEntries(stored.rows.map((r) => [r.id, r.idempotency_key]))).toEqual({
    [first.id]: manualKey,
    [aug.id]: backfillKey
  });

  // Two genuinely concurrent first calls. A third connection holds the property row lock, so
  // both calls get past the pre-check read before either can insert; only
  // uq_pg_rent_invoice_idem (0074) then stands between them and a second invoice, and the
  // loser's 23505 maps to 409 duplicate_invoice.
  const raceKey = randomUUID();
  const blocker = await db.getClient();
  let raced: PromiseSettledResult<{ id: string }>[];
  try {
    await blocker.query("BEGIN");
    await blocker.query(`SELECT 1 FROM pg_properties WHERE id = $1::uuid FOR UPDATE`, [
      p.propertyId
    ]);
    const blockerPid = (await blocker.query<{ pid: number }>(`SELECT pg_backend_pid() AS pid`))
      .rows[0].pid;
    const racing = Promise.allSettled([
      invoices.createManual(operatorId, p.propertyId, manual, raceKey),
      invoices.createManual(operatorId, p.propertyId, manual, raceKey)
    ]);
    await waitForBlockedBehind(blockerPid, 2);
    await blocker.query("COMMIT");
    raced = await racing;
  } finally {
    blocker.release();
  }
  expect(raced.map((r) => r.status).sort()).toEqual(["fulfilled", "rejected"]);
  expect(raced.find((r) => r.status === "rejected")).toMatchObject({
    reason: { response: { code: "duplicate_invoice" } }
  });
  const count = await db.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM pg_rent_invoices WHERE pg_property_id = $1::uuid AND idempotency_key = $2`,
    [p.propertyId, raceKey]
  );
  expect(count.rows[0].n).toBe(1);
  await assertRentInvariants(db, p.propertyId);
});
```

- [ ] **Step 6: Run to verify it fails**

Run: `pnpm --filter @cribliv/api exec vitest run src/modules/pg-rent/__tests__/rent-invoice-actions.integration.test.ts -t "idempotency key"`
Expected: FAIL, `1 failed | 10 skipped (11)` — `expected '<uuid>' to be '<uuid>'`. The service ignores the 4th argument, so the replay inserts a second adhoc invoice. vitest does not typecheck; `tsc` would also reject the 4th argument at this point.

- [ ] **Step 7: Implement in `RentInvoiceService`**

In `apps/api/src/modules/pg-rent/services/rent-invoice.service.ts`, replace the whole `private async insertInvoice(` method with the code below. It runs from its signature through its closing `}`, just before the `/** Task 7: public wrapper for RentSettlementService's settle() …` comment:

```ts
  private async insertInvoice(
    client: PoolClient,
    v: {
      propertyId: string;
      assignmentId: string;
      kind: string;
      source: "manual" | "backfill";
      periodStart: string | null;
      periodEnd: string | null;
      dueDate: string;
      lines: Array<{ kind: string; label: string; amountPaise: number }>;
      eligible: boolean;
      tenantNote: string | null;
      /** POST /invoices' Idempotency-Key (0074); null for settlement and forfeit invoices. */
      idempotencyKey: string | null;
      actor: RentActor;
    }
  ): Promise<string> {
    const a = await client.query<{
      bed_id: string;
      bed_label: string;
      room_id: string;
      room_number: string;
      receipt_prefix: string;
    }>(
      `SELECT b.id::text AS bed_id, b.bed_label, r.id::text AS room_id, r.room_number, s.receipt_prefix
         FROM pg_bed_assignments asg JOIN pg_beds b ON b.id = asg.bed_id JOIN pg_rooms r ON r.id = b.room_id JOIN pg_rent_settings s ON s.pg_property_id = asg.pg_property_id
        WHERE asg.id = $1::uuid AND asg.pg_property_id = $2::uuid FOR UPDATE OF asg`,
      [v.assignmentId, v.propertyId]
    );
    if (!a.rows[0]) throw new NotFoundException({ code: "assignment_not_found" });
    if (v.kind === "rent") {
      // Fix round 1, Important 3: a NULL period_start/period_end makes daterange(NULL,NULL,'[]')
      // the universal range (confirmed on the dev DB), so a bounds-less rent backfill was either
      // wrongly refused as period_overlap (when another rent invoice existed) or silently
      // inserted with NULL bounds (when none did) — the latter violates invariant 5b, which
      // assumes every rent invoice carries real bounds. createBackfill is the only caller that
      // can reach kind='rent' here with operator-supplied (optional) bounds; require both.
      if (v.periodStart === null || v.periodEnd === null)
        throw new BadRequestException({ code: "period_required" });
      const overlap = await client.query(
        `SELECT 1 FROM pg_rent_invoices WHERE assignment_id = $1::uuid AND kind = 'rent' AND status <> 'cancelled' AND daterange(period_start, period_end, '[]') && daterange($2::date, $3::date, '[]')`,
        [v.assignmentId, v.periodStart, v.periodEnd]
      );
      if (overlap.rowCount) throw new ConflictException({ code: "period_overlap" });
    }
    if (v.kind === "deposit") {
      const dup = await client.query(
        `SELECT 1 FROM pg_rent_invoices WHERE assignment_id = $1::uuid AND kind = 'deposit' AND status <> 'cancelled'`,
        [v.assignmentId]
      );
      if (dup.rowCount) throw new ConflictException({ code: "deposit_exists" });
    }
    const number = await nextInvoiceNumber(client, v.propertyId, a.rows[0].receipt_prefix);
    const token = newPayToken();
    const total = v.lines.reduce((s, l) => s + l.amountPaise, 0);
    if (total < 0) throw new BadRequestException({ code: "invalid_total" });
    const inserted = await client.query<{ id: string }>(
      `INSERT INTO pg_rent_invoices (pg_property_id, assignment_id, bed_id, room_id, room_number, bed_label, kind, invoice_number, period_start, period_end, billing_month, due_date, status, source, total_paise, late_fee_eligible, pay_token, pay_token_expires_at, tenant_note, issued_at, created_by, idempotency_key)
       VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5, $6, $7::pg_rent_invoice_kind, $8, $9::date, $10::date, $11::date, $12::date, 'issued', $13::pg_rent_invoice_source, $14, $15, $16, $17, $18, now(), $19::uuid, $20) RETURNING id::text`,
      [
        v.propertyId,
        v.assignmentId,
        a.rows[0].bed_id,
        a.rows[0].room_id,
        a.rows[0].room_number,
        a.rows[0].bed_label,
        v.kind,
        number,
        v.periodStart,
        v.periodEnd,
        firstOfMonth(v.periodStart ?? v.dueDate),
        v.dueDate,
        v.source,
        total,
        v.eligible,
        token.token,
        token.expiresAt,
        v.tenantNote,
        v.actor.id,
        v.idempotencyKey
      ]
    );
    const id = inserted.rows[0].id;
    for (const [i, l] of v.lines.entries()) {
      await client.query(
        `INSERT INTO pg_rent_invoice_lines (invoice_id, kind, label, amount_paise, source, sort_order, created_by) VALUES ($1::uuid, $2::pg_rent_line_kind, $3, $4, 'operator', $5, $6::uuid)`,
        [id, l.kind, l.label, l.amountPaise, i, v.actor.id]
      );
    }
    await this.alloc.recomputeInvoice(client, id);
    await this.event(client, v.propertyId, id, "invoice.issued", v.actor, {
      kind: v.kind,
      source: v.source,
      total_paise: total,
      due_date: v.dueDate
    });
    return id;
  }
```

Next, replace everything from the `/** Task 7: public wrapper for RentSettlementService's settle() …` doc comment down to (not including) the `// ── re-proration (spec §5.8, D18) ──…` comment. That span holds `insertSettlementInvoice`, `createManual` and `createBackfill`. Replace it with:

```ts
  /**
   * Task 7: public wrapper for RentSettlementService's settle() — a
   * settlement invoice carrying only the operator's deduction lines,
   * fee-exempt, due today, no period bounds. Caller (settle, inside its own
   * transaction) applies deposit release / unallocated credit afterward.
   */
  async insertSettlementInvoice(
    client: PoolClient,
    v: {
      propertyId: string;
      assignmentId: string;
      deductions: Array<{ kind: string; label: string; amountPaise: number }>;
      actor: RentActor;
    }
  ): Promise<string> {
    return this.insertInvoice(client, {
      propertyId: v.propertyId,
      assignmentId: v.assignmentId,
      kind: "settlement",
      source: "manual",
      periodStart: null,
      periodEnd: null,
      dueDate: todayIst(),
      lines: v.deductions,
      eligible: false,
      tenantNote: null,
      idempotencyKey: null,
      actor: v.actor
    });
  }

  /**
   * The invoice a replayed POST /invoices already created, or null. Mirrors
   * RentPaymentService.recordByOperator: a sequential retry returns the original
   * here; a truly concurrent duplicate that also misses this read loses on
   * uq_pg_rent_invoice_idem (0074) inside its transaction → 409 duplicate_invoice.
   */
  private async findByIdempotencyKey(
    propertyId: string,
    idempotencyKey: string | null
  ): Promise<string | null> {
    if (idempotencyKey === null) return null;
    const existing = await this.db.query<{ id: string }>(
      `SELECT id::text FROM pg_rent_invoices WHERE pg_property_id = $1::uuid AND idempotency_key = $2`,
      [propertyId, idempotencyKey]
    );
    return existing.rows[0]?.id ?? null;
  }

  /** `idempotencyKey` is the controller's Idempotency-Key; RentSettlementService.forfeit has none and passes nothing. */
  async createManual(
    operatorId: string,
    propertyId: string,
    input: PgRentManualInvoiceInput,
    idempotencyKey: string | null = null
  ): Promise<PgRentInvoice> {
    requireDb(this.db);
    const actor = this.actor(operatorId);
    const existing = await this.findByIdempotencyKey(propertyId, idempotencyKey);
    if (existing) return this.get(operatorId, propertyId, existing);
    const id = await transaction(
      this.db,
      async (client) => {
        await assertManagedOwnership(client, operatorId, propertyId, true);
        const id = await this.insertInvoice(client, {
          propertyId,
          assignmentId: input.assignment_id,
          kind: "adhoc",
          source: "manual",
          periodStart: null,
          periodEnd: null,
          dueDate: input.due_date,
          lines: input.lines.map((l) => ({
            kind: l.kind,
            label: l.label,
            amountPaise: inrToPaise(l.amount_inr, { allowNegative: true })
          })),
          eligible: false,
          tenantNote: input.tenant_note ?? null,
          idempotencyKey,
          actor
        });
        await this.alloc.applyUnallocatedCredit(client, id, actor);
        return id;
      },
      { uniqueViolationCode: "duplicate_invoice" }
    );
    return this.readById(propertyId, id);
  }

  /** Spec §6.4 / §5.5 "Deposit held": invoice (+ optional backfill payment) in one transaction; no receipt; fee-exempt. */
  async createBackfill(
    operatorId: string,
    propertyId: string,
    input: PgRentBackfillInput,
    idempotencyKey: string | null = null
  ): Promise<PgRentInvoice> {
    requireDb(this.db);
    const actor = this.actor(operatorId);
    const existing = await this.findByIdempotencyKey(propertyId, idempotencyKey);
    if (existing) return this.get(operatorId, propertyId, existing);
    const id = await transaction(
      this.db,
      async (client) => {
        await assertManagedOwnership(client, operatorId, propertyId, true);
        const id = await this.insertInvoice(client, {
          propertyId,
          assignmentId: input.assignment_id,
          kind: input.kind,
          source: "backfill",
          periodStart: input.period_start ?? null,
          periodEnd: input.period_end ?? null,
          dueDate: input.due_date,
          lines: input.lines.map((l) => ({
            kind: l.kind,
            label: l.label,
            amountPaise: inrToPaise(l.amount_inr, { allowNegative: true })
          })),
          eligible: false,
          tenantNote: null,
          idempotencyKey,
          actor
        });
        if (input.payment) {
          await this.payments.recordBackfillPayment(client, {
            propertyId,
            assignmentId: input.assignment_id,
            invoiceId: id,
            amountPaise: inrToPaise(input.payment.amount_inr),
            method: input.payment.method,
            paidOn: input.payment.paid_on,
            reference: input.payment.reference ?? null,
            actor
          });
        } else {
          await this.alloc.applyUnallocatedCredit(client, id, actor);
        }
        return id;
      },
      { uniqueViolationCode: "duplicate_invoice" }
    );
    return this.readById(propertyId, id);
  }
```

No import changes are needed (`transaction`, `PoolClient`, `RentActor` are already imported).

- [ ] **Step 8: Run to verify it passes**

Run: `pnpm --filter @cribliv/api exec vitest run src/modules/pg-rent/__tests__/rent-invoice-actions.integration.test.ts`
Expected: PASS, 11 tests.

- [ ] **Step 9: Write the failing controller test**

In `apps/api/src/modules/pg-rent/__tests__/pg-rent-money-controllers.integration.test.ts`, add this as the last test inside the `describe`, after `"tenant routes are scoped to the tenant's own assignments"`:

```ts
it("POST /invoices stores the Idempotency-Key on the invoice row and replays it", async () => {
  const key = randomUUID();
  const post = () =>
    request(app.getHttpServer())
      .post(`${base()}/invoices`)
      .set(as("operator"))
      .set("idempotency-key", key)
      .send({
        source: "manual",
        assignment_id: assignmentId,
        kind: "adhoc",
        due_date: "2026-09-25",
        lines: [{ kind: "other", label: "Idem", amount_inr: 100 }]
      });
  const first = await post();
  expect(first.status).toBe(201);
  const second = await post();
  expect(second.body.data.id).toBe(first.body.data.id);
  const row = await db.query<{ k: string | null }>(
    `SELECT idempotency_key AS k FROM pg_rent_invoices WHERE id = $1::uuid`,
    [first.body.data.id]
  );
  expect(row.rows[0].k).toBe(key);
  await assertRentInvariants(db, propertyId);
});
```

Run: `pnpm --filter @cribliv/api exec vitest run src/modules/pg-rent/__tests__/pg-rent-money-controllers.integration.test.ts -t "Idempotency-Key"`
Expected: FAIL, `1 failed | 4 skipped (5)` — `expected null to be '<key>'`. The controller never hands the key to the service; the replay still returns the same id only because of the 24-hour cache.

- [ ] **Step 10: Thread the key through the controller**

In `apps/api/src/modules/pg-rent/controllers/pg-rent-invoices.controller.ts`, replace the whole `@Post("invoices") async create(` method with the code below. Only the two service calls change: each gains `, key`.

```ts
  @Post("invoices")
  async create(
    @AuthUser() user: UserContext,
    @Param("propertyId") propertyId: string,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Body() body: unknown
  ) {
    assertRentFlag();
    const key = requireIdempotencyKey(idempotencyKey);
    const bodyRecord = body as Record<string, unknown>;
    const { source, ...rest } = bodyRecord;

    if (source === "backfill") {
      const input = parseOrThrow(BackfillSchema, rest);
      return ok(
        await (this.idem ?? PASSTHROUGH_IDEMPOTENCY).run(
          user.id,
          `pg-rent:${propertyId}:invoices`,
          key,
          () => this.invoices.createBackfill(user.id, propertyId, input, key)
        )
      );
    } else {
      const input = parseOrThrow(ManualInvoiceSchema, rest);
      return ok(
        await (this.idem ?? PASSTHROUGH_IDEMPOTENCY).run(
          user.id,
          `pg-rent:${propertyId}:invoices`,
          key,
          () => this.invoices.createManual(user.id, propertyId, input, key)
        )
      );
    }
  }
```

- [ ] **Step 11: Run to verify it passes**

Run: `pnpm --filter @cribliv/api exec vitest run src/modules/pg-rent/__tests__/pg-rent-money-controllers.integration.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 12: Typecheck and the module suite**

Run: `pnpm --filter @cribliv/api typecheck` → no errors.
Run: `pnpm --filter @cribliv/api exec vitest run src/modules/pg-rent`
Expected: PASS, 31 files, **207 tests** (204 after Tasks 1–6, + 3). Read the `Tests` line: without `DATABASE_URL` the DB suites skip and report green.

- [ ] **Step 13: Spec §4.4**

In `docs/superpowers/specs/2026-09-17-pg-rent-collection-design.md` §4.4 `pg_rent_invoices`:

1. Add this table row directly after the `cancel_reason` row:

```md
| `idempotency_key` | text | `POST /invoices` Idempotency-Key (manual + backfill), migration 0074; NULL for engine (`auto`), settlement and forfeit invoices |
```

2. In the `Indexes:` sentence below the table, replace `` `(pay_token)`. `` with `` `(pay_token)`; UNIQUE partial `(pg_property_id, idempotency_key) WHERE idempotency_key IS NOT NULL` (0074, a duplicate → 409 `duplicate_invoice`). ``

(lint-staged runs prettier on the staged `.md`, which realigns the table.)

- [ ] **Step 14: Commit**

```bash
git add infra/migrations/0074_pg_rent_invoice_idempotency.sql infra/migrations/0074_pg_rent_invoice_idempotency.rollback.sql apps/api/src/modules/pg-rent/services/rent-invoice.service.ts apps/api/src/modules/pg-rent/controllers/pg-rent-invoices.controller.ts apps/api/src/modules/pg-rent/__tests__/schema.integration.test.ts apps/api/src/modules/pg-rent/__tests__/rent-invoice-actions.integration.test.ts apps/api/src/modules/pg-rent/__tests__/pg-rent-money-controllers.integration.test.ts docs/superpowers/specs/2026-09-17-pg-rent-collection-design.md
git commit -m "feat(pg-rent): persist the invoice Idempotency-Key (0074) so a concurrent duplicate POST /invoices is refused"
```

---

### Task 8: Restore absorbs the engine's gap invoice (owner decision 2026-09-24)

On default settings, Restore is unreachable. `onAssignmentEvent` runs generation **before** `suggestRestore`. By the time the Restore card appears, the engine has already issued (and usually credit-paid) a `source = 'auto'` rent invoice for `leave_on + 1 … original period end`. `restoreReprorate`'s overlap guard then refuses with `period_overlap`.

After this task, Restore absorbs that invoice inside its own transaction:

1. Release the gap invoice's allocations to credit.
2. Cancel it with reason `restore_absorbed`.
3. The existing `releaseAllocations` + `applyUnallocatedCredit` at the end of `restoreReprorate` moves the credit onto the restored invoice.

**Files:**

- Modify: `apps/api/src/modules/pg-rent/services/rent-invoice.service.ts` (`restoreReprorate`; new private `absorbGapInvoices`)
- Modify: `docs/superpowers/specs/2026-09-17-pg-rent-collection-design.md` (§5.8)
- Test: `apps/api/src/modules/pg-rent/__tests__/rent-invoice-actions.integration.test.ts` (one test replaced, five added, one helper)

**Interfaces:**

```ts
// RentInvoiceService — signature unchanged
async restoreReprorate(operatorId: string, propertyId: string, invoiceId: string): Promise<PgRentInvoice>;
private async absorbGapInvoices(
  client: PoolClient,
  propertyId: string,
  restored: { id: string; assignmentId: string; periodStart: string; periodEnd: string },
  originalEnd: string,
  actor: RentActor
): Promise<string[]>; // ids of the invoices it cancelled, in period order
```

Rules (decided — do not re-derive):

| Overlapping rent invoice (same assignment, not cancelled, overlapping `[restored.period_start, original_end]`)                                                                        | Result                                                                                                                                                                                                                                                                    |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| none                                                                                                                                                                                  | restore as today                                                                                                                                                                                                                                                          |
| every one is `source = 'auto'` **and** lies inside `(restored.period_end, original_end]` **and** has no `late_fee` line and no line with `source` outside `('system','default_item')` | each is absorbed: `releaseAllocations` → `status = 'cancelled'`, `cancelled_at = now()`, `cancel_reason = 'restore_absorbed'`, `pay_token_expires_at = now()`, `reprorate_suggestion = NULL` → event `invoice.cancelled {reason:'restore_absorbed', restored_invoice_id}` |
| any one is not `auto`, or starts on/before `restored.period_end`, or ends after `original_end`                                                                                        | 409 `period_overlap`, nothing changes                                                                                                                                                                                                                                     |
| all absorbable by source/position, but one carries a `late_fee` line or an `operator`/`expense_split` line                                                                            | 409 `restore_gap_edited`, nothing changes                                                                                                                                                                                                                                 |
| the invoice being restored is `cancelled`                                                                                                                                             | 409 `invoice_cancelled`, nothing changes                                                                                                                                                                                                                                  |

These need no handling (see the amendment's design notes): pending claims on the gap invoice, receipts of payments allocated to it, `default_item` lines, and waived fees.

No new event type.

Lock order: property → restored invoice → gap invoices `ORDER BY period_start, id FOR UPDATE` → payments (inside `applyUnallocatedCredit`).

Do **not** modify `cancel()`, `RentAllocationService` or `RentInvoiceEngineService`. Also leave the other two restore tests unchanged: `"restoreReprorate succeeds and fully re-applies credit…"` and `"re-proration: a later, earlier notice…"`.

- [ ] **Step 1: Add the test helper**

In `apps/api/src/modules/pg-rent/__tests__/rent-invoice-actions.integration.test.ts`, add this helper inside the `describe`, directly above the ``/** Polls until `n` backends wait …`` helper that Task 7 added:

```ts
/**
 * The real default path to a Restore card: notice for 15 Sep → re-prorate September →
 * notice cancelled. onAssignmentEvent runs generation against the real clock before
 * suggestRestore, so the engine issues the 16–30 Sep gap invoice on the way (unless
 * `beforeStaying` already put a rent invoice there). Returns whatever rent invoice now
 * starts on 16 Sep.
 */
async function leaveThenStay(
  propertyId: string,
  a: string,
  sepId: string,
  beforeStaying: () => Promise<void> = async () => undefined
) {
  await db.query(
    `UPDATE pg_bed_assignments SET status = 'notice_served', notice_end_date = '2026-09-15' WHERE id = $1::uuid`,
    [a]
  );
  await engine.onAssignmentEvent({ type: "notice_served", propertyId, assignmentId: a });
  await invoices.applyReprorate(operatorId, propertyId, sepId);
  await beforeStaying();
  await db.query(
    `UPDATE pg_bed_assignments SET status = 'active', notice_end_date = NULL WHERE id = $1::uuid`,
    [a]
  );
  await engine.onAssignmentEvent({ type: "notice_cancelled", propertyId, assignmentId: a });
  const sep = await invoices.get(operatorId, propertyId, sepId);
  expect(sep.reprorate_suggestion).toMatchObject({ mode: "restore" });
  return (await invoices.list(operatorId, propertyId, { assignment_id: a, kind: "rent" })).find(
    (i) => i.period_start === "2026-09-16"
  );
}
```

- [ ] **Step 2: Replace the contradicting 1b test and add the new tests**

Delete the whole test titled `"re-proration: notice writes a suggestion, owner applies it (paid invoice → credit), cancelled notice offers restore"`. It asserts the `period_overlap` refusal that the owner's decision reverses. The block to delete:

- starts at its `it(` line;
- ends at its closing `});`, right after `expect(inv.reprorate_suggestion).toMatchObject({ mode: "restore", to_inr: 9000 });` and `await assertRentInvariants(db, p.propertyId);`;
- is followed directly by `it("restoreReprorate succeeds and fully re-applies credit once nothing else occupies the restored period"`.

Put these six tests in its place. The first is the same scenario, now expecting success:

```ts
it("re-proration: notice writes a suggestion, owner applies it (paid invoice → credit), cancelled notice offers restore, and Restore absorbs the engine's gap invoice", async () => {
  const p = await property({ prorate_move_out: true });
  const { a, sep } = await tenantWithSeptember(p);
  await payments.recordByOperator(
    operatorId,
    p.propertyId,
    { assignment_id: a, amount_inr: 9000, method: "upi", paid_on: "2026-09-02" },
    randomUUID()
  );
  await db.query(
    `UPDATE pg_bed_assignments SET status = 'notice_served', notice_end_date = '2026-09-15' WHERE id = $1::uuid`,
    [a]
  );
  await engine.onAssignmentEvent({
    type: "notice_served",
    propertyId: p.propertyId,
    assignmentId: a
  });
  let inv = await invoices.get(operatorId, p.propertyId, sep.id);
  expect(inv.reprorate_suggestion).toEqual({
    leave_on: "2026-09-15",
    from_inr: 9000,
    to_inr: 4500,
    mode: "reprorate"
  });

  inv = await invoices.applyReprorate(operatorId, p.propertyId, sep.id);
  expect(inv).toMatchObject({
    total_inr: 4500,
    amount_paid_inr: 4500,
    status: "paid",
    reprorate_suggestion: null,
    period_end: "2026-09-15"
  });
  expect(await new RentAllocationService().unallocatedCredit(db, a)).toBe(450000);

  // The real default path (no pause, no hand-written suggestion): onAssignmentEvent runs
  // generateInvoicesForProperty against the real wall clock BEFORE suggestRestore, so the
  // reopened window gets an auto "2026-09-16..30" gap invoice that FIFO-takes the ₹4,500
  // credit the re-proration released — and only then is the Restore card offered.
  await db.query(
    `UPDATE pg_bed_assignments SET status = 'active', notice_end_date = NULL WHERE id = $1::uuid`,
    [a]
  );
  await engine.onAssignmentEvent({
    type: "notice_cancelled",
    propertyId: p.propertyId,
    assignmentId: a
  });
  const gap = (
    await invoices.list(operatorId, p.propertyId, { assignment_id: a, kind: "rent" })
  ).find((i) => i.period_start === "2026-09-16");
  expect(gap).toMatchObject({
    source: "auto",
    period_end: "2026-09-30",
    total_inr: 4500,
    amount_paid_inr: 4500,
    status: "paid"
  });
  inv = await invoices.get(operatorId, p.propertyId, sep.id);
  expect(inv.reprorate_suggestion).toMatchObject({ mode: "restore", to_inr: 9000 });
  await assertRentInvariants(db, p.propertyId);

  // Owner decision 2026-09-24: Restore absorbs the gap invoice in its own transaction —
  // releases its allocations to credit, cancels it, and the credit flows back to September.
  inv = await invoices.restoreReprorate(operatorId, p.propertyId, sep.id);
  expect(inv).toMatchObject({
    total_inr: 9000,
    amount_paid_inr: 9000,
    status: "paid",
    reprorate_suggestion: null,
    period_end: "2026-09-30"
  });
  expect(await invoices.get(operatorId, p.propertyId, gap!.id)).toMatchObject({
    status: "cancelled",
    amount_paid_inr: 0,
    cancel_reason: "restore_absorbed",
    reprorate_suggestion: null
  });
  expect(await new RentAllocationService().unallocatedCredit(db, a)).toBe(0);
  const gapEvents = await db.query<{ event_type: string; payload: Record<string, unknown> }>(
    `SELECT event_type, payload FROM pg_rent_events WHERE entity_type = 'invoice' AND entity_id = $1::uuid ORDER BY id`,
    [gap!.id]
  );
  expect(gapEvents.rows.map((e) => e.event_type).slice(-2)).toEqual([
    "invoice.excess_deallocated",
    "invoice.cancelled"
  ]);
  expect(gapEvents.rows.at(-1)!.payload).toEqual({
    reason: "restore_absorbed",
    restored_invoice_id: sep.id
  });
  const restoredEvent = await db.query<{ payload: Record<string, unknown> }>(
    `SELECT payload FROM pg_rent_events WHERE entity_type = 'invoice' AND entity_id = $1::uuid AND event_type = 'invoice.line_updated' ORDER BY id DESC LIMIT 1`,
    [sep.id]
  );
  expect(restoredEvent.rows[0].payload).toMatchObject({
    reason: "reprorate_restored",
    absorbed_invoice_ids: [gap!.id]
  });
  await assertRentInvariants(db, p.propertyId);
});

it("restore absorbs a gap invoice the tenant paid directly: the money moves to the restored invoice, the receipt is untouched", async () => {
  const p = await property({ prorate_move_out: true });
  const { a, sep } = await tenantWithSeptember(p);
  const gap = await leaveThenStay(p.propertyId, a, sep.id);
  expect(gap).toMatchObject({ source: "auto", status: "issued", total_inr: 4500 });
  const paid = await payments.recordByOperator(
    operatorId,
    p.propertyId,
    {
      assignment_id: a,
      amount_inr: 4500,
      method: "upi",
      paid_on: "2026-09-20",
      allocations: [{ invoice_id: gap!.id, amount_inr: 4500 }]
    },
    randomUUID()
  );
  expect((await invoices.get(operatorId, p.propertyId, gap!.id)).status).toBe("paid");
  await assertRentInvariants(db, p.propertyId);

  const inv = await invoices.restoreReprorate(operatorId, p.propertyId, sep.id);
  expect(inv).toMatchObject({
    total_inr: 9000,
    amount_paid_inr: 4500,
    status: "partially_paid",
    period_end: "2026-09-30"
  });
  expect(await invoices.get(operatorId, p.propertyId, gap!.id)).toMatchObject({
    status: "cancelled",
    amount_paid_inr: 0
  });
  expect(await new RentAllocationService().unallocatedCredit(db, a)).toBe(0);
  // Spec §6.7: only a manual re-allocation voids/re-mints; a release caused by an invoice
  // mutation leaves the receipt as the record of what was received.
  const receipts = await db.query<{ voided_at: Date | null }>(
    `SELECT voided_at FROM pg_rent_receipts WHERE payment_id = $1::uuid`,
    [paid.id]
  );
  expect(receipts.rows).toEqual([{ voided_at: null }]);
  await assertRentInvariants(db, p.propertyId);
});

it("restore absorbs a gap invoice carrying a pending tenant claim; confirming the claim later pays the restored invoice", async () => {
  const p = await property({ prorate_move_out: true });
  const tenantUserId = await fx.createUser("tenant");
  const { a, sep } = await tenantWithSeptember(p, "A", { tenantUserId });
  const gap = await leaveThenStay(p.propertyId, a, sep.id);
  const claim = await payments.claimByTenant(tenantUserId, {
    assignment_id: a,
    invoice_id: gap!.id,
    amount_inr: 4500,
    method: "upi",
    paid_on: "2026-09-20",
    idempotency_key: randomUUID()
  });
  expect(claim.status).toBe("pending_confirmation");

  await invoices.restoreReprorate(operatorId, p.propertyId, sep.id);
  expect(await invoices.get(operatorId, p.propertyId, gap!.id)).toMatchObject({
    status: "cancelled"
  });
  await assertRentInvariants(db, p.propertyId);

  // Spec §6.10 "Claim for a cancelled invoice → FIFO/credit": the claimed target is skipped.
  await payments.confirm(operatorId, p.propertyId, claim.id, {});
  expect(await invoices.get(operatorId, p.propertyId, sep.id)).toMatchObject({
    total_inr: 9000,
    amount_paid_inr: 4500,
    status: "partially_paid"
  });
  expect(await invoices.get(operatorId, p.propertyId, gap!.id)).toMatchObject({
    status: "cancelled",
    amount_paid_inr: 0
  });
  await assertRentInvariants(db, p.propertyId);
});

it("restore still refuses period_overlap when the overlapping invoice is not an engine-issued gap invoice", async () => {
  const p = await property({ prorate_move_out: true });
  const { a, sep } = await tenantWithSeptember(p);
  const backfill = await leaveThenStay(p.propertyId, a, sep.id, async () => {
    await invoices.createBackfill(operatorId, p.propertyId, {
      assignment_id: a,
      kind: "rent",
      period_start: "2026-09-16",
      period_end: "2026-09-30",
      due_date: "2026-09-16",
      lines: [{ kind: "rent", label: "Rent · 16–30 Sep 2026", amount_inr: 4500 }]
    });
  });
  expect(backfill).toMatchObject({ source: "backfill", status: "issued" });
  expect((await invoices.get(operatorId, p.propertyId, sep.id)).reprorate_suggestion).toMatchObject(
    { mode: "restore" }
  );
  await expect(invoices.restoreReprorate(operatorId, p.propertyId, sep.id)).rejects.toMatchObject({
    response: { code: "period_overlap" }
  });
  expect(await invoices.get(operatorId, p.propertyId, sep.id)).toMatchObject({
    total_inr: 4500,
    period_end: "2026-09-15"
  });
  expect((await invoices.get(operatorId, p.propertyId, backfill!.id)).status).toBe("issued");
  await assertRentInvariants(db, p.propertyId);
});

it("restore refuses restore_gap_edited while the gap invoice carries an operator line or a late fee, and absorbs it once they are gone", async () => {
  const p = await property({ prorate_move_out: true });
  const { a, sep } = await tenantWithSeptember(p);
  const gap = await leaveThenStay(p.propertyId, a, sep.id);
  expect(gap).toMatchObject({ source: "auto", status: "issued" });

  const withLine = await invoices.addLine(operatorId, p.propertyId, gap!.id, {
    kind: "electricity",
    label: "Electricity",
    amount_inr: 400
  });
  await assertRentInvariants(db, p.propertyId);
  await expect(invoices.restoreReprorate(operatorId, p.propertyId, sep.id)).rejects.toMatchObject({
    response: { code: "restore_gap_edited" }
  });
  expect((await invoices.get(operatorId, p.propertyId, sep.id)).period_end).toBe("2026-09-15");
  await invoices.removeLine(
    operatorId,
    p.propertyId,
    gap!.id,
    withLine.lines.find((l) => l.kind === "electricity")!.id
  );

  await invoices.applyFee(operatorId, p.propertyId, gap!.id, 300);
  await assertRentInvariants(db, p.propertyId);
  await expect(invoices.restoreReprorate(operatorId, p.propertyId, sep.id)).rejects.toMatchObject({
    response: { code: "restore_gap_edited" }
  });
  await invoices.waiveFee(operatorId, p.propertyId, gap!.id, "tenant is staying");
  await assertRentInvariants(db, p.propertyId);

  const inv = await invoices.restoreReprorate(operatorId, p.propertyId, sep.id);
  expect(inv).toMatchObject({
    total_inr: 9000,
    amount_paid_inr: 0,
    status: "issued",
    period_end: "2026-09-30"
  });
  expect(await invoices.get(operatorId, p.propertyId, gap!.id)).toMatchObject({
    status: "cancelled",
    cancel_reason: "restore_absorbed"
  });
  await assertRentInvariants(db, p.propertyId);
});

it("restore refuses invoice_cancelled on a cancelled invoice's leftover restore card and leaves the gap invoice alone", async () => {
  const p = await property({ prorate_move_out: true });
  const { a, sep } = await tenantWithSeptember(p);
  const gap = await leaveThenStay(p.propertyId, a, sep.id);
  await invoices.cancel(operatorId, p.propertyId, sep.id, "billed in error");
  // cancel() does not clear reprorate_suggestion, so the Restore card outlives the invoice.
  expect((await invoices.get(operatorId, p.propertyId, sep.id)).reprorate_suggestion).toMatchObject(
    { mode: "restore" }
  );
  await expect(invoices.restoreReprorate(operatorId, p.propertyId, sep.id)).rejects.toMatchObject({
    response: { code: "invoice_cancelled" }
  });
  expect((await invoices.get(operatorId, p.propertyId, gap!.id)).status).toBe("issued");
  await assertRentInvariants(db, p.propertyId);
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `pnpm --filter @cribliv/api exec vitest run src/modules/pg-rent/__tests__/rent-invoice-actions.integration.test.ts`
Expected: FAIL, `5 failed | 11 passed (16)`:

- `…and Restore absorbs the engine's gap invoice`, `…the tenant paid directly…` and `…pending tenant claim…` fail with `Conflict Exception` (the old `period_overlap` guard).
- `…restore_gap_edited…` and `…invoice_cancelled…` fail with `expected ConflictException … to match object`: they get `period_overlap`, not their own code.
- `"restore still refuses period_overlap when the overlapping invoice is not an engine-issued gap invoice"` already passes. It pins behaviour this change must keep.

- [ ] **Step 4: Implement**

In `apps/api/src/modules/pg-rent/services/rent-invoice.service.ts`, replace the whole `async restoreReprorate(` method with the following two methods. The method runs from its signature through its closing `}`, just before `private async withLines(`. No import changes: `compareIsoDates`, `ConflictException`, `PoolClient` and `RentActor` are already imported.

```ts
  async restoreReprorate(
    operatorId: string,
    propertyId: string,
    invoiceId: string
  ): Promise<PgRentInvoice> {
    requireDb(this.db);
    const actor = this.actor(operatorId);
    await transaction(this.db, async (client) => {
      await assertManagedOwnership(client, operatorId, propertyId, true);
      const inv = await this.lockInvoice(client, propertyId, invoiceId);
      // cancel() leaves reprorate_suggestion in place, so a cancelled invoice can still carry a
      // Restore card; restoring it would now also cancel the live gap invoice below.
      if (inv.status === "cancelled") throw new ConflictException({ code: "invoice_cancelled" });
      const s = inv.reprorate_suggestion;
      if (!s || s.mode !== "restore") throw new ConflictException({ code: "no_suggestion" });
      const line = await client.query<{
        id: string;
        amount_paise: string;
        meta: { reprorated?: { original_paise: number; original_end: string } };
      }>(
        `SELECT id::text, amount_paise::text, meta FROM pg_rent_invoice_lines WHERE invoice_id = $1::uuid AND kind = 'rent' FOR UPDATE`,
        [invoiceId]
      );
      const r = line.rows[0].meta.reprorated;
      if (!r) throw new ConflictException({ code: "no_suggestion" });
      const absorbed = await this.absorbGapInvoices(
        client,
        propertyId,
        {
          id: invoiceId,
          assignmentId: inv.assignment_id,
          periodStart: inv.period_start as string,
          periodEnd: inv.period_end as string
        },
        r.original_end,
        actor
      );
      await client.query(
        `UPDATE pg_rent_invoice_lines SET amount_paise = $2, meta = meta - 'reprorated' WHERE id = $1::uuid`,
        [line.rows[0].id, r.original_paise]
      );
      await client.query(
        `UPDATE pg_rent_invoices SET period_end = $2::date, reprorate_suggestion = NULL WHERE id = $1::uuid`,
        [invoiceId, r.original_end]
      );
      await setInvoiceTotalFromLines(client, invoiceId);
      await this.alloc.recomputeInvoice(client, invoiceId);
      await this.event(client, propertyId, invoiceId, "invoice.line_updated", actor, {
        reason: "reprorate_restored",
        from_paise: Number(line.rows[0].amount_paise),
        to_paise: r.original_paise,
        absorbed_invoice_ids: absorbed
      });
      // applyReprorate's own settleTotal call can leave a *partial* allocation row for
      // (payment, invoiceId) when the shrink only partly exceeded amount_paid (deallocateExcess
      // reduces the row in place rather than deleting it — rent-allocation.service.ts's
      // deallocateExcess). applyUnallocatedCredit always INSERTs a fresh row and has no "top up
      // an existing one" path (uq_pg_rent_alloc_invoice is a unique index on (payment_id,
      // invoice_id), migration 0072), so calling it directly here throws 23505 whenever that
      // partial row survived the round trip. Releasing back to credit first — a no-op when
      // nothing is allocated yet — lets applyUnallocatedCredit's ordinary FIFO re-allocate the
      // full amount fresh, without touching RentAllocationService itself. The same FIFO also
      // picks up whatever absorbGapInvoices just released.
      await this.alloc.releaseAllocations(client, invoiceId, actor);
      await this.alloc.applyUnallocatedCredit(client, invoiceId, actor);
    });
    return this.readById(propertyId, invoiceId);
  }

  /**
   * Owner decision 2026-09-24: Restore absorbs the gap invoice. onAssignmentEvent runs
   * generateInvoicesForProperty BEFORE suggestRestore, so by the time the Restore card exists the
   * engine has already issued a rent invoice for leave_on+1 … the natural period end (the days
   * this restore re-covers) and usually FIFO-paid it with the credit the re-proration released.
   * Restoring over it would bill those days twice (invariant 5), so every overlapping rent
   * invoice is either absorbed here — allocations released to credit, cancelled — or the restore
   * is refused. The caller's applyUnallocatedCredit then moves the released credit onto the
   * restored invoice; anything left over stays the tenant's credit.
   *
   * Absorbable = engine-issued (`source = 'auto'`) and lying entirely inside the gap
   * (invoice.period_end, original_end]. Anything else overlapping (a backfill, a manual rent
   * invoice, a period that runs past original_end) is an operator decision or a bigger period
   * and stays 409 `period_overlap`. An absorbable invoice that carries a charge the restored
   * invoice does not already bill — a late_fee line, or a line the operator or an expense split
   * added — is refused with 409 `restore_gap_edited` so no charge vanishes silently; its
   * default_item lines duplicate the restored invoice's own (applyReprorate only touches the
   * rent line), so cancelling them is correct. Receipts are not touched (spec §6.7: only a
   * manual re-allocation voids/re-mints), and a pending claim that targets the gap invoice falls
   * back to FIFO on confirm (spec §6.10).
   *
   * Lock order: the property (assertManagedOwnership) and the restored invoice are already
   * held; the gap invoices are locked next in period order — the restored invoice starts
   * earlier, so the whole transaction locks rent invoices in period_start order — and payment
   * rows only afterwards (applyUnallocatedCredit).
   */
  private async absorbGapInvoices(
    client: PoolClient,
    propertyId: string,
    restored: { id: string; assignmentId: string; periodStart: string; periodEnd: string },
    originalEnd: string,
    actor: RentActor
  ): Promise<string[]> {
    const overlapping = await client.query<{
      id: string;
      source: string;
      period_start: string;
      period_end: string;
    }>(
      `SELECT id::text, source::text, to_char(period_start,'YYYY-MM-DD') AS period_start, to_char(period_end,'YYYY-MM-DD') AS period_end
         FROM pg_rent_invoices
        WHERE assignment_id = $1::uuid AND kind = 'rent' AND status <> 'cancelled' AND id <> $2::uuid
          AND daterange(period_start, period_end, '[]') && daterange($3::date, $4::date, '[]')
        ORDER BY period_start, id
        FOR UPDATE`,
      [restored.assignmentId, restored.id, restored.periodStart, originalEnd]
    );
    const gap = overlapping.rows;
    if (gap.length === 0) return [];
    if (
      gap.some(
        (g) =>
          g.source !== "auto" ||
          compareIsoDates(g.period_start, restored.periodEnd) <= 0 ||
          compareIsoDates(g.period_end, originalEnd) > 0
      )
    )
      throw new ConflictException({ code: "period_overlap" });
    const ids = gap.map((g) => g.id);
    const edited = await client.query(
      `SELECT 1 FROM pg_rent_invoice_lines
        WHERE invoice_id = ANY($1::uuid[]) AND (kind = 'late_fee' OR source NOT IN ('system', 'default_item'))
        LIMIT 1`,
      [ids]
    );
    if (edited.rowCount)
      throw new ConflictException({
        code: "restore_gap_edited",
        message: "Remove the extra charges or late fee on the later invoice first"
      });
    for (const id of ids) {
      await this.alloc.releaseAllocations(client, id, actor);
      await client.query(
        `UPDATE pg_rent_invoices SET status = 'cancelled', cancelled_at = now(), cancel_reason = 'restore_absorbed', pay_token_expires_at = now(), reprorate_suggestion = NULL WHERE id = $1::uuid`,
        [id]
      );
      await this.event(client, propertyId, id, "invoice.cancelled", actor, {
        reason: "restore_absorbed",
        restored_invoice_id: restored.id
      });
    }
    return ids;
  }
```

- [ ] **Step 5: Run to verify it passes**

Run: `pnpm --filter @cribliv/api exec vitest run src/modules/pg-rent/__tests__/rent-invoice-actions.integration.test.ts`
Expected: PASS, 16 tests. These tests deliberately drive `onAssignmentEvent` against the real clock, because the gap invoice only exists on that path. They hold for any run date from 2026-09-06 on.

- [ ] **Step 6: Typecheck and the module suite**

Run: `pnpm --filter @cribliv/api typecheck` → no errors.
Run: `pnpm --filter @cribliv/api exec vitest run src/modules/pg-rent`
Expected: PASS, 31 files, **212 tests** (207 after Task 7, + 5). If `rent-payment.integration.test.ts` › "per_day fee shrinks…" fails once, re-run. It is a known intermittent failure these tasks do not touch: report it, do not patch it here.

- [ ] **Step 7: Spec §5.8**

In `docs/superpowers/specs/2026-09-17-pg-rent-collection-design.md` §5.8, in the `cancel_move_out` / `cancel_notice` bullet, replace `rent stays a rent line so analytics never see a synthetic adjustment).` with:

```md
rent stays a rent line so analytics never see a synthetic adjustment).

By the time the owner taps Restore, the staying transition's own generation run has usually already issued an `auto` rent invoice for leave date + 1 … the original period end, often paid from the credit §6.6 released. **Restore absorbs that invoice** in the same transaction (owner decision 2026-09-24):

- its allocations go back to credit (`invoice.excess_deallocated`);
- it is cancelled (`invoice.cancelled {reason:'restore_absorbed', restored_invoice_id}`);
- that credit then flows to the restored invoice as above;
- receipts are untouched (§6.7), and a pending claim on it falls back to FIFO on confirm (§6.10).

Only an engine-issued invoice that lies entirely inside that gap is absorbed. Otherwise Restore is refused:

- any other overlapping invoice → 409 `period_overlap`;
- a gap invoice carrying a late fee or an operator-added line → 409 `restore_gap_edited`, until the owner waives or removes it;
- a cancelled invoice's leftover Restore card → 409 `invoice_cancelled`.
```

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/modules/pg-rent/services/rent-invoice.service.ts apps/api/src/modules/pg-rent/__tests__/rent-invoice-actions.integration.test.ts docs/superpowers/specs/2026-09-17-pg-rent-collection-design.md
git commit -m "fix(pg-rent): Restore absorbs the engine's gap invoice instead of refusing period_overlap"
```

---

### Task 9: Full verification and PR

- [ ] **Step 1: Run everything**

```bash
pnpm db:migrate
pnpm --filter @cribliv/shared-types build
pnpm --filter @cribliv/api typecheck
pnpm --filter @cribliv/api exec vitest run src/modules/pg-rent
pnpm --filter @cribliv/api exec vitest run src/modules/pg-rent src/worker src/modules/pg-operations src/modules/admin
pnpm lint
```

Expected: `pnpm db:migrate` applies `0074_pg_rent_invoice_idempotency.sql` (or reports nothing new if Task 7 already did). `src/modules/pg-rent` → **31 files, 212 tests** (baseline at slice start 26 files / 179; this slice: pure 9, message/pay 6, queue 3, tenant 3, read controllers 4 in five new files; Task 7 +3 and Task 8 +5 in existing files). The four-directory run → **58 files, 490 tests** (the 278 in `src/worker`, `src/modules/pg-operations`, `src/modules/admin` are unchanged by this slice). Paste every `Test Files` / `Tests` line; without `DATABASE_URL` the DB suites skip and report green. `rent-payment.integration.test.ts` › "per_day fee shrinks…" is a known intermittent failure: re-run once, report it, do not patch it.

- [ ] **Step 2: Contract, secrets and public-surface checks**

```bash
grep -rn "occupant_phone\|internal_note\|share_token\b" apps/api/src/modules/pg-rent/controllers/pg-rent-public.controller.ts apps/api/src/modules/pg-rent/services/rent-pay-instruction.service.ts | grep -v "whatsapp_phone_e164\|operator_phone" ; echo "(expect nothing above: the public page never returns the tenant phone, internal notes or a share token)"
```

- [ ] **Step 3: Spec housekeeping**

In `docs/superpowers/specs/2026-09-17-pg-rent-collection-design.md`:

1. §12 operator table, `tenants` row: after `` `POST /tenants/:assignmentId/forfeit` (§6.12) `` add ``· `POST /tenants/:assignmentId/identity-dispute/resolve` (§7.9, logs `{flag:'identity_dispute_cleared'}`)``.
2. §4.10 "Tenant-visible subset": replace `` `invoice.*` on invoices that are not `draft` `` with `` `invoice.issued|confirmed_amount|line_added|line_updated|line_removed|due_extended|cancelled|reprorated|excess_deallocated` on invoices that are not `draft` `` and append to that sentence: ``Owner-only: `invoice.draft_created`, `invoice.final_reprorate_suggested`, `invoice.restore_suggested`, `invoice.reprorate_dismissed`, `invoice.pay_token_regenerated`, `reminder.opened`; payloads shown to the tenant carry no `_paise` key and no `rent_source`.`` (this is what `TENANT_VISIBLE_EVENT_SQL` implements).
3. Confirm §4.10 already lists `invoice.pay_token_regenerated` and `reminder.opened`, and §12 lists `POST /messages/preview` and `POST /tenant/pg-rent/claims/:id/notify-message`.

Then run `graphify update .`.

```bash
git add docs/superpowers/specs/2026-09-17-pg-rent-collection-design.md
git commit -m "docs(pg-rent): spec §12 dispute-resolve route, §4.10 tenant-visible event list"
```

- [ ] **Step 4: PR notes (do not open the PR)**

Branch `feat/pg-rent-slice1c-queue-messaging-pay` → base `feat/pg-rent`. Title `feat(pg-rent): collection queue, WhatsApp messaging, pay page API, tenant reads (slice 1c)`. Body: spec sections; the backend is now complete for web slices 2–4; the only backend work left is slice 5's analytics/export/expenses/preferences and slice 6's seed + nightly invariants. Also list:

- Migration `0074_pg_rent_invoice_idempotency.sql` ships in this PR (rollback file included). **Follow-up, not in this PR:** `CLAUDE.md` should say "next free migration 0075" — it has unrelated uncommitted edits in the working tree, so it is not touched here.
- **Parked:** `POST …/tenants/:assignmentId/forfeit` still takes no `Idempotency-Key` (a double submit creates two forfeit invoices).
- **Owner action:** confirm the production API app has `NEXT_PUBLIC_API_BASE_URL` set; otherwise `{receipt_link}` falls back to `${NEXT_PUBLIC_SITE_URL ?? "https://cribliv.com"}/v1/...`, which is only correct if the site proxies `/v1` to the API.
- **Web i18n needed (slice 2):** new 409 codes `restore_gap_edited`, `invoice_cancelled` (Restore) and `duplicate_invoice` (POST /invoices).
- Owner flags from Task 8 (direct payments on the gap invoice move to the restored invoice; surplus stays tenant credit).

---

## Self-review

**Spec coverage.** §7.1 click-to-chat only (no sends anywhere) ✓. §7.2 reminder states, single overdue definition, `{due_phrase}`, offsets warning is a settings-time concern (1a) ✓. §7.3 queue sections incl. every Needs-confirmation row kind, Leaving with Settle/to-return, Overdue ranked ₹×days with in-grace tag and last-reminded, due today/soon, former tenants; `reminder.opened {stage, channel}` per tap ✓ (Tasks 4, 3). §7.4 four templates, merge fields (17), unknown fields literal + flagged, `{upi_id}` "(not set)" + warning, 900-char truncation, Indian grouping, recipients ✓ (Tasks 2, 3). §7.5 tenant-paid message with UTR ✓. §7.6 share pay link / receipt link ✓ (messages + `receipt_share`). §7.7 pay page fields, QR SVG, `tr` sanitised, different-amount (client re-requests `buildPayInstruction` via the same page with `am` omitted — exposed as `instruction.upi_uri` without `am`? **Gap:** the page returns one instruction with `am`; add a second field `upi_uri_open` (no amount) — do it in Task 3's `publicPayPage`: `instruction_open_amount: await this.buildPayInstruction({ ..., amountInr: null })`. Add `instruction_open_amount: PgRentPayInstruction | null` to `PgRentPublicPayPage` in Task 1.) Notify owner text, token format check, expired/paid states, `no-store`, flag-off 404 ✓. §7.8 banners are derived client-side from the summary ✓. §7.9 dispute + resolve ✓ (Task 5). §9 multi-residence, no auto-link on read, hero states (all nine incl. `nothing_due` with next expected date, `leaving`/`settled`), pay panel data, tenant-visible change log, history, deposit block, terms come from the existing residence endpoint ✓. §10.2 month KPIs ✓ (Task 4). §12 tenant/public/messages/reminder-opened/pay-token/portfolio ✓ (Task 6).

**Placeholder scan.** None: Task 6 now carries its four controllers and its test file in full (the earlier elided skeleton is gone). The `instruction_open_amount` gap found in the first self-review is folded into Tasks 1 and 3.

**Type consistency.** `RentPayInstructionService(db)`, `RentMessageService(db, pay)`, `RentTenantService(db, alloc, pay, settlement)`, `RentQueueService(db, settlement)` — same in every test and controller. `fieldsForInvoice` returns `{ fields, locale, row, state, tenantPhone, ownerPhone, verified, payLink, templates }`; the tenant service does not depend on `RentMessageService` (the tenant controller calls `messages.tenantPaidMessage` directly). `PgRentHeroState` union in Task 1 matches every assignment in Task 5. `reminderState` signature identical in Tasks 2, 4, 5.

**Amendment 2026-09-24 (pre-flight audit + owner decisions).** Code blocks in Tasks 2–6 were re-verified against HEAD after slice 1b (typecheck + the pg-rent suite on the local DB); Tasks 7–8 carry the two owner decisions of 2026-09-24; the old Task 7 is Task 9. Audit: `.superpowers/sdd/2026-09-17-pg-rent-slice1c-queue-messaging-pay/preflight-audit.md`.
