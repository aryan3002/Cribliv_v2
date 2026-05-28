import "reflect-metadata";
import { describe, expect, it } from "vitest";
import { validate, type ValidationError } from "class-validator";
import { plainToInstance } from "class-transformer";

import { Step3TermsDto } from "../../validators/step-3-terms.dto";

async function validateDto(payload: unknown): Promise<ValidationError[]> {
  const dto = plainToInstance(Step3TermsDto, payload);
  return validate(dto, { whitelist: true, forbidNonWhitelisted: true });
}

function hasErrorOn(errors: ValidationError[], property: string): boolean {
  return errors.some((e) => e.property === property);
}

const VALID = {
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
};

describe("Step3TermsDto: valid baseline", () => {
  it("accepts a fully valid payload", async () => {
    const errors = await validateDto({ ...VALID });
    expect(errors).toEqual([]);
  });

  it("accepts the optional acknowledge_registration_required when omitted", async () => {
    const { ...payload } = VALID;
    const errors = await validateDto(payload);
    expect(errors).toEqual([]);
  });
});

describe("Step3TermsDto.agreement_type", () => {
  it("accepts 'new'", async () => {
    const errors = await validateDto({ ...VALID, agreement_type: "new" });
    expect(hasErrorOn(errors, "agreement_type")).toBe(false);
  });

  it("accepts 'renewal'", async () => {
    const errors = await validateDto({ ...VALID, agreement_type: "renewal" });
    expect(hasErrorOn(errors, "agreement_type")).toBe(false);
  });

  it("rejects uppercased 'NEW'", async () => {
    const errors = await validateDto({ ...VALID, agreement_type: "NEW" });
    expect(hasErrorOn(errors, "agreement_type")).toBe(true);
  });

  it("rejects 'lease'", async () => {
    const errors = await validateDto({ ...VALID, agreement_type: "lease" });
    expect(hasErrorOn(errors, "agreement_type")).toBe(true);
  });

  it("rejects missing agreement_type", async () => {
    const { agreement_type: _omit, ...rest } = VALID;
    const errors = await validateDto(rest);
    expect(hasErrorOn(errors, "agreement_type")).toBe(true);
  });
});

describe("Step3TermsDto.agreement_date", () => {
  it("accepts a valid past ISO date", async () => {
    const errors = await validateDto({ ...VALID, agreement_date: "2020-01-15" });
    expect(hasErrorOn(errors, "agreement_date")).toBe(false);
  });

  it("accepts today's date", async () => {
    const today = new Date().toISOString().slice(0, 10);
    const errors = await validateDto({ ...VALID, agreement_date: today });
    expect(hasErrorOn(errors, "agreement_date")).toBe(false);
  });

  it("rejects a future date", async () => {
    const future = new Date();
    future.setFullYear(future.getFullYear() + 5);
    const futureIso = future.toISOString().slice(0, 10);
    const errors = await validateDto({ ...VALID, agreement_date: futureIso });
    expect(hasErrorOn(errors, "agreement_date")).toBe(true);
  });

  it("rejects a non-ISO string", async () => {
    const errors = await validateDto({ ...VALID, agreement_date: "01/05/2026" });
    expect(hasErrorOn(errors, "agreement_date")).toBe(true);
  });

  it("rejects when missing", async () => {
    const { agreement_date: _omit, ...rest } = VALID;
    const errors = await validateDto(rest);
    expect(hasErrorOn(errors, "agreement_date")).toBe(true);
  });
});

describe("Step3TermsDto.commencement_date", () => {
  it("accepts a valid ISO date", async () => {
    const errors = await validateDto({ ...VALID, commencement_date: "2027-01-01" });
    expect(hasErrorOn(errors, "commencement_date")).toBe(false);
  });

  it("rejects a non-ISO string", async () => {
    const errors = await validateDto({ ...VALID, commencement_date: "tomorrow" });
    expect(hasErrorOn(errors, "commencement_date")).toBe(true);
  });

  it("rejects when missing", async () => {
    const { commencement_date: _omit, ...rest } = VALID;
    const errors = await validateDto(rest);
    expect(hasErrorOn(errors, "commencement_date")).toBe(true);
  });
});

