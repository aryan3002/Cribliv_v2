import { describe, expect, it } from "vitest";

import {
  validateCrossField,
  HIGH_RENT_PAN_THRESHOLD_PAISE,
  type CrossFieldRow
} from "../../validators/cross-field.validator";

const baseRow: CrossFieldRow = {
  tenure_months: 11,
  lock_in_months: 6,
  rent_amount_paise: 2_000_000,
  owner_pan: "ABCDE1234F",
  tenant_pan: "ZYXWV9876A",
  acknowledge_registration_required: false,
  furnishing: "unfurnished",
  inventory_items: []
};

describe("cross-field: lock-in vs tenure", () => {
  it("accepts lock_in < tenure", () => {
    const errors = validateCrossField({ ...baseRow, tenure_months: 12, lock_in_months: 6 });
    expect(errors.find((e) => e.code === "lock_in_exceeds_tenure")).toBeUndefined();
  });

  it("accepts lock_in == tenure (boundary)", () => {
    const errors = validateCrossField({ ...baseRow, tenure_months: 11, lock_in_months: 11 });
    expect(errors.find((e) => e.code === "lock_in_exceeds_tenure")).toBeUndefined();
  });

  it("rejects lock_in > tenure with structured error", () => {
    const errors = validateCrossField({ ...baseRow, tenure_months: 11, lock_in_months: 12 });
    const err = errors.find((e) => e.code === "lock_in_exceeds_tenure");
    expect(err).toBeDefined();
    expect(err?.field).toBe("lock_in_months");
    expect(err?.message).toMatch(/lock.?in/i);
  });

  it("skips rule when either field is missing", () => {
    const errors = validateCrossField({ ...baseRow, tenure_months: undefined, lock_in_months: 5 });
    expect(errors.find((e) => e.code === "lock_in_exceeds_tenure")).toBeUndefined();
  });
});

describe("cross-field: high-rent PAN requirement", () => {
  it("does not require PAN at or below threshold", () => {
    const errors = validateCrossField({
      ...baseRow,
      rent_amount_paise: HIGH_RENT_PAN_THRESHOLD_PAISE,
      owner_pan: undefined,
      tenant_pan: undefined
    });
    expect(errors.find((e) => e.code === "owner_pan_required_high_rent")).toBeUndefined();
    expect(errors.find((e) => e.code === "tenant_pan_required_high_rent")).toBeUndefined();
  });

  it("requires both PANs above threshold", () => {
    const errors = validateCrossField({
      ...baseRow,
      rent_amount_paise: HIGH_RENT_PAN_THRESHOLD_PAISE + 1,
      owner_pan: undefined,
      tenant_pan: undefined
    });
    const owner = errors.find((e) => e.code === "owner_pan_required_high_rent");
    const tenant = errors.find((e) => e.code === "tenant_pan_required_high_rent");
    expect(owner).toBeDefined();
    expect(owner?.field).toBe("owner.pan");
    expect(tenant).toBeDefined();
    expect(tenant?.field).toBe("tenant.pan");
  });

  it("requires owner PAN when only tenant PAN present above threshold", () => {
    const errors = validateCrossField({
      ...baseRow,
      rent_amount_paise: 6_000_000,
      owner_pan: undefined,
      tenant_pan: "ZYXWV9876A"
    });
    expect(errors.find((e) => e.code === "owner_pan_required_high_rent")).toBeDefined();
    expect(errors.find((e) => e.code === "tenant_pan_required_high_rent")).toBeUndefined();
  });

  it("accepts both PANs above threshold", () => {
    const errors = validateCrossField({
      ...baseRow,
      rent_amount_paise: 10_000_000,
      owner_pan: "ABCDE1234F",
      tenant_pan: "ZYXWV9876A"
    });
    expect(errors.find((e) => e.code === "owner_pan_required_high_rent")).toBeUndefined();
    expect(errors.find((e) => e.code === "tenant_pan_required_high_rent")).toBeUndefined();
  });

  it("rejects malformed PANs (treats as missing) above threshold", () => {
    const errors = validateCrossField({
      ...baseRow,
      rent_amount_paise: 10_000_000,
      owner_pan: "invalid",
      tenant_pan: "ZYXWV9876A"
    });
    expect(errors.find((e) => e.code === "owner_pan_required_high_rent")).toBeDefined();
  });
});

