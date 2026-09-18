# PG Rent — Slice 1b: Payments, invoice actions, late fees, receipts, settlement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make money move in the ledger slice 1a built: operators record payments and tenants claim them; confirmations allocate, mint receipts and can be reversed; invoices can be edited, issued, extended, cancelled and carry late fees; refunds, move-out settlement, booking forfeits, backfill and manual invoices all work; every mutation keeps the §3 invariants.

**Architecture:** Three new services own the money paths — `RentPaymentService` (intake → `finalizeConfirmed`, the only code that can make an invoice paid), `RentReceiptService` (snapshot mint + Puppeteer render queue + void/re-mint), `RentSettlementService` (statement, settle, forfeit) — and `RentInvoiceService`/`RentAllocationService` from 1a gain the mutation methods. Every total-reducing mutation routes through one `deallocateExcess` procedure (invariant 14). Pure `rent-late-fee.ts` and `rent-allocation.ts` hold the math. Controllers validate with zod and map rupees ⇄ paise only in `dto/`.

**Tech Stack:** NestJS 10, `pg`, zod 4, Handlebars + Puppeteer (`rent-agreement/pdf/browser-pool.ts`), Azure Blob via `AzurePdfStorage`/`AzureSasIssuer` (in-memory/dev adapters locally), vitest + supertest.

**Spec:** `docs/superpowers/specs/2026-09-17-pg-rent-collection-design.md` — §5.6, §5.7, §5.8 (suggestions), §6 entirely (6.1–6.12), §12 (invoice actions, payments, receipts, tenants, claims), §13, §14, §16.

## Global Constraints

Everything in `docs/superpowers/plans/2026-09-17-pg-rent-00-index.md`. Specific to this slice:

- **Depends on slice 1a merged** (`pg-rent` module, 0072 incl. `reprorate_suggestion`, `RentAllocationService.applyUnallocatedCredit/recomputeInvoice`, `RentInvoiceEngineService`, `assertRentInvariants`, `RentFixtures`).
- `finalizeConfirmed` is **private** to `RentPaymentService`; nothing else may write `amount_paid_paise` except `RentAllocationService.recomputeInvoice`.
- Every mutation ends with `assertRentInvariants` in its test.
- Receipts are minted only for confirmed inflows with `source ∈ {operator, tenant_claim, gateway}` (D19). Backfill and deposit-release never mint.
- Outflows are funded by allocation rows (`refund_payment_id`), never free-floating (invariant 15).
- No `_paise`, no `pay_token`, no `share_token` in any HTTP response.
- Puppeteer/Chromium: the render integration test is `describe.skipIf` on `!process.env.PG_RENT_TEST_CHROMIUM`; unit tests render the Handlebars HTML only.

---

## File structure

| File                                                                                                      | Responsibility                                                                                                                        |
| --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/shared-types/src/pg-rent.ts` (modify)                                                           | payment / receipt / settlement / action types                                                                                         |
| `apps/api/src/modules/pg-rent/dto/payment.dto.ts`                                                         | zod: record, claim, confirm, reject, reverse, refund, allocations patch, backfill, manual invoice; payment row → DTO                  |
| `apps/api/src/modules/pg-rent/dto/invoice-actions.dto.ts`                                                 | zod: line add/update, extend-due, cancel, fee apply/waive, eligibility, issue                                                         |
| `apps/api/src/modules/pg-rent/dto/receipt.dto.ts`                                                         | receipt row → DTO                                                                                                                     |
| `apps/api/src/modules/pg-rent/dto/settlement.dto.ts`                                                      | zod: settle, forfeit; statement → DTO                                                                                                 |
| `apps/api/src/modules/pg-rent/pure/rent-late-fee.ts`                                                      | `computeLateFee`, `chargeableBalance`, `daysPastGrace`                                                                                |
| `apps/api/src/modules/pg-rent/pure/rent-allocation.ts`                                                    | `planAllocation` (targeted → FIFO), `planDeallocation` (newest first)                                                                 |
| `apps/api/src/modules/pg-rent/services/rent-allocation.service.ts` (modify)                               | `allocateInflow`, `deallocateExcess`, `releaseAllocations`, `fundOutflow`, `unallocatedCredit`, `removeAllocationsOf`                 |
| `apps/api/src/modules/pg-rent/services/rent-payment.service.ts`                                           | intake (operator / claim / backfill / deposit release), confirm, reject, reverse, refund, reallocate, `finalizeConfirmed`             |
| `apps/api/src/modules/pg-rent/services/rent-invoice.service.ts` (modify)                                  | lines, issue, extend, cancel, fee apply/waive/eligibility/waive-all, manual/backfill/deposit-held invoices, reprorate/dismiss/restore |
| `apps/api/src/modules/pg-rent/services/rent-invoice-engine.service.ts` (modify)                           | `onAssignmentEvent` writes / clears `reprorate_suggestion`                                                                            |
| `apps/api/src/modules/pg-rent/services/rent-receipt.service.ts`                                           | mint, render, sweep claim, void, re-mint, retry, share token, download URL                                                            |
| `apps/api/src/modules/pg-rent/receipt/receipt-renderer.ts` + `templates/receipt.en.hbs`, `receipt.hi.hbs` | HTML + PDF                                                                                                                            |
| `apps/api/src/modules/pg-rent/services/rent-settlement.service.ts`                                        | statement, settle, forfeit                                                                                                            |
| `apps/api/src/modules/pg-rent/services/rent-guards.ts` (modify)                                           | `resolveTenantAssignments`, `lockTenantAssignmentForWrite`                                                                            |
| `apps/api/src/modules/pg-rent/controllers/pg-rent-payments.controller.ts`                                 | payments / refunds / receipts routes                                                                                                  |
| `apps/api/src/modules/pg-rent/controllers/pg-rent-invoices.controller.ts` (modify)                        | action routes + `POST /invoices`                                                                                                      |
| `apps/api/src/modules/pg-rent/controllers/pg-rent-settlement.controller.ts`                               | `GET /tenants/:id/settlement`, `POST …/settle`, `POST …/forfeit`                                                                      |
| `apps/api/src/modules/pg-rent/controllers/pg-rent-tenant-claims.controller.ts`                            | `POST /tenant/pg-rent/claims`, `DELETE …/claims/:id`, `GET …/receipts/:id/download`                                                   |
| `apps/api/src/modules/pg-rent/pg-rent.module.ts` (modify)                                                 | providers, PDF storage/SAS tokens                                                                                                     |
| `apps/api/src/worker/pg-rent-sweeps.ts` (modify) + `worker.ts`                                            | `runPgRentLateFeeSweep` (hourly), `runPgRentReceiptSweep` (2 min)                                                                     |
| `apps/api/src/modules/pg-rent/__tests__/*.test.ts`                                                        | suites per task                                                                                                                       |

---

### Task 1: Shared types and payment DTOs

**Files:**

- Modify: `packages/shared-types/src/pg-rent.ts` (append)
- Create: `apps/api/src/modules/pg-rent/dto/payment.dto.ts`
- Test: `apps/api/src/modules/pg-rent/__tests__/payment-dto.test.ts`

**Interfaces:**

- Produces the types below (all rupees) and the zod schemas `RecordPaymentSchema`, `ClaimPaymentSchema`, `ConfirmPaymentSchema`, `RejectPaymentSchema`, `ReversePaymentSchema`, `RefundSchema`, `AllocationsPatchSchema`, `BackfillSchema`, `ManualInvoiceSchema`, plus `toPaymentDto(row, allocations)`.

- [ ] **Step 1: Append the shared types**

```ts
// packages/shared-types/src/pg-rent.ts — append

export interface PgRentAllocation {
  id: string;
  payment_id: string;
  invoice_id: string | null;
  invoice_number: string | null;
  refund_payment_id: string | null;
  amount_inr: number;
  created_at: string;
}

export interface PgRentPayment {
  id: string;
  pg_property_id: string;
  assignment_id: string;
  occupant_name: string;
  direction: PgRentPaymentDirection;
  amount_inr: number;
  /** amount − Σ allocations; only meaningful for confirmed inflows */
  unallocated_inr: number;
  method: PgRentPaymentMethod;
  source: PgRentPaymentSource;
  status: PgRentPaymentStatus;
  claimed_invoice_id: string | null;
  paid_on: string;
  reference: string | null;
  proof_paths: string[];
  note: string | null;
  recorded_by: string | null;
  confirmed_by: string | null;
  confirmed_at: string | null;
  rejected_reason: string | null;
  reversed_at: string | null;
  reversed_reason: string | null;
  receipt_id: string | null;
  allocations: PgRentAllocation[];
  created_at: string;
  updated_at: string;
}

export interface PgRentAllocationTarget {
  invoice_id: string;
  amount_inr: number;
}

export interface PgRentRecordPaymentInput {
  assignment_id: string;
  amount_inr: number;
  method: Exclude<PgRentPaymentMethod, "gateway" | "deposit">;
  paid_on: string;
  reference?: string | null;
  note?: string | null;
  proof_paths?: string[];
  /** Operator-chosen split; omitted = targeted invoice (if any) then FIFO. */
  allocations?: PgRentAllocationTarget[];
  claimed_invoice_id?: string | null;
}

export interface PgRentClaimInput {
  assignment_id: string;
  invoice_id?: string | null;
  amount_inr: number;
  method: Exclude<PgRentPaymentMethod, "gateway" | "deposit" | "cash">;
  paid_on: string;
  reference?: string | null;
  note?: string | null;
  proof_paths?: string[];
  idempotency_key: string;
}

export interface PgRentConfirmInput {
  amount_inr?: number;
  method?: Exclude<PgRentPaymentMethod, "gateway" | "deposit">;
  paid_on?: string;
  allocations?: PgRentAllocationTarget[];
}

export interface PgRentRejectInput {
  reason: string;
}
export interface PgRentReverseInput {
  reason: string;
}

export interface PgRentRefundInput {
  assignment_id: string;
  amount_inr: number;
  method: Exclude<PgRentPaymentMethod, "gateway" | "deposit">;
  paid_on: string;
  reference?: string | null;
  reason: string;
}

export interface PgRentAllocationsPatchInput {
  allocations: PgRentAllocationTarget[];
}

export interface PgRentBackfillInput {
  assignment_id: string;
  /** rent | adhoc | deposit ("Deposit held") */
  kind: Extract<PgRentInvoiceKind, "rent" | "adhoc" | "deposit">;
  period_start?: string;
  period_end?: string;
  due_date: string;
  lines: Array<{ kind: PgRentLineKind; label: string; amount_inr: number }>;
  /** omitted = unpaid backfill invoice */
  payment?: {
    amount_inr: number;
    method: Exclude<PgRentPaymentMethod, "gateway" | "deposit">;
    paid_on: string;
    reference?: string | null;
  };
}

export interface PgRentManualInvoiceInput {
  assignment_id: string;
  kind: Extract<PgRentInvoiceKind, "adhoc">;
  due_date: string;
  lines: Array<{ kind: PgRentLineKind; label: string; amount_inr: number }>;
  tenant_note?: string | null;
}

export interface PgRentBulkResult<T = string> {
  succeeded: T[];
  failed: Array<{ id: string; code: string }>;
}

export interface PgRentReceipt {
  id: string;
  payment_id: string;
  assignment_id: string;
  receipt_number: string;
  amount_inr: number;
  pdf_status: "pending" | "ready" | "failed";
  attempts: number;
  last_error: string | null;
  generated_at: string | null;
  voided_at: string | null;
  void_reason: string | null;
  superseded_by: string | null;
  share_expires_at: string | null;
  created_at: string;
}

export interface PgRentReceiptDownload {
  url: string;
  expires_at: string;
}

export interface PgRentSettlementStatement {
  assignment_id: string;
  status: PgRentSettlementStatus;
  deposit_held_inr: number;
  credit_inr: number;
  open_dues_inr: number;
  open_invoices: Array<{
    invoice_id: string;
    invoice_number: string;
    kind: PgRentInvoiceKind;
    balance_inr: number;
  }>;
  deposit_uncollected_inr: number;
  pending_suggestion: {
    invoice_id: string;
    leave_on: string;
    from_inr: number;
    to_inr: number;
  } | null;
  maintenance_prefills: Array<{ request_id: string; label: string; amount_inr: number | null }>;
  /** already-entered deductions when re-settling */
  deductions: Array<{ kind: PgRentLineKind; label: string; amount_inr: number }>;
  net_inr: number;
  to_return_inr: number;
  settlement_invoice_id: string | null;
}

export type PgRentSettlementStatus = "not_leaving" | "leaving" | "settled" | "nothing_to_settle";

export interface PgRentSettleInput {
  deductions: Array<{
    kind: Extract<PgRentLineKind, "damage" | "cleaning" | "forfeit" | "other">;
    label: string;
    amount_inr: number;
  }>;
  return_now?: {
    amount_inr: number;
    method: Exclude<PgRentPaymentMethod, "gateway" | "deposit">;
    paid_on: string;
    reference?: string | null;
  } | null;
  note?: string | null;
}

export interface PgRentForfeitInput {
  amount_inr: number;
  label?: string;
}

export interface PgRentLineInput {
  kind: Exclude<PgRentLineKind, "rent" | "deposit" | "late_fee">;
  label: string;
  amount_inr: number;
  meta?: Record<string, unknown>;
}

export interface PgRentLinePatchInput {
  label?: string;
  amount_inr?: number;
  meta?: Record<string, unknown>;
}

export interface PgRentExtendDueInput {
  due_date: string;
}
export interface PgRentCancelInvoiceInput {
  reason: string;
}
export interface PgRentIssueDraftInput {
  rent_inr?: number;
  due_date?: string;
}
export interface PgRentApplyFeeInput {
  amount_inr?: number;
}
export interface PgRentWaiveFeeInput {
  reason: string;
}
export interface PgRentEligibilityInput {
  late_fee_eligible: boolean;
}
```

Then `pnpm --filter @cribliv/shared-types build`.

- [ ] **Step 2: Write the failing DTO tests**

```ts
// apps/api/src/modules/pg-rent/__tests__/payment-dto.test.ts
import { describe, expect, it } from "vitest";

import { parseOrThrow } from "../dto/common";
import {
  AllocationsPatchSchema,
  BackfillSchema,
  ClaimPaymentSchema,
  ConfirmPaymentSchema,
  ManualInvoiceSchema,
  RecordPaymentSchema,
  RefundSchema,
  RejectPaymentSchema,
  toPaymentDto,
  type RentAllocationRow,
  type RentPaymentRow
} from "../dto/payment.dto";

const UUID = "11111111-1111-1111-1111-111111111111";
const UUID2 = "22222222-2222-2222-2222-222222222222";

describe("payment schemas", () => {
  it("accepts a valid record input with an explicit split", () => {
    const parsed = parseOrThrow(RecordPaymentSchema, {
      assignment_id: UUID,
      amount_inr: 9000,
      method: "upi",
      paid_on: "2026-09-03",
      reference: "123456789012",
      allocations: [{ invoice_id: UUID2, amount_inr: 9000 }]
    });
    expect(parsed.allocations).toEqual([{ invoice_id: UUID2, amount_inr: 9000 }]);
  });
  it("rejects out-of-bound or ill-typed inputs", () => {
    for (const bad of [
      { assignment_id: UUID, amount_inr: 0, method: "cash", paid_on: "2026-09-03" },
      { assignment_id: UUID, amount_inr: 1000001, method: "cash", paid_on: "2026-09-03" },
      { assignment_id: UUID, amount_inr: 12.5, method: "cash", paid_on: "2026-09-03" },
      { assignment_id: UUID, amount_inr: 100, method: "gateway", paid_on: "2026-09-03" },
      { assignment_id: UUID, amount_inr: 100, method: "deposit", paid_on: "2026-09-03" },
      { assignment_id: UUID, amount_inr: 100, method: "cash", paid_on: "2026-13-03" },
      {
        assignment_id: UUID,
        amount_inr: 100,
        method: "cash",
        paid_on: "2026-09-03",
        reference: "x".repeat(65)
      },
      {
        assignment_id: UUID,
        amount_inr: 100,
        method: "cash",
        paid_on: "2026-09-03",
        proof_paths: ["a", "b", "c", "d"]
      },
      {
        assignment_id: UUID,
        amount_inr: 100,
        method: "cash",
        paid_on: "2026-09-03",
        allocations: [{ invoice_id: UUID2, amount_inr: 0 }]
      },
      { assignment_id: "nope", amount_inr: 100, method: "cash", paid_on: "2026-09-03" }
    ]) {
      expect(() => parseOrThrow(RecordPaymentSchema, bad), JSON.stringify(bad)).toThrow();
    }
  });
  it("claims cannot be cash and need an idempotency key", () => {
    expect(() =>
      parseOrThrow(ClaimPaymentSchema, {
        assignment_id: UUID,
        amount_inr: 100,
        method: "cash",
        paid_on: "2026-09-03",
        idempotency_key: UUID
      })
    ).toThrow();
    expect(() =>
      parseOrThrow(ClaimPaymentSchema, {
        assignment_id: UUID,
        amount_inr: 100,
        method: "upi",
        paid_on: "2026-09-03"
      })
    ).toThrow();
    expect(
      parseOrThrow(ClaimPaymentSchema, {
        assignment_id: UUID,
        amount_inr: 100,
        method: "upi",
        paid_on: "2026-09-03",
        idempotency_key: UUID
      }).idempotency_key
    ).toBe(UUID);
  });
  it("reject/refund need a reason; refund bounds; confirm is all-optional", () => {
    expect(() => parseOrThrow(RejectPaymentSchema, { reason: "" })).toThrow();
    expect(parseOrThrow(RejectPaymentSchema, { reason: "Not received" }).reason).toBe(
      "Not received"
    );
    expect(() =>
      parseOrThrow(RefundSchema, {
        assignment_id: UUID,
        amount_inr: 100,
        method: "cash",
        paid_on: "2026-09-03"
      })
    ).toThrow();
    expect(parseOrThrow(ConfirmPaymentSchema, {})).toEqual({});
    expect(parseOrThrow(AllocationsPatchSchema, { allocations: [] }).allocations).toEqual([]);
  });
  it("backfill needs a period for rent, none for deposit/adhoc; manual is adhoc only", () => {
    expect(() =>
      parseOrThrow(BackfillSchema, {
        assignment_id: UUID,
        kind: "rent",
        due_date: "2026-09-05",
        lines: [{ kind: "rent", label: "Rent", amount_inr: 9000 }]
      })
    ).toThrow();
    expect(
      parseOrThrow(BackfillSchema, {
        assignment_id: UUID,
        kind: "deposit",
        due_date: "2026-09-05",
        lines: [{ kind: "deposit", label: "Deposit", amount_inr: 18000 }],
        payment: { amount_inr: 18000, method: "cash", paid_on: "2026-09-03" }
      }).kind
    ).toBe("deposit");
    expect(() =>
      parseOrThrow(ManualInvoiceSchema, {
        assignment_id: UUID,
        kind: "rent",
        due_date: "2026-09-05",
        lines: [{ kind: "other", label: "x", amount_inr: 1 }]
      })
    ).toThrow();
    expect(() =>
      parseOrThrow(ManualInvoiceSchema, {
        assignment_id: UUID,
        kind: "adhoc",
        due_date: "2026-09-05",
        lines: []
      })
    ).toThrow();
  });
});

