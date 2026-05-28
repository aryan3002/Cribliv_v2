import "reflect-metadata";
import { describe, expect, it } from "vitest";

import {
  validateFinalAgreement,
  type FinalAgreementInput,
  type FinalAgreementError
} from "../../validators/final-agreement.schema";

const VALID_PARTY = {
  full_name: "John Doe",
  father_name: "Sam Doe",
  age: 35,
  phone: "+919876543210",
  permanent_address: "123 MG Road, Bangalore, KA 560001"
};

const VALID_TENANT = {
  full_name: "Jane Smith",
  father_name: "Bob Smith",
  age: 28,
  phone: "+919876543211",
  permanent_address: "456 Park St, Mumbai, MH 400001"
};

const VALID_WITNESS_1 = {
  name: "Witness One",
  father_name: "Father One",
  address: "789 Main Road, Bangalore, KA 560002"
};

const VALID_WITNESS_2 = {
  name: "Witness Two",
  father_name: "Father Two",
  address: "101 Cross Road, Bangalore, KA 560003"
};

function buildValidInput(overrides: Partial<FinalAgreementInput> = {}): FinalAgreementInput {
  return {
    plan_id: "standard",
    step1: { owner: { ...VALID_PARTY }, tenant: { ...VALID_TENANT } },
    step2: {
      full_address: "Plot 12, MG Road, Bangalore, Karnataka 560001",
      type: "flat",
      area_sqft: 850,
      furnishing: "unfurnished",
      purpose: "residential"
    },
    step3: {
      agreement_type: "new",
      agreement_date: "2026-05-01",
      commencement_date: "2026-06-01",
      tenure_months: 11,
      lock_in_months: 6,
      notice_period_months: 2,
      rent_amount_paise: 2_500_000,
      security_deposit_paise: 5_000_000,
      annual_increment_pct: 5,
      state_code: "KA",
      city: "Bangalore"
    },
    step4: {
      rent_due_day: 5,
      rent_payment_method: "upi",
      maintenance_included: true,
      electricity_paid_by: "tenant",
      water_paid_by: "tenant",
      gas_paid_by: "tenant",
      society_charges_paid_by: "shared",
      late_payment_penalty_pct: 2.5
    },
    step5: {
      pets_allowed: true,
      subletting_allowed: false,
      renovation_allowed: false,
      commercial_use_allowed: false,
      max_occupants: 4,
      witness_1: { ...VALID_WITNESS_1 },
      witness_2: { ...VALID_WITNESS_2 }
    },
    ...overrides
  };
}

describe("validateFinalAgreement: happy path", () => {
  it("returns no errors when every step is valid (standard plan, no signatures needed)", async () => {
    const errors = await validateFinalAgreement(buildValidInput());
    expect(errors).toEqual([]);
  });

  it("returns no errors for basic plan", async () => {
    const errors = await validateFinalAgreement(buildValidInput({ plan_id: "basic" }));
    expect(errors).toEqual([]);
  });

  it("returns no errors for premium plan when signatures present", async () => {
    const errors = await validateFinalAgreement(
      buildValidInput({
        plan_id: "premium",
        signatures: { owner_present: true, tenant_present: true }
      })
    );
    expect(errors).toEqual([]);
  });
});

