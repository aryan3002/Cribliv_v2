import { describe, expect, it } from "vitest";
import { step1Schema } from "../step-1.zod";
import { step3Schema } from "../step-3.zod";
import { step7Schema } from "../step-7.zod";

describe("step1Schema", () => {
  const valid = {
    owner: {
      full_name: "John Doe",
      father_name: "Sam Doe",
      age: 35,
      phone: "+919876543210",
      permanent_address: "123 MG Road, Bangalore"
    },
    tenant: {
      full_name: "Jane Smith",
      father_name: "Bob Smith",
      age: 28,
      phone: "+919876543211",
      permanent_address: "456 Park St, Mumbai"
    }
  };
  it("accepts a complete valid payload", () => {
    expect(step1Schema.safeParse(valid).success).toBe(true);
  });
  it("rejects short full_name", () => {
    const r = step1Schema.safeParse({ ...valid, owner: { ...valid.owner, full_name: "A" } });
    expect(r.success).toBe(false);
  });
  it("rejects age < 18", () => {
    const r = step1Schema.safeParse({ ...valid, tenant: { ...valid.tenant, age: 16 } });
    expect(r.success).toBe(false);
  });
  it("rejects non-E.164-IN phone", () => {
    const r = step1Schema.safeParse({ ...valid, owner: { ...valid.owner, phone: "9876543210" } });
    expect(r.success).toBe(false);
  });
});

describe("step3Schema", () => {
  const valid = {
    agreement_type: "new",
    agreement_date: "2026-05-01",
    commencement_date: "2026-06-01",
    tenure_months: 11,
    lock_in_months: 6,
    notice_period_months: 2,
    rent_amount_paise: 2500000,
    security_deposit_paise: 5000000,
    annual_increment_pct: 5,
    state_code: "KA",
    city: "Bangalore",
    acknowledge_registration_required: false
  };
  it("accepts valid", () => expect(step3Schema.safeParse(valid).success).toBe(true));
  it("rejects tenure > 132", () =>
    expect(step3Schema.safeParse({ ...valid, tenure_months: 200 }).success).toBe(false));
  it("rejects lock_in greater than tenure", () =>
    expect(step3Schema.safeParse({ ...valid, lock_in_months: 12, tenure_months: 11 }).success).toBe(
      false
    ));
  // D6: cross-field rule — tenure > 11 months ⇒ registration must be acknowledged.
  it("rejects tenure > 11 without registration acknowledgement", () =>
    expect(
      step3Schema.safeParse({
        ...valid,
        tenure_months: 12,
        acknowledge_registration_required: false
      }).success
    ).toBe(false));
  it("accepts tenure > 11 when registration acknowledged", () =>
    expect(
      step3Schema.safeParse({
        ...valid,
        tenure_months: 12,
        acknowledge_registration_required: true
      }).success
    ).toBe(true));
});

describe("step7Schema", () => {
  it("requires agree_to_terms=true", () => {
    expect(step7Schema.safeParse({ agree_to_terms: true }).success).toBe(true);
    expect(step7Schema.safeParse({ agree_to_terms: false }).success).toBe(false);
  });
});
