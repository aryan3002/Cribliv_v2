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

const UUID = "550e8400-e29b-41d4-a716-446655440000";
const UUID2 = "6ba7b810-9dad-11d1-80b4-00c04fd430c8";

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
  // Fix 1 (final fix wave): a late_fee line may only ever exist on a 'rent'
  // invoice with late_fee_eligible = true (invariant 16), but both
  // ManualInvoiceSchema and BackfillSchema force eligible: false. Before this
  // fix, LINE_KINDS accepted "late_fee" here, so POST /invoices with a
  // late_fee line would parse and let insertInvoice persist exactly the row
  // assertRentInvariants flags as broken — with no DB backstop (the unique
  // index only limits an invoice to at most one late_fee line, not which
  // invoices may carry one). This asserts parseOrThrow rejects it before it
  // ever reaches the service, i.e. the controller returns 400.
  it("rejects a late_fee line on manual or backfill invoices (invariant 16)", () => {
    expect(() =>
      parseOrThrow(ManualInvoiceSchema, {
        assignment_id: UUID,
        kind: "adhoc",
        due_date: "2026-09-05",
        lines: [{ kind: "late_fee", label: "Late fee", amount_inr: 100 }]
      })
    ).toThrow();
    expect(() =>
      parseOrThrow(BackfillSchema, {
        assignment_id: UUID,
        kind: "deposit",
        due_date: "2026-09-05",
        lines: [{ kind: "late_fee", label: "Late fee", amount_inr: 100 }]
      })
    ).toThrow();
  });
  // Fix 1: lineInput was missing the negative-amount refine its sibling
  // (invoice-actions.dto.ts's LineInputSchema) already has, so a negative
  // rent/meals/etc. line parsed here and hit the DB's
  // pg_rent_lines_negative_only_discount CHECK as an unmapped 500 instead of
  // a 400 at the schema boundary.
  it("rejects a negative amount on a non-discount/adjustment line", () => {
    expect(() =>
      parseOrThrow(ManualInvoiceSchema, {
        assignment_id: UUID,
        kind: "adhoc",
        due_date: "2026-09-05",
        lines: [{ kind: "other", label: "Negative", amount_inr: -100 }]
      })
    ).toThrow();
    expect(
      parseOrThrow(ManualInvoiceSchema, {
        assignment_id: UUID,
        kind: "adhoc",
        due_date: "2026-09-05",
        lines: [{ kind: "discount", label: "Discount", amount_inr: -100 }]
      }).lines
    ).toEqual([{ kind: "discount", label: "Discount", amount_inr: -100 }]);
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
