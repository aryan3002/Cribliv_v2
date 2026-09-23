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