describe("validateFinalAgreement: per-step validation failures", () => {
  it("reports step-1 errors with step:1 tag", async () => {
    const input = buildValidInput();
    (input.step1 as { owner: { age: number } }).owner.age = 10;
    const errors = await validateFinalAgreement(input);
    const step1Errors = errors.filter((e: FinalAgreementError) => e.step === 1);
    expect(step1Errors.length).toBeGreaterThan(0);
    expect(step1Errors.find((e) => e.field.includes("age"))).toBeDefined();
  });

  it("reports step-2 errors with step:2 tag", async () => {
    const input = buildValidInput();
    (input.step2 as { type: string }).type = "spaceship";
    const errors = await validateFinalAgreement(input);
    const step2Errors = errors.filter((e: FinalAgreementError) => e.step === 2);
    expect(step2Errors.length).toBeGreaterThan(0);
    expect(step2Errors.find((e) => e.field === "type")).toBeDefined();
  });

  it("reports step-3 errors with step:3 tag", async () => {
    const input = buildValidInput();
    (input.step3 as { rent_amount_paise: number }).rent_amount_paise = 0;
    const errors = await validateFinalAgreement(input);
    const step3Errors = errors.filter((e: FinalAgreementError) => e.step === 3);
    expect(step3Errors.length).toBeGreaterThan(0);
    expect(step3Errors.find((e) => e.field === "rent_amount_paise")).toBeDefined();
  });

  it("reports step-4 errors with step:4 tag", async () => {
    const input = buildValidInput();
    (input.step4 as { rent_due_day: number }).rent_due_day = 99;
    const errors = await validateFinalAgreement(input);
    const step4Errors = errors.filter((e: FinalAgreementError) => e.step === 4);
    expect(step4Errors.length).toBeGreaterThan(0);
  });

  it("reports step-5 errors with step:5 tag", async () => {
    const input = buildValidInput();
    (input.step5 as { max_occupants: number }).max_occupants = 0;
    const errors = await validateFinalAgreement(input);
    const step5Errors = errors.filter((e: FinalAgreementError) => e.step === 5);
    expect(step5Errors.length).toBeGreaterThan(0);
  });

  it("reports missing step as a structural error tagged for that step", async () => {
    const input = buildValidInput();
    (input as Partial<FinalAgreementInput>).step3 = undefined;
    const errors = await validateFinalAgreement(input);
    const step3Errors = errors.filter((e: FinalAgreementError) => e.step === 3);
    expect(step3Errors.length).toBeGreaterThan(0);
    expect(step3Errors[0].code).toBe("step_missing");
  });
});

describe("validateFinalAgreement: cross-field rules", () => {
  it("reports lock_in > tenure", async () => {
    const input = buildValidInput();
    (input.step3 as { lock_in_months: number; tenure_months: number }).lock_in_months = 24;
    (input.step3 as { tenure_months: number }).tenure_months = 12;
    const errors = await validateFinalAgreement(input);
    const cf = errors.filter((e: FinalAgreementError) => e.step === "cross_field");
    expect(cf.find((e) => e.code === "lock_in_exceeds_tenure")).toBeDefined();
  });

  it("reports high-rent PAN missing for both parties", async () => {
    const input = buildValidInput();
    (input.step3 as { rent_amount_paise: number }).rent_amount_paise = 10_000_000;
    const errors = await validateFinalAgreement(input);
    const cf = errors.filter((e: FinalAgreementError) => e.step === "cross_field");
    expect(cf.find((e) => e.code === "owner_pan_required_high_rent")).toBeDefined();
    expect(cf.find((e) => e.code === "tenant_pan_required_high_rent")).toBeDefined();
  });

  it("accepts high-rent when both PANs are present", async () => {
    const input = buildValidInput();
    (input.step1 as { owner: { pan?: string } }).owner.pan = "ABCDE1234F";
    (input.step1 as { tenant: { pan?: string } }).tenant.pan = "ZYXWV9876A";
    (input.step3 as { rent_amount_paise: number }).rent_amount_paise = 10_000_000;
    const errors = await validateFinalAgreement(input);
    expect(errors.filter((e) => e.code.includes("pan_required"))).toEqual([]);
  });

  it("reports tenure > 11 without registration ack", async () => {
    const input = buildValidInput();
    (input.step3 as { tenure_months: number }).tenure_months = 24;
    const errors = await validateFinalAgreement(input);
    const cf = errors.filter((e: FinalAgreementError) => e.step === "cross_field");
    expect(cf.find((e) => e.code === "registration_ack_required")).toBeDefined();
  });

  it("reports furnished without inventory", async () => {
    const input = buildValidInput();
    (input.step2 as { furnishing: string }).furnishing = "semi_furnished";
    const errors = await validateFinalAgreement(input);
    const cf = errors.filter((e: FinalAgreementError) => e.step === "cross_field");
    expect(cf.find((e) => e.code === "inventory_required_when_furnished")).toBeDefined();
  });
});