describe("cross-field: long-tenure registration acknowledgement", () => {
  it("accepts tenure <= 11 without ack", () => {
    const errors = validateCrossField({
      ...baseRow,
      tenure_months: 11,
      acknowledge_registration_required: false
    });
    expect(errors.find((e) => e.code === "registration_ack_required")).toBeUndefined();
  });

  it("rejects tenure > 11 without ack", () => {
    const errors = validateCrossField({
      ...baseRow,
      tenure_months: 12,
      acknowledge_registration_required: false
    });
    const err = errors.find((e) => e.code === "registration_ack_required");
    expect(err).toBeDefined();
    expect(err?.field).toBe("acknowledge_registration_required");
  });

  it("rejects tenure > 11 with undefined ack", () => {
    const errors = validateCrossField({
      ...baseRow,
      tenure_months: 12,
      acknowledge_registration_required: undefined
    });
    expect(errors.find((e) => e.code === "registration_ack_required")).toBeDefined();
  });

  it("accepts tenure > 11 with ack=true", () => {
    const errors = validateCrossField({
      ...baseRow,
      tenure_months: 24,
      acknowledge_registration_required: true
    });
    expect(errors.find((e) => e.code === "registration_ack_required")).toBeUndefined();
  });

  it("skips rule when tenure missing", () => {
    const errors = validateCrossField({ ...baseRow, tenure_months: undefined });
    expect(errors.find((e) => e.code === "registration_ack_required")).toBeUndefined();
  });
});

describe("cross-field: inventory requirement when furnished", () => {
  it("accepts unfurnished with empty inventory", () => {
    const errors = validateCrossField({
      ...baseRow,
      furnishing: "unfurnished",
      inventory_items: []
    });
    expect(errors.find((e) => e.code === "inventory_required_when_furnished")).toBeUndefined();
  });

  it("rejects semi_furnished with empty inventory", () => {
    const errors = validateCrossField({
      ...baseRow,
      furnishing: "semi_furnished",
      inventory_items: []
    });
    const err = errors.find((e) => e.code === "inventory_required_when_furnished");
    expect(err).toBeDefined();
    expect(err?.field).toBe("inventory_items");
  });

  it("rejects fully_furnished with missing inventory_items", () => {
    const errors = validateCrossField({
      ...baseRow,
      furnishing: "fully_furnished",
      inventory_items: undefined
    });
    expect(errors.find((e) => e.code === "inventory_required_when_furnished")).toBeDefined();
  });

  it("accepts fully_furnished with one inventory item", () => {
    const errors = validateCrossField({
      ...baseRow,
      furnishing: "fully_furnished",
      inventory_items: [{ item: "Bed", quantity: 1, condition: "good" }]
    });
    expect(errors.find((e) => e.code === "inventory_required_when_furnished")).toBeUndefined();
  });

  it("skips rule when furnishing missing", () => {
    const errors = validateCrossField({ ...baseRow, furnishing: undefined });
    expect(errors.find((e) => e.code === "inventory_required_when_furnished")).toBeUndefined();
  });
});

describe("cross-field: returns multiple errors when multiple rules fail", () => {
  it("collects every failure independently (no short-circuit)", () => {
    const errors = validateCrossField({
      tenure_months: 12,
      lock_in_months: 24,
      rent_amount_paise: 10_000_000,
      owner_pan: undefined,
      tenant_pan: undefined,
      acknowledge_registration_required: false,
      furnishing: "semi_furnished",
      inventory_items: []
    });
    const codes = errors.map((e) => e.code).sort();
    expect(codes).toEqual([
      "inventory_required_when_furnished",
      "lock_in_exceeds_tenure",
      "owner_pan_required_high_rent",
      "registration_ack_required",
      "tenant_pan_required_high_rent"
    ]);
  });

  it("returns empty array on a fully-valid row", () => {
    const errors = validateCrossField({
      tenure_months: 11,
      lock_in_months: 6,
      rent_amount_paise: 2_000_000,
      owner_pan: undefined,
      tenant_pan: undefined,
      acknowledge_registration_required: false,
      furnishing: "unfurnished",
      inventory_items: []
    });
    expect(errors).toEqual([]);
  });
});

describe("cross-field: HIGH_RENT_PAN_THRESHOLD_PAISE constant", () => {
  it("equals 5,000,000 paise (₹50,000)", () => {
    expect(HIGH_RENT_PAN_THRESHOLD_PAISE).toBe(5_000_000);
  });
});