describe("Step3TermsDto.tenure_months", () => {
  it("accepts boundary 1", async () => {
    const errors = await validateDto({ ...VALID, tenure_months: 1 });
    expect(hasErrorOn(errors, "tenure_months")).toBe(false);
  });

  it("accepts boundary 132", async () => {
    const errors = await validateDto({ ...VALID, tenure_months: 132 });
    expect(hasErrorOn(errors, "tenure_months")).toBe(false);
  });

  it("rejects 0", async () => {
    const errors = await validateDto({ ...VALID, tenure_months: 0 });
    expect(hasErrorOn(errors, "tenure_months")).toBe(true);
  });

  it("rejects 133 (above max)", async () => {
    const errors = await validateDto({ ...VALID, tenure_months: 133 });
    expect(hasErrorOn(errors, "tenure_months")).toBe(true);
  });

  it("rejects a float", async () => {
    const errors = await validateDto({ ...VALID, tenure_months: 11.5 });
    expect(hasErrorOn(errors, "tenure_months")).toBe(true);
  });
});

describe("Step3TermsDto.lock_in_months", () => {
  it("accepts 0", async () => {
    const errors = await validateDto({ ...VALID, lock_in_months: 0 });
    expect(hasErrorOn(errors, "lock_in_months")).toBe(false);
  });

  it("accepts a large value (cross-field validates upper bound vs tenure)", async () => {
    const errors = await validateDto({ ...VALID, lock_in_months: 999 });
    expect(hasErrorOn(errors, "lock_in_months")).toBe(false);
  });

  it("rejects a negative value", async () => {
    const errors = await validateDto({ ...VALID, lock_in_months: -1 });
    expect(hasErrorOn(errors, "lock_in_months")).toBe(true);
  });

  it("rejects a float", async () => {
    const errors = await validateDto({ ...VALID, lock_in_months: 3.5 });
    expect(hasErrorOn(errors, "lock_in_months")).toBe(true);
  });
});

describe("Step3TermsDto.notice_period_months", () => {
  it("accepts boundary 1", async () => {
    const errors = await validateDto({ ...VALID, notice_period_months: 1 });
    expect(hasErrorOn(errors, "notice_period_months")).toBe(false);
  });

  it("accepts boundary 6", async () => {
    const errors = await validateDto({ ...VALID, notice_period_months: 6 });
    expect(hasErrorOn(errors, "notice_period_months")).toBe(false);
  });

  it("rejects 0", async () => {
    const errors = await validateDto({ ...VALID, notice_period_months: 0 });
    expect(hasErrorOn(errors, "notice_period_months")).toBe(true);
  });

  it("rejects 7 (above max)", async () => {
    const errors = await validateDto({ ...VALID, notice_period_months: 7 });
    expect(hasErrorOn(errors, "notice_period_months")).toBe(true);
  });
});

describe("Step3TermsDto.rent_amount_paise", () => {
  it("accepts boundary 1", async () => {
    const errors = await validateDto({ ...VALID, rent_amount_paise: 1 });
    expect(hasErrorOn(errors, "rent_amount_paise")).toBe(false);
  });

  it("rejects 0", async () => {
    const errors = await validateDto({ ...VALID, rent_amount_paise: 0 });
    expect(hasErrorOn(errors, "rent_amount_paise")).toBe(true);
  });

  it("rejects a negative value", async () => {
    const errors = await validateDto({ ...VALID, rent_amount_paise: -100 });
    expect(hasErrorOn(errors, "rent_amount_paise")).toBe(true);
  });

  it("rejects a float", async () => {
    const errors = await validateDto({ ...VALID, rent_amount_paise: 100.5 });
    expect(hasErrorOn(errors, "rent_amount_paise")).toBe(true);
  });
});

describe("Step3TermsDto.security_deposit_paise", () => {
  it("accepts boundary 0", async () => {
    const errors = await validateDto({ ...VALID, security_deposit_paise: 0 });
    expect(hasErrorOn(errors, "security_deposit_paise")).toBe(false);
  });

  it("rejects a negative value", async () => {
    const errors = await validateDto({ ...VALID, security_deposit_paise: -1 });
    expect(hasErrorOn(errors, "security_deposit_paise")).toBe(true);
  });
});