describe("validateFinalAgreement: premium signature gate (step 6)", () => {
  it("requires signatures for premium plan when none provided", async () => {
    const errors = await validateFinalAgreement(buildValidInput({ plan_id: "premium" }));
    const sig = errors.filter((e: FinalAgreementError) => e.step === 6);
    expect(sig.find((e) => e.code === "owner_signature_required")).toBeDefined();
    expect(sig.find((e) => e.code === "tenant_signature_required")).toBeDefined();
  });

  it("requires signatures for premium plan when only owner present", async () => {
    const errors = await validateFinalAgreement(
      buildValidInput({
        plan_id: "premium",
        signatures: { owner_present: true, tenant_present: false }
      })
    );
    expect(errors.find((e) => e.code === "owner_signature_required")).toBeUndefined();
    expect(errors.find((e) => e.code === "tenant_signature_required")).toBeDefined();
  });

  it("does NOT require signatures for basic plan", async () => {
    const errors = await validateFinalAgreement(buildValidInput({ plan_id: "basic" }));
    expect(errors.find((e) => e.code.includes("signature"))).toBeUndefined();
  });

  it("does NOT require signatures for standard plan", async () => {
    const errors = await validateFinalAgreement(buildValidInput({ plan_id: "standard" }));
    expect(errors.find((e) => e.code.includes("signature"))).toBeUndefined();
  });
});

describe("validateFinalAgreement: multi-error accumulation", () => {
  it("collects errors from multiple sources without short-circuit", async () => {
    const input: FinalAgreementInput = {
      plan_id: "premium",
      step1: {
        owner: { ...VALID_PARTY, age: 10 },
        tenant: { ...VALID_TENANT }
      },
      step2: {
        full_address: "Plot 12, MG Road, Bangalore, Karnataka 560001",
        type: "flat",
        area_sqft: 850,
        furnishing: "semi_furnished",
        purpose: "residential"
      },
      step3: {
        agreement_type: "new",
        agreement_date: "2026-05-01",
        commencement_date: "2026-06-01",
        tenure_months: 12,
        lock_in_months: 24,
        notice_period_months: 2,
        rent_amount_paise: 10_000_000,
        security_deposit_paise: 5_000_000,
        annual_increment_pct: 5,
        state_code: "KA",
        city: "Bangalore"
      },
      step4: {
        rent_due_day: 5,
        rent_payment_method: "upi",
        maintenance_included: true,
        electricity_paid_by: "tenant",
        water_paid_by: "tenant",
        gas_paid_by: "tenant",
        society_charges_paid_by: "shared",
        late_payment_penalty_pct: 2.5
      },
      step5: {
        pets_allowed: true,
        subletting_allowed: false,
        renovation_allowed: false,
        commercial_use_allowed: false,
        max_occupants: 4,
        witness_1: { ...VALID_WITNESS_1 },
        witness_2: { ...VALID_WITNESS_2 }
      }
      // no signatures
    };
    const errors = await validateFinalAgreement(input);
    const stepsTouched = new Set(errors.map((e) => e.step));
    expect(stepsTouched.has(1)).toBe(true);
    expect(stepsTouched.has("cross_field")).toBe(true);
    expect(stepsTouched.has(6)).toBe(true);
    expect(errors.length).toBeGreaterThanOrEqual(5);
  });
});

describe("validateFinalAgreement: shape contract", () => {
  it("every error has step, code, field, message", async () => {
    const errors = await validateFinalAgreement(buildValidInput({ plan_id: "premium" }));
    for (const err of errors) {
      expect(err).toHaveProperty("step");
      expect(err).toHaveProperty("code");
      expect(err).toHaveProperty("field");
      expect(err).toHaveProperty("message");
      expect(typeof err.code).toBe("string");
      expect(typeof err.field).toBe("string");
      expect(typeof err.message).toBe("string");
    }
  });
});