describe("toPaymentDto", () => {
  it("maps paise to rupees, computes unallocated, hides nothing it should show", () => {
    const row: RentPaymentRow = {
      id: UUID,
      pg_property_id: UUID2,
      assignment_id: UUID2,
      occupant_name: "Rahul",
      direction: "inflow",
      amount_paise: "900000",
      method: "upi",
      source: "operator",
      status: "confirmed",
      claimed_invoice_id: null,
      paid_on: "2026-09-03",
      reference: "UTR1",
      proof_paths: [],
      note: null,
      recorded_by: UUID,
      confirmed_by: UUID,
      confirmed_at: new Date("2026-09-03T05:00:00Z"),
      rejected_reason: null,
      reversed_at: null,
      reversed_reason: null,
      receipt_id: UUID2,
      created_at: new Date("2026-09-03T05:00:00Z"),
      updated_at: new Date("2026-09-03T05:00:00Z")
    };
    const allocs: RentAllocationRow[] = [
      {
        id: UUID,
        payment_id: UUID,
        invoice_id: UUID2,
        invoice_number: "SUN-INV-0001",
        refund_payment_id: null,
        amount_paise: "600000",
        created_at: new Date("2026-09-03T05:00:00Z")
      }
    ];
    const dto = toPaymentDto(row, allocs);
    expect(dto).toMatchObject({
      amount_inr: 9000,
      unallocated_inr: 3000,
      receipt_id: UUID2,
      confirmed_at: "2026-09-03T05:00:00.000Z"
    });
    expect(dto.allocations[0]).toMatchObject({ invoice_number: "SUN-INV-0001", amount_inr: 6000 });
    expect(JSON.stringify(dto)).not.toMatch(/_paise/);
  });
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `pnpm --filter @cribliv/api exec vitest run src/modules/pg-rent/__tests__/payment-dto.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement `dto/payment.dto.ts`**

```ts
// apps/api/src/modules/pg-rent/dto/payment.dto.ts
import { z } from "zod";
import type {
  PgRentAllocation,
  PgRentAllocationsPatchInput,
  PgRentBackfillInput,
  PgRentClaimInput,
  PgRentConfirmInput,
  PgRentManualInvoiceInput,
  PgRentPayment,
  PgRentRecordPaymentInput,
  PgRentRefundInput,
  PgRentRejectInput,
  PgRentReverseInput
} from "@cribliv/shared-types";

import { isIsoDate } from "../../../common/date";
import { toIsoDate, toIsoTs } from "./common";
import { paiseToInr } from "./money";

const isoDate = z.string().refine(isIsoDate, "must be a real YYYY-MM-DD date");
const uuid = z.string().uuid();
/** ₹1 – ₹10,00,000 whole rupees (spec §4.6). */
const amountInr = z.number().int().min(1).max(1000000);
const reference = z.string().trim().max(64).nullable().optional();
const note = z.string().trim().max(200).nullable().optional();
const proofPaths = z.array(z.string().min(1).max(300)).max(3).optional();
const recordableMethod = z.enum(["cash", "upi", "bank_transfer", "cheque", "card", "other"]);
const claimableMethod = z.enum(["upi", "bank_transfer", "cheque", "card", "other"]);
const allocationTargets = z
  .array(z.object({ invoice_id: uuid, amount_inr: amountInr }).strict())
  .max(20);
const LINE_KINDS = [
  "rent",
  "deposit",
  "late_fee",
  "electricity",
  "meals",
  "maintenance",
  "damage",
  "cleaning",
  "forfeit",
  "other",
  "discount",
  "adjustment"
] as const;
const lineInput = z
  .object({
    kind: z.enum(LINE_KINDS),
    label: z.string().trim().min(1).max(40),
    amount_inr: z.number().int().min(-1000000).max(1000000)
  })
  .strict();

export const RecordPaymentSchema = z.object({
  assignment_id: uuid,
  amount_inr: amountInr,
  method: recordableMethod,
  paid_on: isoDate,
  reference,
  note,
  proof_paths: proofPaths,
  allocations: allocationTargets.optional(),
  claimed_invoice_id: uuid.nullable().optional()
}) satisfies z.ZodType<PgRentRecordPaymentInput, PgRentRecordPaymentInput>;

export const ClaimPaymentSchema = z.object({
  assignment_id: uuid,
  invoice_id: uuid.nullable().optional(),
  amount_inr: amountInr,
  method: claimableMethod,
  paid_on: isoDate,
  reference,
  note,
  proof_paths: proofPaths,
  idempotency_key: z.string().min(8).max(64)
}) satisfies z.ZodType<PgRentClaimInput, PgRentClaimInput>;

export const ConfirmPaymentSchema = z.object({
  amount_inr: amountInr.optional(),
  method: recordableMethod.optional(),
  paid_on: isoDate.optional(),
  allocations: allocationTargets.optional()
}) satisfies z.ZodType<PgRentConfirmInput, PgRentConfirmInput>;

export const RejectPaymentSchema = z.object({
  reason: z.string().trim().min(1).max(200)
}) satisfies z.ZodType<PgRentRejectInput, PgRentRejectInput>;
export const ReversePaymentSchema = z.object({
  reason: z.string().trim().min(1).max(200)
}) satisfies z.ZodType<PgRentReverseInput, PgRentReverseInput>;

export const RefundSchema = z.object({
  assignment_id: uuid,
  amount_inr: amountInr,
  method: recordableMethod,
  paid_on: isoDate,
  reference,
  reason: z.string().trim().min(1).max(200)
}) satisfies z.ZodType<PgRentRefundInput, PgRentRefundInput>;

export const AllocationsPatchSchema = z.object({
  allocations: allocationTargets
}) satisfies z.ZodType<PgRentAllocationsPatchInput, PgRentAllocationsPatchInput>;

export const BackfillSchema = z
  .object({
    assignment_id: uuid,
    kind: z.enum(["rent", "adhoc", "deposit"]),
    period_start: isoDate.optional(),
    period_end: isoDate.optional(),
    due_date: isoDate,
    lines: z.array(lineInput).min(1).max(10),
    payment: z
      .object({ amount_inr: amountInr, method: recordableMethod, paid_on: isoDate, reference })
      .strict()
      .optional()
  })
  .refine(
    (v) => v.kind !== "rent" || (v.period_start && v.period_end && v.period_start <= v.period_end),
    {
      message: "rent backfill needs period_start <= period_end"
    }
  ) satisfies z.ZodType<PgRentBackfillInput, PgRentBackfillInput>;

export const ManualInvoiceSchema = z.object({
  assignment_id: uuid,
  kind: z.literal("adhoc"),
  due_date: isoDate,
  lines: z.array(lineInput).min(1).max(10),
  tenant_note: note
}) satisfies z.ZodType<PgRentManualInvoiceInput, PgRentManualInvoiceInput>;

export interface RentPaymentRow {
  id: string;
  pg_property_id: string;
  assignment_id: string;
  occupant_name: string;
  direction: PgRentPayment["direction"];
  amount_paise: string;
  method: PgRentPayment["method"];
  source: PgRentPayment["source"];
  status: PgRentPayment["status"];
  claimed_invoice_id: string | null;
  paid_on: Date | string;
  reference: string | null;
  proof_paths: string[];
  note: string | null;
  recorded_by: string | null;
  confirmed_by: string | null;
  confirmed_at: Date | string | null;
  rejected_reason: string | null;
  reversed_at: Date | string | null;
  reversed_reason: string | null;
  receipt_id: string | null;
  created_at: Date | string;
  updated_at: Date | string;
}

export interface RentAllocationRow {
  id: string;
  payment_id: string;
  invoice_id: string | null;
  invoice_number: string | null;
  refund_payment_id: string | null;
  amount_paise: string;
  created_at: Date | string;
}

export const PAYMENT_SELECT = `
  p.id::text, p.pg_property_id::text, p.assignment_id::text, a.occupant_name, p.direction::text, p.amount_paise::text,
  p.method::text, p.source::text, p.status::text, p.claimed_invoice_id::text, p.paid_on, p.reference, p.proof_paths, p.note,
  p.recorded_by::text, p.confirmed_by::text, p.confirmed_at, p.rejected_reason, p.reversed_at, p.reversed_reason,
  (SELECT r.id::text FROM pg_rent_receipts r WHERE r.payment_id = p.id AND r.voided_at IS NULL LIMIT 1) AS receipt_id,
  p.created_at, p.updated_at`;

export const ALLOCATION_SELECT = `
  al.id::text, al.payment_id::text, al.invoice_id::text, i.invoice_number, al.refund_payment_id::text, al.amount_paise::text, al.created_at`;

export function toAllocationDto(row: RentAllocationRow): PgRentAllocation {
  return {
    id: row.id,
    payment_id: row.payment_id,
    invoice_id: row.invoice_id,
    invoice_number: row.invoice_number,
    refund_payment_id: row.refund_payment_id,
    amount_inr: paiseToInr(row.amount_paise),
    created_at: toIsoTs(row.created_at) as string
  };
}

export function toPaymentDto(row: RentPaymentRow, allocations: RentAllocationRow[]): PgRentPayment {
  const mine = allocations.filter((a) => a.payment_id === row.id);
  const allocated = mine.reduce((sum, a) => sum + Number(a.amount_paise), 0);
  return {
    id: row.id,
    pg_property_id: row.pg_property_id,
    assignment_id: row.assignment_id,
    occupant_name: row.occupant_name,
    direction: row.direction,
    amount_inr: paiseToInr(row.amount_paise),
    unallocated_inr:
      row.direction === "inflow" && row.status === "confirmed"
        ? paiseToInr(Number(row.amount_paise) - allocated)
        : 0,
    method: row.method,
    source: row.source,
    status: row.status,
    claimed_invoice_id: row.claimed_invoice_id,
    paid_on: toIsoDate(row.paid_on) as string,
    reference: row.reference,
    proof_paths: row.proof_paths ?? [],
    note: row.note,
    recorded_by: row.recorded_by,
    confirmed_by: row.confirmed_by,
    confirmed_at: toIsoTs(row.confirmed_at),
    rejected_reason: row.rejected_reason,
    reversed_at: toIsoTs(row.reversed_at),
    reversed_reason: row.reversed_reason,
    receipt_id: row.receipt_id,
    allocations: mine.map(toAllocationDto),
    created_at: toIsoTs(row.created_at) as string,
    updated_at: toIsoTs(row.updated_at) as string
  };
}
```

- [ ] **Step 5: Run to verify it passes**

Run: `pnpm --filter @cribliv/api exec vitest run src/modules/pg-rent/__tests__/payment-dto.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 6: Commit**

```bash
git add packages/shared-types/src/pg-rent.ts apps/api/src/modules/pg-rent/dto/payment.dto.ts apps/api/src/modules/pg-rent/__tests__/payment-dto.test.ts
git commit -m "feat(pg-rent): payment, receipt and settlement wire types and payment DTOs"
```

---

### Task 2: Pure late-fee and allocation math

**Files:**

- Create: `apps/api/src/modules/pg-rent/pure/rent-late-fee.ts`
- Create: `apps/api/src/modules/pg-rent/pure/rent-allocation.ts`
- Test: `apps/api/src/modules/pg-rent/__tests__/rent-late-fee-allocation.test.ts`

**Interfaces:**

```ts
// rent-late-fee.ts
export interface LateFeePolicy {
  kind: "flat" | "per_day" | "percent";
  amountPaise: number;
  percentBp: number;
  capPaise: number | null;
  graceDays: number;
}
export interface LateFeeInput {
  policy: LateFeePolicy;
  dueDate: string;
  asOf: string;
  /** unpaid balance excluding any existing late_fee line (spec §5.6) */
  chargeablePaise: number;
  overridePaise: number | null; // tenant late_fee_override_paise
  existingFeePaise: number | null; // current late_fee line, if any
  frozen: boolean; // late_fee_computed_at is set (flat/percent/override already computed)
}
export function daysPastGrace(dueDate: string, graceDays: number, asOf: string): number; // ≥ 0
export function computeLateFee(i: LateFeeInput): {
  feePaise: number;
  action: "none" | "apply" | "update" | "remove" | "freeze";
};

// rent-allocation.ts
export interface OpenInvoice {
  invoiceId: string;
  kind: "rent" | "deposit" | "adhoc" | "settlement";
  dueDate: string;
  balancePaise: number;
}
export function planAllocation(
  amountPaise: number,
  open: OpenInvoice[],
  targets: Array<{ invoiceId: string; amountPaise: number }>
): { allocations: Array<{ invoiceId: string; amountPaise: number }>; creditPaise: number };
export interface ExistingAllocation {
  allocationId: string;
  paymentId: string;
  amountPaise: number;
  createdAt: string;
}
export function planDeallocation(
  excessPaise: number,
  allocations: ExistingAllocation[]
): Array<{ allocationId: string; paymentId: string; reducePaise: number }>; // newest first
```

- [ ] **Step 1: Write the failing tests**

```ts
// apps/api/src/modules/pg-rent/__tests__/rent-late-fee-allocation.test.ts
import { describe, expect, it } from "vitest";

import { planAllocation, planDeallocation } from "../pure/rent-allocation";
import { computeLateFee, daysPastGrace } from "../pure/rent-late-fee";

const flat = {
  kind: "flat",
  amountPaise: 30000,
  percentBp: 200,
  capPaise: null,
  graceDays: 3
} as const;
const perDay = {
  kind: "per_day",
  amountPaise: 5000,
  percentBp: 200,
  capPaise: 50000,
  graceDays: 3
} as const;
const percent = {
  kind: "percent",
  amountPaise: 30000,
  percentBp: 250,
  capPaise: null,
  graceDays: 3
} as const;
const base = {
  dueDate: "2026-10-05",
  chargeablePaise: 900000,
  overridePaise: null,
  existingFeePaise: null,
  frozen: false
};

describe("daysPastGrace", () => {
  it("counts days after due + grace, never negative", () => {
    expect(daysPastGrace("2026-10-05", 3, "2026-10-08")).toBe(0);
    expect(daysPastGrace("2026-10-05", 3, "2026-10-09")).toBe(1);
    expect(daysPastGrace("2026-10-05", 3, "2026-10-20")).toBe(12);
    expect(daysPastGrace("2026-10-05", 0, "2026-10-01")).toBe(0);
  });
});

describe("computeLateFee (spec §5.6)", () => {
  it("does nothing inside grace, and REMOVES an existing fee when as-of is inside grace (paid_within_grace)", () => {
    expect(computeLateFee({ ...base, policy: flat, asOf: "2026-10-08" })).toEqual({
      feePaise: 0,
      action: "none"
    });
    expect(
      computeLateFee({
        ...base,
        policy: flat,
        asOf: "2026-10-08",
        existingFeePaise: 30000,
        frozen: true
      })
    ).toEqual({ feePaise: 0, action: "remove" });
  });
  it("flat: applies once and then stays frozen", () => {
    expect(computeLateFee({ ...base, policy: flat, asOf: "2026-10-09" })).toEqual({
      feePaise: 30000,
      action: "apply"
    });
    expect(
      computeLateFee({
        ...base,
        policy: flat,
        asOf: "2026-10-20",
        existingFeePaise: 30000,
        frozen: true
      })
    ).toEqual({ feePaise: 30000, action: "none" });
  });
  it("percent: bp of the chargeable balance, rounded to the rupee, frozen afterwards", () => {
    expect(computeLateFee({ ...base, policy: percent, asOf: "2026-10-09" })).toEqual({
      feePaise: 22500,
      action: "apply"
    });
    expect(
      computeLateFee({ ...base, policy: percent, asOf: "2026-10-09", chargeablePaise: 123456 })
    ).toEqual({ feePaise: 3100, action: "apply" });
    expect(
      computeLateFee({
        ...base,
        policy: percent,
        asOf: "2026-10-20",
        chargeablePaise: 400000,
        existingFeePaise: 22500,
        frozen: true
      })
    ).toEqual({ feePaise: 22500, action: "none" });
  });
  it("per_day: grows daily, caps, updates only when the amount changes, and can shrink when recomputed as of paid_on", () => {
    expect(computeLateFee({ ...base, policy: perDay, asOf: "2026-10-09" })).toEqual({
      feePaise: 5000,
      action: "apply"
    });
    expect(
      computeLateFee({ ...base, policy: perDay, asOf: "2026-10-12", existingFeePaise: 5000 })
    ).toEqual({ feePaise: 20000, action: "update" });
    expect(
      computeLateFee({ ...base, policy: perDay, asOf: "2026-10-12", existingFeePaise: 20000 })
    ).toEqual({ feePaise: 20000, action: "none" });
    expect(
      computeLateFee({ ...base, policy: perDay, asOf: "2026-12-01", existingFeePaise: 20000 })
    ).toEqual({ feePaise: 50000, action: "update" });
    // recompute as of an earlier paid_on: shrinks
    expect(
      computeLateFee({ ...base, policy: perDay, asOf: "2026-10-10", existingFeePaise: 20000 })
    ).toEqual({ feePaise: 10000, action: "update" });
  });
  it("freezes when the chargeable balance is zero (only the fee is left)", () => {
    expect(
      computeLateFee({
        ...base,
        policy: perDay,
        asOf: "2026-12-01",
        chargeablePaise: 0,
        existingFeePaise: 20000
      })
    ).toEqual({ feePaise: 20000, action: "freeze" });
    expect(
      computeLateFee({ ...base, policy: perDay, asOf: "2026-12-01", chargeablePaise: 0 })
    ).toEqual({ feePaise: 0, action: "none" });
  });
  it("tenant override replaces the computed fee, once", () => {
    expect(
      computeLateFee({ ...base, policy: perDay, asOf: "2026-10-20", overridePaise: 10000 })
    ).toEqual({ feePaise: 10000, action: "apply" });
    expect(
      computeLateFee({
        ...base,
        policy: perDay,
        asOf: "2026-11-20",
        overridePaise: 10000,
        existingFeePaise: 10000,
        frozen: true
      })
    ).toEqual({ feePaise: 10000, action: "none" });
  });
});

describe("planAllocation (spec §6.2)", () => {
  const open = [
    { invoiceId: "dep", kind: "deposit", dueDate: "2026-09-01", balancePaise: 1800000 },
    { invoiceId: "sep", kind: "rent", dueDate: "2026-09-05", balancePaise: 900000 },
    { invoiceId: "oct", kind: "rent", dueDate: "2026-10-05", balancePaise: 900000 },
    { invoiceId: "set", kind: "settlement", dueDate: "2026-09-01", balancePaise: 50000 }
  ] as const;
  it("targets first, then FIFO by due date (deposit before rent on ties, settlement last), remainder is credit", () => {
    expect(planAllocation(1000000, [...open], [{ invoiceId: "oct", amountPaise: 400000 }])).toEqual(
      {
        allocations: [
          { invoiceId: "oct", amountPaise: 400000 },
          { invoiceId: "dep", amountPaise: 600000 }
        ],
        creditPaise: 0
      }
    );
    expect(planAllocation(3700000, [...open], [])).toEqual({
      allocations: [
        { invoiceId: "dep", amountPaise: 1800000 },
        { invoiceId: "sep", amountPaise: 900000 },
        { invoiceId: "oct", amountPaise: 900000 },
        { invoiceId: "set", amountPaise: 50000 }
      ],
      creditPaise: 50000
    });
  });
  it("refuses a target that exceeds the invoice balance, the payment, or is not open", () => {
    expect(() =>
      planAllocation(100000, [...open], [{ invoiceId: "sep", amountPaise: 950000 }])
    ).toThrow(/exceeds invoice balance/);
    expect(() =>
      planAllocation(
        100000,
        [...open],
        [
          { invoiceId: "sep", amountPaise: 100000 },
          { invoiceId: "oct", amountPaise: 1 }
        ]
      )
    ).toThrow(/exceeds payment/);
    expect(() =>
      planAllocation(100000, [...open], [{ invoiceId: "nope", amountPaise: 1 }])
    ).toThrow(/not open/);
  });
  it("with no open invoices everything is credit", () => {
    expect(planAllocation(100000, [], [])).toEqual({ allocations: [], creditPaise: 100000 });
  });
});

describe("planDeallocation (invariant 14, newest first)", () => {
  const allocs = [
    { allocationId: "a1", paymentId: "p1", amountPaise: 500000, createdAt: "2026-09-03T00:00:00Z" },
    { allocationId: "a2", paymentId: "p2", amountPaise: 400000, createdAt: "2026-09-10T00:00:00Z" }
  ];
  it("reduces the newest allocation first and spills into older ones", () => {
    expect(planDeallocation(100000, allocs)).toEqual([
      { allocationId: "a2", paymentId: "p2", reducePaise: 100000 }
    ]);
    expect(planDeallocation(450000, allocs)).toEqual([
      { allocationId: "a2", paymentId: "p2", reducePaise: 400000 },
      { allocationId: "a1", paymentId: "p1", reducePaise: 50000 }
    ]);
  });
  it("refuses to de-allocate more than exists or nothing", () => {
    expect(() => planDeallocation(1000000, allocs)).toThrow(/exceeds/);
    expect(planDeallocation(0, allocs)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @cribliv/api exec vitest run src/modules/pg-rent/__tests__/rent-late-fee-allocation.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement**

```ts
// apps/api/src/modules/pg-rent/pure/rent-late-fee.ts
import { addDays, compareIso, daysInclusive } from "./rent-dates";
import { roundToRupee } from "./rent-money";

export interface LateFeePolicy {
  kind: "flat" | "per_day" | "percent";
  amountPaise: number;
  percentBp: number;
  capPaise: number | null;
  graceDays: number;
}

export interface LateFeeInput {
  policy: LateFeePolicy;
  dueDate: string;
  asOf: string;
  chargeablePaise: number;
  overridePaise: number | null;
  existingFeePaise: number | null;
  frozen: boolean;
}

export function daysPastGrace(dueDate: string, graceDays: number, asOf: string): number {
  const graceEnd = addDays(dueDate, graceDays);
  if (compareIso(asOf, graceEnd) <= 0) return 0;
  return daysInclusive(graceEnd, asOf) - 1;
}

/**
 * Spec §5.6. Pure: the caller decides what "asOf" means (today for the sweep,
 * paid_on when a payment settles the chargeable balance).
 */
export function computeLateFee(i: LateFeeInput): {
  feePaise: number;
  action: "none" | "apply" | "update" | "remove" | "freeze";
} {
  const days = daysPastGrace(i.dueDate, i.policy.graceDays, i.asOf);
  const existing = i.existingFeePaise;

  if (days === 0) {
    return existing !== null ? { feePaise: 0, action: "remove" } : { feePaise: 0, action: "none" };
  }
  if (i.chargeablePaise <= 0) {
    return existing !== null
      ? { feePaise: existing, action: "freeze" }
      : { feePaise: 0, action: "none" };
  }
  if (i.frozen && existing !== null) return { feePaise: existing, action: "none" };

  let fee: number;
  if (i.overridePaise !== null) fee = i.overridePaise;
  else if (i.policy.kind === "flat") fee = i.policy.amountPaise;
  else if (i.policy.kind === "percent")
    fee = roundToRupee((i.chargeablePaise * i.policy.percentBp) / 10000);
  else fee = i.policy.amountPaise * days;
  if (i.policy.capPaise !== null) fee = Math.min(fee, i.policy.capPaise);
  fee = roundToRupee(fee);

  if (existing === null) return { feePaise: fee, action: "apply" };
  return fee === existing ? { feePaise: fee, action: "none" } : { feePaise: fee, action: "update" };
}
```

```ts
// apps/api/src/modules/pg-rent/pure/rent-allocation.ts
export interface OpenInvoice {
  invoiceId: string;
  kind: "rent" | "deposit" | "adhoc" | "settlement";
  dueDate: string;
  balancePaise: number;
}

const KIND_RANK: Record<OpenInvoice["kind"], number> = {
  deposit: 0,
  rent: 1,
  adhoc: 1,
  settlement: 9
};

/** Spec §6.2: targets first, then FIFO by due date (deposit before rent on ties, settlement last), remainder = credit. */
export function planAllocation(
  amountPaise: number,
  open: OpenInvoice[],
  targets: Array<{ invoiceId: string; amountPaise: number }>
): { allocations: Array<{ invoiceId: string; amountPaise: number }>; creditPaise: number } {
  const remaining = new Map(open.map((o) => [o.invoiceId, o.balancePaise]));
  const allocations: Array<{ invoiceId: string; amountPaise: number }> = [];
  let left = amountPaise;

  for (const t of targets) {
    const balance = remaining.get(t.invoiceId);
    if (balance === undefined) throw new RangeError(`invoice ${t.invoiceId} is not open`);
    if (t.amountPaise > balance)
      throw new RangeError(`allocation exceeds invoice balance for ${t.invoiceId}`);
    if (t.amountPaise > left) throw new RangeError("allocations exceed payment");
    allocations.push({ invoiceId: t.invoiceId, amountPaise: t.amountPaise });
    remaining.set(t.invoiceId, balance - t.amountPaise);
    left -= t.amountPaise;
  }

  const order = [...open].sort((a, b) =>
    a.dueDate === b.dueDate ? KIND_RANK[a.kind] - KIND_RANK[b.kind] : a.dueDate < b.dueDate ? -1 : 1
  );
  for (const o of order) {
    if (left <= 0) break;
    const balance = remaining.get(o.invoiceId) ?? 0;
    if (balance <= 0) continue;
    const take = Math.min(balance, left);
    const existing = allocations.find((a) => a.invoiceId === o.invoiceId);
    if (existing) existing.amountPaise += take;
    else allocations.push({ invoiceId: o.invoiceId, amountPaise: take });
    remaining.set(o.invoiceId, balance - take);
    left -= take;
  }
  return { allocations, creditPaise: left };
}

export interface ExistingAllocation {
  allocationId: string;
  paymentId: string;
  amountPaise: number;
  createdAt: string;
}

/** Invariant 14 procedure: shrink allocations newest-first until `excessPaise` is released. */
export function planDeallocation(
  excessPaise: number,
  allocations: ExistingAllocation[]
): Array<{ allocationId: string; paymentId: string; reducePaise: number }> {
  if (excessPaise <= 0) return [];
  const total = allocations.reduce((s, a) => s + a.amountPaise, 0);
  if (excessPaise > total) throw new RangeError("excess exceeds allocated amount");
  const out: Array<{ allocationId: string; paymentId: string; reducePaise: number }> = [];
  let left = excessPaise;
  for (const a of [...allocations].sort((x, y) => (x.createdAt < y.createdAt ? 1 : -1))) {
    if (left <= 0) break;
    const reduce = Math.min(a.amountPaise, left);
    out.push({ allocationId: a.allocationId, paymentId: a.paymentId, reducePaise: reduce });
    left -= reduce;
  }
  return out;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @cribliv/api exec vitest run src/modules/pg-rent/__tests__/rent-late-fee-allocation.test.ts`
Expected: PASS, 12 tests. (`22500` = 900000 × 250/10000; `3100` = 123456 × 0.025 = 3086.4 → nearest rupee 3100.)

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/pg-rent/pure/rent-late-fee.ts apps/api/src/modules/pg-rent/pure/rent-allocation.ts apps/api/src/modules/pg-rent/__tests__/rent-late-fee-allocation.test.ts
git commit -m "feat(pg-rent): pure late-fee and allocation planning"
```

---

### Task 3: Allocation service — allocate, de-allocate excess, release, fund outflow

**Files:**

- Modify: `apps/api/src/modules/pg-rent/services/rent-allocation.service.ts`
- Test: `apps/api/src/modules/pg-rent/__tests__/rent-allocation-mutations.integration.test.ts`

**Interfaces:**

- Consumes: Task 2 pure functions; 1a `recomputeInvoice`.
- Produces (all take the caller's `PoolClient`; all write events; all recompute touched invoices):

```ts
async unallocatedCredit(q: Queryable, assignmentId: string): Promise<number>            // Σ (inflow.amount − Σ its allocations) over confirmed inflows
async openInvoices(q: Queryable, assignmentId: string, lock?: boolean): Promise<OpenInvoice[]>   // issued/partially_paid, balance > 0
/** Allocate a confirmed inflow: targets first, FIFO, remainder = credit. Sets settled_on on invoices that close. Returns the plan. */
async allocateInflow(client, paymentId: string, targets: PgRentAllocationTarget[] | null, actor): Promise<{ allocations: Array<{invoiceId; amountPaise}>; creditPaise: number }>
/** Invariant 14: release `excessPaise` from this invoice, newest allocation first; recompute; event per payment. */
async deallocateExcess(client, invoiceId: string, excessPaise: number, actor): Promise<void>
/** Cancel path: release ALL allocations to the invoice back to credit. */
async releaseAllocations(client, invoiceId: string, actor): Promise<number>
/** Reversal path: delete every allocation of this payment (as source or as refund target); recompute touched invoices; returns touched invoice ids. */
async removeAllocationsOf(client, paymentId: string): Promise<string[]>
/** Invariant 15: fund an outflow from the assignment's credit, oldest inflow first; 400 refund_exceeds_credit. */
async fundOutflow(client, outflowId: string): Promise<void>
```

- [ ] **Step 1: Write the failing tests**

```ts
// apps/api/src/modules/pg-rent/__tests__/rent-allocation-mutations.integration.test.ts
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { DatabaseService } from "../../../common/database.service";
import { transaction } from "../../../common/transaction";
import { RentAllocationService } from "../services/rent-allocation.service";
import { SYSTEM_ACTOR } from "../services/rent-guards";
import { assertRentInvariants } from "./helpers/assert-rent-invariants";
import { RentFixtures } from "./helpers/rent-fixtures";

const HAS_DB = Boolean(process.env.DATABASE_URL);

describe.skipIf(!HAS_DB)("RentAllocationService mutations", () => {
  let db: DatabaseService;
  let fx: RentFixtures;
  let operatorId: string;
  let propertyId: string;
  let assignmentId: string;
  const service = new RentAllocationService();
  let seq = 0;

  async function invoice(
    kind: "rent" | "deposit" | "adhoc" | "settlement",
    totalPaise: number,
    dueDate: string,
    status = "issued"
  ): Promise<string> {
    seq += 1;
    const inv = await db.query<{ id: string }>(
      `INSERT INTO pg_rent_invoices (pg_property_id, assignment_id, room_number, bed_label, kind, invoice_number, billing_month, due_date, status, source, total_paise)
       VALUES ($1::uuid, $2::uuid, 'R1', 'A', $3::pg_rent_invoice_kind, $4, date_trunc('month', $5::date)::date, $5::date, $6::pg_rent_invoice_status, 'manual', $7) RETURNING id::text`,
      [
        propertyId,
        assignmentId,
        kind,
        `T-INV-${String(seq).padStart(4, "0")}`,
        dueDate,
        status,
        totalPaise
      ]
    );
    await db.query(
      `INSERT INTO pg_rent_invoice_lines (invoice_id, kind, label, amount_paise, source) VALUES ($1::uuid, 'other', 'x', $2, 'operator')`,
      [inv.rows[0].id, totalPaise]
    );
    return inv.rows[0].id;
  }
  async function inflow(
    amountPaise: number,
    paidOn: string,
    status = "confirmed"
  ): Promise<string> {
    const p = await db.query<{ id: string }>(
      `INSERT INTO pg_rent_payments (pg_property_id, assignment_id, amount_paise, method, source, status, paid_on, confirmed_at)
       VALUES ($1::uuid, $2::uuid, $3, 'cash', 'operator', $4::pg_rent_payment_status, $5::date, now()) RETURNING id::text`,
      [propertyId, assignmentId, amountPaise, status, paidOn]
    );
    return p.rows[0].id;
  }
  async function outflow(amountPaise: number): Promise<string> {
    const p = await db.query<{ id: string }>(
      `INSERT INTO pg_rent_payments (pg_property_id, assignment_id, direction, amount_paise, method, source, status, paid_on, note)
       VALUES ($1::uuid, $2::uuid, 'outflow', $3, 'cash', 'operator', 'confirmed', '2026-10-20', 'returned') RETURNING id::text`,
      [propertyId, assignmentId, amountPaise]
    );
    return p.rows[0].id;
  }
  async function state(invoiceId: string) {
    const r = await db.query<{ status: string; paid: string; settled_on: string | null }>(
      `SELECT status::text, amount_paid_paise::text AS paid, to_char(settled_on, 'YYYY-MM-DD') AS settled_on FROM pg_rent_invoices WHERE id = $1::uuid`,
      [invoiceId]
    );
    return r.rows[0];
  }

  beforeAll(async () => {
    db = new DatabaseService();
    fx = new RentFixtures(db, randomUUID().replace(/-/g, ""));
    await fx.setup();
    operatorId = await fx.createUser("pg_operator");
    propertyId = await fx.createProperty(operatorId);
    const roomId = await fx.createRoom(propertyId);
    const bedId = await fx.createBed(roomId, "A");
    assignmentId = await fx.createAssignment(propertyId, bedId, { createdBy: operatorId });
  });
  afterAll(async () => {
    await fx.teardown();
    await db.onModuleDestroy();
  });

  it("allocateInflow: targets, then FIFO with deposit first, remainder credit, settled_on set on closed invoices", async () => {
    const dep = await invoice("deposit", 1800000, "2026-09-01");
    const sep = await invoice("rent", 900000, "2026-09-05");
    const oct = await invoice("rent", 900000, "2026-10-05");
    const p = await inflow(3000000, "2026-09-03");

    const plan = await transaction(db, (c) =>
      service.allocateInflow(c, p, [{ invoice_id: oct, amount_inr: 4000 }], SYSTEM_ACTOR)
    );
    expect(plan).toEqual({
      allocations: [
        { invoiceId: oct, amountPaise: 400000 },
        { invoiceId: dep, amountPaise: 1800000 },
        { invoiceId: sep, amountPaise: 800000 }
      ],
      creditPaise: 0
    });
    expect(await state(dep)).toEqual({ status: "paid", paid: "1800000", settled_on: "2026-09-03" });
    expect(await state(sep)).toEqual({
      status: "partially_paid",
      paid: "800000",
      settled_on: null
    });
    expect(await state(oct)).toEqual({
      status: "partially_paid",
      paid: "400000",
      settled_on: null
    });
    expect(await service.unallocatedCredit(db, assignmentId)).toBe(0);
    await assertRentInvariants(db, propertyId);

    // a second inflow closes sep and oct and leaves credit
    const p2 = await inflow(700000, "2026-09-10");
    const plan2 = await transaction(db, (c) => service.allocateInflow(c, p2, null, SYSTEM_ACTOR));
    expect(plan2.creditPaise).toBe(100000);
    expect(await state(sep)).toMatchObject({ status: "paid", settled_on: "2026-09-10" });
    expect(await state(oct)).toMatchObject({ status: "paid", settled_on: "2026-09-10" });
    expect(await service.unallocatedCredit(db, assignmentId)).toBe(100000);
    await assertRentInvariants(db, propertyId);

    // deallocateExcess: shrink oct's total by 3000 → excess released newest-first (p2's allocation first)
    await transaction(db, async (c) => {
      await service.deallocateExcess(c, oct, 300000, SYSTEM_ACTOR);
      await c.query(
        `UPDATE pg_rent_invoice_lines SET amount_paise = 600000 WHERE invoice_id = $1::uuid`,
        [oct]
      );
      await c.query(`UPDATE pg_rent_invoices SET total_paise = 600000 WHERE id = $1::uuid`, [oct]);
      await service.recomputeInvoice(c, oct);
    });
    expect(await state(oct)).toMatchObject({ status: "paid", paid: "600000" });
    expect(await service.unallocatedCredit(db, assignmentId)).toBe(400000);
    const ev = await db.query<{ event_type: string; payload: Record<string, unknown> }>(
      `SELECT event_type, payload FROM pg_rent_events WHERE entity_id = $1::uuid AND event_type = 'invoice.excess_deallocated'`,
      [oct]
    );
    expect(ev.rows[0].payload).toMatchObject({ payment_id: p2, paise: 300000 });
    await assertRentInvariants(db, propertyId);

    // releaseAllocations (cancel path) on sep → its 900000 goes back to credit
    const released = await transaction(db, (c) => service.releaseAllocations(c, sep, SYSTEM_ACTOR));
    expect(released).toBe(900000);
    expect(await state(sep)).toMatchObject({ status: "issued", paid: "0", settled_on: null });
    expect(await service.unallocatedCredit(db, assignmentId)).toBe(1300000);

    // fundOutflow: 13000 refund is fully funded; 13001 is refused
    const ok = await outflow(1300000);
    await transaction(db, (c) => service.fundOutflow(c, ok));
    expect(await service.unallocatedCredit(db, assignmentId)).toBe(0);
    const tooMuch = await outflow(100);
    await expect(transaction(db, (c) => service.fundOutflow(c, tooMuch))).rejects.toMatchObject({
      response: { code: "refund_exceeds_credit" }
    });
    await db.query(`DELETE FROM pg_rent_payments WHERE id = $1::uuid`, [tooMuch]);
    await assertRentInvariants(db, propertyId);

    // removeAllocationsOf the refund → credit is back; of p → dep and oct walk back
    expect(await transaction(db, (c) => service.removeAllocationsOf(c, ok))).toEqual([]);
    expect(await service.unallocatedCredit(db, assignmentId)).toBe(1300000);
    const touched = await transaction(db, (c) => service.removeAllocationsOf(c, p));
    expect(new Set(touched)).toEqual(new Set([dep, oct]));
    expect(await state(dep)).toMatchObject({ status: "issued", paid: "0", settled_on: null });
    await db.query(`DELETE FROM pg_rent_payments WHERE id = $1::uuid`, [ok]);
    await assertRentInvariants(db, propertyId);
  });

  it("refuses targets on drafts, other assignments and over-balance", async () => {
    const draft = await invoice("rent", 100000, "2026-11-05", "draft");
    const p = await inflow(100000, "2026-11-01");
    await expect(
      transaction(db, (c) =>
        service.allocateInflow(c, p, [{ invoice_id: draft, amount_inr: 1000 }], SYSTEM_ACTOR)
      )
    ).rejects.toMatchObject({
      response: { code: "invalid_allocation" }
    });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @cribliv/api exec vitest run src/modules/pg-rent/__tests__/rent-allocation-mutations.integration.test.ts`
Expected: FAIL — `allocateInflow is not a function`.

- [ ] **Step 3: Extend the service**

Add to `rent-allocation.service.ts` (imports: `BadRequestException` from `@nestjs/common`; `planAllocation`, `planDeallocation`, `type OpenInvoice` from `../pure/rent-allocation`; `inrToPaise` from `../dto/money`; `type PgRentAllocationTarget` from shared types; `type Queryable` from `./rent-guards`):

```ts
  async unallocatedCredit(q: Queryable, assignmentId: string): Promise<number> {
    const r = await q.query<{ credit: string }>(
      `SELECT COALESCE(SUM(p.amount_paise - COALESCE(al.allocated, 0)), 0)::text AS credit
         FROM pg_rent_payments p
         LEFT JOIN (SELECT payment_id, SUM(amount_paise) AS allocated FROM pg_rent_payment_allocations GROUP BY payment_id) al
           ON al.payment_id = p.id
        WHERE p.assignment_id = $1::uuid AND p.direction = 'inflow' AND p.status = 'confirmed'`,
      [assignmentId]
    );
    return Number(r.rows[0].credit);
  }

  async openInvoices(q: Queryable, assignmentId: string, lock = false): Promise<OpenInvoice[]> {
    const r = await q.query<{ id: string; kind: OpenInvoice["kind"]; due_date: string; balance: string }>(
      `SELECT id::text, kind::text, to_char(due_date, 'YYYY-MM-DD') AS due_date, (total_paise - amount_paid_paise)::text AS balance
         FROM pg_rent_invoices
        WHERE assignment_id = $1::uuid AND status IN ('issued', 'partially_paid') AND total_paise > amount_paid_paise
        ORDER BY due_date${lock ? " FOR UPDATE" : ""}`,
      [assignmentId]
    );
    return r.rows.map((x) => ({ invoiceId: x.id, kind: x.kind, dueDate: x.due_date, balancePaise: Number(x.balance) }));
  }

  /** Spec §6.2. The payment must be a confirmed inflow with no allocations yet. */
  async allocateInflow(
    client: PoolClient, paymentId: string, targets: PgRentAllocationTarget[] | null, actor: RentActor
  ): Promise<{ allocations: Array<{ invoiceId: string; amountPaise: number }>; creditPaise: number }> {
    const p = await client.query<{ assignment_id: string; pg_property_id: string; amount_paise: string; paid_on: string; direction: string; status: string; claimed_invoice_id: string | null }>(
      `SELECT assignment_id::text, pg_property_id::text, amount_paise::text, to_char(paid_on,'YYYY-MM-DD') AS paid_on, direction::text, status::text, claimed_invoice_id::text
         FROM pg_rent_payments WHERE id = $1::uuid FOR UPDATE`,
      [paymentId]
    );
    const payment = p.rows[0];
    if (!payment || payment.direction !== "inflow" || payment.status !== "confirmed") {
      throw new BadRequestException({ code: "invalid_allocation", message: "Only confirmed inflows can be allocated" });
    }
    const open = await this.openInvoices(client, payment.assignment_id, true);
    const wanted = (targets ?? (payment.claimed_invoice_id ? [{ invoice_id: payment.claimed_invoice_id, amount_inr: null }] : []))
      .filter((t) => open.some((o) => o.invoiceId === t.invoice_id))
      .map((t) => {
        const balance = open.find((o) => o.invoiceId === t.invoice_id)!.balancePaise;
        const requested = t.amount_inr === null ? Math.min(balance, Number(payment.amount_paise)) : inrToPaise(t.amount_inr as number);
        return { invoiceId: t.invoice_id, amountPaise: requested };
      });
    if (targets && wanted.length !== targets.length) {
      throw new BadRequestException({ code: "invalid_allocation", message: "An allocation target is not an open invoice of this tenant" });
    }
    let plan;
    try {
      plan = planAllocation(Number(payment.amount_paise), open, wanted);
    } catch (error) {
      throw new BadRequestException({ code: "invalid_allocation", message: (error as Error).message });
    }
    for (const a of plan.allocations) {
      await client.query(
        `INSERT INTO pg_rent_payment_allocations (payment_id, invoice_id, amount_paise) VALUES ($1::uuid, $2::uuid, $3)`,
        [paymentId, a.invoiceId, a.amountPaise]
      );
      await this.recomputeInvoice(client, a.invoiceId, payment.paid_on);
      await writeRentEvent(client, {
        propertyId: payment.pg_property_id, entityType: "invoice", entityId: a.invoiceId, eventType: "allocation.changed", actor,
        payload: { payment_id: paymentId, allocated_paise: a.amountPaise, reason: targets ? "operator_split" : "fifo" }
      });
    }
    return plan;
  }

  /** Invariant 14 procedure (spec §6.6). Caller applies the total change and recomputes afterwards. */
  async deallocateExcess(client: PoolClient, invoiceId: string, excessPaise: number, actor: RentActor): Promise<void> {
    if (excessPaise <= 0) return;
    const inv = await this.lockInvoice(client, invoiceId);
    const rows = await client.query<{ id: string; payment_id: string; amount_paise: string; created_at: Date }>(
      `SELECT al.id::text, al.payment_id::text, al.amount_paise::text, al.created_at
         FROM pg_rent_payment_allocations al JOIN pg_rent_payments p ON p.id = al.payment_id
        WHERE al.invoice_id = $1::uuid AND p.status = 'confirmed' ORDER BY al.created_at DESC FOR UPDATE OF al`,
      [invoiceId]
    );
    const plan = planDeallocation(
      excessPaise,
      rows.rows.map((r) => ({ allocationId: r.id, paymentId: r.payment_id, amountPaise: Number(r.amount_paise), createdAt: r.created_at.toISOString() }))
    );
    for (const step of plan) {
      const row = rows.rows.find((r) => r.id === step.allocationId)!;
      if (step.reducePaise === Number(row.amount_paise)) {
        await client.query(`DELETE FROM pg_rent_payment_allocations WHERE id = $1::uuid`, [step.allocationId]);
      } else {
        await client.query(`UPDATE pg_rent_payment_allocations SET amount_paise = amount_paise - $2 WHERE id = $1::uuid`, [step.allocationId, step.reducePaise]);
      }
      await writeRentEvent(client, {
        propertyId: inv.pg_property_id, entityType: "invoice", entityId: invoiceId, eventType: "invoice.excess_deallocated", actor,
        payload: { payment_id: step.paymentId, paise: step.reducePaise }
      });
    }
    await this.recomputeInvoice(client, invoiceId);
  }

  /** Cancel path (spec §5.7): every allocation to this invoice goes back to credit. Returns paise released. */
  async releaseAllocations(client: PoolClient, invoiceId: string, actor: RentActor): Promise<number> {
    const inv = await this.lockInvoice(client, invoiceId);
    const rows = await client.query<{ payment_id: string; amount_paise: string }>(
      `DELETE FROM pg_rent_payment_allocations WHERE invoice_id = $1::uuid RETURNING payment_id::text, amount_paise::text`,
      [invoiceId]
    );
    let total = 0;
    for (const r of rows.rows) {
      total += Number(r.amount_paise);
      await writeRentEvent(client, {
        propertyId: inv.pg_property_id, entityType: "invoice", entityId: invoiceId, eventType: "invoice.excess_deallocated", actor,
        payload: { payment_id: r.payment_id, paise: Number(r.amount_paise), reason: "cancelled" }
      });
    }
    await this.recomputeInvoice(client, invoiceId);
    return total;
  }

  /** Reversal path: drop allocations where this payment is the source OR the funded outflow. Returns touched invoice ids. */
  async removeAllocationsOf(client: PoolClient, paymentId: string): Promise<string[]> {
    const rows = await client.query<{ invoice_id: string | null }>(
      `DELETE FROM pg_rent_payment_allocations WHERE payment_id = $1::uuid OR refund_payment_id = $1::uuid RETURNING invoice_id::text`,
      [paymentId]
    );
    const touched = Array.from(new Set(rows.rows.map((r) => r.invoice_id).filter((x): x is string => x !== null)));
    for (const invoiceId of touched) await this.recomputeInvoice(client, invoiceId);
    return touched;
  }

  /** Invariant 15: an outflow is fully funded from the assignment's credit, oldest inflow first. */
  async fundOutflow(client: PoolClient, outflowId: string): Promise<void> {
    const o = await client.query<{ assignment_id: string; amount_paise: string; direction: string }>(
      `SELECT assignment_id::text, amount_paise::text, direction::text FROM pg_rent_payments WHERE id = $1::uuid FOR UPDATE`,
      [outflowId]
    );
    if (!o.rows[0] || o.rows[0].direction !== "outflow") throw new BadRequestException({ code: "invalid_refund" });
    let left = Number(o.rows[0].amount_paise);
    const credits = await client.query<{ payment_id: string; unallocated: string }>(
      `SELECT p.id::text AS payment_id, (p.amount_paise - COALESCE(SUM(a.amount_paise), 0))::text AS unallocated
         FROM pg_rent_payments p LEFT JOIN pg_rent_payment_allocations a ON a.payment_id = p.id
        WHERE p.assignment_id = $1::uuid AND p.direction = 'inflow' AND p.status = 'confirmed'
        GROUP BY p.id HAVING p.amount_paise - COALESCE(SUM(a.amount_paise), 0) > 0
        ORDER BY p.paid_on ASC, p.created_at ASC FOR UPDATE OF p`,
      [o.rows[0].assignment_id]
    );
    for (const c of credits.rows) {
      if (left <= 0) break;
      const take = Math.min(left, Number(c.unallocated));
      await client.query(
        `INSERT INTO pg_rent_payment_allocations (payment_id, refund_payment_id, amount_paise) VALUES ($1::uuid, $2::uuid, $3)`,
        [c.payment_id, outflowId, take]
      );
      left -= take;
    }
    if (left > 0) {
      throw new BadRequestException({ code: "refund_exceeds_credit", message: "The tenant does not have that much credit to return" });
    }
  }
```

`lockInvoice` (from 1a) already returns `pg_property_id`. `allocateInflow` treats a `claimed_invoice_id` as a soft target: if that invoice is no longer open it is simply skipped (spec §6.10 "Claim for a cancelled invoice → FIFO/credit"), whereas explicit operator targets must all be open.

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @cribliv/api exec vitest run src/modules/pg-rent/__tests__/rent-allocation-mutations.integration.test.ts`
Expected: PASS, 2 tests; every `assertRentInvariants` clean.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/pg-rent/services/rent-allocation.service.ts apps/api/src/modules/pg-rent/__tests__/rent-allocation-mutations.integration.test.ts
git commit -m "feat(pg-rent): allocation mutations — allocate, de-allocate excess, release, fund outflow"
```

---

### Task 4: Payment service — intake, `finalizeConfirmed`, confirm/reject/reverse/refund/reallocate; receipt mint

**Files:**

- Create: `apps/api/src/modules/pg-rent/services/rent-fee-line.ts` (helpers shared by payments, invoice actions and the sweep)
- Create: `apps/api/src/modules/pg-rent/services/rent-receipt.service.ts` (mint + void + re-mint only; rendering is Task 6)
- Create: `apps/api/src/modules/pg-rent/services/rent-payment.service.ts`
- Modify: `apps/api/src/modules/pg-rent/pg-rent.module.ts`
- Test: `apps/api/src/modules/pg-rent/__tests__/rent-payment.integration.test.ts`

**Interfaces:**

```ts
// rent-fee-line.ts (all take the caller's client)
export interface FeeContext {
  policy: LateFeePolicy | null;
  invoice: {
    id;
    propertyId;
    dueDate;
    totalPaise;
    paidPaise;
    eligible;
    waivedAt;
    computedAt;
    overridePaise;
    exempt;
    kind;
  };
  feeLinePaise: number | null;
}
export async function loadFeeContext(client, invoiceId): Promise<FeeContext>;
/** Apply a computeLateFee result: upsert/update/remove the single late_fee line, set late_fee_computed_at, adjust total, run deallocateExcess when removing/reducing, write the event. */
export async function applyFeeDecision(
  client,
  alloc: RentAllocationService,
  ctx: FeeContext,
  decision: { feePaise; action },
  actor,
  reason?: string
): Promise<void>;
export async function setInvoiceTotalFromLines(client, invoiceId): Promise<number>; // total = Σ lines; returns new total (does NOT recompute status)

// rent-receipt.service.ts (Task 4 subset)
@Injectable()
export class RentReceiptService {
  async mint(client, paymentId: string, actor): Promise<string>; // receipt id; builds the snapshot; bumps next_receipt_seq; event receipt.generated
  async void(client, receiptId: string, reason: string, actor): Promise<void>; // voided_at, void_reason; event receipt.voided
  async remint(client, paymentId: string, actor): Promise<string>; // void live receipt (reallocated) + mint; superseded_by; event receipt.reminted
}

// rent-payment.service.ts
@Injectable()
export class RentPaymentService {
  async recordByOperator(
    operatorId,
    propertyId,
    input: PgRentRecordPaymentInput,
    idempotencyKey: string
  ): Promise<PgRentPayment>;
  async recordBackfillPayment(
    client,
    ctx: { propertyId; assignmentId; invoiceId; amountPaise; method; paidOn; reference; actor }
  ): Promise<string>; // used by Task 5 backfill
  async releaseDeposit(
    client,
    ctx: { propertyId; assignmentId; amountPaise; actor }
  ): Promise<string>; // used by Task 8 settlement
  async claimByTenant(tenantUserId, input: PgRentClaimInput): Promise<PgRentPayment>; // 409 claim_pending
  async cancelClaim(tenantUserId, paymentId): Promise<void>;
  async confirm(
    operatorId,
    propertyId,
    paymentId,
    input: PgRentConfirmInput
  ): Promise<PgRentPayment>; // 409 payment_not_pending
  async confirmBulk(operatorId, propertyId, ids: string[]): Promise<PgRentBulkResult>;
  async reject(operatorId, propertyId, paymentId, reason): Promise<PgRentPayment>;
  async reverse(operatorId, propertyId, paymentId, reason): Promise<PgRentPayment>; // 409 reverse_outflow_first / payment_not_confirmed
  async recordRefund(
    operatorId,
    propertyId,
    input: PgRentRefundInput,
    idempotencyKey
  ): Promise<PgRentPayment>;
  async reallocate(operatorId, propertyId, paymentId, targets): Promise<PgRentPayment>; // void + re-mint receipt
  async list(
    operatorId,
    propertyId,
    filters: { assignment_id?; status?; direction? }
  ): Promise<PgRentPayment[]>;
  async get(operatorId, propertyId, paymentId): Promise<PgRentPayment>;
}
```

- [ ] **Step 1: Write the failing tests**

```ts
// apps/api/src/modules/pg-rent/__tests__/rent-payment.integration.test.ts
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { DatabaseService } from "../../../common/database.service";
import { RentAllocationService } from "../services/rent-allocation.service";
import { RentInvoiceEngineService } from "../services/rent-invoice-engine.service";
import { RentPaymentService } from "../services/rent-payment.service";
import { RentReceiptService } from "../services/rent-receipt.service";
import { RentSettingsService } from "../services/rent-settings.service";
import { assertRentInvariants } from "./helpers/assert-rent-invariants";
import { RentFixtures } from "./helpers/rent-fixtures";

const HAS_DB = Boolean(process.env.DATABASE_URL);

describe.skipIf(!HAS_DB)("RentPaymentService", () => {
  let db: DatabaseService;
  let fx: RentFixtures;
  let operatorId: string;
  let tenantUserId: string;
  let settings: RentSettingsService;
  let engine: RentInvoiceEngineService;
  let payments: RentPaymentService;

  async function property(
    opts: { lateFee?: boolean; kind?: "flat" | "per_day"; autoApply?: boolean } = {}
  ) {
    const propertyId = await fx.createProperty(operatorId, { internalCode: "TST" });
    const listingId = await fx.createListingWithDetails(propertyId, operatorId);
    const roomTypeId = await fx.createRoomType(listingId, {
      rentPaise: 900000,
      depositPaise: 1800000
    });
    const roomId = await fx.createRoom(propertyId, { roomTypeId, roomNumber: "101" });
    await settings.enable(operatorId, propertyId, {
      billing_starts_on: "2026-09-01",
      due_day: 5,
      late_fee_enabled: opts.lateFee ?? false,
      late_fee_kind: opts.kind ?? "flat",
      late_fee_amount_inr: 100,
      late_fee_grace_days: 3,
      late_fee_auto_apply: opts.autoApply ?? true
    });
    return { propertyId, roomId };
  }
  async function tenant(p: { propertyId: string; roomId: string }, label: string, phone?: string) {
    const bedId = await fx.createBed(p.roomId, label);
    return fx.createAssignment(p.propertyId, bedId, {
      createdBy: operatorId,
      moveIn: "2026-09-01",
      occupantPhone: phone
    });
  }
  async function invoiceRows(assignmentId: string) {
    const r = await db.query<{
      id: string;
      kind: string;
      status: string;
      total: string;
      paid: string;
      settled_on: string | null;
    }>(
      `SELECT id::text, kind::text, status::text, total_paise::text AS total, amount_paid_paise::text AS paid, to_char(settled_on,'YYYY-MM-DD') AS settled_on
         FROM pg_rent_invoices WHERE assignment_id = $1::uuid ORDER BY kind, period_start NULLS FIRST`,
      [assignmentId]
    );
    return r.rows;
  }

  beforeAll(async () => {
    db = new DatabaseService();
    fx = new RentFixtures(db, randomUUID().replace(/-/g, ""));
    await fx.setup();
    operatorId = await fx.createUser("pg_operator");
    tenantUserId = await fx.createUser("tenant", "+917700000099");
    settings = new RentSettingsService(db);
    const alloc = new RentAllocationService();
    engine = new RentInvoiceEngineService(db, settings, alloc);
    payments = new RentPaymentService(db, settings, alloc, new RentReceiptService(db));
  });
  afterAll(async () => {
    await fx.teardown();
    await db.onModuleDestroy();
  });

  it("operator records cash: confirmed at birth, allocated FIFO (deposit first), receipt minted, idempotent", async () => {
    const p = await property();
    const a = await tenant(p, "A");
    await engine.generateInvoicesForProperty(p.propertyId, "2026-09-01"); // deposit 18000 + Sep 9000

    const key = randomUUID();
    const first = await payments.recordByOperator(
      operatorId,
      p.propertyId,
      { assignment_id: a, amount_inr: 20000, method: "cash", paid_on: "2026-09-02" },
      key
    );
    expect(first).toMatchObject({
      status: "confirmed",
      source: "operator",
      amount_inr: 20000,
      unallocated_inr: 0
    });
    expect(first.allocations.map((x) => x.amount_inr)).toEqual([18000, 2000]);
    expect(first.receipt_id).not.toBeNull();
    const receipt = await db.query<{ receipt_number: string; snapshot: Record<string, unknown> }>(
      `SELECT receipt_number, snapshot FROM pg_rent_receipts WHERE id = $1::uuid`,
      [first.receipt_id]
    );
    expect(receipt.rows[0].receipt_number).toBe("TST-0001");
    expect(receipt.rows[0].snapshot).toMatchObject({
      amount_inr: 20000,
      amount_words: expect.stringMatching(/Twenty Thousand/i),
      tenant_name: "Rent Tenant",
      room_number: "101"
    });

    const again = await payments.recordByOperator(
      operatorId,
      p.propertyId,
      { assignment_id: a, amount_inr: 20000, method: "cash", paid_on: "2026-09-02" },
      key
    );
    expect(again.id).toBe(first.id);
    expect((await invoiceRows(a)).map((i) => [i.kind, i.status])).toEqual([
      ["deposit", "paid"],
      ["rent", "partially_paid"]
    ]);
    await assertRentInvariants(db, p.propertyId);
  });

  it("tenant claim → pending, one per invoice, owner confirms with an edited amount; reject needs a reason", async () => {
    const p = await property();
    const a = await tenant(p, "A", "+917700000099");
    await engine.generateInvoicesForProperty(p.propertyId, "2026-09-01");
    const sep = (await invoiceRows(a)).find((i) => i.kind === "rent")!.id;

    const claim = await payments.claimByTenant(tenantUserId, {
      assignment_id: a,
      invoice_id: sep,
      amount_inr: 9000,
      method: "upi",
      paid_on: "2026-09-03",
      reference: "123456789012",
      idempotency_key: randomUUID()
    });
    expect(claim).toMatchObject({
      status: "pending_confirmation",
      source: "tenant_claim",
      allocations: []
    });
    await expect(
      payments.claimByTenant(tenantUserId, {
        assignment_id: a,
        invoice_id: sep,
        amount_inr: 9000,
        method: "upi",
        paid_on: "2026-09-03",
        idempotency_key: randomUUID()
      })
    ).rejects.toMatchObject({ response: { code: "claim_pending" } });
    expect((await invoiceRows(a)).find((i) => i.id === sep)!.status).toBe("issued"); // pending allocates nothing

    const confirmed = await payments.confirm(operatorId, p.propertyId, claim.id, {
      amount_inr: 8500
    });
    expect(confirmed).toMatchObject({ status: "confirmed", amount_inr: 8500 });
    expect((await invoiceRows(a)).find((i) => i.id === sep)).toMatchObject({
      status: "partially_paid",
      paid: "850000"
    });
    const ev = await db.query<{ payload: Record<string, unknown> }>(
      `SELECT payload FROM pg_rent_events WHERE entity_id = $1::uuid AND event_type = 'payment.confirmed'`,
      [claim.id]
    );
    expect(ev.rows[0].payload).toMatchObject({ original: { amount_paise: 900000 } });
    await expect(payments.confirm(operatorId, p.propertyId, claim.id, {})).rejects.toMatchObject({
      response: { code: "payment_not_pending" }
    });

    const claim2 = await payments.claimByTenant(tenantUserId, {
      assignment_id: a,
      invoice_id: sep,
      amount_inr: 500,
      method: "upi",
      paid_on: "2026-09-04",
      idempotency_key: randomUUID()
    });
    const rejected = await payments.reject(operatorId, p.propertyId, claim2.id, "Not received");
    expect(rejected).toMatchObject({ status: "rejected", rejected_reason: "Not received" });
    await assertRentInvariants(db, p.propertyId);
  });

  it("tenant can cancel only their own pending claim", async () => {
    const p = await property();
    const a = await tenant(p, "A", "+917700000099");
    await engine.generateInvoicesForProperty(p.propertyId, "2026-09-01");
    const claim = await payments.claimByTenant(tenantUserId, {
      assignment_id: a,
      amount_inr: 100,
      method: "upi",
      paid_on: "2026-09-03",
      idempotency_key: randomUUID()
    });
    const stranger = await fx.createUser("tenant");
    await expect(payments.cancelClaim(stranger, claim.id)).rejects.toMatchObject({
      response: { code: "forbidden" }
    });
    await payments.cancelClaim(tenantUserId, claim.id);
    expect((await payments.get(operatorId, p.propertyId, claim.id)).status).toBe("rejected");
  });

  it("reversal walks the invoice back, voids the receipt, regenerates an expired pay token; reversing a funded inflow is refused", async () => {
    const p = await property();
    const a = await tenant(p, "A");
    await engine.generateInvoicesForProperty(p.propertyId, "2026-09-01");
    const paid = await payments.recordByOperator(
      operatorId,
      p.propertyId,
      { assignment_id: a, amount_inr: 27000, method: "upi", paid_on: "2026-09-02" },
      randomUUID()
    );
    expect((await invoiceRows(a)).every((i) => i.status === "paid")).toBe(true);
    const tokenBefore = (
      await db.query<{ t: Date }>(
        `SELECT pay_token_expires_at AS t FROM pg_rent_invoices WHERE assignment_id = $1::uuid AND kind = 'rent'`,
        [a]
      )
    ).rows[0].t;
    expect(tokenBefore.getTime()).toBeLessThanOrEqual(Date.now()); // expired on paid

    const reversed = await payments.reverse(operatorId, p.propertyId, paid.id, "wrong tenant");
    expect(reversed).toMatchObject({ status: "reversed", reversed_reason: "wrong tenant" });
    expect((await invoiceRows(a)).map((i) => [i.status, i.paid, i.settled_on])).toEqual([
      ["issued", "0", null],
      ["issued", "0", null]
    ]);
    const receipt = await db.query<{ voided_at: Date | null; void_reason: string | null }>(
      `SELECT voided_at, void_reason FROM pg_rent_receipts WHERE id = $1::uuid`,
      [paid.receipt_id]
    );
    expect(receipt.rows[0].void_reason).toBe("reversed");
    const tokenAfter = (
      await db.query<{ t: Date }>(
        `SELECT pay_token_expires_at AS t FROM pg_rent_invoices WHERE assignment_id = $1::uuid AND kind = 'rent'`,
        [a]
      )
    ).rows[0].t;
    expect(tokenAfter.getTime()).toBeGreaterThan(Date.now());
    await expect(
      payments.reverse(operatorId, p.propertyId, paid.id, "again")
    ).rejects.toMatchObject({ response: { code: "payment_not_confirmed" } });

    // credit → refund → the inflow that funded it cannot be reversed first
    const credit = await payments.recordByOperator(
      operatorId,
      p.propertyId,
      { assignment_id: a, amount_inr: 30000, method: "cash", paid_on: "2026-09-03" },
      randomUUID()
    );
    expect(credit.unallocated_inr).toBe(3000);
    const refund = await payments.recordRefund(
      operatorId,
      p.propertyId,
      {
        assignment_id: a,
        amount_inr: 3000,
        method: "cash",
        paid_on: "2026-09-04",
        reason: "overpaid"
      },
      randomUUID()
    );
    expect(refund).toMatchObject({ direction: "outflow", status: "confirmed", receipt_id: null });
    await expect(
      payments.recordRefund(
        operatorId,
        p.propertyId,
        { assignment_id: a, amount_inr: 1, method: "cash", paid_on: "2026-09-04", reason: "x" },
        randomUUID()
      )
    ).rejects.toMatchObject({ response: { code: "refund_exceeds_credit" } });
    await expect(payments.reverse(operatorId, p.propertyId, credit.id, "x")).rejects.toMatchObject({
      response: { code: "reverse_outflow_first" }
    });
    await payments.reverse(operatorId, p.propertyId, refund.id, "returned by mistake");
    expect((await payments.get(operatorId, p.propertyId, credit.id)).unallocated_inr).toBe(3000);
    await assertRentInvariants(db, p.propertyId);
  });

  it("per_day fee is re-evaluated as of paid_on: a cash payment inside grace recorded late removes the fee", async () => {
    const p = await property({ lateFee: true, kind: "per_day" });
    const a = await tenant(p, "A");
    await engine.generateInvoicesForProperty(p.propertyId, "2026-09-01");
    const sep = (await invoiceRows(a)).find((i) => i.kind === "rent")!.id;
    // simulate the sweep having applied a 5-day fee (Task 6 owns the sweep; here we write the line directly)
    await db.query(
      `INSERT INTO pg_rent_invoice_lines (invoice_id, kind, label, amount_paise, source) VALUES ($1::uuid, 'late_fee', 'Late fee', 50000, 'system')`,
      [sep]
    );
    await db.query(
      `UPDATE pg_rent_invoices SET total_paise = 950000, late_fee_computed_at = now() WHERE id = $1::uuid`,
      [sep]
    );

    const paid = await payments.recordByOperator(
      operatorId,
      p.propertyId,
      { assignment_id: a, amount_inr: 27000, method: "cash", paid_on: "2026-09-07" },
      randomUUID()
    );
    const row = (await invoiceRows(a)).find((i) => i.id === sep)!;
    expect(row).toMatchObject({ status: "paid", total: "900000" }); // fee removed (paid_within_grace: Sep 7 ≤ Sep 5 + 3)
    expect(paid.unallocated_inr).toBe(0);
    const ev = await db.query<{ payload: Record<string, unknown> }>(
      `SELECT payload FROM pg_rent_events WHERE entity_id = $1::uuid AND event_type = 'late_fee.removed'`,
      [sep]
    );
    expect(ev.rows[0].payload).toMatchObject({ reason: "paid_within_grace" });
    await assertRentInvariants(db, p.propertyId);
  });

  it("manual re-allocation voids and re-mints the receipt", async () => {
    const p = await property();
    const a = await tenant(p, "A");
    await engine.generateInvoicesForProperty(p.propertyId, "2026-09-01");
    const rows = await invoiceRows(a);
    const dep = rows.find((i) => i.kind === "deposit")!.id;
    const sep = rows.find((i) => i.kind === "rent")!.id;
    const paid = await payments.recordByOperator(
      operatorId,
      p.propertyId,
      { assignment_id: a, amount_inr: 9000, method: "upi", paid_on: "2026-09-02" },
      randomUUID()
    );
    expect(paid.allocations[0].invoice_id).toBe(dep); // FIFO put it on the deposit
    const moved = await payments.reallocate(operatorId, p.propertyId, paid.id, [
      { invoice_id: sep, amount_inr: 9000 }
    ]);
    expect(moved.allocations).toHaveLength(1);
    expect(moved.allocations[0].invoice_id).toBe(sep);
    expect(moved.receipt_id).not.toBe(paid.receipt_id);
    const receipts = await db.query<{
      receipt_number: string;
      void_reason: string | null;
      superseded_by: string | null;
    }>(
      `SELECT receipt_number, void_reason, superseded_by::text FROM pg_rent_receipts WHERE payment_id = $1::uuid ORDER BY created_at`,
      [paid.id]
    );
    expect(receipts.rows).toEqual([
      { receipt_number: "TST-0001", void_reason: "reallocated", superseded_by: moved.receipt_id },
      { receipt_number: "TST-0002", void_reason: null, superseded_by: null }
    ]);
    await assertRentInvariants(db, p.propertyId);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @cribliv/api exec vitest run src/modules/pg-rent/__tests__/rent-payment.integration.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Fee-line helpers**

```ts
// apps/api/src/modules/pg-rent/services/rent-fee-line.ts
import type { PoolClient } from "pg";

import type { LateFeePolicy } from "../pure/rent-late-fee";
import type { RentAllocationService } from "./rent-allocation.service";
import { writeRentEvent } from "./rent-events";
import type { RentActor } from "./rent-guards";

export interface FeeContext {
  policy: LateFeePolicy | null; // null = property policy disabled
  invoice: {
    id: string;
    propertyId: string;
    kind: string;
    dueDate: string;
    totalPaise: number;
    paidPaise: number;
    eligible: boolean;
    waivedAt: Date | null;
    computedAt: Date | null;
    overridePaise: number | null;
    exempt: boolean;
    suggestedPaise: number | null;
  };
  feeLinePaise: number | null;
}

export async function loadFeeContext(client: PoolClient, invoiceId: string): Promise<FeeContext> {
  const r = await client.query<{
    id: string;
    pg_property_id: string;
    kind: string;
    due_date: string;
    total_paise: string;
    amount_paid_paise: string;
    late_fee_eligible: boolean;
    late_fee_waived_at: Date | null;
    late_fee_computed_at: Date | null;
    suggested_late_fee_paise: string | null;
    late_fee_override_paise: string | null;
    late_fee_exempt: boolean;
    fee_line: string | null;
    late_fee_enabled: boolean | null;
    late_fee_kind: string | null;
    late_fee_amount_paise: string | null;
    late_fee_percent_bp: number | null;
    late_fee_cap_paise: string | null;
    late_fee_grace_days: number | null;
  }>(
    `SELECT i.id::text, i.pg_property_id::text, i.kind::text, to_char(i.due_date,'YYYY-MM-DD') AS due_date, i.total_paise::text, i.amount_paid_paise::text,
            i.late_fee_eligible, i.late_fee_waived_at, i.late_fee_computed_at, i.suggested_late_fee_paise::text,
            a.late_fee_override_paise::text, a.late_fee_exempt,
            (SELECT l.amount_paise::text FROM pg_rent_invoice_lines l WHERE l.invoice_id = i.id AND l.kind = 'late_fee') AS fee_line,
            s.late_fee_enabled, s.late_fee_kind::text, s.late_fee_amount_paise::text, s.late_fee_percent_bp, s.late_fee_cap_paise::text, s.late_fee_grace_days
       FROM pg_rent_invoices i
       JOIN pg_bed_assignments a ON a.id = i.assignment_id
       LEFT JOIN pg_rent_settings s ON s.pg_property_id = i.pg_property_id
      WHERE i.id = $1::uuid FOR UPDATE OF i`,
    [invoiceId]
  );
  const x = r.rows[0];
  if (!x) throw new Error(`invoice ${invoiceId} not found`);
  return {
    policy: x.late_fee_enabled
      ? {
          kind: x.late_fee_kind as LateFeePolicy["kind"],
          amountPaise: Number(x.late_fee_amount_paise),
          percentBp: Number(x.late_fee_percent_bp),
          capPaise: x.late_fee_cap_paise === null ? null : Number(x.late_fee_cap_paise),
          graceDays: Number(x.late_fee_grace_days)
        }
      : null,
    invoice: {
      id: x.id,
      propertyId: x.pg_property_id,
      kind: x.kind,
      dueDate: x.due_date,
      totalPaise: Number(x.total_paise),
      paidPaise: Number(x.amount_paid_paise),
      eligible: x.late_fee_eligible,
      waivedAt: x.late_fee_waived_at,
      computedAt: x.late_fee_computed_at,
      overridePaise: x.late_fee_override_paise === null ? null : Number(x.late_fee_override_paise),
      exempt: x.late_fee_exempt,
      suggestedPaise:
        x.suggested_late_fee_paise === null ? null : Number(x.suggested_late_fee_paise)
    },
    feeLinePaise: x.fee_line === null ? null : Number(x.fee_line)
  };
}

/** total = Σ lines (invariant 1). Status is recomputed by the caller via RentAllocationService.recomputeInvoice. */
export async function setInvoiceTotalFromLines(
  client: PoolClient,
  invoiceId: string
): Promise<number> {
  const r = await client.query<{ total: string }>(
    `UPDATE pg_rent_invoices i SET total_paise = COALESCE((SELECT SUM(amount_paise) FROM pg_rent_invoice_lines WHERE invoice_id = i.id), 0)
      WHERE i.id = $1::uuid RETURNING total_paise::text AS total`,
    [invoiceId]
  );
  return Number(r.rows[0].total);
}

/**
 * Apply a computeLateFee decision to the invoice's single late_fee line.
 * Reductions run deallocateExcess first (invariant 14). `applyMode` decides
 * whether a positive fee becomes a line (auto_apply / owner tap) or a suggestion.
 */
export async function applyFeeDecision(
  client: PoolClient,
  alloc: RentAllocationService,
  ctx: FeeContext,
  decision: { feePaise: number; action: "none" | "apply" | "update" | "remove" | "freeze" },
  actor: RentActor,
  opts: { applyMode: "line" | "suggest"; reason?: string }
): Promise<void> {
  const { invoice } = ctx;
  const event = (type: string, payload: Record<string, unknown>) =>
    writeRentEvent(client, {
      propertyId: invoice.propertyId,
      entityType: "invoice",
      entityId: invoice.id,
      eventType: type,
      actor,
      payload
    });

  if (decision.action === "none") return;

  if (decision.action === "freeze") {
    await client.query(
      `UPDATE pg_rent_invoices SET late_fee_computed_at = COALESCE(late_fee_computed_at, now()) WHERE id = $1::uuid`,
      [invoice.id]
    );
    return;
  }

  if (decision.action === "remove") {
    if (ctx.feeLinePaise !== null) {
      const newTotal = invoice.totalPaise - ctx.feeLinePaise;
      if (invoice.paidPaise > newTotal)
        await alloc.deallocateExcess(client, invoice.id, invoice.paidPaise - newTotal, actor);
      await client.query(
        `DELETE FROM pg_rent_invoice_lines WHERE invoice_id = $1::uuid AND kind = 'late_fee'`,
        [invoice.id]
      );
      await setInvoiceTotalFromLines(client, invoice.id);
    }
    await client.query(
      `UPDATE pg_rent_invoices SET suggested_late_fee_paise = NULL, late_fee_computed_at = NULL WHERE id = $1::uuid`,
      [invoice.id]
    );
    await alloc.recomputeInvoice(client, invoice.id);
    await event("late_fee.removed", {
      reason: opts.reason ?? "recomputed",
      previous_paise: ctx.feeLinePaise ?? invoice.suggestedPaise
    });
    return;
  }

  if (opts.applyMode === "suggest" && ctx.feeLinePaise === null) {
    await client.query(
      `UPDATE pg_rent_invoices SET suggested_late_fee_paise = $2 WHERE id = $1::uuid`,
      [invoice.id, decision.feePaise]
    );
    await event("late_fee.suggested", { paise: decision.feePaise });
    return;
  }

  // apply / update as a line
  if (ctx.feeLinePaise === null) {
    await client.query(
      `INSERT INTO pg_rent_invoice_lines (invoice_id, kind, label, amount_paise, source, sort_order) VALUES ($1::uuid, 'late_fee', 'Late fee', $2, 'system', 99)`,
      [invoice.id, decision.feePaise]
    );
    await client.query(
      `UPDATE pg_rent_invoices SET suggested_late_fee_paise = NULL, late_fee_computed_at = now() WHERE id = $1::uuid`,
      [invoice.id]
    );
    await setInvoiceTotalFromLines(client, invoice.id);
    await alloc.recomputeInvoice(client, invoice.id);
    await event("late_fee.applied", { paise: decision.feePaise });
    return;
  }
  const newTotal = invoice.totalPaise - ctx.feeLinePaise + decision.feePaise;
  if (invoice.paidPaise > newTotal)
    await alloc.deallocateExcess(client, invoice.id, invoice.paidPaise - newTotal, actor);
  await client.query(
    `UPDATE pg_rent_invoice_lines SET amount_paise = $2 WHERE invoice_id = $1::uuid AND kind = 'late_fee'`,
    [invoice.id, decision.feePaise]
  );
  await setInvoiceTotalFromLines(client, invoice.id);
  await alloc.recomputeInvoice(client, invoice.id);
  await event("late_fee.updated", { from_paise: ctx.feeLinePaise, to_paise: decision.feePaise });
}
```

- [ ] **Step 4: Receipt service (mint / void / re-mint)**

```ts
// apps/api/src/modules/pg-rent/services/rent-receipt.service.ts  (Task 4 subset — Task 6 adds rendering)
import { randomBytes } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import type { PoolClient } from "pg";

import { DatabaseService } from "../../../common/database.service";
import { numberToIndianWords } from "../../rent-agreement/format/words.format";
import { paiseToInr } from "../dto/money";
import { periodLabel } from "../pure/rent-period";
import { writeRentEvent } from "./rent-events";
import type { RentActor } from "./rent-guards";

export interface ReceiptSnapshot {
  receipt_number: string;
  issued_on: string;
  property_name: string;
  business_name: string | null;
  address: string | null;
  footer: string | null;
  logo_path: string | null;
  tenant_name: string;
  room_number: string;
  bed_label: string;
  amount_inr: number;
  amount_words: string;
  method: string;
  reference: string | null;
  paid_on: string;
  covers: Array<{
    invoice_number: string;
    period_label: string;
    allocated_inr: number;
    remaining_inr: number;
  }>;
  credit_inr: number;
}

@Injectable()
export class RentReceiptService {
  constructor(@Inject(DatabaseService) private readonly db: DatabaseService) {}

  /** Spec §6.7. Called inside finalizeConfirmed's transaction for receipt-earning sources. */
  async mint(client: PoolClient, paymentId: string, actor: RentActor): Promise<string> {
    const p = await client.query<{
      pg_property_id: string;
      assignment_id: string;
      amount_paise: string;
      method: string;
      reference: string | null;
      paid_on: string;
      occupant_name: string;
      room_number: string;
      bed_label: string;
      property_name: string;
      receipt_prefix: string;
      receipt_business_name: string | null;
      receipt_address: string | null;
      receipt_footer: string | null;
      receipt_logo_path: string | null;
      cycle_mode: "calendar_month" | "anniversary";
    }>(
      `SELECT p.pg_property_id::text, p.assignment_id::text, p.amount_paise::text, p.method::text, p.reference, to_char(p.paid_on,'YYYY-MM-DD') AS paid_on,
              a.occupant_name, r.room_number, b.bed_label, pr.display_name AS property_name,
              s.receipt_prefix, s.receipt_business_name, s.receipt_address, s.receipt_footer, s.receipt_logo_path, s.cycle_mode::text
         FROM pg_rent_payments p
         JOIN pg_bed_assignments a ON a.id = p.assignment_id
         JOIN pg_beds b ON b.id = a.bed_id
         JOIN pg_rooms r ON r.id = b.room_id
         JOIN pg_properties pr ON pr.id = p.pg_property_id
         JOIN pg_rent_settings s ON s.pg_property_id = p.pg_property_id
        WHERE p.id = $1::uuid`,
      [paymentId]
    );
    const x = p.rows[0];
    const covers = await client.query<{
      invoice_number: string;
      period_start: string | null;
      period_end: string | null;
      kind: string;
      allocated: string;
      remaining: string;
    }>(
      `SELECT i.invoice_number, to_char(i.period_start,'YYYY-MM-DD') AS period_start, to_char(i.period_end,'YYYY-MM-DD') AS period_end, i.kind::text,
              al.amount_paise::text AS allocated, (i.total_paise - i.amount_paid_paise)::text AS remaining
         FROM pg_rent_payment_allocations al JOIN pg_rent_invoices i ON i.id = al.invoice_id
        WHERE al.payment_id = $1::uuid ORDER BY i.due_date`,
      [paymentId]
    );
    const allocated = covers.rows.reduce((s, c) => s + Number(c.allocated), 0);
    const seq = await client.query<{ seq: number }>(
      `UPDATE pg_rent_counters SET next_receipt_seq = next_receipt_seq + 1 WHERE pg_property_id = $1::uuid RETURNING next_receipt_seq - 1 AS seq`,
      [x.pg_property_id]
    );
    const number = `${x.receipt_prefix}-${String(seq.rows[0].seq).padStart(4, "0")}`;
    const amountInr = paiseToInr(x.amount_paise);
    const snapshot: ReceiptSnapshot = {
      receipt_number: number,
      issued_on: x.paid_on,
      property_name: x.property_name,
      business_name: x.receipt_business_name,
      address: x.receipt_address,
      footer: x.receipt_footer,
      logo_path: x.receipt_logo_path,
      tenant_name: x.occupant_name,
      room_number: x.room_number,
      bed_label: x.bed_label,
      amount_inr: amountInr,
      amount_words: numberToIndianWords(amountInr),
      method: x.method,
      reference: x.reference,
      paid_on: x.paid_on,
      covers: covers.rows.map((c) => ({
        invoice_number: c.invoice_number,
        period_label:
          c.period_start && c.period_end
            ? periodLabel(
                { start: c.period_start, end: c.period_end },
                { cycleMode: x.cycle_mode, anchorDay: 1 }
              )
            : c.kind === "deposit"
              ? "Security deposit"
              : c.kind,
        allocated_inr: paiseToInr(c.allocated),
        remaining_inr: paiseToInr(c.remaining)
      })),
      credit_inr: paiseToInr(Number(x.amount_paise) - allocated)
    };
    const inserted = await client.query<{ id: string }>(
      `INSERT INTO pg_rent_receipts (pg_property_id, payment_id, assignment_id, receipt_number, amount_paise, snapshot, share_token, share_token_expires_at)
       VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5, $6::jsonb, $7, now() + interval '30 days') RETURNING id::text`,
      [
        x.pg_property_id,
        paymentId,
        x.assignment_id,
        number,
        x.amount_paise,
        JSON.stringify(snapshot),
        randomBytes(32).toString("base64url")
      ]
    );
    await writeRentEvent(client, {
      propertyId: x.pg_property_id,
      entityType: "receipt",
      entityId: inserted.rows[0].id,
      eventType: "receipt.generated",
      actor,
      payload: { receipt_number: number, payment_id: paymentId }
    });
    return inserted.rows[0].id;
  }

  async void(
    client: PoolClient,
    receiptId: string,
    reason: string,
    actor: RentActor
  ): Promise<void> {
    const r = await client.query<{ pg_property_id: string }>(
      `UPDATE pg_rent_receipts SET voided_at = now(), void_reason = $2 WHERE id = $1::uuid AND voided_at IS NULL RETURNING pg_property_id::text`,
      [receiptId, reason]
    );
    if (!r.rows[0]) return;
    await writeRentEvent(client, {
      propertyId: r.rows[0].pg_property_id,
      entityType: "receipt",
      entityId: receiptId,
      eventType: "receipt.voided",
      actor,
      payload: { reason }
    });
  }

  /** Spec §6.7 manual re-allocation: void the live receipt, mint a new one, link them. */
  async remint(client: PoolClient, paymentId: string, actor: RentActor): Promise<string> {
    const live = await client.query<{ id: string }>(
      `SELECT id::text FROM pg_rent_receipts WHERE payment_id = $1::uuid AND voided_at IS NULL`,
      [paymentId]
    );
    if (live.rows[0]) await this.void(client, live.rows[0].id, "reallocated", actor);
    const next = await this.mint(client, paymentId, actor);
    if (live.rows[0]) {
      await client.query(
        `UPDATE pg_rent_receipts SET superseded_by = $2::uuid WHERE id = $1::uuid`,
        [live.rows[0].id, next]
      );
      const p = await client.query<{ pg_property_id: string }>(
        `SELECT pg_property_id::text FROM pg_rent_receipts WHERE id = $1::uuid`,
        [next]
      );
      await writeRentEvent(client, {
        propertyId: p.rows[0].pg_property_id,
        entityType: "receipt",
        entityId: next,
        eventType: "receipt.reminted",
        actor,
        payload: { supersedes: live.rows[0].id }
      });
    }
    return next;
  }
}
```

Check `numberToIndianWords`'s exact casing/format at `rent-agreement/format/words.format.ts:58` and adjust the test's regex (`/Twenty Thousand/i`) if it returns e.g. "twenty thousand rupees only".

- [ ] **Step 5: Payment service**

```ts
// apps/api/src/modules/pg-rent/services/rent-payment.service.ts
import { randomBytes } from "node:crypto";
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException
} from "@nestjs/common";
import type { PoolClient } from "pg";
import type {
  PgRentAllocationTarget,
  PgRentBulkResult,
  PgRentClaimInput,
  PgRentConfirmInput,
  PgRentPayment,
  PgRentRecordPaymentInput,
  PgRentRefundInput
} from "@cribliv/shared-types";

import { DatabaseService } from "../../../common/database.service";
import { compareIsoDates, todayIst } from "../../../common/date";
import { transaction } from "../../../common/transaction";
import { inrToPaise } from "../dto/money";
import {
  ALLOCATION_SELECT,
  PAYMENT_SELECT,
  toPaymentDto,
  type RentAllocationRow,
  type RentPaymentRow
} from "../dto/payment.dto";
import { planAllocation } from "../pure/rent-allocation";
import { computeLateFee } from "../pure/rent-late-fee";
import { RentAllocationService } from "./rent-allocation.service";
import { writeRentEvent } from "./rent-events";
import { applyFeeDecision, loadFeeContext } from "./rent-fee-line";
import {
  assertManagedOwnership,
  requireDb,
  resolveTenantAssignmentIds,
  type Queryable,
  type RentActor
} from "./rent-guards";
import { RentReceiptService } from "./rent-receipt.service";
import { RentSettingsService } from "./rent-settings.service";

const RECEIPT_SOURCES = new Set(["operator", "tenant_claim", "gateway"]);

@Injectable()
export class RentPaymentService {
  constructor(
    @Inject(DatabaseService) private readonly db: DatabaseService,
    @Inject(RentSettingsService) private readonly settings: RentSettingsService,
    @Inject(RentAllocationService) private readonly alloc: RentAllocationService,
    @Inject(RentReceiptService) private readonly receipts: RentReceiptService
  ) {}

  // ── intake ────────────────────────────────────────────────────────────────

  /** Spec §6.4. Confirmed at birth; idempotency key on the row (unique) AND in the controller cache. */
  async recordByOperator(
    operatorId: string,
    propertyId: string,
    input: PgRentRecordPaymentInput,
    idempotencyKey: string
  ): Promise<PgRentPayment> {
    requireDb(this.db);
    const actor: RentActor = { id: operatorId, role: "pg_operator" };
    const existing = await this.db.query<{ id: string }>(
      `SELECT id::text FROM pg_rent_payments WHERE pg_property_id = $1::uuid AND idempotency_key = $2`,
      [propertyId, idempotencyKey]
    );
    if (existing.rows[0]) return this.get(operatorId, propertyId, existing.rows[0].id);

    const id = await transaction(
      this.db,
      async (client) => {
        await assertManagedOwnership(client, operatorId, propertyId, true);
        await this.assertAssignment(client, propertyId, input.assignment_id, [
          "reserved",
          "active",
          "notice_served",
          "move_out_requested",
          "move_out_pending_confirmation",
          "moved_out"
        ]);
        this.assertPaidOn(input.paid_on);
        const paymentId = await this.insertPayment(client, {
          propertyId,
          assignmentId: input.assignment_id,
          direction: "inflow",
          amountPaise: inrToPaise(input.amount_inr),
          method: input.method,
          source: "operator",
          status: "confirmed",
          claimedInvoiceId: input.claimed_invoice_id ?? null,
          paidOn: input.paid_on,
          reference: input.reference ?? null,
          proofPaths: input.proof_paths ?? [],
          note: input.note ?? null,
          idempotencyKey,
          recordedBy: operatorId,
          confirmedBy: operatorId
        });
        await writeRentEvent(client, {
          propertyId,
          entityType: "payment",
          entityId: paymentId,
          eventType: "payment.recorded",
          actor,
          payload: { amount_paise: inrToPaise(input.amount_inr), method: input.method }
        });
        await this.finalizeConfirmed(client, paymentId, input.allocations ?? null, actor);
        return paymentId;
      },
      { uniqueViolationCode: "duplicate_payment" }
    );
    return this.get(operatorId, propertyId, id);
  }

  /** Backfill payment for a backfill invoice (Task 5 calls this inside its transaction). No receipt (D19). */
  async recordBackfillPayment(
    client: PoolClient,
    ctx: {
      propertyId: string;
      assignmentId: string;
      invoiceId: string;
      amountPaise: number;
      method: string;
      paidOn: string;
      reference: string | null;
      actor: RentActor;
    }
  ): Promise<string> {
    const paymentId = await this.insertPayment(client, {
      propertyId: ctx.propertyId,
      assignmentId: ctx.assignmentId,
      direction: "inflow",
      amountPaise: ctx.amountPaise,
      method: ctx.method,
      source: "backfill",
      status: "confirmed",
      claimedInvoiceId: ctx.invoiceId,
      paidOn: ctx.paidOn,
      reference: ctx.reference,
      proofPaths: [],
      note: null,
      idempotencyKey: null,
      recordedBy: ctx.actor.id,
      confirmedBy: ctx.actor.id
    });
    await writeRentEvent(client, {
      propertyId: ctx.propertyId,
      entityType: "payment",
      entityId: paymentId,
      eventType: "payment.recorded",
      actor: ctx.actor,
      payload: { source: "backfill", amount_paise: ctx.amountPaise }
    });
    await this.finalizeConfirmed(
      client,
      paymentId,
      [{ invoice_id: ctx.invoiceId, amount_inr: null as unknown as number }],
      ctx.actor
    );
    return paymentId;
  }

  /** Deposit release at settlement (Task 8). Non-cash inflow, FIFO across open dues incl. settlement, no receipt. */
  async releaseDeposit(
    client: PoolClient,
    ctx: { propertyId: string; assignmentId: string; amountPaise: number; actor: RentActor }
  ): Promise<string> {
    const paymentId = await this.insertPayment(client, {
      propertyId: ctx.propertyId,
      assignmentId: ctx.assignmentId,
      direction: "inflow",
      amountPaise: ctx.amountPaise,
      method: "deposit",
      source: "deposit_release",
      status: "confirmed",
      claimedInvoiceId: null,
      paidOn: todayIst(),
      reference: null,
      proofPaths: [],
      note: "Deposit applied at settlement",
      idempotencyKey: null,
      recordedBy: ctx.actor.id,
      confirmedBy: ctx.actor.id
    });
    await writeRentEvent(client, {
      propertyId: ctx.propertyId,
      entityType: "payment",
      entityId: paymentId,
      eventType: "deposit.released",
      actor: ctx.actor,
      payload: { amount_paise: ctx.amountPaise }
    });
    await this.finalizeConfirmed(client, paymentId, null, ctx.actor);
    return paymentId;
  }

  /** Spec §6.3. Pending; allocates nothing; one pending claim per invoice (unique index → 409 claim_pending). */
  async claimByTenant(tenantUserId: string, input: PgRentClaimInput): Promise<PgRentPayment> {
    requireDb(this.db);
    const actor: RentActor = { id: tenantUserId, role: "tenant" };
    const dup = await this.db.query<{ id: string }>(
      `SELECT p.id::text FROM pg_rent_payments p WHERE p.assignment_id = $1::uuid AND p.idempotency_key = $2`,
      [input.assignment_id, input.idempotency_key]
    );
    if (dup.rows[0]) return this.getForTenant(tenantUserId, dup.rows[0].id);

    const id = await transaction(
      this.db,
      async (client) => {
        const propertyId = await this.assertTenantAssignment(
          client,
          tenantUserId,
          input.assignment_id
        );
        this.assertPaidOn(input.paid_on);
        if (input.invoice_id) {
          const inv = await client.query(
            `SELECT 1 FROM pg_rent_invoices WHERE id = $1::uuid AND assignment_id = $2::uuid AND status IN ('issued','partially_paid')`,
            [input.invoice_id, input.assignment_id]
          );
          if (!inv.rowCount) throw new BadRequestException({ code: "invoice_not_open" });
        }
        const paymentId = await this.insertPayment(client, {
          propertyId,
          assignmentId: input.assignment_id,
          direction: "inflow",
          amountPaise: inrToPaise(input.amount_inr),
          method: input.method,
          source: "tenant_claim",
          status: "pending_confirmation",
          claimedInvoiceId: input.invoice_id ?? null,
          paidOn: input.paid_on,
          reference: input.reference ?? null,
          proofPaths: input.proof_paths ?? [],
          note: input.note ?? null,
          idempotencyKey: input.idempotency_key,
          recordedBy: tenantUserId,
          confirmedBy: null
        });
        await writeRentEvent(client, {
          propertyId,
          entityType: "payment",
          entityId: paymentId,
          eventType: "payment.claimed",
          actor,
          payload: {
            amount_paise: inrToPaise(input.amount_inr),
            invoice_id: input.invoice_id ?? null
          }
        });
        return paymentId;
      },
      { uniqueViolationCode: "claim_pending" }
    );
    return this.getForTenant(tenantUserId, id);
  }

  async cancelClaim(tenantUserId: string, paymentId: string): Promise<void> {
    requireDb(this.db);
    await transaction(this.db, async (client) => {
      const p = await this.lockPayment(client, paymentId);
      const mine = await resolveTenantAssignmentIds(client, tenantUserId);
      if (!mine.includes(p.assignment_id)) throw new ForbiddenException({ code: "forbidden" });
      if (p.status !== "pending_confirmation")
        throw new ConflictException({ code: "payment_not_pending" });
      await client.query(
        `UPDATE pg_rent_payments SET status = 'rejected', rejected_reason = 'cancelled_by_tenant' WHERE id = $1::uuid`,
        [paymentId]
      );
      await writeRentEvent(client, {
        propertyId: p.pg_property_id,
        entityType: "payment",
        entityId: paymentId,
        eventType: "payment.claim_cancelled",
        actor: { id: tenantUserId, role: "tenant" }
      });
    });
  }

  // ── verifier ──────────────────────────────────────────────────────────────

  /** Spec §6.3 Confirm sheet: editable amount/date/method; originals kept in the event. FOR UPDATE + status check → 409. */
  async confirm(
    operatorId: string,
    propertyId: string,
    paymentId: string,
    input: PgRentConfirmInput
  ): Promise<PgRentPayment> {
    requireDb(this.db);
    const actor: RentActor = { id: operatorId, role: "pg_operator" };
    await transaction(this.db, async (client) => {
      await assertManagedOwnership(client, operatorId, propertyId, true);
      const p = await this.lockPayment(client, paymentId, propertyId);
      if (p.status !== "pending_confirmation")
        throw new ConflictException({ code: "payment_not_pending" });
      if (input.paid_on) this.assertPaidOn(input.paid_on);
      await client.query(
        `UPDATE pg_rent_payments SET status = 'confirmed', confirmed_by = $2::uuid, confirmed_at = now(),
                amount_paise = COALESCE($3, amount_paise), method = COALESCE($4::pg_rent_payment_method, method), paid_on = COALESCE($5::date, paid_on)
          WHERE id = $1::uuid`,
        [
          paymentId,
          operatorId,
          input.amount_inr === undefined ? null : inrToPaise(input.amount_inr),
          input.method ?? null,
          input.paid_on ?? null
        ]
      );
      await writeRentEvent(client, {
        propertyId,
        entityType: "payment",
        entityId: paymentId,
        eventType: "payment.confirmed",
        actor,
        payload: {
          original: { amount_paise: Number(p.amount_paise), method: p.method, paid_on: p.paid_on },
          edited: input.amount_inr !== undefined || !!input.method || !!input.paid_on
        }
      });
      await this.finalizeConfirmed(client, paymentId, input.allocations ?? null, actor);
    });
    return this.get(operatorId, propertyId, paymentId);
  }

  /** Per-item results; one conflict never fails the batch (spec §6.3). */
  async confirmBulk(
    operatorId: string,
    propertyId: string,
    ids: string[]
  ): Promise<PgRentBulkResult> {
    const result: PgRentBulkResult = { succeeded: [], failed: [] };
    for (const id of ids) {
      try {
        await this.confirm(operatorId, propertyId, id, {});
        result.succeeded.push(id);
      } catch (error) {
        const code = (error as { response?: { code?: string } }).response?.code ?? "error";
        result.failed.push({ id, code });
      }
    }
    return result;
  }

  async reject(
    operatorId: string,
    propertyId: string,
    paymentId: string,
    reason: string
  ): Promise<PgRentPayment> {
    requireDb(this.db);
    await transaction(this.db, async (client) => {
      await assertManagedOwnership(client, operatorId, propertyId, true);
      const p = await this.lockPayment(client, paymentId, propertyId);
      if (p.status !== "pending_confirmation")
        throw new ConflictException({ code: "payment_not_pending" });
      await client.query(
        `UPDATE pg_rent_payments SET status = 'rejected', rejected_reason = $2 WHERE id = $1::uuid`,
        [paymentId, reason]
      );
      await writeRentEvent(client, {
        propertyId,
        entityType: "payment",
        entityId: paymentId,
        eventType: "payment.rejected",
        actor: { id: operatorId, role: "pg_operator" },
        payload: { reason }
      });
    });
    return this.get(operatorId, propertyId, paymentId);
  }

  /** Spec §6.5. Terminal. Refused when this inflow funds a live outflow (invariant 15). */
  async reverse(
    operatorId: string,
    propertyId: string,
    paymentId: string,
    reason: string
  ): Promise<PgRentPayment> {
    requireDb(this.db);
    const actor: RentActor = { id: operatorId, role: "pg_operator" };
    await transaction(this.db, async (client) => {
      await assertManagedOwnership(client, operatorId, propertyId, true);
      const p = await this.lockPayment(client, paymentId, propertyId);
      if (p.status !== "confirmed") throw new ConflictException({ code: "payment_not_confirmed" });
      const funds = await client.query(
        `SELECT 1 FROM pg_rent_payment_allocations al JOIN pg_rent_payments o ON o.id = al.refund_payment_id
          WHERE al.payment_id = $1::uuid AND o.status = 'confirmed' LIMIT 1`,
        [paymentId]
      );
      if (funds.rowCount)
        throw new ConflictException({
          code: "reverse_outflow_first",
          message: "Reverse the refund this payment funded first"
        });

      const touched = await this.alloc.removeAllocationsOf(client, paymentId);
      await client.query(
        `UPDATE pg_rent_payments SET status = 'reversed', reversed_by = $2::uuid, reversed_at = now(), reversed_reason = $3 WHERE id = $1::uuid`,
        [paymentId, operatorId, reason]
      );
      for (const invoiceId of touched) await this.refreshPayToken(client, invoiceId);
      const live = await client.query<{ id: string }>(
        `SELECT id::text FROM pg_rent_receipts WHERE payment_id = $1::uuid AND voided_at IS NULL`,
        [paymentId]
      );
      if (live.rows[0]) await this.receipts.void(client, live.rows[0].id, "reversed", actor);
      await writeRentEvent(client, {
        propertyId,
        entityType: "payment",
        entityId: paymentId,
        eventType: p.direction === "outflow" ? "refund.reversed" : "payment.reversed",
        actor,
        payload: { reason, touched_invoices: touched }
      });
    });
    return this.get(operatorId, propertyId, paymentId);
  }

  /** Spec §6.11 step 3 / §6.12 Return. Outflow, confirmed at birth, funded from credit (invariant 15). */
  async recordRefund(
    operatorId: string,
    propertyId: string,
    input: PgRentRefundInput,
    idempotencyKey: string
  ): Promise<PgRentPayment> {
    requireDb(this.db);
    const actor: RentActor = { id: operatorId, role: "pg_operator" };
    const existing = await this.db.query<{ id: string }>(
      `SELECT id::text FROM pg_rent_payments WHERE pg_property_id = $1::uuid AND idempotency_key = $2`,
      [propertyId, idempotencyKey]
    );
    if (existing.rows[0]) return this.get(operatorId, propertyId, existing.rows[0].id);
    const id = await transaction(
      this.db,
      async (client) => {
        await assertManagedOwnership(client, operatorId, propertyId, true);
        await this.assertAssignment(client, propertyId, input.assignment_id, null);
        this.assertPaidOn(input.paid_on);
        const paymentId = await this.insertPayment(client, {
          propertyId,
          assignmentId: input.assignment_id,
          direction: "outflow",
          amountPaise: inrToPaise(input.amount_inr),
          method: input.method,
          source: "operator",
          status: "confirmed",
          claimedInvoiceId: null,
          paidOn: input.paid_on,
          reference: input.reference ?? null,
          proofPaths: [],
          note: input.reason,
          idempotencyKey,
          recordedBy: operatorId,
          confirmedBy: operatorId
        });
        await this.alloc.fundOutflow(client, paymentId);
        await writeRentEvent(client, {
          propertyId,
          entityType: "payment",
          entityId: paymentId,
          eventType: "refund.recorded",
          actor,
          payload: { amount_paise: inrToPaise(input.amount_inr), reason: input.reason }
        });
        return paymentId;
      },
      { uniqueViolationCode: "duplicate_payment" }
    );
    return this.get(operatorId, propertyId, id);
  }

  /** Spec §6.7: manual re-allocation restates what the money was for → void + re-mint. */
  async reallocate(
    operatorId: string,
    propertyId: string,
    paymentId: string,
    targets: PgRentAllocationTarget[]
  ): Promise<PgRentPayment> {
    requireDb(this.db);
    const actor: RentActor = { id: operatorId, role: "pg_operator" };
    await transaction(this.db, async (client) => {
      await assertManagedOwnership(client, operatorId, propertyId, true);
      const p = await this.lockPayment(client, paymentId, propertyId);
      if (p.status !== "confirmed" || p.direction !== "inflow")
        throw new ConflictException({ code: "payment_not_confirmed" });
      const funds = await client.query(
        `SELECT 1 FROM pg_rent_payment_allocations WHERE payment_id = $1::uuid AND refund_payment_id IS NOT NULL LIMIT 1`,
        [paymentId]
      );
      if (funds.rowCount) throw new ConflictException({ code: "reverse_outflow_first" });
      await this.alloc.removeAllocationsOf(client, paymentId);
      await this.alloc.allocateInflow(client, paymentId, targets, actor);
      if (RECEIPT_SOURCES.has(p.source)) await this.receipts.remint(client, paymentId, actor);
      await writeRentEvent(client, {
        propertyId,
        entityType: "payment",
        entityId: paymentId,
        eventType: "allocation.changed",
        actor,
        payload: { reason: "operator_reallocation", targets }
      });
    });
    return this.get(operatorId, propertyId, paymentId);
  }

  // ── reads ─────────────────────────────────────────────────────────────────

  async list(
    operatorId: string,
    propertyId: string,
    filters: { assignment_id?: string; status?: string; direction?: string } = {}
  ): Promise<PgRentPayment[]> {
    requireDb(this.db);
    await assertManagedOwnership(this.db, operatorId, propertyId);
    const where = ["p.pg_property_id = $1::uuid"];
    const params: unknown[] = [propertyId];
    if (filters.assignment_id) {
      params.push(filters.assignment_id);
      where.push(`p.assignment_id = $${params.length}::uuid`);
    }
    if (filters.status) {
      params.push(filters.status);
      where.push(`p.status = $${params.length}::pg_rent_payment_status`);
    }
    if (filters.direction) {
      params.push(filters.direction);
      where.push(`p.direction = $${params.length}::pg_rent_payment_direction`);
    }
    const rows = await this.db.query<RentPaymentRow>(
      `SELECT ${PAYMENT_SELECT} FROM pg_rent_payments p JOIN pg_bed_assignments a ON a.id = p.assignment_id WHERE ${where.join(" AND ")} ORDER BY p.paid_on DESC, p.created_at DESC LIMIT 500`,
      params
    );
    return this.withAllocations(this.db, rows.rows);
  }

  async get(operatorId: string, propertyId: string, paymentId: string): Promise<PgRentPayment> {
    requireDb(this.db);
    await assertManagedOwnership(this.db, operatorId, propertyId);
    const rows = await this.db.query<RentPaymentRow>(
      `SELECT ${PAYMENT_SELECT} FROM pg_rent_payments p JOIN pg_bed_assignments a ON a.id = p.assignment_id WHERE p.id = $1::uuid AND p.pg_property_id = $2::uuid`,
      [paymentId, propertyId]
    );
    if (!rows.rows[0]) throw new NotFoundException({ code: "payment_not_found" });
    return (await this.withAllocations(this.db, rows.rows))[0];
  }

  async getForTenant(tenantUserId: string, paymentId: string): Promise<PgRentPayment> {
    const mine = await resolveTenantAssignmentIds(this.db, tenantUserId);
    const rows = await this.db.query<RentPaymentRow>(
      `SELECT ${PAYMENT_SELECT} FROM pg_rent_payments p JOIN pg_bed_assignments a ON a.id = p.assignment_id WHERE p.id = $1::uuid AND p.assignment_id = ANY($2::uuid[])`,
      [paymentId, mine]
    );
    if (!rows.rows[0]) throw new NotFoundException({ code: "payment_not_found" });
    return (await this.withAllocations(this.db, rows.rows))[0];
  }

  // ── the only path that can make an invoice paid ───────────────────────────

  /**
   * Spec §6.1. Re-evaluates late fees as of paid_on for invoices this payment
   * settles (§5.6 as-of rule), allocates (targets → FIFO → credit), sets
   * settled_on via recomputeInvoice, expires pay tokens on paid invoices,
   * mints a receipt for receipt-earning sources.
   */
  private async finalizeConfirmed(
    client: PoolClient,
    paymentId: string,
    targets: PgRentAllocationTarget[] | null,
    actor: RentActor
  ): Promise<void> {
    const p = await this.lockPayment(client, paymentId);
    // 1. dry-run to learn which invoices this payment would settle
    const open = await this.alloc.openInvoices(client, p.assignment_id, true);
    const wanted = (targets ?? [])
      .filter((t) => open.some((o) => o.invoiceId === t.invoice_id))
      .map((t) => ({
        invoiceId: t.invoice_id,
        amountPaise:
          (t.amount_inr as unknown) === null
            ? Math.min(
                open.find((o) => o.invoiceId === t.invoice_id)!.balancePaise,
                Number(p.amount_paise)
              )
            : inrToPaise(t.amount_inr)
      }));
    let dry;
    try {
      dry = planAllocation(Number(p.amount_paise), open, wanted);
    } catch (error) {
      throw new BadRequestException({
        code: "invalid_allocation",
        message: (error as Error).message
      });
    }

    // 2. fee re-evaluation as of paid_on on invoices whose chargeable balance this payment covers
    for (const a of dry.allocations) {
      const ctx = await loadFeeContext(client, a.invoiceId);
      if (
        ctx.invoice.kind !== "rent" ||
        !ctx.invoice.eligible ||
        ctx.invoice.exempt ||
        ctx.invoice.waivedAt ||
        !ctx.policy
      )
        continue;
      if (ctx.feeLinePaise === null && ctx.invoice.suggestedPaise === null) continue;
      const chargeable = ctx.invoice.totalPaise - ctx.invoice.paidPaise - (ctx.feeLinePaise ?? 0);
      if (a.amountPaise < chargeable) continue;
      const decision = computeLateFee({
        policy: ctx.policy,
        dueDate: ctx.invoice.dueDate,
        asOf: p.paid_on,
        chargeablePaise: chargeable,
        overridePaise: ctx.invoice.overridePaise,
        existingFeePaise: ctx.feeLinePaise ?? ctx.invoice.suggestedPaise,
        frozen: ctx.invoice.computedAt !== null
      });
      if (decision.action === "remove")
        await applyFeeDecision(client, this.alloc, ctx, decision, actor, {
          applyMode: "line",
          reason: "paid_within_grace"
        });
      else if (decision.action === "update" && decision.feePaise < (ctx.feeLinePaise ?? Infinity))
        await applyFeeDecision(client, this.alloc, ctx, decision, actor, {
          applyMode: "line",
          reason: "recomputed_as_of_paid_on"
        });
    }

    // 3. real allocation against the (possibly reduced) balances
    const plan = await this.alloc.allocateInflow(client, paymentId, targets, actor);
    for (const a of plan.allocations) await this.expireTokenIfPaid(client, a.invoiceId);

    // 4. receipt
    if (RECEIPT_SOURCES.has(p.source)) await this.receipts.mint(client, paymentId, actor);
  }

  // ── helpers ───────────────────────────────────────────────────────────────

  private assertPaidOn(paidOn: string): void {
    if (compareIsoDates(paidOn, todayIst()) > 0)
      throw new BadRequestException({ code: "paid_on_in_future" });
  }

  private async assertAssignment(
    client: Queryable,
    propertyId: string,
    assignmentId: string,
    statuses: string[] | null
  ): Promise<void> {
    const r = await client.query<{ status: string }>(
      `SELECT status::text FROM pg_bed_assignments WHERE id = $1::uuid AND pg_property_id = $2::uuid`,
      [assignmentId, propertyId]
    );
    if (!r.rows[0]) throw new NotFoundException({ code: "assignment_not_found" });
    if (statuses && !statuses.includes(r.rows[0].status))
      throw new ConflictException({ code: "assignment_status_invalid" });
  }

  private async assertTenantAssignment(
    client: Queryable,
    tenantUserId: string,
    assignmentId: string
  ): Promise<string> {
    const mine = await resolveTenantAssignmentIds(client, tenantUserId);
    if (!mine.includes(assignmentId)) throw new ForbiddenException({ code: "forbidden" });
    const r = await client.query<{ pg_property_id: string; enabled: boolean }>(
      `SELECT a.pg_property_id::text, (s.pg_property_id IS NOT NULL) AS enabled FROM pg_bed_assignments a LEFT JOIN pg_rent_settings s ON s.pg_property_id = a.pg_property_id WHERE a.id = $1::uuid`,
      [assignmentId]
    );
    if (!r.rows[0].enabled) throw new NotFoundException({ code: "rent_not_enabled" });
    return r.rows[0].pg_property_id;
  }

  private async lockPayment(client: PoolClient, paymentId: string, propertyId?: string) {
    const r = await client.query<{
      id: string;
      pg_property_id: string;
      assignment_id: string;
      direction: string;
      source: string;
      status: string;
      amount_paise: string;
      method: string;
      paid_on: string;
    }>(
      `SELECT id::text, pg_property_id::text, assignment_id::text, direction::text, source::text, status::text, amount_paise::text, method::text, to_char(paid_on,'YYYY-MM-DD') AS paid_on
         FROM pg_rent_payments WHERE id = $1::uuid${propertyId ? " AND pg_property_id = $2::uuid" : ""} FOR UPDATE`,
      propertyId ? [paymentId, propertyId] : [paymentId]
    );
    if (!r.rows[0]) throw new NotFoundException({ code: "payment_not_found" });
    return r.rows[0];
  }

  private async insertPayment(
    client: PoolClient,
    v: {
      propertyId: string;
      assignmentId: string;
      direction: "inflow" | "outflow";
      amountPaise: number;
      method: string;
      source: string;
      status: string;
      claimedInvoiceId: string | null;
      paidOn: string;
      reference: string | null;
      proofPaths: string[];
      note: string | null;
      idempotencyKey: string | null;
      recordedBy: string | null;
      confirmedBy: string | null;
    }
  ): Promise<string> {
    const r = await client.query<{ id: string }>(
      `INSERT INTO pg_rent_payments
         (pg_property_id, assignment_id, direction, amount_paise, method, source, status, claimed_invoice_id, paid_on, reference, proof_paths, note, idempotency_key, recorded_by, confirmed_by, confirmed_at)
       VALUES ($1::uuid, $2::uuid, $3::pg_rent_payment_direction, $4, $5::pg_rent_payment_method, $6::pg_rent_payment_source, $7::pg_rent_payment_status, $8::uuid, $9::date, $10, $11::jsonb, $12, $13, $14::uuid, $15::uuid,
               CASE WHEN $7 = 'confirmed' THEN now() ELSE NULL END)
       RETURNING id::text`,
      [
        v.propertyId,
        v.assignmentId,
        v.direction,
        v.amountPaise,
        v.method,
        v.source,
        v.status,
        v.claimedInvoiceId,
        v.paidOn,
        v.reference,
        JSON.stringify(v.proofPaths),
        v.note,
        v.idempotencyKey,
        v.recordedBy,
        v.confirmedBy
      ]
    );
    return r.rows[0].id;
  }

  /** Spec §4.4: the pay token expires on `paid` … */
  private async expireTokenIfPaid(client: PoolClient, invoiceId: string): Promise<void> {
    await client.query(
      `UPDATE pg_rent_invoices SET pay_token_expires_at = now() WHERE id = $1::uuid AND status = 'paid' AND pay_token IS NOT NULL`,
      [invoiceId]
    );
  }

  /** … and is regenerated when a reversal reopens the invoice. */
  private async refreshPayToken(client: PoolClient, invoiceId: string): Promise<void> {
    await client.query(
      `UPDATE pg_rent_invoices SET pay_token = $2, pay_token_expires_at = now() + interval '45 days'
        WHERE id = $1::uuid AND status IN ('issued','partially_paid') AND (pay_token IS NULL OR pay_token_expires_at <= now())`,
      [invoiceId, randomBytes(32).toString("base64url")]
    );
  }

  private async withAllocations(q: Queryable, rows: RentPaymentRow[]): Promise<PgRentPayment[]> {
    if (!rows.length) return [];
    const allocs = await q.query<RentAllocationRow>(
      `SELECT ${ALLOCATION_SELECT} FROM pg_rent_payment_allocations al LEFT JOIN pg_rent_invoices i ON i.id = al.invoice_id WHERE al.payment_id = ANY($1::uuid[]) ORDER BY al.created_at`,
      [rows.map((r) => r.id)]
    );
    return rows.map((r) => toPaymentDto(r, allocs.rows));
  }
}
```

Add to `rent-guards.ts` (used above and by Task 9):

```ts
/** Spec §9: every assignment the user matches, any status, no auto-link. */
export async function resolveTenantAssignmentIds(q: Queryable, userId: string): Promise<string[]> {
  const r = await q.query<{ id: string }>(
    `SELECT a.id::text FROM pg_bed_assignments a JOIN users u ON u.id = $1::uuid
      WHERE a.tenant_user_id = u.id OR (a.tenant_user_id IS NULL AND a.occupant_phone_e164 = u.phone_e164)`,
    [userId]
  );
  return r.rows.map((x) => x.id);
}
```

Register `RentReceiptService` and `RentPaymentService` in the module (providers + exports). Note `recordBackfillPayment` passes `amount_inr: null` as a sentinel meaning "the invoice balance, capped by the payment" — `finalizeConfirmed` and `allocateInflow` both honour it (see the `=== null` checks).

- [ ] **Step 6: Run to verify it passes**

Run: `pnpm --filter @cribliv/api exec vitest run src/modules/pg-rent/__tests__/rent-payment.integration.test.ts`
Expected: PASS, 6 tests. The `numberToIndianWords` regex and the deposit-first FIFO expectation are the two assertions most likely to need a literal tweak — fix the _test literal_ only if the behaviour is right and the wording differs.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/modules/pg-rent
git commit -m "feat(pg-rent): payment intake, confirmation, reversal, refunds, re-allocation and receipt minting"
```

---

### Task 5: Invoice actions — lines, issue, extend, cancel, fees, manual/backfill invoices, re-proration suggestions

**Files:**

- Create: `apps/api/src/modules/pg-rent/dto/invoice-actions.dto.ts`
- Modify: `apps/api/src/modules/pg-rent/services/rent-invoice.service.ts`
- Modify: `apps/api/src/modules/pg-rent/services/rent-invoice-engine.service.ts` (`onAssignmentEvent` suggestions)
- Test: `apps/api/src/modules/pg-rent/__tests__/rent-invoice-actions.integration.test.ts`

**Interfaces:**

```ts
// dto/invoice-actions.dto.ts
export const LineInputSchema, LinePatchSchema, ExtendDueSchema, CancelInvoiceSchema, IssueDraftSchema, ApplyFeeSchema, WaiveFeeSchema, EligibilitySchema

// rent-invoice.service.ts additions (operator scope on every call; every mutation → recompute + event)
async addLine(operatorId, propertyId, invoiceId, input: PgRentLineInput): Promise<PgRentInvoice>            // draft|issued|partially_paid only → 409 invoice_not_editable
async updateLine(operatorId, propertyId, invoiceId, lineId, input: PgRentLinePatchInput): Promise<PgRentInvoice>   // rent/deposit/late_fee lines: label+meta only, amount refused (409 line_locked)
async removeLine(operatorId, propertyId, invoiceId, lineId): Promise<PgRentInvoice>                          // never rent/deposit/late_fee (use waive) → 409 line_locked
async issueDraft(operatorId, propertyId, invoiceId, input: PgRentIssueDraftInput): Promise<PgRentInvoice>    // draft only; rent_inr overrides the rent line; due = max(stored, today) unless given; pay token; credit auto-apply
async extendDue(operatorId, propertyId, invoiceId, dueDate): Promise<PgRentInvoice>                          // issued|partially_paid; fee removed if inside new grace
async cancel(operatorId, propertyId, invoiceId, reason): Promise<PgRentInvoice>                              // paid with amount_paid>0 → 409 invoice_paid; partially_paid releases allocations; pay token expired
async applyFee(operatorId, propertyId, invoiceId, amountInr?: number): Promise<PgRentInvoice>                 // from suggestion or explicit amount; rent+eligible only
async waiveFee(operatorId, propertyId, invoiceId, reason): Promise<PgRentInvoice>                             // removes line/suggestion via §6.6; late_fee_waived_at set
async waiveAllFees(operatorId, propertyId, reason): Promise<{ waived: number }>
async setEligibility(operatorId, propertyId, invoiceId, eligible: boolean): Promise<PgRentInvoice>
async createManual(operatorId, propertyId, input: PgRentManualInvoiceInput): Promise<PgRentInvoice>           // adhoc, issued, token, credit auto-apply
async createBackfill(operatorId, propertyId, input: PgRentBackfillInput): Promise<PgRentInvoice>             // source backfill, late_fee_eligible=false, overlap check for rent, optional backfill payment (no receipt)
async applyReprorate(operatorId, propertyId, invoiceId): Promise<PgRentInvoice>                               // reprorate_suggestion.mode='reprorate' → rent line = to_paise (via §6.6), invoice.reprorated, suggestion cleared
async dismissReprorate(operatorId, propertyId, invoiceId): Promise<PgRentInvoice>                             // clears suggestion
async restoreReprorate(operatorId, propertyId, invoiceId): Promise<PgRentInvoice>                             // mode='restore' → adjustment line for the difference + re-apply credit; suggestion cleared

// rent-invoice-engine.service.ts
onAssignmentEvent: notice/move-out events with prorate_move_out on → write reprorate_suggestion {mode:'reprorate'} on the last ISSUED period whose end > leave date (event invoice.final_reprorate_suggested); cancel events → clear an open 'reprorate' suggestion, or set {mode:'restore'} when a re-proration was applied (event invoice.line_added reason restore_prompt is NOT written — only the suggestion column)
```

- [ ] **Step 1: Write the failing tests**

```ts
// apps/api/src/modules/pg-rent/__tests__/rent-invoice-actions.integration.test.ts
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { DatabaseService } from "../../../common/database.service";
import { todayIst } from "../../../common/date";
import { RentAllocationService } from "../services/rent-allocation.service";
import { RentInvoiceEngineService } from "../services/rent-invoice-engine.service";
import { RentInvoiceService } from "../services/rent-invoice.service";
import { RentPaymentService } from "../services/rent-payment.service";
import { RentReceiptService } from "../services/rent-receipt.service";
import { RentSettingsService } from "../services/rent-settings.service";
import { assertRentInvariants } from "./helpers/assert-rent-invariants";
import { RentFixtures } from "./helpers/rent-fixtures";

const HAS_DB = Boolean(process.env.DATABASE_URL);

describe.skipIf(!HAS_DB)("RentInvoiceService actions", () => {
  let db: DatabaseService;
  let fx: RentFixtures;
  let operatorId: string;
  let settings: RentSettingsService;
  let engine: RentInvoiceEngineService;
  let payments: RentPaymentService;
  let invoices: RentInvoiceService;

  async function property(extra: Record<string, unknown> = {}) {
    const propertyId = await fx.createProperty(operatorId, { internalCode: "ACT" });
    const listingId = await fx.createListingWithDetails(propertyId, operatorId);
    const roomTypeId = await fx.createRoomType(listingId, { rentPaise: 900000 });
    const roomId = await fx.createRoom(propertyId, { roomTypeId, roomNumber: "201" });
    await settings.enable(operatorId, propertyId, {
      billing_starts_on: "2026-09-01",
      due_day: 5,
      late_fee_enabled: true,
      late_fee_amount_inr: 300,
      late_fee_grace_days: 3,
      ...extra
    });
    return { propertyId, roomId };
  }
  async function tenantWithSeptember(
    p: { propertyId: string; roomId: string },
    label = "A",
    opts: Record<string, unknown> = {}
  ) {
    const bedId = await fx.createBed(p.roomId, label);
    const a = await fx.createAssignment(p.propertyId, bedId, {
      createdBy: operatorId,
      moveIn: "2026-09-01",
      ...opts
    });
    await engine.generateInvoicesForProperty(p.propertyId, "2026-09-01");
    const sep = (
      await invoices.list(operatorId, p.propertyId, { assignment_id: a, kind: "rent" })
    )[0];
    return { a, sep };
  }

  beforeAll(async () => {
    db = new DatabaseService();
    fx = new RentFixtures(db, randomUUID().replace(/-/g, ""));
    await fx.setup();
    operatorId = await fx.createUser("pg_operator");
    settings = new RentSettingsService(db);
    const alloc = new RentAllocationService();
    const receipts = new RentReceiptService(db);
    engine = new RentInvoiceEngineService(db, settings, alloc);
    payments = new RentPaymentService(db, settings, alloc, receipts);
    invoices = new RentInvoiceService(db, alloc, payments, engine);
  });
  afterAll(async () => {
    await fx.teardown();
    await db.onModuleDestroy();
  });

  it("adds, edits and removes lines; a removal below what was paid releases the excess to credit", async () => {
    const p = await property();
    const { a, sep } = await tenantWithSeptember(p);
    let inv = await invoices.addLine(operatorId, p.propertyId, sep.id, {
      kind: "electricity",
      label: "Electricity",
      amount_inr: 896,
      meta: { units: 112, rate_inr: 8 }
    });
    expect(inv.total_inr).toBe(9896);
    const elec = inv.lines.find((l) => l.kind === "electricity")!;
    inv = await invoices.updateLine(operatorId, p.propertyId, sep.id, elec.id, { amount_inr: 900 });
    expect(inv.total_inr).toBe(9900);
    await expect(
      invoices.updateLine(
        operatorId,
        p.propertyId,
        sep.id,
        inv.lines.find((l) => l.kind === "rent")!.id,
        { amount_inr: 1 }
      )
    ).rejects.toMatchObject({ response: { code: "line_locked" } });

    await payments.recordByOperator(
      operatorId,
      p.propertyId,
      { assignment_id: a, amount_inr: 9900, method: "cash", paid_on: "2026-09-02" },
      randomUUID()
    );
    expect((await invoices.get(operatorId, p.propertyId, sep.id)).status).toBe("paid");
    inv = await invoices.removeLine(operatorId, p.propertyId, sep.id, elec.id);
    expect(inv).toMatchObject({ total_inr: 9000, amount_paid_inr: 9000, status: "paid" });
    const ev = await db.query<{ event_type: string }>(
      `SELECT event_type FROM pg_rent_events WHERE entity_id = $1::uuid ORDER BY id`,
      [sep.id]
    );
    expect(ev.rows.map((e) => e.event_type)).toEqual(
      expect.arrayContaining([
        "invoice.line_added",
        "invoice.line_updated",
        "invoice.excess_deallocated",
        "invoice.line_removed"
      ])
    );
    const credit = await new RentAllocationService().unallocatedCredit(db, a);
    expect(credit).toBe(90000);
    await assertRentInvariants(db, p.propertyId);
  });

  it("issues a draft at a typed rent with due = today, mints the token and auto-applies credit", async () => {
    const p = await property();
    const propertyNoType = await fx.createProperty(operatorId, { internalCode: "DRF" });
    await fx.createListingWithDetails(propertyNoType, operatorId, { startingRentPaise: 700000 });
    const roomId = await fx.createRoom(propertyNoType, { roomTypeId: null });
    await settings.enable(operatorId, propertyNoType, {
      billing_starts_on: "2026-09-01",
      due_day: 5
    });
    const bedId = await fx.createBed(roomId, "A");
    const a = await fx.createAssignment(propertyNoType, bedId, {
      createdBy: operatorId,
      moveIn: "2026-09-01"
    });
    await engine.generateInvoicesForProperty(propertyNoType, "2026-09-01");
    const draft = (await invoices.list(operatorId, propertyNoType, { assignment_id: a }))[0];
    expect(draft.status).toBe("draft");
    await payments.recordByOperator(
      operatorId,
      propertyNoType,
      { assignment_id: a, amount_inr: 1000, method: "cash", paid_on: "2026-09-01" },
      randomUUID()
    ); // credit (draft not allocatable)

    const issued = await invoices.issueDraft(operatorId, propertyNoType, draft.id, {
      rent_inr: 8000
    });
    expect(issued).toMatchObject({
      status: "partially_paid",
      total_inr: 8000,
      amount_paid_inr: 1000,
      due_date: todayIst()
    });
    expect(issued.lines.find((l) => l.kind === "rent")!.amount_inr).toBe(8000);
    const tok = await db.query<{ t: string | null }>(
      `SELECT pay_token AS t FROM pg_rent_invoices WHERE id = $1::uuid`,
      [draft.id]
    );
    expect(tok.rows[0].t).toHaveLength(43);
    expect(p.propertyId).toBeTruthy();
    await assertRentInvariants(db, propertyNoType);
  });

  it("applies a fee from the suggestion, waives it after the tenant paid it (credit), and extend-due removes a fee inside the new grace", async () => {
    const p = await property({ late_fee_auto_apply: false });
    const { a, sep } = await tenantWithSeptember(p);
    await db.query(
      `UPDATE pg_rent_invoices SET suggested_late_fee_paise = 30000 WHERE id = $1::uuid`,
      [sep.id]
    );
    let inv = await invoices.applyFee(operatorId, p.propertyId, sep.id);
    expect(inv).toMatchObject({ total_inr: 9300, suggested_late_fee_inr: null });
    await payments.recordByOperator(
      operatorId,
      p.propertyId,
      { assignment_id: a, amount_inr: 9300, method: "upi", paid_on: "2026-09-12" },
      randomUUID()
    );
    inv = await invoices.waiveFee(operatorId, p.propertyId, sep.id, "goodwill");
    expect(inv).toMatchObject({ total_inr: 9000, amount_paid_inr: 9000, status: "paid" });
    expect(inv.late_fee_waived_at).not.toBeNull();
    expect(await new RentAllocationService().unallocatedCredit(db, a)).toBe(30000);

    const { sep: sep2 } = await tenantWithSeptember(p, "B");
    await invoices.applyFee(operatorId, p.propertyId, sep2.id, 500);
    expect((await invoices.get(operatorId, p.propertyId, sep2.id)).total_inr).toBe(9500);
    inv = await invoices.extendDue(operatorId, p.propertyId, sep2.id, "2099-01-01");
    expect(inv).toMatchObject({ total_inr: 9000, due_date: "2099-01-01" });
    await expect(invoices.applyFee(operatorId, p.propertyId, sep2.id, 500)).resolves.toMatchObject({
      total_inr: 9500
    });
    await expect(
      invoices.setEligibility(operatorId, p.propertyId, sep2.id, false)
    ).resolves.toMatchObject({ late_fee_eligible: false });
    await expect(invoices.applyFee(operatorId, p.propertyId, sep2.id, 1)).rejects.toMatchObject({
      response: { code: "fee_not_allowed" }
    });
    await assertRentInvariants(db, p.propertyId);
  });

  it("waives every outstanding fee in one call", async () => {
    const p = await property();
    const { sep } = await tenantWithSeptember(p, "A");
    const { sep: sep2 } = await tenantWithSeptember(p, "B");
    await invoices.applyFee(operatorId, p.propertyId, sep.id, 300);
    await invoices.applyFee(operatorId, p.propertyId, sep2.id, 300);
    expect(await invoices.waiveAllFees(operatorId, p.propertyId, "festival")).toEqual({
      waived: 2
    });
    expect(
      (await invoices.list(operatorId, p.propertyId, { kind: "rent" })).every(
        (i) => i.total_inr === 9000
      )
    ).toBe(true);
  });

  it("cancels: partially paid releases allocations; paid with money refuses; ₹0 paid cancels", async () => {
    const p = await property();
    const { a, sep } = await tenantWithSeptember(p);
    await payments.recordByOperator(
      operatorId,
      p.propertyId,
      { assignment_id: a, amount_inr: 4000, method: "cash", paid_on: "2026-09-02" },
      randomUUID()
    );
    const cancelled = await invoices.cancel(operatorId, p.propertyId, sep.id, "issued by mistake");
    expect(cancelled).toMatchObject({
      status: "cancelled",
      amount_paid_inr: 0,
      cancel_reason: "issued by mistake"
    });
    expect(await new RentAllocationService().unallocatedCredit(db, a)).toBe(400000);

    const adhoc = await invoices.createManual(operatorId, p.propertyId, {
      assignment_id: a,
      kind: "adhoc",
      due_date: "2026-09-20",
      lines: [{ kind: "other", label: "Key", amount_inr: 4000 }]
    });
    expect(adhoc).toMatchObject({ status: "paid", amount_paid_inr: 4000 }); // credit auto-applied
    await expect(invoices.cancel(operatorId, p.propertyId, adhoc.id, "x")).rejects.toMatchObject({
      response: { code: "invoice_paid" }
    });
    const zero = await invoices.createManual(operatorId, p.propertyId, {
      assignment_id: a,
      kind: "adhoc",
      due_date: "2026-09-20",
      lines: [{ kind: "discount", label: "Waived", amount_inr: 0 }]
    });
    expect(zero.status).toBe("paid");
    await expect(
      invoices.cancel(operatorId, p.propertyId, zero.id, "unneeded")
    ).resolves.toMatchObject({ status: "cancelled" });
    await assertRentInvariants(db, p.propertyId);
  });

  it("backfill: paid history has no receipt and no fees; unpaid arrears are collectible; overlapping rent periods are refused", async () => {
    const p = await property();
    const { a } = await tenantWithSeptember(p);
    const aug = await invoices.createBackfill(operatorId, p.propertyId, {
      assignment_id: a,
      kind: "rent",
      period_start: "2026-08-01",
      period_end: "2026-08-31",
      due_date: "2026-08-05",
      lines: [{ kind: "rent", label: "Rent · August 2026", amount_inr: 9000 }],
      payment: { amount_inr: 9000, method: "cash", paid_on: "2026-08-03" }
    });
    expect(aug).toMatchObject({
      source: "backfill",
      status: "paid",
      late_fee_eligible: false,
      settled_on: "2026-08-03"
    });
    const rec = await db.query(
      `SELECT 1 FROM pg_rent_receipts r JOIN pg_rent_payments pm ON pm.id = r.payment_id WHERE pm.assignment_id = $1::uuid`,
      [a]
    );
    expect(rec.rowCount).toBe(0);
    const jul = await invoices.createBackfill(operatorId, p.propertyId, {
      assignment_id: a,
      kind: "rent",
      period_start: "2026-07-01",
      period_end: "2026-07-31",
      due_date: "2026-07-05",
      lines: [{ kind: "rent", label: "Rent · July 2026", amount_inr: 9000 }]
    });
    expect(jul.status).toBe("issued");
    await expect(
      invoices.createBackfill(operatorId, p.propertyId, {
        assignment_id: a,
        kind: "rent",
        period_start: "2026-08-15",
        period_end: "2026-09-14",
        due_date: "2026-08-20",
        lines: [{ kind: "rent", label: "x", amount_inr: 1 }]
      })
    ).rejects.toMatchObject({ response: { code: "period_overlap" } });
    const held = await invoices.createBackfill(operatorId, p.propertyId, {
      assignment_id: a,
      kind: "deposit",
      due_date: "2026-08-01",
      lines: [{ kind: "deposit", label: "Security deposit", amount_inr: 18000 }],
      payment: { amount_inr: 18000, method: "cash", paid_on: "2026-08-01" }
    });
    expect(held).toMatchObject({ kind: "deposit", status: "paid" });
    await assertRentInvariants(db, p.propertyId);
  });

  it("re-proration: notice writes a suggestion, owner applies it (paid invoice → credit), cancelled notice offers restore", async () => {
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

    await db.query(
      `UPDATE pg_bed_assignments SET status = 'active', notice_end_date = NULL WHERE id = $1::uuid`,
      [a]
    );
    await engine.onAssignmentEvent({
      type: "notice_cancelled",
      propertyId: p.propertyId,
      assignmentId: a
    });
    inv = await invoices.get(operatorId, p.propertyId, sep.id);
    expect(inv.reprorate_suggestion).toMatchObject({ mode: "restore", to_inr: 9000 });
    inv = await invoices.restoreReprorate(operatorId, p.propertyId, sep.id);
    expect(inv).toMatchObject({
      total_inr: 9000,
      amount_paid_inr: 9000,
      status: "paid",
      reprorate_suggestion: null,
      period_end: "2026-09-30"
    });
    expect(await new RentAllocationService().unallocatedCredit(db, a)).toBe(0);
    await assertRentInvariants(db, p.propertyId);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @cribliv/api exec vitest run src/modules/pg-rent/__tests__/rent-invoice-actions.integration.test.ts`
Expected: FAIL — `RentInvoiceService` constructor arity / missing methods.

- [ ] **Step 3: DTO schemas**

```ts
// apps/api/src/modules/pg-rent/dto/invoice-actions.dto.ts
import { z } from "zod";
import type {
  PgRentApplyFeeInput, PgRentCancelInvoiceInput, PgRentEligibilityInput, PgRentExtendDueInput, PgRentIssueDraftInput, PgRentLineInput, PgRentLinePatchInput, PgRentWaiveFeeInput
} from "@cribliv/shared-types";

import { isIsoDate } from "../../../common/date";

const isoDate = z.string().refine(isIsoDate, "must be a real YYYY-MM-DD date");
const meta = z.record(z.string(), z.unknown()).optional();
const EDITABLE_KINDS = ["electricity","meals","maintenance","damage","cleaning","forfeit","other","discount","adjustment"] as const;

export const LineInputSchema = z.object({
  kind: z.enum(EDITABLE_KINDS), label: z.string().trim().min(1).max(40),
  amount_inr: z.number().int().min(-1000000).max(1000000), meta
}).refine((v) => v.amount_inr >= 0 || v.kind === "discount" || v.kind === "adjustment", "only discount/adjustment may be negative")
  satisfies z.ZodType<PgRentLineInput, PgRentLineInput>;

export const LinePatchSchema = z.object({
  label: z.string().trim().min(1).max(40).optional(), amount_inr: z.number().int().min(-1000000).max(1000000).optional(), meta
}) satisfies z.ZodType<PgRentLinePatchInput, PgRentLinePatchInput>;

export const ExtendDueSchema = z.object({ due_date: isoDate }) satisfies z.ZodType<PgRentExtendDueInput, PgRentExtendDueInput>;
export const CancelInvoiceSchema = z.object({ reason: z.string().trim().min(1).max(200) }) satisfies z.ZodType<PgRentCancelInvoiceInput, PgRentCancelInvoiceInput>;
export const IssueDraftSchema = z.object({ rent_inr: z.number().int().min(1).max(1000000).optional(), due_date: isoDate.optional() }) satisfies z.ZodType<PgRentIssueDraftInput, PgRentIssueDraftInput>;
export const ApplyFeeSchema = z.object({ amount_inr: z.number().int().min(1).max(50000).optional() }) satisfies z.ZodType<PgRentApplyFeeInput, PgRentApplyFeeInput>;
export const WaiveFeeSchema = z.object({ reason: z.string().trim().min(1).max(200) }) satisfies z.ZodType<PgRentWaiveFeeInput, PgRentWaiveFeeInput>;
export const EligibilitySchema = z.object({ late_fee_eligible: z.boolean() }) satisfies z.ZodType<PgRentEligibilityInput, PgRentEligibilityInput>;
```

- [ ] **Step 4: Extract numbering + token helpers from the engine**

Create `apps/api/src/modules/pg-rent/services/rent-numbering.ts` and move the engine's private `nextInvoiceNumber` and `payToken` there (the engine imports them; its tests are unchanged):

```ts
// apps/api/src/modules/pg-rent/services/rent-numbering.ts
import { randomBytes } from "node:crypto";
import type { PoolClient } from "pg";

export const PAY_TOKEN_DAYS = 45;

export async function nextInvoiceNumber(
  client: PoolClient,
  propertyId: string,
  prefix: string
): Promise<string> {
  const r = await client.query<{ seq: number }>(
    `UPDATE pg_rent_counters SET next_invoice_seq = next_invoice_seq + 1 WHERE pg_property_id = $1::uuid RETURNING next_invoice_seq - 1 AS seq`,
    [propertyId]
  );
  if (!r.rows[0]) throw new Error(`pg_rent_counters missing for ${propertyId}`);
  return `${prefix}-INV-${String(r.rows[0].seq).padStart(4, "0")}`;
}

export function newPayToken(): { token: string; expiresAt: Date } {
  return {
    token: randomBytes(32).toString("base64url"),
    expiresAt: new Date(Date.now() + PAY_TOKEN_DAYS * 24 * 60 * 60 * 1000)
  };
}
```

In `rent-invoice-engine.service.ts` delete the two private methods, import these, and replace `this.nextInvoiceNumber(` → `nextInvoiceNumber(` and `this.payToken()` → `newPayToken()`. Run `pnpm --filter @cribliv/api exec vitest run src/modules/pg-rent/__tests__/rent-invoice-engine.integration.test.ts` → still PASS.

- [ ] **Step 5: Invoice service mutations**

Change the constructor and add the methods below to `rent-invoice.service.ts`. New imports: `BadRequestException, ConflictException`; `todayIst, compareIsoDates` from common/date; `inrToPaise`; `prorate` from `../pure/rent-proration`; `periodLabel, naturalPeriodContaining` from `../pure/rent-period`; `firstOfMonth, dayOf` from `../pure/rent-dates`; `RentAllocationService`, `RentPaymentService`, `RentInvoiceEngineService`; `applyFeeDecision, loadFeeContext, setInvoiceTotalFromLines` from `./rent-fee-line`; `nextInvoiceNumber, newPayToken` from `./rent-numbering`; `computeLateFee` from `../pure/rent-late-fee`; types `PgRentBackfillInput, PgRentIssueDraftInput, PgRentLineInput, PgRentLinePatchInput, PgRentManualInvoiceInput`.

```ts
  constructor(
    @Inject(DatabaseService) private readonly db: DatabaseService,
    @Inject(RentAllocationService) private readonly alloc: RentAllocationService,
    @Inject(RentPaymentService) private readonly payments: RentPaymentService,
    @Inject(RentInvoiceEngineService) private readonly engine: RentInvoiceEngineService
  ) {}

  private actor(operatorId: string): RentActor { return { id: operatorId, role: "pg_operator" }; }

  private async readById(propertyId: string, invoiceId: string): Promise<PgRentInvoice> {
    const rows = await this.db.query<RentInvoiceRow>(
      `SELECT ${INVOICE_SELECT} FROM pg_rent_invoices i JOIN pg_bed_assignments a ON a.id = i.assignment_id WHERE i.id = $1::uuid AND i.pg_property_id = $2::uuid`, [invoiceId, propertyId]
    );
    if (!rows.rows[0]) throw new NotFoundException({ code: "invoice_not_found" });
    return (await this.withLines(this.db, rows.rows))[0];
  }

  private async lockInvoice(client: PoolClient, propertyId: string, invoiceId: string) {
    const r = await client.query<{
      id: string; assignment_id: string; kind: string; status: string; total_paise: string; amount_paid_paise: string; due_date: string;
      period_start: string | null; period_end: string | null; late_fee_eligible: boolean; suggested_late_fee_paise: string | null;
      reprorate_suggestion: { leave_on: string; from_paise: number; to_paise: number; mode: "reprorate" | "restore" } | null; rent_snapshot_paise: string | null;
    }>(
      `SELECT id::text, assignment_id::text, kind::text, status::text, total_paise::text, amount_paid_paise::text, to_char(due_date,'YYYY-MM-DD') AS due_date,
              to_char(period_start,'YYYY-MM-DD') AS period_start, to_char(period_end,'YYYY-MM-DD') AS period_end, late_fee_eligible, suggested_late_fee_paise::text,
              reprorate_suggestion, rent_snapshot_paise::text
         FROM pg_rent_invoices WHERE id = $1::uuid AND pg_property_id = $2::uuid FOR UPDATE`,
      [invoiceId, propertyId]
    );
    if (!r.rows[0]) throw new NotFoundException({ code: "invoice_not_found" });
    return r.rows[0];
  }

  private assertEditable(status: string): void {
    if (!["draft", "issued", "partially_paid"].includes(status)) throw new ConflictException({ code: "invoice_not_editable" });
  }

  /** Invariant 14 + 1: apply a line change, releasing excess first when the total drops below amount_paid. */
  private async settleTotal(client: PoolClient, invoiceId: string, paidPaise: number, newTotal: number, actor: RentActor): Promise<void> {
    if (paidPaise > newTotal) await this.alloc.deallocateExcess(client, invoiceId, paidPaise - newTotal, actor);
    await setInvoiceTotalFromLines(client, invoiceId);
    await this.alloc.recomputeInvoice(client, invoiceId);
  }

  private async event(client: PoolClient, propertyId: string, invoiceId: string, type: string, actor: RentActor, payload: Record<string, unknown> = {}) {
    await writeRentEvent(client, { propertyId, entityType: "invoice", entityId: invoiceId, eventType: type, actor, payload });
  }

  // ── lines ─────────────────────────────────────────────────────────────────

  async addLine(operatorId: string, propertyId: string, invoiceId: string, input: PgRentLineInput): Promise<PgRentInvoice> {
    requireDb(this.db);
    const actor = this.actor(operatorId);
    await transaction(this.db, async (client) => {
      await assertManagedOwnership(client, operatorId, propertyId, true);
      const inv = await this.lockInvoice(client, propertyId, invoiceId);
      this.assertEditable(inv.status);
      const amount = inrToPaise(input.amount_inr, { allowNegative: true });
      const line = await client.query<{ id: string }>(
        `INSERT INTO pg_rent_invoice_lines (invoice_id, kind, label, amount_paise, meta, source, sort_order, created_by)
         VALUES ($1::uuid, $2::pg_rent_line_kind, $3, $4, $5::jsonb, 'operator', (SELECT COALESCE(MAX(sort_order),0)+1 FROM pg_rent_invoice_lines WHERE invoice_id = $1::uuid AND kind <> 'late_fee'), $6::uuid) RETURNING id::text`,
        [invoiceId, input.kind, input.label, amount, JSON.stringify(input.meta ?? {}), operatorId]
      );
      await this.settleTotal(client, invoiceId, Number(inv.amount_paid_paise), Number(inv.total_paise) + amount, actor);
      await this.event(client, propertyId, invoiceId, "invoice.line_added", actor, { line_id: line.rows[0].id, kind: input.kind, label: input.label, amount_paise: amount });
    });
    return this.readById(propertyId, invoiceId);
  }

  async updateLine(operatorId: string, propertyId: string, invoiceId: string, lineId: string, input: PgRentLinePatchInput): Promise<PgRentInvoice> {
    requireDb(this.db);
    const actor = this.actor(operatorId);
    await transaction(this.db, async (client) => {
      await assertManagedOwnership(client, operatorId, propertyId, true);
      const inv = await this.lockInvoice(client, propertyId, invoiceId);
      this.assertEditable(inv.status);
      const line = await client.query<{ kind: string; amount_paise: string; label: string }>(`SELECT kind::text, amount_paise::text, label FROM pg_rent_invoice_lines WHERE id = $1::uuid AND invoice_id = $2::uuid FOR UPDATE`, [lineId, invoiceId]);
      if (!line.rows[0]) throw new NotFoundException({ code: "line_not_found" });
      const locked = ["rent", "deposit", "late_fee"].includes(line.rows[0].kind);
      if (locked && input.amount_inr !== undefined) throw new ConflictException({ code: "line_locked", message: "Use waive / re-prorate / issue for this line" });
      const newAmount = input.amount_inr === undefined ? Number(line.rows[0].amount_paise) : inrToPaise(input.amount_inr, { allowNegative: true });
      await client.query(
        `UPDATE pg_rent_invoice_lines SET label = COALESCE($3, label), amount_paise = $4, meta = COALESCE($5::jsonb, meta) WHERE id = $1::uuid AND invoice_id = $2::uuid`,
        [lineId, invoiceId, input.label ?? null, newAmount, input.meta ? JSON.stringify(input.meta) : null]
      );
      await this.settleTotal(client, invoiceId, Number(inv.amount_paid_paise), Number(inv.total_paise) - Number(line.rows[0].amount_paise) + newAmount, actor);
      await this.event(client, propertyId, invoiceId, "invoice.line_updated", actor, { line_id: lineId, from_paise: Number(line.rows[0].amount_paise), to_paise: newAmount, label: input.label ?? line.rows[0].label });
    });
    return this.readById(propertyId, invoiceId);
  }

  async removeLine(operatorId: string, propertyId: string, invoiceId: string, lineId: string): Promise<PgRentInvoice> {
    requireDb(this.db);
    const actor = this.actor(operatorId);
    await transaction(this.db, async (client) => {
      await assertManagedOwnership(client, operatorId, propertyId, true);
      const inv = await this.lockInvoice(client, propertyId, invoiceId);
      this.assertEditable(inv.status === "paid" ? "issued" : inv.status); // a paid invoice may still lose a charge (§6.6)
      const line = await client.query<{ kind: string; label: string; amount_paise: string; meta: unknown; source: string }>(`SELECT kind::text, label, amount_paise::text, meta, source::text FROM pg_rent_invoice_lines WHERE id = $1::uuid AND invoice_id = $2::uuid FOR UPDATE`, [lineId, invoiceId]);
      if (!line.rows[0]) throw new NotFoundException({ code: "line_not_found" });
      if (["rent", "deposit", "late_fee"].includes(line.rows[0].kind)) throw new ConflictException({ code: "line_locked" });
      const amount = Number(line.rows[0].amount_paise);
      await this.settleTotal(client, invoiceId, Number(inv.amount_paid_paise), Number(inv.total_paise) - amount, actor);
      await client.query(`DELETE FROM pg_rent_invoice_lines WHERE id = $1::uuid`, [lineId]);
      await setInvoiceTotalFromLines(client, invoiceId);
      await this.alloc.recomputeInvoice(client, invoiceId);
      // D14: the event carries the full removed line — that is the audit record.
      await this.event(client, propertyId, invoiceId, "invoice.line_removed", actor, { line: { id: lineId, ...line.rows[0], amount_paise: amount } });
    });
    return this.readById(propertyId, invoiceId);
  }

  // ── lifecycle ─────────────────────────────────────────────────────────────

  async issueDraft(operatorId: string, propertyId: string, invoiceId: string, input: PgRentIssueDraftInput): Promise<PgRentInvoice> {
    requireDb(this.db);
    const actor = this.actor(operatorId);
    await transaction(this.db, async (client) => {
      await assertManagedOwnership(client, operatorId, propertyId, true);
      const inv = await this.lockInvoice(client, propertyId, invoiceId);
      if (inv.status !== "draft") throw new ConflictException({ code: "invoice_not_draft" });
      if (input.rent_inr !== undefined) {
        const rent = inrToPaise(input.rent_inr);
        await client.query(`UPDATE pg_rent_invoice_lines SET amount_paise = $2 WHERE invoice_id = $1::uuid AND kind = 'rent'`, [invoiceId, rent]);
        await client.query(`UPDATE pg_rent_invoices SET rent_snapshot_paise = $2, rent_source = 'assignment' WHERE id = $1::uuid`, [invoiceId, rent]);
        await this.event(client, propertyId, invoiceId, "invoice.confirmed_amount", actor, { rent_paise: rent });
      }
      const today = todayIst();
      const due = input.due_date ?? (compareIsoDates(inv.due_date, today) < 0 ? today : inv.due_date);
      const token = newPayToken();
      await client.query(
        `UPDATE pg_rent_invoices SET status = 'issued', issued_at = now(), due_date = $2::date, pay_token = $3, pay_token_expires_at = $4 WHERE id = $1::uuid`,
        [invoiceId, due, token.token, token.expiresAt]
      );
      await setInvoiceTotalFromLines(client, invoiceId);
      await this.alloc.recomputeInvoice(client, invoiceId);
      await this.event(client, propertyId, invoiceId, "invoice.issued", actor, { from: "draft", due_date: due });
      await this.alloc.applyUnallocatedCredit(client, invoiceId, actor);
    });
    return this.readById(propertyId, invoiceId);
  }

  async extendDue(operatorId: string, propertyId: string, invoiceId: string, dueDate: string): Promise<PgRentInvoice> {
    requireDb(this.db);
    const actor = this.actor(operatorId);
    await transaction(this.db, async (client) => {
      await assertManagedOwnership(client, operatorId, propertyId, true);
      const inv = await this.lockInvoice(client, propertyId, invoiceId);
      if (!["issued", "partially_paid"].includes(inv.status)) throw new ConflictException({ code: "invoice_not_editable" });
      await client.query(`UPDATE pg_rent_invoices SET due_date = $2::date WHERE id = $1::uuid`, [invoiceId, dueDate]);
      await this.event(client, propertyId, invoiceId, "invoice.due_extended", actor, { from: inv.due_date, to: dueDate });
      const ctx = await loadFeeContext(client, invoiceId);
      if (ctx.policy && (ctx.feeLinePaise !== null || ctx.invoice.suggestedPaise !== null)) {
        const decision = computeLateFee({ policy: ctx.policy, dueDate, asOf: todayIst(), chargeablePaise: ctx.invoice.totalPaise - ctx.invoice.paidPaise - (ctx.feeLinePaise ?? 0), overridePaise: ctx.invoice.overridePaise, existingFeePaise: ctx.feeLinePaise ?? ctx.invoice.suggestedPaise, frozen: false });
        if (decision.action === "remove") await applyFeeDecision(client, this.alloc, ctx, decision, actor, { applyMode: "line", reason: "due_date_extended" });
      }
    });
    return this.readById(propertyId, invoiceId);
  }

  async cancel(operatorId: string, propertyId: string, invoiceId: string, reason: string): Promise<PgRentInvoice> {
    requireDb(this.db);
    const actor = this.actor(operatorId);
    await transaction(this.db, async (client) => {
      await assertManagedOwnership(client, operatorId, propertyId, true);
      const inv = await this.lockInvoice(client, propertyId, invoiceId);
      if (inv.status === "cancelled") throw new ConflictException({ code: "invoice_cancelled" });
      if (inv.status === "paid" && Number(inv.amount_paid_paise) > 0) throw new ConflictException({ code: "invoice_paid", message: "Reverse its payments first" });
      if (inv.status === "partially_paid") await this.alloc.releaseAllocations(client, invoiceId, actor);
      await client.query(`UPDATE pg_rent_invoices SET status = 'cancelled', cancelled_at = now(), cancel_reason = $2, pay_token_expires_at = now() WHERE id = $1::uuid`, [invoiceId, reason]);
      await this.event(client, propertyId, invoiceId, "invoice.cancelled", actor, { reason });
    });
    return this.readById(propertyId, invoiceId);
  }

  // ── fees ──────────────────────────────────────────────────────────────────

  async applyFee(operatorId: string, propertyId: string, invoiceId: string, amountInr?: number): Promise<PgRentInvoice> {
    requireDb(this.db);
    const actor = this.actor(operatorId);
    await transaction(this.db, async (client) => {
      await assertManagedOwnership(client, operatorId, propertyId, true);
      const inv = await this.lockInvoice(client, propertyId, invoiceId);
      if (inv.kind !== "rent" || !inv.late_fee_eligible || !["issued", "partially_paid"].includes(inv.status)) throw new ConflictException({ code: "fee_not_allowed" });
      const ctx = await loadFeeContext(client, invoiceId);
      const fee = amountInr !== undefined ? inrToPaise(amountInr) : ctx.invoice.suggestedPaise;
      if (fee === null || fee <= 0) throw new BadRequestException({ code: "fee_amount_required" });
      await applyFeeDecision(client, this.alloc, ctx, { feePaise: fee, action: ctx.feeLinePaise === null ? "apply" : "update" }, actor, { applyMode: "line", reason: "owner_tap" });
      await client.query(`UPDATE pg_rent_invoices SET late_fee_waived_at = NULL, late_fee_waived_by = NULL, late_fee_waive_reason = NULL WHERE id = $1::uuid`, [invoiceId]);
    });
    return this.readById(propertyId, invoiceId);
  }

  async waiveFee(operatorId: string, propertyId: string, invoiceId: string, reason: string): Promise<PgRentInvoice> {
    requireDb(this.db);
    const actor = this.actor(operatorId);
    await transaction(this.db, async (client) => {
      await assertManagedOwnership(client, operatorId, propertyId, true);
      await this.lockInvoice(client, propertyId, invoiceId);
      const ctx = await loadFeeContext(client, invoiceId);
      await applyFeeDecision(client, this.alloc, ctx, { feePaise: 0, action: "remove" }, actor, { applyMode: "line", reason: "waived" });
      await client.query(`UPDATE pg_rent_invoices SET late_fee_waived_at = now(), late_fee_waived_by = $2::uuid, late_fee_waive_reason = $3 WHERE id = $1::uuid`, [invoiceId, operatorId, reason]);
      await this.event(client, propertyId, invoiceId, "late_fee.waived", actor, { reason });
    });
    return this.readById(propertyId, invoiceId);
  }

  async waiveAllFees(operatorId: string, propertyId: string, reason: string): Promise<{ waived: number }> {
    requireDb(this.db);
    await assertManagedOwnership(this.db, operatorId, propertyId);
    const ids = await this.db.query<{ id: string }>(
      `SELECT i.id::text FROM pg_rent_invoices i WHERE i.pg_property_id = $1::uuid AND i.status IN ('issued','partially_paid')
          AND (EXISTS (SELECT 1 FROM pg_rent_invoice_lines l WHERE l.invoice_id = i.id AND l.kind = 'late_fee') OR i.suggested_late_fee_paise IS NOT NULL)`,
      [propertyId]
    );
    for (const row of ids.rows) await this.waiveFee(operatorId, propertyId, row.id, reason);
    return { waived: ids.rows.length };
  }

  async setEligibility(operatorId: string, propertyId: string, invoiceId: string, eligible: boolean): Promise<PgRentInvoice> {
    requireDb(this.db);
    const actor = this.actor(operatorId);
    await transaction(this.db, async (client) => {
      await assertManagedOwnership(client, operatorId, propertyId, true);
      const inv = await this.lockInvoice(client, propertyId, invoiceId);
      if (inv.kind !== "rent") throw new ConflictException({ code: "fee_not_allowed" });
      await client.query(`UPDATE pg_rent_invoices SET late_fee_eligible = $2 WHERE id = $1::uuid`, [invoiceId, eligible]);
      await this.event(client, propertyId, invoiceId, "late_fee.eligibility_changed", actor, { late_fee_eligible: eligible });
    });
    return this.readById(propertyId, invoiceId);
  }

  // ── manual & backfill ─────────────────────────────────────────────────────

  private async insertInvoice(client: PoolClient, v: {
    propertyId: string; assignmentId: string; kind: string; source: "manual" | "backfill"; periodStart: string | null; periodEnd: string | null; dueDate: string;
    lines: Array<{ kind: string; label: string; amountPaise: number }>; eligible: boolean; tenantNote: string | null; actor: RentActor;
  }): Promise<string> {
    const a = await client.query<{ bed_id: string; bed_label: string; room_id: string; room_number: string; receipt_prefix: string }>(
      `SELECT b.id::text AS bed_id, b.bed_label, r.id::text AS room_id, r.room_number, s.receipt_prefix
         FROM pg_bed_assignments asg JOIN pg_beds b ON b.id = asg.bed_id JOIN pg_rooms r ON r.id = b.room_id JOIN pg_rent_settings s ON s.pg_property_id = asg.pg_property_id
        WHERE asg.id = $1::uuid AND asg.pg_property_id = $2::uuid FOR UPDATE OF asg`,
      [v.assignmentId, v.propertyId]
    );
    if (!a.rows[0]) throw new NotFoundException({ code: "assignment_not_found" });
    if (v.kind === "rent") {
      const overlap = await client.query(
        `SELECT 1 FROM pg_rent_invoices WHERE assignment_id = $1::uuid AND kind = 'rent' AND status <> 'cancelled' AND daterange(period_start, period_end, '[]') && daterange($2::date, $3::date, '[]')`,
        [v.assignmentId, v.periodStart, v.periodEnd]
      );
      if (overlap.rowCount) throw new ConflictException({ code: "period_overlap" });
    }
    if (v.kind === "deposit") {
      const dup = await client.query(`SELECT 1 FROM pg_rent_invoices WHERE assignment_id = $1::uuid AND kind = 'deposit' AND status <> 'cancelled'`, [v.assignmentId]);
      if (dup.rowCount) throw new ConflictException({ code: "deposit_exists" });
    }
    const number = await nextInvoiceNumber(client, v.propertyId, a.rows[0].receipt_prefix);
    const token = newPayToken();
    const total = v.lines.reduce((s, l) => s + l.amountPaise, 0);
    if (total < 0) throw new BadRequestException({ code: "invalid_total" });
    const inserted = await client.query<{ id: string }>(
      `INSERT INTO pg_rent_invoices (pg_property_id, assignment_id, bed_id, room_id, room_number, bed_label, kind, invoice_number, period_start, period_end, billing_month, due_date, status, source, total_paise, late_fee_eligible, pay_token, pay_token_expires_at, tenant_note, issued_at, created_by)
       VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5, $6, $7::pg_rent_invoice_kind, $8, $9::date, $10::date, $11::date, $12::date, 'issued', $13::pg_rent_invoice_source, $14, $15, $16, $17, $18, now(), $19::uuid) RETURNING id::text`,
      [v.propertyId, v.assignmentId, a.rows[0].bed_id, a.rows[0].room_id, a.rows[0].room_number, a.rows[0].bed_label, v.kind, number, v.periodStart, v.periodEnd,
       firstOfMonth(v.periodStart ?? v.dueDate), v.dueDate, v.source, total, v.eligible, token.token, token.expiresAt, v.tenantNote, v.actor.id]
    );
    const id = inserted.rows[0].id;
    for (const [i, l] of v.lines.entries()) {
      await client.query(`INSERT INTO pg_rent_invoice_lines (invoice_id, kind, label, amount_paise, source, sort_order, created_by) VALUES ($1::uuid, $2::pg_rent_line_kind, $3, $4, 'operator', $5, $6::uuid)`, [id, l.kind, l.label, l.amountPaise, i, v.actor.id]);
    }
    await this.alloc.recomputeInvoice(client, id);
    await this.event(client, v.propertyId, id, "invoice.issued", v.actor, { kind: v.kind, source: v.source, total_paise: total, due_date: v.dueDate });
    return id;
  }

  async createManual(operatorId: string, propertyId: string, input: PgRentManualInvoiceInput): Promise<PgRentInvoice> {
    requireDb(this.db);
    const actor = this.actor(operatorId);
    const id = await transaction(this.db, async (client) => {
      await assertManagedOwnership(client, operatorId, propertyId, true);
      const id = await this.insertInvoice(client, {
        propertyId, assignmentId: input.assignment_id, kind: "adhoc", source: "manual", periodStart: null, periodEnd: null, dueDate: input.due_date,
        lines: input.lines.map((l) => ({ kind: l.kind, label: l.label, amountPaise: inrToPaise(l.amount_inr, { allowNegative: true }) })), eligible: false, tenantNote: input.tenant_note ?? null, actor
      });
      await this.alloc.applyUnallocatedCredit(client, id, actor);
      return id;
    });
    return this.readById(propertyId, id);
  }

  /** Spec §6.4 / §5.5 "Deposit held": invoice (+ optional backfill payment) in one transaction; no receipt; fee-exempt. */
  async createBackfill(operatorId: string, propertyId: string, input: PgRentBackfillInput): Promise<PgRentInvoice> {
    requireDb(this.db);
    const actor = this.actor(operatorId);
    const id = await transaction(this.db, async (client) => {
      await assertManagedOwnership(client, operatorId, propertyId, true);
      const id = await this.insertInvoice(client, {
        propertyId, assignmentId: input.assignment_id, kind: input.kind, source: "backfill", periodStart: input.period_start ?? null, periodEnd: input.period_end ?? null, dueDate: input.due_date,
        lines: input.lines.map((l) => ({ kind: l.kind, label: l.label, amountPaise: inrToPaise(l.amount_inr, { allowNegative: true }) })), eligible: false, tenantNote: null, actor
      });
      if (input.payment) {
        await this.payments.recordBackfillPayment(client, {
          propertyId, assignmentId: input.assignment_id, invoiceId: id, amountPaise: inrToPaise(input.payment.amount_inr), method: input.payment.method,
          paidOn: input.payment.paid_on, reference: input.payment.reference ?? null, actor
        });
      } else {
        await this.alloc.applyUnallocatedCredit(client, id, actor);
      }
      return id;
    });
    return this.readById(propertyId, id);
  }

  // ── re-proration (spec §5.8, D18) ─────────────────────────────────────────

  async applyReprorate(operatorId: string, propertyId: string, invoiceId: string): Promise<PgRentInvoice> {
    requireDb(this.db);
    const actor = this.actor(operatorId);
    await transaction(this.db, async (client) => {
      await assertManagedOwnership(client, operatorId, propertyId, true);
      const inv = await this.lockInvoice(client, propertyId, invoiceId);
      const s = inv.reprorate_suggestion;
      if (!s || s.mode !== "reprorate") throw new ConflictException({ code: "no_suggestion" });
      const line = await client.query<{ id: string; amount_paise: string; meta: Record<string, unknown> }>(`SELECT id::text, amount_paise::text, meta FROM pg_rent_invoice_lines WHERE invoice_id = $1::uuid AND kind = 'rent' FOR UPDATE`, [invoiceId]);
      const original = Number(line.rows[0].amount_paise);
      await client.query(
        `UPDATE pg_rent_invoice_lines SET amount_paise = $2, meta = meta || $3::jsonb WHERE id = $1::uuid`,
        [line.rows[0].id, s.to_paise, JSON.stringify({ reprorated: { original_paise: original, original_end: inv.period_end, leave_on: s.leave_on } })]
      );
      await client.query(`UPDATE pg_rent_invoices SET period_end = $2::date, proration_factor = NULL, reprorate_suggestion = NULL WHERE id = $1::uuid`, [invoiceId, s.leave_on]);
      await this.settleTotal(client, invoiceId, Number(inv.amount_paid_paise), Number(inv.total_paise) - original + s.to_paise, actor);
      await this.event(client, propertyId, invoiceId, "invoice.reprorated", actor, { leave_on: s.leave_on, from_paise: original, to_paise: s.to_paise });
    });
    return this.readById(propertyId, invoiceId);
  }

  async dismissReprorate(operatorId: string, propertyId: string, invoiceId: string): Promise<PgRentInvoice> {
    requireDb(this.db);
    await transaction(this.db, async (client) => {
      await assertManagedOwnership(client, operatorId, propertyId, true);
      await this.lockInvoice(client, propertyId, invoiceId);
      await client.query(`UPDATE pg_rent_invoices SET reprorate_suggestion = NULL WHERE id = $1::uuid`, [invoiceId]);
      await this.event(client, propertyId, invoiceId, "invoice.reprorate_dismissed", this.actor(operatorId));
    });
    return this.readById(propertyId, invoiceId);
  }

  async restoreReprorate(operatorId: string, propertyId: string, invoiceId: string): Promise<PgRentInvoice> {
    requireDb(this.db);
    const actor = this.actor(operatorId);
    await transaction(this.db, async (client) => {
      await assertManagedOwnership(client, operatorId, propertyId, true);
      const inv = await this.lockInvoice(client, propertyId, invoiceId);
      const s = inv.reprorate_suggestion;
      if (!s || s.mode !== "restore") throw new ConflictException({ code: "no_suggestion" });
      const line = await client.query<{ id: string; amount_paise: string; meta: { reprorated?: { original_paise: number; original_end: string } } }>(`SELECT id::text, amount_paise::text, meta FROM pg_rent_invoice_lines WHERE invoice_id = $1::uuid AND kind = 'rent' FOR UPDATE`, [invoiceId]);
      const r = line.rows[0].meta.reprorated;
      if (!r) throw new ConflictException({ code: "no_suggestion" });
      await client.query(`UPDATE pg_rent_invoice_lines SET amount_paise = $2, meta = meta - 'reprorated' WHERE id = $1::uuid`, [line.rows[0].id, r.original_paise]);
      await client.query(`UPDATE pg_rent_invoices SET period_end = $2::date, reprorate_suggestion = NULL WHERE id = $1::uuid`, [invoiceId, r.original_end]);
      await setInvoiceTotalFromLines(client, invoiceId);
      await this.alloc.recomputeInvoice(client, invoiceId);
      await this.event(client, propertyId, invoiceId, "invoice.line_updated", actor, { reason: "reprorate_restored", from_paise: Number(line.rows[0].amount_paise), to_paise: r.original_paise });
      await this.alloc.applyUnallocatedCredit(client, invoiceId, actor);
    });
    return this.readById(propertyId, invoiceId);
  }
```

`invoice.reprorate_dismissed` is an owner-only event type; it is already listed in spec §4.10.

- [ ] **Step 6: Engine — write and clear suggestions**

In `rent-invoice-engine.service.ts`, replace the body of `onAssignmentEvent` with:

```ts
  async onAssignmentEvent(event: { type: string; propertyId: string; assignmentId: string }): Promise<void> {
    if (!this.db.isEnabled()) return;
    try {
      const settings = await this.settings.getRow(this.db, event.propertyId);
      if (!settings) return;
      await this.generateInvoicesForProperty(event.propertyId, todayIst(), SYSTEM_ACTOR, { assignmentId: event.assignmentId });
      if (!settings.prorate_move_out) return;
      const leaving = ["notice_served", "operator_move_out_requested", "tenant_move_out_requested", "move_out_confirmed", "operator_direct_move_out"].includes(event.type);
      const staying = ["move_out_cancelled", "notice_cancelled"].includes(event.type);
      if (leaving) await transaction(this.db, (client) => this.suggestReprorate(client, event.propertyId, event.assignmentId, settings));
      else if (staying) await transaction(this.db, (client) => this.suggestRestore(client, event.propertyId, event.assignmentId));
    } catch (error) {
      console.error(JSON.stringify({ job: "pg_rent_assignment_hook", type: event.type, assignment_id: event.assignmentId, error: error instanceof Error ? error.message : String(error) }));
    }
  }

  /** Spec §5.8: a suggestion on every issued/paid rent invoice whose period straddles the leave date. Never edits a bill. */
  private async suggestReprorate(client: PoolClient, propertyId: string, assignmentId: string, settings: RentSettingsRow): Promise<void> {
    const rows = await this.loadAssignments(client, propertyId, assignmentId);
    const a = rows[0];
    if (!a || !a.move_in_date) return;
    const window = billingWindow(a);
    if (!window?.end) return;
    const leaveOn = window.end;
    if (compareIsoDates(leaveOn, a.move_in_date) < 0) return; // "check the notice date" — refused as a suggestion
    const { spec } = this.specFor(a, settings);
    const invoices = await client.query<{ id: string; period_start: string; period_end: string; rent_line: string; rent_snapshot_paise: string | null }>(
      `SELECT i.id::text, to_char(i.period_start,'YYYY-MM-DD') AS period_start, to_char(i.period_end,'YYYY-MM-DD') AS period_end, i.rent_snapshot_paise::text,
              (SELECT l.amount_paise::text FROM pg_rent_invoice_lines l WHERE l.invoice_id = i.id AND l.kind = 'rent') AS rent_line
         FROM pg_rent_invoices i
        WHERE i.assignment_id = $1::uuid AND i.kind = 'rent' AND i.status IN ('issued','partially_paid','paid')
          AND i.period_start <= $2::date AND i.period_end > $2::date AND i.reprorate_suggestion IS NULL FOR UPDATE`,
      [assignmentId, leaveOn]
    );
    for (const inv of invoices.rows) {
      if (compareIsoDates(leaveOn, inv.period_start) < 0) continue;
      const rent = inv.rent_snapshot_paise === null ? Number(inv.rent_line) : Number(inv.rent_snapshot_paise);
      const { amountPaise } = prorate(rent, { start: inv.period_start, end: leaveOn }, spec, settings.proration_mode);
      const suggestion = { leave_on: leaveOn, from_paise: Number(inv.rent_line), to_paise: amountPaise, mode: "reprorate" as const };
      await client.query(`UPDATE pg_rent_invoices SET reprorate_suggestion = $2::jsonb WHERE id = $1::uuid`, [inv.id, JSON.stringify(suggestion)]);
      await writeRentEvent(client, { propertyId, entityType: "invoice", entityId: inv.id, eventType: "invoice.final_reprorate_suggested", actor: SYSTEM_ACTOR, payload: suggestion });
    }
  }

  /** Spec §5.8: an unactioned suggestion disappears; an applied re-proration gets a Restore prompt. */
  private async suggestRestore(client: PoolClient, propertyId: string, assignmentId: string): Promise<void> {
    await client.query(`UPDATE pg_rent_invoices SET reprorate_suggestion = NULL WHERE assignment_id = $1::uuid AND reprorate_suggestion->>'mode' = 'reprorate'`, [assignmentId]);
    const applied = await client.query<{ id: string; amount_paise: string; meta: { reprorated: { original_paise: number; original_end: string; leave_on: string } } }>(
      `SELECT i.id::text, l.amount_paise::text, l.meta FROM pg_rent_invoices i JOIN pg_rent_invoice_lines l ON l.invoice_id = i.id AND l.kind = 'rent'
        WHERE i.assignment_id = $1::uuid AND i.status <> 'cancelled' AND l.meta ? 'reprorated' AND i.reprorate_suggestion IS NULL FOR UPDATE OF i`,
      [assignmentId]
    );
    for (const inv of applied.rows) {
      const r = inv.meta.reprorated;
      const suggestion = { leave_on: r.original_end, from_paise: Number(inv.amount_paise), to_paise: r.original_paise, mode: "restore" as const };
      await client.query(`UPDATE pg_rent_invoices SET reprorate_suggestion = $2::jsonb WHERE id = $1::uuid`, [inv.id, JSON.stringify(suggestion)]);
      await writeRentEvent(client, { propertyId, entityType: "invoice", entityId: inv.id, eventType: "invoice.restore_suggested", actor: SYSTEM_ACTOR, payload: suggestion });
    }
  }
```

(imports to add in the engine: `transaction`, `PoolClient`, `RentSettingsRow`, `writeRentEvent`. `invoice.restore_suggested` joins `invoice.reprorate_dismissed` as owner-only event types.)

- [ ] **Step 7: Run everything touched**

```bash
pnpm --filter @cribliv/api exec vitest run src/modules/pg-rent/__tests__/rent-invoice-actions.integration.test.ts
pnpm --filter @cribliv/api exec vitest run src/modules/pg-rent
```

Expected: actions PASS (7); the 1a controller test that constructs `RentInvoiceService` through the Nest module still passes (DI supplies the new constructor args — add `RentPaymentService`/`RentReceiptService` to the module providers if you have not yet). The 1a controller test file constructs nothing by hand, so no edit there.

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/modules/pg-rent
git commit -m "feat(pg-rent): invoice actions — lines, issue, extend, cancel, fees, manual/backfill invoices, re-proration suggestions"
```

---

### Task 6: Late-fee sweep, receipt rendering queue, worker wiring

**Files:**

- Create: `apps/api/src/modules/pg-rent/receipt/receipt-renderer.ts`
- Create: `apps/api/src/modules/pg-rent/receipt/templates/receipt.en.hbs`, `receipt.hi.hbs`
- Modify: `apps/api/src/modules/pg-rent/services/rent-receipt.service.ts` (render, sweep, retry, download, share)
- Modify: `apps/api/src/modules/pg-rent/pg-rent.module.ts` (`PG_RENT_PDF_STORAGE`, `PG_RENT_SAS_ISSUER`, `PG_RENT_RECEIPT_RENDERER` providers)
- Modify: `apps/api/src/worker/pg-rent-sweeps.ts`, `apps/api/src/worker/worker.ts`
- Modify: `.env.example` (`PG_RENT_AZURE_CONTAINER=pg-rent-receipts`)
- Test: `apps/api/src/modules/pg-rent/__tests__/rent-late-fee-sweep.integration.test.ts`, `apps/api/src/modules/pg-rent/__tests__/receipt-render.test.ts`, `apps/api/src/modules/pg-rent/__tests__/rent-receipt-queue.integration.test.ts`

**Interfaces:**

```ts
// receipt/receipt-renderer.ts
export interface ReceiptRendererPort { render(snapshot: ReceiptSnapshot, locale: "en" | "hi", voided: boolean): Promise<Buffer> }
export function renderReceiptHtml(snapshot: ReceiptSnapshot, locale: "en" | "hi", voided: boolean): string     // pure, unit-testable
export class LazyReceiptRenderer implements ReceiptRendererPort   // BrowserPool launched on first render, page.pdf A4

// rent-receipt.service.ts additions
async renderOne(receiptId: string): Promise<"ready" | "failed" | "skipped">   // claims the row (SKIP LOCKED), renders, uploads, marks ready/failed with backoff
async renderPending(limit = 20): Promise<{ rendered: number; failed: number }> // the 2-minute sweep body
async retry(operatorId, propertyId, receiptId): Promise<PgRentReceipt>          // failed → pending, attempts reset
async downloadUrl(operatorId, propertyId, receiptId): Promise<PgRentReceiptDownload>     // 15-min SAS; 409 receipt_not_ready
async downloadUrlForTenant(tenantUserId, receiptId): Promise<PgRentReceiptDownload>
async regenerateShareToken(operatorId, propertyId, receiptId): Promise<{ expires_at: string }>
async resolveShareToken(token: string): Promise<PgRentReceiptDownload>            // for 1c's public endpoint; 404 when expired/voided/not ready

// worker/pg-rent-sweeps.ts additions
export async function runPgRentLateFeeSweep(db, today): Promise<{ invoices: number; applied: number; suggested: number; updated: number; frozen: number }>
export async function runPgRentReceiptSweep(db, service?): Promise<{ rendered: number; failed: number }>
```

- [ ] **Step 1: Late-fee sweep — failing test**

```ts
// apps/api/src/modules/pg-rent/__tests__/rent-late-fee-sweep.integration.test.ts
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { DatabaseService } from "../../../common/database.service";
import { runPgRentLateFeeSweep } from "../../../worker/pg-rent-sweeps";
import { RentAllocationService } from "../services/rent-allocation.service";
import { RentInvoiceEngineService } from "../services/rent-invoice-engine.service";
import { RentPaymentService } from "../services/rent-payment.service";
import { RentReceiptService } from "../services/rent-receipt.service";
import { RentSettingsService } from "../services/rent-settings.service";
import { assertRentInvariants } from "./helpers/assert-rent-invariants";
import { RentFixtures } from "./helpers/rent-fixtures";

const HAS_DB = Boolean(process.env.DATABASE_URL);

describe.skipIf(!HAS_DB)("runPgRentLateFeeSweep", () => {
  let db: DatabaseService;
  let fx: RentFixtures;
  let operatorId: string;
  let settings: RentSettingsService;
  let engine: RentInvoiceEngineService;
  let payments: RentPaymentService;

  async function property(extra: Record<string, unknown>) {
    const propertyId = await fx.createProperty(operatorId);
    const listingId = await fx.createListingWithDetails(propertyId, operatorId);
    const roomTypeId = await fx.createRoomType(listingId, { rentPaise: 900000 });
    const roomId = await fx.createRoom(propertyId, { roomTypeId });
    await settings.enable(operatorId, propertyId, {
      billing_starts_on: "2026-09-01",
      due_day: 5,
      late_fee_enabled: true,
      late_fee_grace_days: 3,
      ...extra
    });
    const bedId = await fx.createBed(roomId, "A");
    const a = await fx.createAssignment(propertyId, bedId, {
      createdBy: operatorId,
      moveIn: "2026-09-01"
    });
    await engine.generateInvoicesForProperty(propertyId, "2026-09-01");
    const sep = (
      await db.query<{ id: string }>(
        `SELECT id::text FROM pg_rent_invoices WHERE assignment_id = $1::uuid AND kind = 'rent'`,
        [a]
      )
    ).rows[0].id;
    return { propertyId, a, sep };
  }
  async function fee(invoiceId: string) {
    const r = await db.query<{
      fee: string | null;
      suggested: string | null;
      total: string;
      status: string;
    }>(
      `SELECT (SELECT amount_paise::text FROM pg_rent_invoice_lines WHERE invoice_id = i.id AND kind = 'late_fee') AS fee, i.suggested_late_fee_paise::text AS suggested, i.total_paise::text AS total, i.status::text
         FROM pg_rent_invoices i WHERE i.id = $1::uuid`,
      [invoiceId]
    );
    return r.rows[0];
  }

  beforeAll(async () => {
    db = new DatabaseService();
    fx = new RentFixtures(db, randomUUID().replace(/-/g, ""));
    await fx.setup();
    operatorId = await fx.createUser("pg_operator");
    settings = new RentSettingsService(db);
    const alloc = new RentAllocationService();
    engine = new RentInvoiceEngineService(db, settings, alloc);
    payments = new RentPaymentService(db, settings, alloc, new RentReceiptService(db));
  });
  afterAll(async () => {
    await fx.teardown();
    await db.onModuleDestroy();
  });

  it("suggests when auto_apply is off, applies when on, and never touches ineligible or exempt invoices", async () => {
    const off = await property({
      late_fee_auto_apply: false,
      late_fee_kind: "flat",
      late_fee_amount_inr: 300
    });
    const on = await property({
      late_fee_auto_apply: true,
      late_fee_kind: "flat",
      late_fee_amount_inr: 300
    });
    const exempt = await property({
      late_fee_auto_apply: true,
      late_fee_kind: "flat",
      late_fee_amount_inr: 300
    });
    await db.query(`UPDATE pg_bed_assignments SET late_fee_exempt = true WHERE id = $1::uuid`, [
      exempt.a
    ]);

    expect(await runPgRentLateFeeSweep(db, "2026-09-08")).toMatchObject({
      applied: 0,
      suggested: 0
    }); // inside grace
    const r = await runPgRentLateFeeSweep(db, "2026-09-09");
    expect(r.suggested).toBeGreaterThanOrEqual(1);
    expect(r.applied).toBeGreaterThanOrEqual(1);
    expect(await fee(off.sep)).toMatchObject({ fee: null, suggested: "30000", total: "900000" });
    expect(await fee(on.sep)).toMatchObject({
      fee: "30000",
      suggested: null,
      total: "930000",
      status: "issued"
    });
    expect(await fee(exempt.sep)).toMatchObject({ fee: null, suggested: null });
    // idempotent
    await runPgRentLateFeeSweep(db, "2026-09-09");
    expect(await fee(on.sep)).toMatchObject({ fee: "30000", total: "930000" });
    for (const p of [off, on, exempt]) await assertRentInvariants(db, p.propertyId);
  });

  it("per_day grows daily, caps, freezes once only the fee is left, skips pending claims", async () => {
    const p = await property({
      late_fee_auto_apply: true,
      late_fee_kind: "per_day",
      late_fee_amount_inr: 50,
      late_fee_cap_inr: 500
    });
    await runPgRentLateFeeSweep(db, "2026-09-10");
    expect(await fee(p.sep)).toMatchObject({ fee: "10000" });
    await runPgRentLateFeeSweep(db, "2026-09-12");
    expect(await fee(p.sep)).toMatchObject({ fee: "20000" });
    await runPgRentLateFeeSweep(db, "2026-12-01");
    expect(await fee(p.sep)).toMatchObject({ fee: "50000", total: "950000" });

    // pending claim pauses it
    const tenant = await fx.createUser("tenant", "+917700000077");
    await db.query(`UPDATE pg_bed_assignments SET tenant_user_id = $2::uuid WHERE id = $1::uuid`, [
      p.a,
      tenant
    ]);
    await payments.claimByTenant(tenant, {
      assignment_id: p.a,
      invoice_id: p.sep,
      amount_inr: 9500,
      method: "upi",
      paid_on: "2026-12-02",
      idempotency_key: randomUUID()
    });
    const before = await fee(p.sep);
    await runPgRentLateFeeSweep(db, "2026-12-20");
    expect(await fee(p.sep)).toEqual(before);

    // rent paid, only the fee left → frozen (no growth even without a cap)
    const p2 = await property({
      late_fee_auto_apply: true,
      late_fee_kind: "per_day",
      late_fee_amount_inr: 50
    });
    await runPgRentLateFeeSweep(db, "2026-09-12"); // fee 20000
    await payments.recordByOperator(
      operatorId,
      p2.propertyId,
      { assignment_id: p2.a, amount_inr: 9000, method: "cash", paid_on: "2026-09-12" },
      randomUUID()
    );
    expect(await fee(p2.sep)).toMatchObject({ fee: "20000", status: "partially_paid" });
    await runPgRentLateFeeSweep(db, "2026-12-01");
    expect(await fee(p2.sep)).toMatchObject({ fee: "20000", total: "920000" });
    await assertRentInvariants(db, p.propertyId);
    await assertRentInvariants(db, p2.propertyId);
  });

  it("does not sweep backfill, deposit, adhoc or paused properties, and honours late_fee_enabled=false", async () => {
    const p = await property({ late_fee_enabled: false });
    await runPgRentLateFeeSweep(db, "2026-12-01");
    expect(await fee(p.sep)).toMatchObject({ fee: null, suggested: null });
  });
});
```

- [ ] **Step 2: Implement the late-fee sweep**

Append to `apps/api/src/worker/pg-rent-sweeps.ts`:

```ts
import { transaction } from "../common/transaction";
import { computeLateFee } from "../modules/pg-rent/pure/rent-late-fee";
import { applyFeeDecision, loadFeeContext } from "../modules/pg-rent/services/rent-fee-line";

/**
 * Spec §5.6, same hourly run as generation. Candidate = issued/partially_paid rent
 * invoice, eligible, unwaived, property policy on and not paused, tenant not
 * exempt, no pending claim, past due + grace. Each invoice is its own transaction.
 */
export async function runPgRentLateFeeSweep(
  db: DatabaseService,
  today: string,
  alloc: RentAllocationService = new RentAllocationService()
): Promise<{
  invoices: number;
  applied: number;
  suggested: number;
  updated: number;
  frozen: number;
}> {
  const out = { invoices: 0, applied: 0, suggested: 0, updated: 0, frozen: 0 };
  if (!db.isEnabled()) return out;
  const candidates = await db.query<{ id: string; auto_apply: boolean }>(
    `SELECT i.id::text, s.late_fee_auto_apply AS auto_apply
       FROM pg_rent_invoices i
       JOIN pg_rent_settings s ON s.pg_property_id = i.pg_property_id
       JOIN pg_bed_assignments a ON a.id = i.assignment_id
      WHERE i.kind = 'rent' AND i.status IN ('issued','partially_paid') AND i.late_fee_eligible AND i.late_fee_waived_at IS NULL
        AND s.late_fee_enabled AND s.paused_at IS NULL AND NOT a.late_fee_exempt
        AND (i.due_date + s.late_fee_grace_days) < $1::date
        AND NOT EXISTS (SELECT 1 FROM pg_rent_payments p WHERE p.claimed_invoice_id = i.id AND p.status = 'pending_confirmation')
      ORDER BY i.due_date`,
    [today]
  );
  for (const c of candidates.rows) {
    out.invoices += 1;
    try {
      await transaction(db, async (client) => {
        const ctx = await loadFeeContext(client, c.id);
        if (!ctx.policy) return;
        const chargeable = ctx.invoice.totalPaise - ctx.invoice.paidPaise - (ctx.feeLinePaise ?? 0);
        const decision = computeLateFee({
          policy: ctx.policy,
          dueDate: ctx.invoice.dueDate,
          asOf: today,
          chargeablePaise: chargeable,
          overridePaise: ctx.invoice.overridePaise,
          existingFeePaise: ctx.feeLinePaise ?? ctx.invoice.suggestedPaise,
          frozen: ctx.invoice.computedAt !== null
        });
        // an existing suggestion that changes amount is re-suggested, never auto-applied
        const mode = c.auto_apply ? "line" : "suggest";
        if (mode === "suggest" && decision.action === "update" && ctx.feeLinePaise === null) {
          await client.query(
            `UPDATE pg_rent_invoices SET suggested_late_fee_paise = $2 WHERE id = $1::uuid`,
            [c.id, decision.feePaise]
          );
          out.suggested += 1;
          return;
        }
        await applyFeeDecision(client, alloc, ctx, decision, SYSTEM_ACTOR, { applyMode: mode });
        if (decision.action === "apply") {
          if (mode === "line") out.applied += 1;
          else out.suggested += 1;
        } else if (decision.action === "update") out.updated += 1;
        else if (decision.action === "freeze") out.frozen += 1;
      });
    } catch (error) {
      console.error(
        JSON.stringify({
          job: "pg_rent_late_fee_sweep",
          invoice_id: c.id,
          error: error instanceof Error ? error.message : String(error),
          timestamp: new Date().toISOString()
        })
      );
    }
  }
  logTelemetry("pg_rent.late_fee_sweep", out);
  return out;
}
```

(`RentAllocationService` import already exists in the file from 1a.) Run the sweep test → PASS (3).

- [ ] **Step 3: Receipt HTML renderer — failing unit test**

```ts
// apps/api/src/modules/pg-rent/__tests__/receipt-render.test.ts
import { describe, expect, it } from "vitest";

import { renderReceiptHtml } from "../receipt/receipt-renderer";
import type { ReceiptSnapshot } from "../services/rent-receipt.service";

const snapshot: ReceiptSnapshot = {
  receipt_number: "SUN-0042",
  issued_on: "2026-09-03",
  property_name: "Sunrise PG",
  business_name: "Sunrise Hostels",
  address: "12 MG Road, Pune",
  footer: "Thank you",
  logo_path: null,
  tenant_name: "Rahul Verma",
  room_number: "102",
  bed_label: "A",
  amount_inr: 9000,
  amount_words: "Nine Thousand Rupees Only",
  method: "upi",
  reference: "123456789012",
  paid_on: "2026-09-03",
  covers: [
    {
      invoice_number: "SUN-INV-0007",
      period_label: "September 2026",
      allocated_inr: 8000,
      remaining_inr: 0
    }
  ],
  credit_inr: 1000
};

describe("renderReceiptHtml", () => {
  it("renders every snapshot field with Indian grouping and no template syntax left", () => {
    const html = renderReceiptHtml(snapshot, "en", false);
    for (const s of [
      "SUN-0042",
      "Sunrise Hostels",
      "12 MG Road, Pune",
      "Rahul Verma",
      "Room 102",
      "Bed A",
      "₹9,000",
      "Nine Thousand Rupees Only",
      "UPI",
      "123456789012",
      "SUN-INV-0007",
      "September 2026",
      "₹8,000",
      "₹1,000",
      "Thank you",
      "computer-generated"
    ]) {
      expect(html, s).toContain(s);
    }
    expect(html).not.toMatch(/\{\{/);
    expect(html).not.toContain("VOID");
  });
  it("renders the VOID banner and the Hindi template", () => {
    expect(renderReceiptHtml(snapshot, "en", true)).toContain("VOID");
    expect(renderReceiptHtml(snapshot, "hi", false)).toContain("रसीद");
  });
  it("escapes HTML in owner-typed fields", () => {
    expect(
      renderReceiptHtml({ ...snapshot, footer: "<script>x</script>" }, "en", false)
    ).not.toContain("<script>");
  });
});
```

- [ ] **Step 4: Renderer + templates**

```ts
// apps/api/src/modules/pg-rent/receipt/receipt-renderer.ts
import { readFileSync } from "node:fs";
import path from "node:path";
import Handlebars from "handlebars";

import { BrowserPool } from "../../rent-agreement/pdf/browser-pool";
import type { ReceiptSnapshot } from "../services/rent-receipt.service";

export interface ReceiptRendererPort {
  render(snapshot: ReceiptSnapshot, locale: "en" | "hi", voided: boolean): Promise<Buffer>;
}

const templates: Record<"en" | "hi", HandlebarsTemplateDelegate> = {
  en: Handlebars.compile(readFileSync(path.join(__dirname, "templates", "receipt.en.hbs"), "utf8")),
  hi: Handlebars.compile(readFileSync(path.join(__dirname, "templates", "receipt.hi.hbs"), "utf8"))
};

/** en-IN grouping: 12,34,567 */
export function formatInr(n: number): string {
  return `₹${new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 }).format(n)}`;
}

const METHOD_LABEL: Record<string, string> = {
  cash: "Cash",
  upi: "UPI",
  bank_transfer: "Bank transfer",
  cheque: "Cheque",
  card: "Card",
  gateway: "Online",
  deposit: "Deposit",
  other: "Other"
};

/** Pure: snapshot → HTML. Handlebars escapes every `{{ }}` field, so owner-typed text is safe. */
export function renderReceiptHtml(
  snapshot: ReceiptSnapshot,
  locale: "en" | "hi",
  voided: boolean
): string {
  return templates[locale]({
    ...snapshot,
    voided,
    amount: formatInr(snapshot.amount_inr),
    credit: snapshot.credit_inr > 0 ? formatInr(snapshot.credit_inr) : null,
    method_label: METHOD_LABEL[snapshot.method] ?? snapshot.method,
    covers: snapshot.covers.map((c) => ({
      ...c,
      allocated: formatInr(c.allocated_inr),
      remaining: c.remaining_inr > 0 ? formatInr(c.remaining_inr) : null
    }))
  });
}

export class LazyReceiptRenderer implements ReceiptRendererPort {
  private pool: BrowserPool | null = null;
  private launching: Promise<BrowserPool> | null = null;

  private getPool(): Promise<BrowserPool> {
    if (this.pool) return Promise.resolve(this.pool);
    if (!this.launching) {
      this.launching = (async () => {
        const pool = new BrowserPool({ maxPagesPerBrowser: 50 });
        await pool.launch();
        this.pool = pool;
        return pool;
      })();
    }
    return this.launching;
  }

  async render(snapshot: ReceiptSnapshot, locale: "en" | "hi", voided: boolean): Promise<Buffer> {
    const pool = await this.getPool();
    const page = await pool.acquire();
    try {
      await page.setContent(renderReceiptHtml(snapshot, locale, voided), { waitUntil: "load" });
      const pdf = await page.pdf({
        format: "A5",
        printBackground: true,
        margin: { top: "12mm", bottom: "12mm", left: "12mm", right: "12mm" }
      });
      return Buffer.isBuffer(pdf) ? pdf : Buffer.from(pdf);
    } finally {
      await pool.release(page);
    }
  }
}
```

`receipt.en.hbs` (copy the same structure into `receipt.hi.hbs` with the labels translated — headings "रसीद", "किरायेदार", "राशि", "भुगतान का तरीका", "संदर्भ", "विवरण", "शेष क्रेडिट", footer "यह कंप्यूटर-जनित रसीद है"):

```hbs
<html lang="en"><head><meta charset="utf-8" />
    <style>
      body {
        font-family: -apple-system, "Segoe UI", Roboto, sans-serif;
        color: #111;
        font-size: 12px;
        margin: 0;
      }
      .void {
        position: fixed;
        top: 40%;
        left: 10%;
        font-size: 64px;
        color: rgba(200, 0, 0, 0.25);
        transform: rotate(-20deg);
        font-weight: 700;
      }
      h1 {
        font-size: 18px;
        margin: 0 0 2px;
      }
      .muted {
        color: #666;
      }
      table {
        width: 100%;
        border-collapse: collapse;
        margin-top: 12px;
      }
      td,
      th {
        padding: 6px 4px;
        border-bottom: 1px solid #ddd;
        text-align: left;
      }
      th {
        font-weight: 600;
        background: #f5f5f5;
      }
      .amt {
        text-align: right;
      }
      .box {
        border: 1px solid #ddd;
        border-radius: 6px;
        padding: 10px;
        margin-top: 12px;
      }
      .total {
        font-size: 20px;
        font-weight: 700;
      }
      .foot {
        margin-top: 18px;
        font-size: 10px;
        color: #666;
      }
    </style></head>
  <body>
    {{#if voided}}<div class="void">VOID</div>{{/if}}
    <h1>{{#if business_name}}{{business_name}}{{else}}{{property_name}}{{/if}}</h1>
    <div class="muted">{{#if address}}{{address}}<br />{{/if}}{{property_name}}</div>
    <div class="box">
      <div><strong>Receipt {{receipt_number}}</strong> · {{issued_on}}</div>
      <div>Received from
        <strong>{{tenant_name}}</strong>
        · Room
        {{room_number}}
        · Bed
        {{bed_label}}</div>
      <div class="total">{{amount}}</div>
      <div class="muted">{{amount_words}}</div>
      <div>Paid on {{paid_on}} by {{method_label}}{{#if reference}} · Ref {{reference}}{{/if}}</div>
    </div>
    <table>
      <tr><th>Invoice</th><th>Period</th><th class="amt">Applied</th><th
          class="amt"
        >Remaining</th></tr>
      {{#each covers}}<tr><td>{{invoice_number}}</td><td>{{period_label}}</td><td
            class="amt"
          >{{allocated}}</td><td class="amt">{{#if
              remaining
            }}{{remaining}}{{else}}—{{/if}}</td></tr>{{/each}}
      {{#if credit}}<tr><td colspan="3">Held as credit towards future dues</td><td
            class="amt"
          >{{credit}}</td></tr>{{/if}}
    </table>
    {{#if footer}}<div class="foot">{{footer}}</div>{{/if}}
    <div class="foot">This is a computer-generated receipt and does not require a signature.</div>
  </body></html>
```

Make sure the API build copies `.hbs` files into `dist` — check how `rent-agreement` ships its templates (`grep -rn "hbs" apps/api/package.json apps/api/tsconfig*.json apps/api/nest-cli.json`) and add the `pg-rent/receipt/templates` glob to the same `assets` list. Run the unit test → PASS (3).

- [ ] **Step 5: Receipt queue — failing integration test**

```ts
// apps/api/src/modules/pg-rent/__tests__/rent-receipt-queue.integration.test.ts
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { DatabaseService } from "../../../common/database.service";
import { InMemoryPdfStorage } from "../../rent-agreement/pdf/in-memory-pdf-storage";
import { DevApiSasIssuer } from "../../rent-agreement/downloads/dev-api-sas-issuer";
import { RentAllocationService } from "../services/rent-allocation.service";
import { RentInvoiceEngineService } from "../services/rent-invoice-engine.service";
import { RentPaymentService } from "../services/rent-payment.service";
import { RentReceiptService } from "../services/rent-receipt.service";
import { RentSettingsService } from "../services/rent-settings.service";
import { RentFixtures } from "./helpers/rent-fixtures";

const HAS_DB = Boolean(process.env.DATABASE_URL);

describe.skipIf(!HAS_DB)("receipt render queue", () => {
  let db: DatabaseService;
  let fx: RentFixtures;
  let operatorId: string;
  let propertyId: string;
  let assignmentId: string;
  let receipts: RentReceiptService;
  let payments: RentPaymentService;
  const renderer = { render: vi.fn() };

  beforeAll(async () => {
    db = new DatabaseService();
    fx = new RentFixtures(db, randomUUID().replace(/-/g, ""));
    await fx.setup();
    operatorId = await fx.createUser("pg_operator");
    propertyId = await fx.createProperty(operatorId, { internalCode: "RCP" });
    const listingId = await fx.createListingWithDetails(propertyId, operatorId);
    const roomTypeId = await fx.createRoomType(listingId, { rentPaise: 900000 });
    const roomId = await fx.createRoom(propertyId, { roomTypeId });
    const settings = new RentSettingsService(db);
    await settings.enable(operatorId, propertyId, { billing_starts_on: "2026-09-01" });
    const bedId = await fx.createBed(roomId, "A");
    assignmentId = await fx.createAssignment(propertyId, bedId, {
      createdBy: operatorId,
      moveIn: "2026-09-01"
    });
    const alloc = new RentAllocationService();
    await new RentInvoiceEngineService(db, settings, alloc).generateInvoicesForProperty(
      propertyId,
      "2026-09-01"
    );
    receipts = new RentReceiptService(
      db,
      renderer,
      new InMemoryPdfStorage(),
      new DevApiSasIssuer({ baseUrl: "http://api.test" })
    );
    payments = new RentPaymentService(db, settings, alloc, receipts);
  });
  afterAll(async () => {
    await fx.teardown();
    await db.onModuleDestroy();
  });

  it("renders pending receipts, retries with backoff, marks failed after 5 attempts, and serves a download URL", async () => {
    const paid = await payments.recordByOperator(
      operatorId,
      propertyId,
      { assignment_id: assignmentId, amount_inr: 9000, method: "cash", paid_on: "2026-09-02" },
      randomUUID()
    );
    const receiptId = paid.receipt_id!;
    await expect(receipts.downloadUrl(operatorId, propertyId, receiptId)).rejects.toMatchObject({
      response: { code: "receipt_not_ready" }
    });

    renderer.render.mockRejectedValueOnce(new Error("chromium down"));
    expect(await receipts.renderPending()).toEqual({ rendered: 0, failed: 0 }); // attempt 1 failed → still pending with backoff
    let row = (
      await db.query<{ pdf_status: string; attempts: number; last_error: string }>(
        `SELECT pdf_status::text, attempts, last_error FROM pg_rent_receipts WHERE id = $1::uuid`,
        [receiptId]
      )
    ).rows[0];
    expect(row).toMatchObject({ pdf_status: "pending", attempts: 1, last_error: "chromium down" });
    expect(await receipts.renderPending()).toEqual({ rendered: 0, failed: 0 }); // backoff not elapsed → skipped
    await db.query(`UPDATE pg_rent_receipts SET next_attempt_at = now() WHERE id = $1::uuid`, [
      receiptId
    ]);

    renderer.render.mockResolvedValueOnce(Buffer.from("%PDF-1.4 fake"));
    expect(await receipts.renderPending()).toEqual({ rendered: 1, failed: 0 });
    row = (
      await db.query<{ pdf_status: string; attempts: number; last_error: string }>(
        `SELECT pdf_status::text, attempts, last_error FROM pg_rent_receipts WHERE id = $1::uuid`,
        [receiptId]
      )
    ).rows[0];
    expect(row.pdf_status).toBe("ready");
    expect(renderer.render).toHaveBeenLastCalledWith(
      expect.objectContaining({ receipt_number: "RCP-0001" }),
      "en",
      false
    );
    const dl = await receipts.downloadUrl(operatorId, propertyId, receiptId);
    expect(dl.url).toContain("http://api.test");

    // five failures → failed; retry resets
    const paid2 = await payments.recordByOperator(
      operatorId,
      propertyId,
      { assignment_id: assignmentId, amount_inr: 100, method: "cash", paid_on: "2026-09-03" },
      randomUUID()
    );
    for (let i = 0; i < 5; i += 1) {
      renderer.render.mockRejectedValueOnce(new Error("boom"));
      await db.query(`UPDATE pg_rent_receipts SET next_attempt_at = now() WHERE id = $1::uuid`, [
        paid2.receipt_id
      ]);
      await receipts.renderPending();
    }
    expect(
      (
        await db.query<{ s: string }>(
          `SELECT pdf_status::text AS s FROM pg_rent_receipts WHERE id = $1::uuid`,
          [paid2.receipt_id]
        )
      ).rows[0].s
    ).toBe("failed");
    expect(await receipts.retry(operatorId, propertyId, paid2.receipt_id!)).toMatchObject({
      pdf_status: "pending",
      attempts: 0
    });
  });

  it("share token resolves only while valid, ready and not voided", async () => {
    const paid = await payments.recordByOperator(
      operatorId,
      propertyId,
      { assignment_id: assignmentId, amount_inr: 200, method: "upi", paid_on: "2026-09-04" },
      randomUUID()
    );
    const token = (
      await db.query<{ t: string }>(
        `SELECT share_token AS t FROM pg_rent_receipts WHERE id = $1::uuid`,
        [paid.receipt_id]
      )
    ).rows[0].t;
    await expect(receipts.resolveShareToken(token)).rejects.toMatchObject({
      response: { code: "receipt_not_ready" }
    });
    renderer.render.mockResolvedValueOnce(Buffer.from("%PDF"));
    await receipts.renderPending();
    expect((await receipts.resolveShareToken(token)).url).toContain("http://api.test");
    await expect(receipts.resolveShareToken("nope")).rejects.toMatchObject({
      response: { code: "receipt_not_found" }
    });
    await db.query(
      `UPDATE pg_rent_receipts SET share_token_expires_at = now() - interval '1 day' WHERE id = $1::uuid`,
      [paid.receipt_id]
    );
    await expect(receipts.resolveShareToken(token)).rejects.toMatchObject({
      response: { code: "receipt_not_found" }
    });
    const regen = await receipts.regenerateShareToken(operatorId, propertyId, paid.receipt_id!);
    expect(new Date(regen.expires_at).getTime()).toBeGreaterThan(Date.now());
  });
});
```

- [ ] **Step 6: Extend `RentReceiptService`**

Change the constructor and add the methods (imports: `ConflictException, NotFoundException`; `assertManagedOwnership, requireDb, resolveTenantAssignmentIds`; `toIsoTs`; `PdfStoragePort`, `SasIssuerPort` types; `ReceiptRendererPort`; the two injection tokens):

```ts
export const PG_RENT_RECEIPT_RENDERER = "PG_RENT_RECEIPT_RENDERER";
export const PG_RENT_PDF_STORAGE = "PG_RENT_PDF_STORAGE";
export const PG_RENT_SAS_ISSUER = "PG_RENT_SAS_ISSUER";
const MAX_ATTEMPTS = 5;
const BACKOFF_MINUTES = [2, 5, 15, 30, 60];
const DOWNLOAD_TTL_SECONDS = 15 * 60;

  constructor(
    @Inject(DatabaseService) private readonly db: DatabaseService,
    @Inject(PG_RENT_RECEIPT_RENDERER) private readonly renderer: ReceiptRendererPort,
    @Inject(PG_RENT_PDF_STORAGE) private readonly storage: PdfStoragePort,
    @Inject(PG_RENT_SAS_ISSUER) private readonly sas: SasIssuerPort
  ) {}

  /** Spec §6.7: claim one row with SKIP LOCKED so the API's immediate attempt and the worker never render the same receipt twice. */
  async renderOne(receiptId?: string): Promise<"ready" | "failed" | "skipped"> {
    const client = await this.db.getClient();
    try {
      await client.query("BEGIN");
      const claimed = await client.query<{ id: string; snapshot: ReceiptSnapshot; attempts: number; voided_at: Date | null; locale: string }>(
        `SELECT r.id::text, r.snapshot, r.attempts, r.voided_at, COALESCE(u.preferred_language, 'en') AS locale
           FROM pg_rent_receipts r
           JOIN pg_bed_assignments a ON a.id = r.assignment_id
           LEFT JOIN users u ON u.id = a.tenant_user_id
          WHERE r.pdf_status = 'pending' AND r.next_attempt_at <= now()${receiptId ? " AND r.id = $1::uuid" : ""}
          ORDER BY r.next_attempt_at LIMIT 1 FOR UPDATE OF r SKIP LOCKED`,
        receiptId ? [receiptId] : []
      );
      const row = claimed.rows[0];
      if (!row) { await client.query("COMMIT"); return "skipped"; }
      try {
        const pdf = await this.renderer.render(row.snapshot, row.locale === "hi" ? "hi" : "en", row.voided_at !== null);
        const { blobPath } = await this.storage.upload(pdf, row.id, row.locale);
        await client.query(`UPDATE pg_rent_receipts SET pdf_status = 'ready', pdf_path = $2, generated_at = now(), attempts = attempts + 1, last_error = NULL WHERE id = $1::uuid`, [row.id, blobPath]);
        await client.query("COMMIT");
        logTelemetry("pg_rent.receipt_rendered", { receipt_id: row.id });
        return "ready";
      } catch (error) {
        const attempts = row.attempts + 1;
        const failed = attempts >= MAX_ATTEMPTS;
        const backoff = BACKOFF_MINUTES[Math.min(attempts - 1, BACKOFF_MINUTES.length - 1)];
        await client.query(
          `UPDATE pg_rent_receipts SET attempts = $2, last_error = $3, pdf_status = $4::pg_rent_receipt_pdf_status, next_attempt_at = now() + ($5 || ' minutes')::interval WHERE id = $1::uuid`,
          [row.id, attempts, error instanceof Error ? error.message : String(error), failed ? "failed" : "pending", String(backoff)]
        );
        await client.query("COMMIT");
        logTelemetry("pg_rent.receipt_failed", { receipt_id: row.id, attempts, final: failed });
        return failed ? "failed" : "skipped";
      }
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async renderPending(limit = 20): Promise<{ rendered: number; failed: number }> {
    const out = { rendered: 0, failed: 0 };
    for (let i = 0; i < limit; i += 1) {
      const r = await this.renderOne();
      if (r === "skipped") break;
      if (r === "ready") out.rendered += 1; else out.failed += 1;
    }
    return out;
  }

  async retry(operatorId: string, propertyId: string, receiptId: string): Promise<PgRentReceipt> {
    requireDb(this.db);
    await assertManagedOwnership(this.db, operatorId, propertyId);
    const r = await this.db.query<RentReceiptRow>(
      `UPDATE pg_rent_receipts SET pdf_status = 'pending', attempts = 0, last_error = NULL, next_attempt_at = now()
        WHERE id = $1::uuid AND pg_property_id = $2::uuid AND pdf_status = 'failed' RETURNING ${RECEIPT_SELECT}`,
      [receiptId, propertyId]
    );
    if (!r.rows[0]) throw new NotFoundException({ code: "receipt_not_found" });
    return toReceiptDto(r.rows[0]);
  }

  async downloadUrl(operatorId: string, propertyId: string, receiptId: string): Promise<PgRentReceiptDownload> {
    requireDb(this.db);
    await assertManagedOwnership(this.db, operatorId, propertyId);
    const r = await this.db.query<{ pdf_path: string | null; pdf_status: string }>(`SELECT pdf_path, pdf_status::text FROM pg_rent_receipts WHERE id = $1::uuid AND pg_property_id = $2::uuid`, [receiptId, propertyId]);
    return this.issue(r.rows[0]);
  }

  async downloadUrlForTenant(tenantUserId: string, receiptId: string): Promise<PgRentReceiptDownload> {
    requireDb(this.db);
    const mine = await resolveTenantAssignmentIds(this.db, tenantUserId);
    const r = await this.db.query<{ pdf_path: string | null; pdf_status: string }>(`SELECT pdf_path, pdf_status::text FROM pg_rent_receipts WHERE id = $1::uuid AND assignment_id = ANY($2::uuid[])`, [receiptId, mine]);
    return this.issue(r.rows[0]);
  }

  async regenerateShareToken(operatorId: string, propertyId: string, receiptId: string): Promise<{ expires_at: string }> {
    requireDb(this.db);
    await assertManagedOwnership(this.db, operatorId, propertyId);
    const r = await this.db.query<{ e: Date }>(
      `UPDATE pg_rent_receipts SET share_token = $3, share_token_expires_at = now() + interval '30 days' WHERE id = $1::uuid AND pg_property_id = $2::uuid RETURNING share_token_expires_at AS e`,
      [receiptId, propertyId, randomBytes(32).toString("base64url")]
    );
    if (!r.rows[0]) throw new NotFoundException({ code: "receipt_not_found" });
    return { expires_at: r.rows[0].e.toISOString() };
  }

  /** Public share (slice 1c endpoint): valid token, not voided, ready → fresh 15-minute SAS. */
  async resolveShareToken(token: string): Promise<PgRentReceiptDownload> {
    requireDb(this.db);
    const r = await this.db.query<{ pdf_path: string | null; pdf_status: string }>(
      `SELECT pdf_path, pdf_status::text FROM pg_rent_receipts WHERE share_token = $1 AND share_token_expires_at > now() AND voided_at IS NULL`, [token]
    );
    return this.issue(r.rows[0]);
  }

  private async issue(row: { pdf_path: string | null; pdf_status: string } | undefined): Promise<PgRentReceiptDownload> {
    if (!row) throw new NotFoundException({ code: "receipt_not_found" });
    if (row.pdf_status !== "ready" || !row.pdf_path) throw new ConflictException({ code: "receipt_not_ready" });
    const sas = await this.sas.issue({ blobPath: row.pdf_path, ttlSeconds: DOWNLOAD_TTL_SECONDS, now: new Date() });
    return { url: sas.sasUrl, expires_at: sas.expiresAt.toISOString() };
  }
```

Add `dto/receipt.dto.ts` with `RECEIPT_SELECT`, `RentReceiptRow` and `toReceiptDto` (all columns except `snapshot`, `pdf_path`, `share_token`; `share_expires_at` = `share_token_expires_at`; rupees via `paiseToInr`; timestamps via `toIsoTs`) — same shape as the invoice mapper in 1a Task 13.

Update `void()` so a voided receipt that is already `ready` is re-queued to render the VOID banner: after setting `voided_at`, run `UPDATE pg_rent_receipts SET pdf_status = 'pending', attempts = 0, next_attempt_at = now() WHERE id = $1::uuid AND pdf_status = 'ready'`. The existing PDF path is overwritten by the next render (spec §6.7 "Voided receipts render a VOID banner on re-download").

The tests in Tasks 4 and 5 construct `new RentReceiptService(db)` — change those calls to `new RentReceiptService(db, { render: async () => Buffer.from("%PDF") }, new InMemoryPdfStorage(), new DevApiSasIssuer())` (import the two dev adapters).

- [ ] **Step 7: Module providers and worker wiring**

In `pg-rent.module.ts`:

```ts
import { readAzureStorageConfig, buildAzureConnectionString } from "../rent-agreement/pdf/azure-storage-config";
import { AzurePdfStorage } from "../rent-agreement/pdf/azure-pdf-storage";
import { InMemoryPdfStorage } from "../rent-agreement/pdf/in-memory-pdf-storage";
import { AzureSasIssuer } from "../rent-agreement/downloads/azure-sas-issuer";
import { DevApiSasIssuer } from "../rent-agreement/downloads/dev-api-sas-issuer";
import { LazyReceiptRenderer } from "./receipt/receipt-renderer";
import { PG_RENT_PDF_STORAGE, PG_RENT_RECEIPT_RENDERER, PG_RENT_SAS_ISSUER } from "./services/rent-receipt.service";

const RECEIPT_CONTAINER = () => (process.env.PG_RENT_AZURE_CONTAINER ?? "").trim() || "pg-rent-receipts";
// providers:
    { provide: PG_RENT_RECEIPT_RENDERER, useFactory: () => new LazyReceiptRenderer() },
    {
      provide: PG_RENT_PDF_STORAGE,
      useFactory: () => {
        const azure = readAzureStorageConfig();
        return azure.present
          ? new AzurePdfStorage({ connectionString: buildAzureConnectionString(azure.accountName, azure.accountKey), containerName: RECEIPT_CONTAINER() })
          : new InMemoryPdfStorage();
      }
    },
    {
      provide: PG_RENT_SAS_ISSUER,
      useFactory: () => {
        const azure = readAzureStorageConfig();
        return azure.present
          ? new AzureSasIssuer({ accountName: azure.accountName, accountKey: azure.accountKey, containerName: RECEIPT_CONTAINER() })
          : new DevApiSasIssuer({ baseUrl: process.env.RENT_AGREEMENT_DEV_BASE_URL ?? "" });
      }
    },
```

Receipts get their own container (`pg-rent-receipts`) so a receipt blob path can never collide with an agreement's `yyyy/mm/<id>.pdf`. Add `PG_RENT_AZURE_CONTAINER=pg-rent-receipts` to `.env.example` next to `RENT_AGREEMENT_AZURE_CONTAINER`.

Immediate best-effort render after commit: in `RentPaymentService.recordByOperator` and `confirm`, after the transaction resolves, call `void this.receipts.renderOne(receiptId).catch(() => undefined)` when a receipt was minted (look it up via `get()`'s `receipt_id`). Never inside the transaction.

In `pg-rent-sweeps.ts` add:

```ts
export async function runPgRentReceiptSweep(
  db: DatabaseService,
  service?: RentReceiptService
): Promise<{ rendered: number; failed: number }> {
  if (!db.isEnabled()) return { rendered: 0, failed: 0 };
  const svc =
    service ??
    new RentReceiptService(db, new LazyReceiptRenderer(), storageFromEnv(), sasFromEnv());
  return svc.renderPending();
}
```

with `storageFromEnv()` / `sasFromEnv()` duplicating the two module factories (the worker has no Nest container). In `worker.ts`, inside the `FF_PG_RENT_COLLECTION` block from 1a, add the late-fee call after generation and a second interval:

```ts
setInterval(async () => {
  try {
    await runPgRentSweep(maintenanceDb, todayIst());
    await runPgRentLateFeeSweep(maintenanceDb, todayIst());
  } catch (error) {
    /* same JSON error log as 1a */
  }
}, PG_RENT_SWEEP_MS);
const PG_RENT_RECEIPT_SWEEP_MS = 2 * 60 * 1000;
setInterval(async () => {
  try {
    await runPgRentReceiptSweep(maintenanceDb);
  } catch (error) {
    /* JSON error log, job: "pg_rent_receipt_sweep" */
  }
}, PG_RENT_RECEIPT_SWEEP_MS);
```

- [ ] **Step 8: Run the three suites**

```bash
pnpm --filter @cribliv/api exec vitest run src/modules/pg-rent/__tests__/rent-late-fee-sweep.integration.test.ts src/modules/pg-rent/__tests__/receipt-render.test.ts src/modules/pg-rent/__tests__/rent-receipt-queue.integration.test.ts
PG_RENT_TEST_CHROMIUM=1 pnpm --filter @cribliv/api exec vitest run src/modules/pg-rent/__tests__/receipt-render.test.ts   # optional real render
pnpm --filter @cribliv/api typecheck
```

Expected: 3 + 3 + 2 PASS; typecheck clean. (If you add the optional Chromium test, it lives in the same file under `describe.skipIf(!process.env.PG_RENT_TEST_CHROMIUM)` and asserts the buffer starts with `%PDF`.)

- [ ] **Step 9: Commit**

```bash
git add apps/api/src/modules/pg-rent apps/api/src/worker .env.example
git commit -m "feat(pg-rent): late-fee sweep, receipt rendering queue with SKIP LOCKED, share and download links"
```

---

### Task 7: Settlement — statement, settle, forfeit

**Files:**

- Create: `apps/api/src/modules/pg-rent/dto/settlement.dto.ts`
- Create: `apps/api/src/modules/pg-rent/pure/rent-settlement.ts`
- Create: `apps/api/src/modules/pg-rent/services/rent-settlement.service.ts`
- Modify: `apps/api/src/modules/pg-rent/pg-rent.module.ts`
- Test: `apps/api/src/modules/pg-rent/__tests__/rent-settlement.integration.test.ts`

**Interfaces:**

```ts
// pure/rent-settlement.ts
export function settlementNet(i: {
  depositHeld: number;
  credit: number;
  openDues: number;
  deductions: number;
}): { net: number; toReturn: number };
// net = held + credit − dues − deductions; toReturn = max(0, net)

// dto/settlement.dto.ts
export const SettleSchema: z.ZodType<PgRentSettleInput>;
export const ForfeitSchema: z.ZodType<PgRentForfeitInput>;

// services/rent-settlement.service.ts
@Injectable()
export class RentSettlementService {
  async statement(operatorId, propertyId, assignmentId): Promise<PgRentSettlementStatement>; // runs generation first (§6.11 "Before the statement")
  async settle(
    operatorId,
    propertyId,
    assignmentId,
    input: PgRentSettleInput,
    idempotencyKey
  ): Promise<PgRentSettlementStatement>;
  async forfeit(
    operatorId,
    propertyId,
    assignmentId,
    input: PgRentForfeitInput
  ): Promise<PgRentInvoice>; // §6.12
}
```

- [ ] **Step 1: Write the failing tests**

```ts
// apps/api/src/modules/pg-rent/__tests__/rent-settlement.integration.test.ts
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { DatabaseService } from "../../../common/database.service";
import { DevApiSasIssuer } from "../../rent-agreement/downloads/dev-api-sas-issuer";
import { InMemoryPdfStorage } from "../../rent-agreement/pdf/in-memory-pdf-storage";
import { settlementNet } from "../pure/rent-settlement";
import { RentAllocationService } from "../services/rent-allocation.service";
import { RentInvoiceEngineService } from "../services/rent-invoice-engine.service";
import { RentInvoiceService } from "../services/rent-invoice.service";
import { RentPaymentService } from "../services/rent-payment.service";
import { RentReceiptService } from "../services/rent-receipt.service";
import { RentSettlementService } from "../services/rent-settlement.service";
import { RentSettingsService } from "../services/rent-settings.service";
import { assertRentInvariants } from "./helpers/assert-rent-invariants";
import { RentFixtures } from "./helpers/rent-fixtures";

const HAS_DB = Boolean(process.env.DATABASE_URL);

describe("settlementNet", () => {
  it("nets and never returns a negative to-return", () => {
    expect(
      settlementNet({ depositHeld: 1800000, credit: 0, openDues: 435500, deductions: 80000 })
    ).toEqual({ net: 1284500, toReturn: 1284500 });
    expect(settlementNet({ depositHeld: 0, credit: 0, openDues: 120000, deductions: 0 })).toEqual({
      net: -120000,
      toReturn: 0
    });
  });
});

describe.skipIf(!HAS_DB)("RentSettlementService", () => {
  let db: DatabaseService;
  let fx: RentFixtures;
  let operatorId: string;
  let settings: RentSettingsService;
  let engine: RentInvoiceEngineService;
  let payments: RentPaymentService;
  let invoices: RentInvoiceService;
  let settlement: RentSettlementService;

  async function leavingTenant(opts: { payDeposit?: boolean; payRent?: boolean } = {}) {
    const propertyId = await fx.createProperty(operatorId, { internalCode: "STL" });
    const listingId = await fx.createListingWithDetails(propertyId, operatorId);
    const roomTypeId = await fx.createRoomType(listingId, {
      rentPaise: 900000,
      depositPaise: 1800000
    });
    const roomId = await fx.createRoom(propertyId, { roomTypeId });
    await settings.enable(operatorId, propertyId, {
      billing_starts_on: "2026-09-01",
      due_day: 5,
      prorate_move_out: true,
      billing_timing: "arrears"
    });
    const bedId = await fx.createBed(roomId, "A");
    const a = await fx.createAssignment(propertyId, bedId, {
      createdBy: operatorId,
      moveIn: "2026-09-01"
    });
    await engine.generateInvoicesForProperty(propertyId, "2026-09-30"); // deposit + September (arrears, due Oct 5)
    if (opts.payDeposit !== false)
      await payments.recordByOperator(
        operatorId,
        propertyId,
        {
          assignment_id: a,
          amount_inr: 18000,
          method: "cash",
          paid_on: "2026-09-01",
          allocations: []
        },
        randomUUID()
      );
    if (opts.payRent !== false)
      await payments.recordByOperator(
        operatorId,
        propertyId,
        { assignment_id: a, amount_inr: 9000, method: "upi", paid_on: "2026-10-03" },
        randomUUID()
      );
    await db.query(
      `UPDATE pg_bed_assignments SET status = 'moved_out', move_out_date = '2026-10-15' WHERE id = $1::uuid`,
      [a]
    );
    await engine.onAssignmentEvent({
      type: "operator_direct_move_out",
      propertyId,
      assignmentId: a
    });
    return { propertyId, a };
  }

  beforeAll(async () => {
    db = new DatabaseService();
    fx = new RentFixtures(db, randomUUID().replace(/-/g, ""));
    await fx.setup();
    operatorId = await fx.createUser("pg_operator");
    settings = new RentSettingsService(db);
    const alloc = new RentAllocationService();
    const receipts = new RentReceiptService(
      db,
      { render: async () => Buffer.from("%PDF") },
      new InMemoryPdfStorage(),
      new DevApiSasIssuer()
    );
    engine = new RentInvoiceEngineService(db, settings, alloc);
    payments = new RentPaymentService(db, settings, alloc, receipts);
    invoices = new RentInvoiceService(db, alloc, payments, engine);
    settlement = new RentSettlementService(db, alloc, payments, invoices, engine);
  });
  afterAll(async () => {
    await fx.teardown();
    await db.onModuleDestroy();
  });

  it("statement: deposit held + credit − open dues (final cut period, deposit excluded) − deductions; settle releases the deposit, records the return, tenant sees settled", async () => {
    const { propertyId, a } = await leavingTenant();
    // `allocations: []` = no explicit targets → FIFO, so the ₹18,000 landed on the deposit invoice (due first).
    let st = await settlement.statement(operatorId, propertyId, a);
    expect(st).toMatchObject({
      status: "leaving",
      deposit_held_inr: 18000,
      credit_inr: 0,
      deposit_uncollected_inr: 0,
      pending_suggestion: null,
      settlement_invoice_id: null
    });
    expect(st.open_invoices.map((i) => i.kind)).toEqual(["rent"]); // October 1–15 cut period, generated by the hook
    expect(st.open_dues_inr).toBe(4355); // 9000 × 15/31 → ₹4,355
    expect(st).toMatchObject({ net_inr: 13645, to_return_inr: 13645 });

    st = await settlement.settle(
      operatorId,
      propertyId,
      a,
      {
        deductions: [{ kind: "cleaning", label: "Deep clean", amount_inr: 800 }],
        return_now: { amount_inr: 12845, method: "upi", paid_on: "2026-10-16", reference: "REF1" }
      },
      randomUUID()
    );
    expect(st).toMatchObject({
      status: "settled",
      deposit_held_inr: 0,
      open_dues_inr: 0,
      to_return_inr: 0,
      net_inr: 0
    });
    expect(st.settlement_invoice_id).not.toBeNull();
    const rows = await db.query<{ kind: string; status: string; total: string }>(
      `SELECT kind::text, status::text, total_paise::text AS total FROM pg_rent_invoices WHERE assignment_id = $1::uuid ORDER BY kind`,
      [a]
    );
    expect(rows.rows).toEqual(
      expect.arrayContaining([
        { kind: "deposit", status: "paid", total: "1800000" },
        { kind: "settlement", status: "paid", total: "80000" },
        { kind: "rent", status: "paid", total: "435500" }
      ])
    );
    const pays = await db.query<{
      source: string;
      direction: string;
      amount: string;
      status: string;
    }>(
      `SELECT source::text, direction::text, amount_paise::text AS amount, status::text FROM pg_rent_payments WHERE assignment_id = $1::uuid ORDER BY created_at`,
      [a]
    );
    expect(pays.rows).toEqual(
      expect.arrayContaining([
        { source: "deposit_release", direction: "inflow", amount: "1800000", status: "confirmed" },
        { source: "operator", direction: "outflow", amount: "1284500", status: "confirmed" }
      ])
    );
    // no receipt for the release; the outflow has none either
    const receipts = await db.query(
      `SELECT 1 FROM pg_rent_receipts r JOIN pg_rent_payments p ON p.id = r.payment_id WHERE p.assignment_id = $1::uuid AND p.source IN ('deposit_release') OR p.direction = 'outflow'`,
      [a]
    );
    expect(receipts.rowCount).toBe(0);
    const ev = await db.query<{ event_type: string }>(
      `SELECT event_type FROM pg_rent_events WHERE pg_property_id = $1::uuid AND event_type IN ('settlement.created','deposit.released','refund.recorded') ORDER BY id`,
      [propertyId]
    );
    expect(ev.rows.map((e) => e.event_type)).toEqual([
      "settlement.created",
      "deposit.released",
      "refund.recorded"
    ]);
    await assertRentInvariants(db, propertyId);
  });

  it("uncollected deposit is written down; net < 0 leaves the shortfall collectible on the settlement invoice", async () => {
    const { propertyId, a } = await leavingTenant({ payDeposit: false, payRent: false });
    let st = await settlement.statement(operatorId, propertyId, a);
    expect(st).toMatchObject({
      deposit_held_inr: 0,
      deposit_uncollected_inr: 18000,
      open_dues_inr: 9000 + 4355
    });
    st = await settlement.settle(
      operatorId,
      propertyId,
      a,
      { deductions: [{ kind: "damage", label: "Broken chair", amount_inr: 1200 }] },
      randomUUID()
    );
    expect(st).toMatchObject({
      status: "settled",
      net_inr: -(9000 + 4355 + 1200),
      to_return_inr: 0
    });
    const dep = (
      await db.query<{ status: string; total: string }>(
        `SELECT status::text, total_paise::text AS total FROM pg_rent_invoices WHERE assignment_id = $1::uuid AND kind = 'deposit'`,
        [a]
      )
    ).rows[0];
    expect(dep).toEqual({ status: "paid", total: "0" }); // written down to what was paid (nothing)
    const set = (
      await db.query<{ status: string; total: string; token: string | null }>(
        `SELECT status::text, total_paise::text AS total, pay_token AS token FROM pg_rent_invoices WHERE assignment_id = $1::uuid AND kind = 'settlement'`,
        [a]
      )
    ).rows[0];
    expect(set).toMatchObject({ status: "issued", total: "120000" });
    expect(set.token).toHaveLength(43);
    await assertRentInvariants(db, propertyId);
  });

  it("blocks settle while a re-proration suggestion is pending, then re-settle updates the same settlement invoice after a reversed release", async () => {
    const propertyId = await fx.createProperty(operatorId);
    const listingId = await fx.createListingWithDetails(propertyId, operatorId);
    const roomTypeId = await fx.createRoomType(listingId, {
      rentPaise: 900000,
      depositPaise: 1800000
    });
    const roomId = await fx.createRoom(propertyId, { roomTypeId });
    await settings.enable(operatorId, propertyId, {
      billing_starts_on: "2026-09-01",
      due_day: 5,
      prorate_move_out: true
    }); // advance
    const bedId = await fx.createBed(roomId, "A");
    const a = await fx.createAssignment(propertyId, bedId, {
      createdBy: operatorId,
      moveIn: "2026-09-01"
    });
    await engine.generateInvoicesForProperty(propertyId, "2026-09-30"); // deposit + Sep + Oct (advance, created Sep 30)
    await payments.recordByOperator(
      operatorId,
      propertyId,
      { assignment_id: a, amount_inr: 36000, method: "cash", paid_on: "2026-09-30" },
      randomUUID()
    );
    await db.query(
      `UPDATE pg_bed_assignments SET status = 'moved_out', move_out_date = '2026-10-15' WHERE id = $1::uuid`,
      [a]
    );
    await engine.onAssignmentEvent({
      type: "operator_direct_move_out",
      propertyId,
      assignmentId: a
    });

    let st = await settlement.statement(operatorId, propertyId, a);
    expect(st.pending_suggestion).toMatchObject({
      leave_on: "2026-10-15",
      from_inr: 9000,
      to_inr: 4355
    });
    await expect(
      settlement.settle(operatorId, propertyId, a, { deductions: [] }, randomUUID())
    ).rejects.toMatchObject({ response: { code: "suggestion_pending" } });
    await invoices.applyReprorate(operatorId, propertyId, st.pending_suggestion!.invoice_id);
    st = await settlement.statement(operatorId, propertyId, a);
    expect(st).toMatchObject({
      pending_suggestion: null,
      credit_inr: 4645,
      deposit_held_inr: 18000,
      open_dues_inr: 0,
      to_return_inr: 22645
    });

    st = await settlement.settle(operatorId, propertyId, a, { deductions: [] }, randomUUID());
    expect(st).toMatchObject({ status: "settled", to_return_inr: 22645 }); // nothing returned yet → still to return
    const release = (
      await db.query<{ id: string }>(
        `SELECT id::text FROM pg_rent_payments WHERE assignment_id = $1::uuid AND source = 'deposit_release'`,
        [a]
      )
    ).rows[0].id;
    await payments.reverse(operatorId, propertyId, release, "wrong deductions");
    st = await settlement.statement(operatorId, propertyId, a);
    expect(st).toMatchObject({
      status: "leaving",
      deposit_held_inr: 18000,
      settlement_invoice_id: expect.any(String)
    });
    const again = await settlement.settle(
      operatorId,
      propertyId,
      a,
      { deductions: [{ kind: "other", label: "Keys", amount_inr: 500 }] },
      randomUUID()
    );
    expect(again).toMatchObject({ status: "settled", to_return_inr: 22145 });
    const count = await db.query(
      `SELECT 1 FROM pg_rent_invoices WHERE assignment_id = $1::uuid AND kind = 'settlement' AND status <> 'cancelled'`,
      [a]
    );
    expect(count.rowCount).toBe(1);
    await assertRentInvariants(db, propertyId);
  });

  it("forfeit: a cancelled reservation's booking credit becomes an adhoc forfeit invoice paid from that credit", async () => {
    const propertyId = await fx.createProperty(operatorId);
    const roomId = await fx.createRoom(propertyId);
    await settings.enable(operatorId, propertyId, {});
    const bedId = await fx.createBed(roomId, "A", "reserved");
    const a = await fx.createAssignment(propertyId, bedId, {
      createdBy: operatorId,
      status: "reserved",
      moveIn: null
    });
    await payments.recordByOperator(
      operatorId,
      propertyId,
      { assignment_id: a, amount_inr: 2000, method: "upi", paid_on: "2026-09-01" },
      randomUUID()
    );
    await db.query(`UPDATE pg_bed_assignments SET status = 'cancelled' WHERE id = $1::uuid`, [a]);
    const inv = await settlement.forfeit(operatorId, propertyId, a, { amount_inr: 1500 });
    expect(inv).toMatchObject({ kind: "adhoc", status: "paid", total_inr: 1500 });
    expect(inv.lines[0]).toMatchObject({ kind: "forfeit", amount_inr: 1500 });
    expect(await new RentAllocationService().unallocatedCredit(db, a)).toBe(50000);
    await expect(
      settlement.forfeit(operatorId, propertyId, a, { amount_inr: 600 })
    ).rejects.toMatchObject({ response: { code: "forfeit_exceeds_credit" } });
    await assertRentInvariants(db, propertyId);
  });
});
```

`4355`: 9000 × 15/31 = 4354.8 → ₹4,355. `13645` = 18000 − 4355. `12845` = 13645 − 800. `4645` = 9000 − 4355 released to credit by `applyReprorate`.

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @cribliv/api exec vitest run src/modules/pg-rent/__tests__/rent-settlement.integration.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Pure + DTO**

```ts
// apps/api/src/modules/pg-rent/pure/rent-settlement.ts
/** Spec §6.11 statement math. All paise. */
export function settlementNet(i: {
  depositHeld: number;
  credit: number;
  openDues: number;
  deductions: number;
}): { net: number; toReturn: number } {
  const net = i.depositHeld + i.credit - i.openDues - i.deductions;
  return { net, toReturn: Math.max(0, net) };
}
```

```ts
// apps/api/src/modules/pg-rent/dto/settlement.dto.ts
import { z } from "zod";
import type { PgRentForfeitInput, PgRentSettleInput } from "@cribliv/shared-types";

import { isIsoDate } from "../../../common/date";

const isoDate = z.string().refine(isIsoDate);
export const SettleSchema = z.object({
  deductions: z
    .array(
      z
        .object({
          kind: z.enum(["damage", "cleaning", "forfeit", "other"]),
          label: z.string().trim().min(1).max(40),
          amount_inr: z.number().int().min(1).max(1000000)
        })
        .strict()
    )
    .max(20),
  return_now: z
    .object({
      amount_inr: z.number().int().min(1).max(1000000),
      method: z.enum(["cash", "upi", "bank_transfer", "cheque", "card", "other"]),
      paid_on: isoDate,
      reference: z.string().trim().max(64).nullable().optional()
    })
    .strict()
    .nullable()
    .optional(),
  note: z.string().trim().max(200).nullable().optional()
}) satisfies z.ZodType<PgRentSettleInput, PgRentSettleInput>;

export const ForfeitSchema = z.object({
  amount_inr: z.number().int().min(1).max(1000000),
  label: z.string().trim().min(1).max(40).optional()
}) satisfies z.ZodType<PgRentForfeitInput, PgRentForfeitInput>;
```

- [ ] **Step 4: Settlement service**

```ts
// apps/api/src/modules/pg-rent/services/rent-settlement.service.ts
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException
} from "@nestjs/common";
import type { PoolClient } from "pg";
import type {
  PgRentForfeitInput,
  PgRentInvoice,
  PgRentSettleInput,
  PgRentSettlementStatement,
  PgRentSettlementStatus
} from "@cribliv/shared-types";

import { DatabaseService } from "../../../common/database.service";
import { todayIst } from "../../../common/date";
import { transaction } from "../../../common/transaction";
import { inrToPaise, paiseToInr } from "../dto/money";
import { settlementNet } from "../pure/rent-settlement";
import { RentAllocationService } from "./rent-allocation.service";
import { writeRentEvent } from "./rent-events";
import { setInvoiceTotalFromLines } from "./rent-fee-line";
import { assertManagedOwnership, requireDb, type Queryable, type RentActor } from "./rent-guards";
import { RentInvoiceEngineService } from "./rent-invoice-engine.service";
import { RentInvoiceService } from "./rent-invoice.service";
import { RentPaymentService } from "./rent-payment.service";

const LEAVING = [
  "notice_served",
  "move_out_requested",
  "move_out_pending_confirmation",
  "moved_out"
];

@Injectable()
export class RentSettlementService {
  constructor(
    @Inject(DatabaseService) private readonly db: DatabaseService,
    @Inject(RentAllocationService) private readonly alloc: RentAllocationService,
    @Inject(RentPaymentService) private readonly payments: RentPaymentService,
    @Inject(RentInvoiceService) private readonly invoices: RentInvoiceService,
    @Inject(RentInvoiceEngineService) private readonly engine: RentInvoiceEngineService
  ) {}

  /** Spec §6.11 "Before the statement": generate first so the final cut period exists. */
  async statement(
    operatorId: string,
    propertyId: string,
    assignmentId: string
  ): Promise<PgRentSettlementStatement> {
    requireDb(this.db);
    await assertManagedOwnership(this.db, operatorId, propertyId);
    await this.engine.generateInvoicesForProperty(
      propertyId,
      todayIst(),
      { id: operatorId, role: "pg_operator" },
      { assignmentId }
    );
    return this.compute(this.db, propertyId, assignmentId);
  }

  private async compute(
    q: Queryable,
    propertyId: string,
    assignmentId: string,
    extraDeductionsPaise = 0
  ): Promise<PgRentSettlementStatement> {
    const a = await q.query<{ status: string }>(
      `SELECT status::text FROM pg_bed_assignments WHERE id = $1::uuid AND pg_property_id = $2::uuid`,
      [assignmentId, propertyId]
    );
    if (!a.rows[0]) throw new NotFoundException({ code: "assignment_not_found" });

    const deposit = await q.query<{ paid: string; total: string }>(
      `SELECT COALESCE(SUM(amount_paid_paise),0)::text AS paid, COALESCE(SUM(total_paise),0)::text AS total FROM pg_rent_invoices WHERE assignment_id = $1::uuid AND kind = 'deposit' AND status <> 'cancelled'`,
      [assignmentId]
    );
    const released = await q.query<{ v: string }>(
      `SELECT COALESCE(SUM(amount_paise),0)::text AS v FROM pg_rent_payments WHERE assignment_id = $1::uuid AND source = 'deposit_release' AND status = 'confirmed'`,
      [assignmentId]
    );
    const depositHeld = Number(deposit.rows[0].paid) - Number(released.rows[0].v);
    const depositUncollected = Number(deposit.rows[0].total) - Number(deposit.rows[0].paid);
    const credit = await this.alloc.unallocatedCredit(q, assignmentId);
    const open = await q.query<{
      id: string;
      invoice_number: string;
      kind: PgRentInvoice["kind"];
      balance: string;
    }>(
      `SELECT id::text, invoice_number, kind::text, (total_paise - amount_paid_paise)::text AS balance FROM pg_rent_invoices
        WHERE assignment_id = $1::uuid AND status IN ('issued','partially_paid') AND kind <> 'deposit' ORDER BY due_date`,
      [assignmentId]
    );
    const openDues = open.rows.reduce((s, r) => s + Number(r.balance), 0);
    const suggestion = await q.query<{
      id: string;
      s: { leave_on: string; from_paise: number; to_paise: number; mode: string };
    }>(
      `SELECT id::text, reprorate_suggestion AS s FROM pg_rent_invoices WHERE assignment_id = $1::uuid AND reprorate_suggestion->>'mode' = 'reprorate' LIMIT 1`,
      [assignmentId]
    );
    const settlementInv = await q.query<{ id: string }>(
      `SELECT id::text FROM pg_rent_invoices WHERE assignment_id = $1::uuid AND kind = 'settlement' AND status <> 'cancelled'`,
      [assignmentId]
    );
    const deductions = settlementInv.rows[0]
      ? (
          await q.query<{
            kind: PgRentInvoice["kind"] extends never
              ? never
              : "damage" | "cleaning" | "forfeit" | "other";
            label: string;
            amount: string;
          }>(
            `SELECT kind::text, label, amount_paise::text AS amount FROM pg_rent_invoice_lines WHERE invoice_id = $1::uuid AND kind <> 'adjustment' ORDER BY sort_order`,
            [settlementInv.rows[0].id]
          )
        ).rows
      : [];
    const maintenance = await q.query<{ id: string; label: string; cost: string | null }>(
      `SELECT id::text, category || ': ' || left(description, 30) AS label, resolution_cost_paise::text AS cost FROM pg_maintenance_requests
        WHERE assignment_id = $1::uuid AND chargeable_damage = true ORDER BY created_at DESC LIMIT 10`,
      [assignmentId]
    );

    const settled = settlementInv.rows.length > 0 && Number(released.rows[0].v) > 0;
    const leaving = LEAVING.includes(a.rows[0].status);
    let status: PgRentSettlementStatus = !leaving ? "not_leaving" : settled ? "settled" : "leaving";
    // settlement-invoice dues are already in openDues; deductions being entered now come via extraDeductionsPaise
    const { net, toReturn } = settlementNet({
      depositHeld,
      credit,
      openDues,
      deductions: extraDeductionsPaise
    });
    if (
      leaving &&
      !settled &&
      depositHeld === 0 &&
      credit === 0 &&
      openDues === 0 &&
      depositUncollected === 0 &&
      !suggestion.rows[0]
    )
      status = "nothing_to_settle";

    return {
      assignment_id: assignmentId,
      status,
      deposit_held_inr: paiseToInr(depositHeld),
      credit_inr: paiseToInr(credit),
      open_dues_inr: paiseToInr(openDues),
      open_invoices: open.rows.map((r) => ({
        invoice_id: r.id,
        invoice_number: r.invoice_number,
        kind: r.kind,
        balance_inr: paiseToInr(r.balance)
      })),
      deposit_uncollected_inr: paiseToInr(depositUncollected),
      pending_suggestion: suggestion.rows[0]
        ? {
            invoice_id: suggestion.rows[0].id,
            leave_on: suggestion.rows[0].s.leave_on,
            from_inr: paiseToInr(suggestion.rows[0].s.from_paise),
            to_inr: paiseToInr(suggestion.rows[0].s.to_paise)
          }
        : null,
      maintenance_prefills: maintenance.rows.map((m) => ({
        request_id: m.id,
        label: m.label,
        amount_inr: m.cost === null ? null : paiseToInr(m.cost)
      })),
      deductions: deductions.map((d) => ({
        kind: d.kind,
        label: d.label,
        amount_inr: paiseToInr(d.amount)
      })),
      net_inr: paiseToInr(net),
      to_return_inr: paiseToInr(toReturn),
      settlement_invoice_id: settlementInv.rows[0]?.id ?? null
    };
  }

  /** Spec §6.11 steps 0–5 in one transaction. Idempotent by key (stored on the deposit-release payment). */
  async settle(
    operatorId: string,
    propertyId: string,
    assignmentId: string,
    input: PgRentSettleInput,
    idempotencyKey: string
  ): Promise<PgRentSettlementStatement> {
    requireDb(this.db);
    const actor: RentActor = { id: operatorId, role: "pg_operator" };
    const dup = await this.db.query(
      `SELECT 1 FROM pg_rent_payments WHERE pg_property_id = $1::uuid AND idempotency_key = $2`,
      [propertyId, idempotencyKey]
    );
    if (dup.rowCount) return this.statement(operatorId, propertyId, assignmentId);

    await this.engine.generateInvoicesForProperty(propertyId, todayIst(), actor, { assignmentId });
    await transaction(this.db, async (client) => {
      await assertManagedOwnership(client, operatorId, propertyId, true);
      const a = await client.query<{ status: string }>(
        `SELECT status::text FROM pg_bed_assignments WHERE id = $1::uuid AND pg_property_id = $2::uuid FOR UPDATE`,
        [assignmentId, propertyId]
      );
      if (!a.rows[0]) throw new NotFoundException({ code: "assignment_not_found" });
      if (!LEAVING.includes(a.rows[0].status)) throw new ConflictException({ code: "not_leaving" });
      const pending = await client.query(
        `SELECT 1 FROM pg_rent_invoices WHERE assignment_id = $1::uuid AND reprorate_suggestion->>'mode' = 'reprorate'`,
        [assignmentId]
      );
      if (pending.rowCount)
        throw new ConflictException({
          code: "suggestion_pending",
          message: "Act on the final-period re-proration first"
        });
      const live = await client.query(
        `SELECT 1 FROM pg_rent_payments WHERE assignment_id = $1::uuid AND source = 'deposit_release' AND status = 'confirmed'`,
        [assignmentId]
      );
      if (live.rowCount)
        throw new ConflictException({
          code: "already_settled",
          message: "Reverse the deposit release to re-settle"
        });

      // step 0: write the uncollected deposit down
      const dep = await client.query<{ id: string; total: string; paid: string }>(
        `SELECT id::text, total_paise::text AS total, amount_paid_paise::text AS paid FROM pg_rent_invoices WHERE assignment_id = $1::uuid AND kind = 'deposit' AND status IN ('issued','partially_paid') FOR UPDATE`,
        [assignmentId]
      );
      if (dep.rows[0]) {
        const shortfall = Number(dep.rows[0].total) - Number(dep.rows[0].paid);
        await client.query(
          `INSERT INTO pg_rent_invoice_lines (invoice_id, kind, label, amount_paise, source, sort_order, created_by) VALUES ($1::uuid, 'adjustment', 'Not collected at move-out', $2, 'operator', 50, $3::uuid)`,
          [dep.rows[0].id, -shortfall, operatorId]
        );
        await setInvoiceTotalFromLines(client, dep.rows[0].id);
        await this.alloc.recomputeInvoice(client, dep.rows[0].id);
        await writeRentEvent(client, {
          propertyId,
          entityType: "invoice",
          entityId: dep.rows[0].id,
          eventType: "invoice.line_added",
          actor,
          payload: { reason: "deposit_settled", amount_paise: -shortfall }
        });
      }

      // step 1: settlement invoice (create or replace its deduction lines)
      const deductions = input.deductions.map((d) => ({
        kind: d.kind,
        label: d.label,
        amountPaise: inrToPaise(d.amount_inr)
      }));
      const existing = await client.query<{ id: string }>(
        `SELECT id::text FROM pg_rent_invoices WHERE assignment_id = $1::uuid AND kind = 'settlement' AND status <> 'cancelled' FOR UPDATE`,
        [assignmentId]
      );
      let settlementId: string;
      if (existing.rows[0]) {
        settlementId = existing.rows[0].id;
        await client.query(`DELETE FROM pg_rent_invoice_lines WHERE invoice_id = $1::uuid`, [
          settlementId
        ]);
        for (const [i, d] of deductions.entries()) {
          await client.query(
            `INSERT INTO pg_rent_invoice_lines (invoice_id, kind, label, amount_paise, source, sort_order, created_by) VALUES ($1::uuid, $2::pg_rent_line_kind, $3, $4, 'operator', $5, $6::uuid)`,
            [settlementId, d.kind, d.label, d.amountPaise, i, operatorId]
          );
        }
        await setInvoiceTotalFromLines(client, settlementId);
        await this.alloc.recomputeInvoice(client, settlementId);
        await writeRentEvent(client, {
          propertyId,
          entityType: "invoice",
          entityId: settlementId,
          eventType: "invoice.line_updated",
          actor,
          payload: { reason: "settlement_replaced", deductions }
        });
      } else {
        settlementId = await this.invoices.insertSettlementInvoice(client, {
          propertyId,
          assignmentId,
          deductions,
          actor
        });
      }

      // step 2: deposit release → FIFO across open dues, settlement last
      const held = await client.query<{ v: string }>(
        `SELECT COALESCE(SUM(amount_paid_paise),0)::text AS v FROM pg_rent_invoices WHERE assignment_id = $1::uuid AND kind = 'deposit' AND status <> 'cancelled'`,
        [assignmentId]
      );
      const depositHeld = Number(held.rows[0].v);
      if (depositHeld > 0)
        await this.payments.releaseDeposit(client, {
          propertyId,
          assignmentId,
          amountPaise: depositHeld,
          actor
        });
      else await this.alloc.applyUnallocatedCredit(client, settlementId, actor);

      // step 3: return now (funded from credit)
      if (input.return_now) {
        const credit = await this.alloc.unallocatedCredit(client, assignmentId);
        const want = inrToPaise(input.return_now.amount_inr);
        if (want > credit) throw new BadRequestException({ code: "refund_exceeds_credit" });
        await this.payments.recordRefundInTransaction(client, {
          propertyId,
          assignmentId,
          amountPaise: want,
          method: input.return_now.method,
          paidOn: input.return_now.paid_on,
          reference: input.return_now.reference ?? null,
          reason: "Deposit returned at move-out",
          idempotencyKey,
          actor
        });
      } else {
        // the idempotency key still has to live somewhere: pin it on the deposit-release row
        await client.query(
          `UPDATE pg_rent_payments SET idempotency_key = $2 WHERE assignment_id = $1::uuid AND source = 'deposit_release' AND status = 'confirmed' AND idempotency_key IS NULL`,
          [assignmentId, idempotencyKey]
        );
      }
      const st = await this.compute(client, propertyId, assignmentId);
      await writeRentEvent(client, {
        propertyId,
        entityType: "assignment",
        entityId: assignmentId,
        eventType: "settlement.created",
        actor,
        payload: {
          deposit_held_paise: depositHeld,
          credit_inr: st.credit_inr,
          dues_inr: st.open_dues_inr,
          deductions,
          net_inr: st.net_inr,
          note: input.note ?? null
        }
      });
    });
    return this.compute(this.db, propertyId, assignmentId);
  }

  /** Spec §6.12: forfeit ≤ credit on a cancelled/reserved assignment → adhoc invoice with a forfeit line, paid from the credit. */
  async forfeit(
    operatorId: string,
    propertyId: string,
    assignmentId: string,
    input: PgRentForfeitInput
  ): Promise<PgRentInvoice> {
    requireDb(this.db);
    const credit = await this.alloc.unallocatedCredit(this.db, assignmentId);
    if (inrToPaise(input.amount_inr) > credit)
      throw new BadRequestException({ code: "forfeit_exceeds_credit" });
    return this.invoices.createManual(operatorId, propertyId, {
      assignment_id: assignmentId,
      kind: "adhoc",
      due_date: todayIst(),
      lines: [
        {
          kind: "forfeit",
          label: input.label ?? "Booking amount forfeited",
          amount_inr: input.amount_inr
        }
      ]
    });
  }
}
```

Two small additions this needs elsewhere:

1. `RentInvoiceService.insertSettlementInvoice(client, { propertyId, assignmentId, deductions, actor })` — a public wrapper around the private `insertInvoice` with `kind: "settlement", source: "manual", eligible: false, periodStart/End: null, dueDate: todayIst()`.
2. `RentPaymentService.recordRefundInTransaction(client, ctx)` — the body of `recordRefund` minus the outer `transaction`/ownership (so settlement can fund the return in the same transaction); make `recordRefund` call it.

`createManual` in `forfeit` relies on `applyUnallocatedCredit` inside it — the reserved/cancelled assignment's credit pays the forfeit line. `assertAssignment` in `recordByOperator` already permits `reserved`; ensure `insertInvoice` does not reject `cancelled` assignments (it locks by id only — correct).

Register `RentSettlementService` in the module.

- [ ] **Step 5: Run to verify it passes**

Run: `pnpm --filter @cribliv/api exec vitest run src/modules/pg-rent/__tests__/rent-settlement.integration.test.ts`
Expected: PASS, 5 tests. If `maintenance_prefills` fails on column names, check `pg_maintenance_requests` for `chargeable_damage` / `resolution_cost_paise` (spec §18 names them; 0063/0064 define them) and adjust the SELECT.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/pg-rent
git commit -m "feat(pg-rent): move-out settlement, deposit release, returns and booking forfeits"
```

---

### Task 8: Controllers — operator payments/receipts/actions/settlement, tenant claims

**Files:**

- Create: `apps/api/src/modules/pg-rent/controllers/pg-rent-payments.controller.ts`
- Modify: `apps/api/src/modules/pg-rent/controllers/pg-rent-invoices.controller.ts`
- Create: `apps/api/src/modules/pg-rent/controllers/pg-rent-settlement.controller.ts`
- Create: `apps/api/src/modules/pg-rent/controllers/pg-rent-tenant-claims.controller.ts`
- Modify: `apps/api/src/modules/pg-rent/pg-rent.module.ts`
- Test: `apps/api/src/modules/pg-rent/__tests__/pg-rent-money-controllers.integration.test.ts`

**Routes** (operator base `/v1/pg-operator/properties/:propertyId/rent`, `AuthGuard + RolesGuard('pg_operator')`, `assertRentFlag()` first in every handler, zod via `parseOrThrow`):

| Method & path                                                                    | Handler                                                                                                                               | Body schema                                               | Idempotency                                 |
| -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- | ------------------------------------------- |
| `GET /payments`                                                                  | `payments.list`                                                                                                                       | query `assignment_id?`, `status?`, `direction?`           | —                                           |
| `POST /payments`                                                                 | `payments.recordByOperator`                                                                                                           | `RecordPaymentSchema`                                     | header → `IdempotencyService.run` + row key |
| `POST /payments/:id/confirm`                                                     | `payments.confirm`                                                                                                                    | `ConfirmPaymentSchema`                                    | —                                           |
| `POST /payments/confirm-bulk`                                                    | `payments.confirmBulk`                                                                                                                | `{ ids: uuid[] (1–50) }`                                  | —                                           |
| `POST /payments/:id/reject`                                                      | `payments.reject`                                                                                                                     | `RejectPaymentSchema`                                     | —                                           |
| `POST /payments/:id/reverse`                                                     | `payments.reverse`                                                                                                                    | `ReversePaymentSchema`                                    | —                                           |
| `PATCH /payments/:id/allocations`                                                | `payments.reallocate`                                                                                                                 | `AllocationsPatchSchema`                                  | —                                           |
| `POST /refunds`                                                                  | `payments.recordRefund`                                                                                                               | `RefundSchema`                                            | header + row key                            |
| `GET /receipts/:id/download`                                                     | `receipts.downloadUrl`                                                                                                                | —                                                         | —                                           |
| `POST /receipts/:id/retry`                                                       | `receipts.retry`                                                                                                                      | —                                                         | —                                           |
| `POST /receipts/:id/share-token`                                                 | `receipts.regenerateShareToken`                                                                                                       | —                                                         | —                                           |
| `POST /invoices`                                                                 | `invoices.createManual` / `createBackfill` (by `source` in body: `"manual"` → `ManualInvoiceSchema`, `"backfill"` → `BackfillSchema`) |                                                           | header → `IdempotencyService.run`           |
| `POST /invoices/:id/issue`                                                       | `invoices.issueDraft`                                                                                                                 | `IssueDraftSchema`                                        | —                                           |
| `POST /invoices/:id/lines` · `PATCH …/lines/:lineId` · `DELETE …/lines/:lineId`  | `addLine` / `updateLine` / `removeLine`                                                                                               | `LineInputSchema` / `LinePatchSchema`                     | —                                           |
| `POST /invoices/:id/extend-due`                                                  | `extendDue`                                                                                                                           | `ExtendDueSchema`                                         | —                                           |
| `POST /invoices/:id/cancel`                                                      | `cancel`                                                                                                                              | `CancelInvoiceSchema`                                     | —                                           |
| `POST /invoices/:id/late-fee/apply` · `…/waive` · `PATCH …/late-fee/eligibility` | `applyFee` / `waiveFee` / `setEligibility`                                                                                            | `ApplyFeeSchema` / `WaiveFeeSchema` / `EligibilitySchema` | —                                           |
| `POST /late-fees/waive-all`                                                      | `waiveAllFees`                                                                                                                        | `WaiveFeeSchema`                                          | —                                           |
| `POST /invoices/:id/reprorate` · `…/reprorate/dismiss` · `…/reprorate/restore`   | `applyReprorate` / `dismissReprorate` / `restoreReprorate`                                                                            | —                                                         | —                                           |
| `GET /tenants/:assignmentId/settlement`                                          | `settlement.statement`                                                                                                                | —                                                         | —                                           |
| `POST /tenants/:assignmentId/settle`                                             | `settlement.settle`                                                                                                                   | `SettleSchema`                                            | header + key                                |
| `POST /tenants/:assignmentId/forfeit`                                            | `settlement.forfeit`                                                                                                                  | `ForfeitSchema`                                           | —                                           |

Tenant base `/v1/tenant/pg-rent`, `AuthGuard + RolesGuard('tenant')`:

| `POST /claims` | `payments.claimByTenant` (body `ClaimPaymentSchema`; the `idempotency_key` is in the body per spec §6.3) |
| `DELETE /claims/:id` | `payments.cancelClaim` |
| `GET /receipts/:id/download` | `receipts.downloadUrlForTenant` |

- [ ] **Step 1: Write the failing controller tests**

Bootstrap exactly like 1a's `pg-rent-controllers.integration.test.ts` (same `AuthGuard` override; add a `tenant` identity with role `tenant` and a `tenantUserId` created with phone `+917700000055`; set `FF_PG_RENT_COLLECTION=true`), seed one property with a room type (rent 9000, deposit 18000), enable it, one bed, one assignment with `occupantPhone: "+917700000055"` and `moveIn: "2026-09-01"`, run `POST /generate-now`. Then:

```ts
it("records, lists, confirms a tenant claim, rejects, reverses, refunds — all in rupees, with idempotency", async () => {
  const key = randomUUID();
  const rec = () =>
    request(app.getHttpServer())
      .post(`${base()}/payments`)
      .set(as("operator"))
      .set("idempotency-key", key)
      .send({
        assignment_id: assignmentId,
        amount_inr: 18000,
        method: "cash",
        paid_on: "2026-09-02"
      });
  const first = await rec();
  expect(first.status).toBe(201);
  const second = await rec();
  expect(second.body.data.id).toBe(first.body.data.id);
  expect(JSON.stringify(first.body)).not.toMatch(/_paise|pay_token|share_token/);
  expect(
    (
      await request(app.getHttpServer())
        .post(`${base()}/payments`)
        .set(as("operator"))
        .send({ assignment_id: assignmentId, amount_inr: 1, method: "cash", paid_on: "2026-09-02" })
    ).status
  ).toBe(400); // missing header

  const claim = await request(app.getHttpServer())
    .post(`/v1/tenant/pg-rent/claims`)
    .set(as("tenant"))
    .send({
      assignment_id: assignmentId,
      amount_inr: 9000,
      method: "upi",
      paid_on: "2026-09-03",
      idempotency_key: randomUUID()
    });
  expect(claim.status).toBe(201);
  expect(claim.body.data.status).toBe("pending_confirmation");
  const list = await request(app.getHttpServer())
    .get(`${base()}/payments?status=pending_confirmation`)
    .set(as("operator"));
  expect(list.body.data.map((p: { id: string }) => p.id)).toContain(claim.body.data.id);
  const confirmed = await request(app.getHttpServer())
    .post(`${base()}/payments/${claim.body.data.id}/confirm`)
    .set(as("operator"))
    .send({ amount_inr: 8500 });
  expect(confirmed.status).toBe(201);
  expect(confirmed.body.data).toMatchObject({ status: "confirmed", amount_inr: 8500 });
  expect(
    (
      await request(app.getHttpServer())
        .post(`${base()}/payments/${claim.body.data.id}/reject`)
        .set(as("operator"))
        .send({ reason: "late" })
    ).status
  ).toBe(409);
  expect(
    (
      await request(app.getHttpServer())
        .post(`${base()}/payments/${claim.body.data.id}/reject`)
        .set(as("operator"))
        .send({})
    ).status
  ).toBe(400);

  const reversed = await request(app.getHttpServer())
    .post(`${base()}/payments/${first.body.data.id}/reverse`)
    .set(as("operator"))
    .send({ reason: "wrong tenant" });
  expect(reversed.body.data.status).toBe("reversed");
  const refundBad = await request(app.getHttpServer())
    .post(`${base()}/refunds`)
    .set(as("operator"))
    .set("idempotency-key", randomUUID())
    .send({
      assignment_id: assignmentId,
      amount_inr: 100,
      method: "cash",
      paid_on: "2026-09-05",
      reason: "x"
    });
  expect(refundBad.status).toBe(400);
  expect(refundBad.body.error?.code ?? refundBad.body.code).toBe("refund_exceeds_credit");
  expect(
    (await request(app.getHttpServer()).get(`${base()}/payments`).set(as("other"))).status
  ).toBe(403);
});

it("invoice actions and settlement routes are wired", async () => {
  const inv = (
    await request(app.getHttpServer()).get(`${base()}/invoices?kind=rent`).set(as("operator"))
  ).body.data[0];
  const added = await request(app.getHttpServer())
    .post(`${base()}/invoices/${inv.id}/lines`)
    .set(as("operator"))
    .send({ kind: "electricity", label: "Electricity", amount_inr: 896 });
  expect(added.status).toBe(201);
  expect(added.body.data.total_inr).toBe(inv.total_inr + 896);
  const lineId = added.body.data.lines.find((l: { kind: string }) => l.kind === "electricity").id;
  expect(
    (
      await request(app.getHttpServer())
        .delete(`${base()}/invoices/${inv.id}/lines/${lineId}`)
        .set(as("operator"))
    ).status
  ).toBe(200);
  expect(
    (
      await request(app.getHttpServer())
        .post(`${base()}/invoices/${inv.id}/extend-due`)
        .set(as("operator"))
        .send({ due_date: "2099-01-01" })
    ).body.data.due_date
  ).toBe("2099-01-01");
  expect(
    (
      await request(app.getHttpServer())
        .post(`${base()}/invoices/${inv.id}/late-fee/apply`)
        .set(as("operator"))
        .send({ amount_inr: 300 })
    ).body.data.total_inr
  ).toBe(inv.total_inr + 300);
  expect(
    (
      await request(app.getHttpServer())
        .post(`${base()}/late-fees/waive-all`)
        .set(as("operator"))
        .send({ reason: "ok" })
    ).body.data
  ).toEqual({ waived: 1 });
  const manual = await request(app.getHttpServer())
    .post(`${base()}/invoices`)
    .set(as("operator"))
    .set("idempotency-key", randomUUID())
    .send({
      source: "manual",
      assignment_id: assignmentId,
      kind: "adhoc",
      due_date: "2026-09-20",
      lines: [{ kind: "other", label: "Key", amount_inr: 200 }]
    });
  expect(manual.status).toBe(201);
  expect(manual.body.data.kind).toBe("adhoc");
  const st = await request(app.getHttpServer())
    .get(`${base()}/tenants/${assignmentId}/settlement`)
    .set(as("operator"));
  expect(st.status).toBe(200);
  expect(st.body.data.status).toBe("not_leaving");
  expect(
    (
      await request(app.getHttpServer())
        .post(`${base()}/tenants/${assignmentId}/settle`)
        .set(as("operator"))
        .set("idempotency-key", randomUUID())
        .send({ deductions: [] })
    ).status
  ).toBe(409);
});

it("tenant routes are scoped to the tenant's own assignments", async () => {
  const stranger = await fx.createUser("tenant"); // add a 'stranger' identity to the guard map
  const res = await request(app.getHttpServer())
    .post(`/v1/tenant/pg-rent/claims`)
    .set(as("stranger"))
    .send({
      assignment_id: assignmentId,
      amount_inr: 10,
      method: "upi",
      paid_on: "2026-09-03",
      idempotency_key: randomUUID()
    });
  expect(res.status).toBe(403);
  expect(stranger).toBeTruthy();
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @cribliv/api exec vitest run src/modules/pg-rent/__tests__/pg-rent-money-controllers.integration.test.ts`
Expected: FAIL — 404s.

- [ ] **Step 3: Implement the controllers**

Every handler follows this exact shape (copy it; only the schema, service call and route differ):

```ts
  @Post("payments")
  async record(
    @AuthUser() user: UserContext, @Param("propertyId") propertyId: string,
    @Headers("idempotency-key") idempotencyKey: string | undefined, @Body() body: unknown
  ) {
    assertRentFlag();
    const key = requireIdempotencyKey(idempotencyKey);
    const input = parseOrThrow(RecordPaymentSchema, body);
    return ok(
      await (this.idem ?? PASSTHROUGH_IDEMPOTENCY).run(user.id, `pg-rent:${propertyId}:payments`, key, () =>
        this.payments.recordByOperator(user.id, propertyId, input, key)
      )
    );
  }
```

Controller skeletons:

```ts
// pg-rent-payments.controller.ts
@Controller("pg-operator/properties/:propertyId/rent") @UseGuards(AuthGuard, RolesGuard) @Roles("pg_operator")
export class PgRentPaymentsController {
  constructor(
    @Inject(RentPaymentService) private readonly payments: RentPaymentService,
    @Inject(RentReceiptService) private readonly receipts: RentReceiptService,
    @Optional() @Inject(IdempotencyService) private readonly idem: IdempotencyService | undefined
  ) {}
  @Get("payments") list(...)                                   // parseOrThrow(z.object({ assignment_id: uuid.optional(), status: enum.optional(), direction: enum.optional() }), query ?? {})
  @Post("payments") record(...)                                // above
  @Post("payments/confirm-bulk") confirmBulk(...)              // parseOrThrow(z.object({ ids: z.array(z.string().uuid()).min(1).max(50) }), body) → payments.confirmBulk
  @Post("payments/:id/confirm") confirm(...)                   // ConfirmPaymentSchema
  @Post("payments/:id/reject") reject(...)                     // RejectPaymentSchema → payments.reject(user.id, propertyId, id, input.reason)
  @Post("payments/:id/reverse") reverse(...)                   // ReversePaymentSchema
  @Patch("payments/:id/allocations") reallocate(...)           // AllocationsPatchSchema → payments.reallocate(user.id, propertyId, id, input.allocations)
  @Post("refunds") refund(...)                                 // RefundSchema + idempotency header, route `pg-rent:${propertyId}:refunds`
  @Get("receipts/:id/download") download(...)                  // receipts.downloadUrl
  @Post("receipts/:id/retry") retry(...)                       // receipts.retry
  @Post("receipts/:id/share-token") share(...)                 // receipts.regenerateShareToken
}
```

`confirm-bulk` must be declared **before** `payments/:id/confirm` so Nest does not match `confirm-bulk` as an `:id`.

```ts
// pg-rent-invoices.controller.ts — add (constructor gains @Optional() IdempotencyService)
  @Post("invoices") create(...)   // const src = (body as { source?: string })?.source; src === "backfill" ? createBackfill(parseOrThrow(BackfillSchema, body)) : createManual(parseOrThrow(ManualInvoiceSchema, body)); idempotency route `pg-rent:${propertyId}:invoices`
  @Post("invoices/:id/issue") issue(...)
  @Post("invoices/:id/lines") addLine(...) · @Patch("invoices/:id/lines/:lineId") updateLine(...) · @Delete("invoices/:id/lines/:lineId") removeLine(...)
  @Post("invoices/:id/extend-due") extendDue(...) · @Post("invoices/:id/cancel") cancel(...)
  @Post("invoices/:id/late-fee/apply") applyFee(...) · @Post("invoices/:id/late-fee/waive") waiveFee(...) · @Patch("invoices/:id/late-fee/eligibility") eligibility(...)
  @Post("late-fees/waive-all") waiveAll(...)
  @Post("invoices/:id/reprorate") reprorate(...) · @Post("invoices/:id/reprorate/dismiss") dismiss(...) · @Post("invoices/:id/reprorate/restore") restore(...)
```

Strip the `source` key before schema parsing for `POST /invoices`: `const { source, ...rest } = body as Record<string, unknown>`.

```ts
// pg-rent-settlement.controller.ts
@Controller("pg-operator/properties/:propertyId/rent/tenants/:assignmentId") @UseGuards(AuthGuard, RolesGuard) @Roles("pg_operator")
export class PgRentSettlementController {
  @Get("settlement") statement(...)         // settlement.statement
  @Post("settle") settle(...)               // SettleSchema + idempotency header, route `pg-rent:${propertyId}:settle:${assignmentId}`
  @Post("forfeit") forfeit(...)             // ForfeitSchema
}

// pg-rent-tenant-claims.controller.ts
@Controller("tenant/pg-rent") @UseGuards(AuthGuard, RolesGuard) @Roles("tenant")
export class PgRentTenantClaimsController {
  @Post("claims") claim(...)                // parseOrThrow(ClaimPaymentSchema, body) → payments.claimByTenant(user.id, input)
  @Delete("claims/:id") cancel(...)         // payments.cancelClaim(user.id, id) → ok({ ok: true })
  @Get("receipts/:id/download") download(...) // receipts.downloadUrlForTenant
}
```

Register the three new controllers in `pg-rent.module.ts`. Delete/HTTP 200: Nest returns 200 for `@Delete` and `@Patch`, 201 for `@Post` — the tests above assert those.

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @cribliv/api exec vitest run src/modules/pg-rent/__tests__/pg-rent-money-controllers.integration.test.ts`
Expected: PASS, 3 tests. A 404 on `confirm-bulk` means the route order note above was missed.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/pg-rent
git commit -m "feat(pg-rent): payment, invoice-action, settlement and tenant-claim controllers"
```

---

### Task 9: Full verification and PR

- [ ] **Step 1: Run everything**

```bash
pnpm --filter @cribliv/shared-types build
pnpm --filter @cribliv/api typecheck
pnpm --filter @cribliv/api exec vitest run src/modules/pg-rent src/worker src/modules/pg-operations src/modules/admin
pnpm lint
```

Expected: all pg-rent suites green — 1a's 91 plus this slice's payment-dto 6, late-fee/allocation 12, allocation mutations 2, payments 6, invoice actions 7, late-fee sweep 3, receipt render 3, receipt queue 2, settlement 5, money controllers 3 = **140 tests**; pre-existing failures only where the memory note says.

- [ ] **Step 2: Invariant sweep over every test property**

Add to the end of each integration suite's `afterAll` (before teardown) a loop `for (const id of fx.propertyIds) await assertRentInvariants(db, id);` — every property every suite created must still satisfy §3 after the whole file ran. Re-run `src/modules/pg-rent`. Expected: green.

- [ ] **Step 3: Contract and secrets check**

```bash
grep -rn "_paise\|pay_token\|share_token" apps/api/src/modules/pg-rent/controllers/ apps/api/src/modules/pg-rent/dto/*.dto.ts | grep -v "paise:\|Paise\|paiseToInr\|inrToPaise\|_paise\b.*::text\|share_token_expires_at" ; echo "(expect no DTO output field named *_paise, pay_token or share_token above)"
```

- [ ] **Step 4: Spec housekeeping**

Verify `invoice.reprorate_dismissed` and `invoice.restore_suggested` are in spec §4.10's event list (they were pre-added when the plan was written; add them only if missing). Run `graphify update .`.

- [ ] **Step 5: PR**

Branch `feat/pg-rent-slice1b-payments-settlement`, title `feat(pg-rent): payments, invoice actions, late fees, receipts, settlement (slice 1b)`. Body: spec sections covered; what is deliberately absent (queue, reminder states, templates, pay page, tenant summary/history — slice 1c); the two provider containers (`pg-rent-receipts`); the note that the immediate receipt render runs in the API process and needs Chromium there (already true for rent agreements).

---

## Self-review

**Spec coverage.** §5.6 late-fee sweep with chargeable balance, freeze, as-of-`paid_on` re-evaluation incl. `paid_within_grace`, suggestion vs auto-apply, exempt/eligible/backfill exclusions, pending-claim pause — Tasks 2, 4, 6. §5.7 status machine: draft→issued (Task 5 `issueDraft`), cancel rules incl. ₹0 paid and partially-paid release, line editing with locked rent/deposit/fee lines, extend-due fee removal — Task 5. §5.8 suggestions (leaving → `reprorate`, staying → `restore`, refused when leave date < period start, owner tap applies via §6.6) — Task 5 Step 6 + `applyReprorate`/`restoreReprorate`. §6.1 intake variants incl. deposit release and backfill; `finalizeConfirmed` as the single paid-making path; outflow funding — Task 4. §6.2 targeted → FIFO → credit, same-assignment only, deposit first / settlement last — Tasks 2, 3. §6.3 claims (pending, one per invoice, idempotency key, cancel own, confirm with edits + originals in event, per-item bulk, reject reason) — Tasks 4, 8. §6.4 record + backfill (no receipt, fee-exempt, unpaid arrears) — Tasks 4, 5. §6.5 reversal (allocations off, status walks back, `settled_on` cleared, token regenerated, receipt voided, `reverse_outflow_first`) — Task 4. §6.6 excess de-allocation newest-first — Task 3, used by every reducer in Tasks 4–7. §6.7 receipts (mint for the three sources, snapshot with words + credit, render queue with SKIP LOCKED and backoff, retry, 15-min SAS, 30-day share token, VOID re-render, re-mint on manual re-allocation) — Tasks 4, 6. §6.8 bounds — Task 1 schemas + `paid_on ≤ today`. §6.10 edge cases — each has a test (two-months-one-transfer = FIFO test; paid-before-invoice = engine credit test in 1a; wrong amount = reverse test; cancelled-invoice claim = soft target; moved-out pays = `assertAssignment` allows `moved_out`; receipt fails 5× = queue test; rent-not-fee = freeze test; cash inside grace = as-of test; line removed below paid = actions test; partially-paid cancelled = cancel test; reversal after credit auto-applied = `removeAllocationsOf`; re-allocation re-mint = reallocate test). §6.11 settlement (generation-first, suggestion gate, deposit write-down, settlement invoice create/replace, deposit release FIFO, return-now funded, net < 0 collectible with token, reversal order, re-settle) — Task 7. §6.12 booking credit on reserved + forfeit — Task 4 (`reserved` allowed) + Task 7 `forfeit`. §12 routes — Task 8 table matches the spec's payments / receipts / invoice-action / tenants / claims rows. §14 — idempotency on record/claim/refund/settle, `FOR UPDATE` in every mutation, outflow bounds, tenant dates never change a bill.

**Not in this slice (by design, in 1c):** §7 reminder states/queue/templates/pay page, §9 tenant summary/history/identity dispute, public endpoints, `GET /portfolio`. Stated in the index.

**Placeholder scan.** Task 8 Step 3 uses skeleton listings with one fully written handler as the pattern — every route names its schema and service call, so nothing is left to guess. Task 7 Step 4 names the two small cross-service additions with their exact signatures. No TBD/TODO.

**Type consistency.** `RentPaymentService(db, settings, alloc, receipts)` — same order in Tasks 4, 5, 6, 7 tests. `RentInvoiceService(db, alloc, payments, engine)` — Tasks 5, 7. `RentReceiptService(db, renderer, storage, sas)` — Task 6 changes the constructor and Step 6 tells the executor to update the Task 4/5 test constructions. `applyFeeDecision(client, alloc, ctx, decision, actor, { applyMode, reason })` — identical in Task 4 (`finalizeConfirmed`), Task 5 (`applyFee`, `waiveFee`, `extendDue`) and Task 6 (sweep). `resolveTenantAssignmentIds` defined in Task 4 Step 5, used by Task 6 `downloadUrlForTenant` and Task 8. `reprorate_suggestion` jsonb shape `{leave_on, from_paise, to_paise, mode}` matches the 1a DTO mapper patch and Task 5/7 readers. `PgRentSettlementStatement.status` union matches `compute()`'s assignments.