describe("Step3TermsDto.annual_increment_pct", () => {
  it("accepts boundary 0", async () => {
    const errors = await validateDto({ ...VALID, annual_increment_pct: 0 });
    expect(hasErrorOn(errors, "annual_increment_pct")).toBe(false);
  });

  it("accepts boundary 100", async () => {
    const errors = await validateDto({ ...VALID, annual_increment_pct: 100 });
    expect(hasErrorOn(errors, "annual_increment_pct")).toBe(false);
  });

  it("rejects -0.1 (below min)", async () => {
    const errors = await validateDto({ ...VALID, annual_increment_pct: -0.1 });
    expect(hasErrorOn(errors, "annual_increment_pct")).toBe(true);
  });

  it("rejects 100.1 (above max)", async () => {
    const errors = await validateDto({ ...VALID, annual_increment_pct: 100.1 });
    expect(hasErrorOn(errors, "annual_increment_pct")).toBe(true);
  });
});

describe("Step3TermsDto.state_code", () => {
  it("accepts 'KA' (length 2 boundary)", async () => {
    const errors = await validateDto({ ...VALID, state_code: "KA" });
    expect(hasErrorOn(errors, "state_code")).toBe(false);
  });

  it("rejects 'K' (too short)", async () => {
    const errors = await validateDto({ ...VALID, state_code: "K" });
    expect(hasErrorOn(errors, "state_code")).toBe(true);
  });

  it("rejects 'KAR' (too long)", async () => {
    const errors = await validateDto({ ...VALID, state_code: "KAR" });
    expect(hasErrorOn(errors, "state_code")).toBe(true);
  });

  it("rejects lowercase 'ka' (uppercase enforced)", async () => {
    const errors = await validateDto({ ...VALID, state_code: "ka" });
    expect(hasErrorOn(errors, "state_code")).toBe(true);
  });
});

describe("Step3TermsDto.city", () => {
  it("accepts a 2-char boundary value", async () => {
    const errors = await validateDto({ ...VALID, city: "Ax" });
    expect(hasErrorOn(errors, "city")).toBe(false);
  });

  it("accepts a 120-char boundary value", async () => {
    const errors = await validateDto({ ...VALID, city: "A".repeat(120) });
    expect(hasErrorOn(errors, "city")).toBe(false);
  });

  it("rejects a 1-char value (below min)", async () => {
    const errors = await validateDto({ ...VALID, city: "A" });
    expect(hasErrorOn(errors, "city")).toBe(true);
  });

  it("rejects a 121-char value (above max)", async () => {
    const errors = await validateDto({ ...VALID, city: "A".repeat(121) });
    expect(hasErrorOn(errors, "city")).toBe(true);
  });
});

describe("Step3TermsDto.acknowledge_registration_required", () => {
  it("accepts when omitted", async () => {
    const errors = await validateDto({ ...VALID });
    expect(hasErrorOn(errors, "acknowledge_registration_required")).toBe(false);
  });

  it("accepts true", async () => {
    const errors = await validateDto({ ...VALID, acknowledge_registration_required: true });
    expect(hasErrorOn(errors, "acknowledge_registration_required")).toBe(false);
  });

  it("accepts false", async () => {
    const errors = await validateDto({ ...VALID, acknowledge_registration_required: false });
    expect(hasErrorOn(errors, "acknowledge_registration_required")).toBe(false);
  });

  it("rejects a string value", async () => {
    const errors = await validateDto({
      ...VALID,
      acknowledge_registration_required: "yes"
    });
    expect(hasErrorOn(errors, "acknowledge_registration_required")).toBe(true);
  });
});

describe("Step3TermsDto: whitelist enforcement", () => {
  it("rejects an unknown top-level field via forbidNonWhitelisted", async () => {
    const errors = await validateDto({ ...VALID, unexpected_field: "boom" });
    expect(hasErrorOn(errors, "unexpected_field")).toBe(true);
  });

  it("produces multiple errors when several required fields are missing", async () => {
    const errors = await validateDto({});
    expect(errors.length).toBeGreaterThan(1);
    expect(hasErrorOn(errors, "agreement_type")).toBe(true);
    expect(hasErrorOn(errors, "tenure_months")).toBe(true);
  });
});
