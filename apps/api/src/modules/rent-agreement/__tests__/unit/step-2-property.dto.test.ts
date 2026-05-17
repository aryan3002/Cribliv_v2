import "reflect-metadata";

import { describe, expect, it } from "vitest";
import { validate } from "class-validator";
import { plainToInstance } from "class-transformer";

import { Step2PropertyDto } from "../../validators/step-2-property.dto";

async function validateDto(payload: unknown) {
  const dto = plainToInstance(Step2PropertyDto, payload);
  return validate(dto, { whitelist: true, forbidNonWhitelisted: true });
}

const VALID = {
  full_address: "Plot 12, MG Road, Bangalore, Karnataka 560001",
  type: "flat",
  area_sqft: 850,
  furnishing: "semi_furnished",
  purpose: "residential"
} as const;

function hasErrorOn(errors: { property: string }[], field: string): boolean {
  return errors.some((e) => e.property === field);
}

describe("Step2PropertyDto: baseline", () => {
  it("accepts a minimal valid payload (only required fields)", async () => {
    const errors = await validateDto({ ...VALID });
    expect(errors).toEqual([]);
  });

  it("accepts a payload with every optional field present", async () => {
    const errors = await validateDto({
      ...VALID,
      parking: "both",
      floor_number: 3,
      total_floors: 10,
      flat_number: "A-201",
      municipal_number: "MUN/2024/001",
      survey_number: "SY-42/3B"
    });
    expect(errors).toEqual([]);
  });
});

describe("Step2PropertyDto: full_address (length 20..1000)", () => {
  it("rejects strings shorter than 20", async () => {
    const errors = await validateDto({ ...VALID, full_address: "x".repeat(19) });
    expect(hasErrorOn(errors, "full_address")).toBe(true);
  });

  it("accepts exactly 20 chars (lower boundary)", async () => {
    const errors = await validateDto({ ...VALID, full_address: "x".repeat(20) });
    expect(hasErrorOn(errors, "full_address")).toBe(false);
  });

  it("accepts exactly 1000 chars (upper boundary)", async () => {
    const errors = await validateDto({ ...VALID, full_address: "x".repeat(1000) });
    expect(hasErrorOn(errors, "full_address")).toBe(false);
  });

  it("rejects strings longer than 1000", async () => {
    const errors = await validateDto({ ...VALID, full_address: "x".repeat(1001) });
    expect(hasErrorOn(errors, "full_address")).toBe(true);
  });

  it("rejects non-string full_address", async () => {
    const errors = await validateDto({ ...VALID, full_address: 12345 });
    expect(hasErrorOn(errors, "full_address")).toBe(true);
  });
});

describe("Step2PropertyDto: type (6-value enum)", () => {
  const valid = ["flat", "house", "villa", "pg_room", "shop", "office"] as const;

  for (const value of valid) {
    it(`accepts type='${value}'`, async () => {
      const errors = await validateDto({ ...VALID, type: value });
      expect(hasErrorOn(errors, "type")).toBe(false);
    });
  }

  it("rejects an unknown type value", async () => {
    const errors = await validateDto({ ...VALID, type: "mansion" });
    expect(hasErrorOn(errors, "type")).toBe(true);
  });

  it("rejects a non-string type", async () => {
    const errors = await validateDto({ ...VALID, type: 7 });
    expect(hasErrorOn(errors, "type")).toBe(true);
  });
});

describe("Step2PropertyDto: area_sqft (>0)", () => {
  it("rejects 0", async () => {
    const errors = await validateDto({ ...VALID, area_sqft: 0 });
    expect(hasErrorOn(errors, "area_sqft")).toBe(true);
  });

  it("accepts 0.01 (smallest positive)", async () => {
    const errors = await validateDto({ ...VALID, area_sqft: 0.01 });
    expect(hasErrorOn(errors, "area_sqft")).toBe(false);
  });

  it("accepts a large value (100000)", async () => {
    const errors = await validateDto({ ...VALID, area_sqft: 100_000 });
    expect(hasErrorOn(errors, "area_sqft")).toBe(false);
  });

  it("rejects a negative value", async () => {
    const errors = await validateDto({ ...VALID, area_sqft: -1 });
    expect(hasErrorOn(errors, "area_sqft")).toBe(true);
  });

  it("rejects a non-number value", async () => {
    const errors = await validateDto({ ...VALID, area_sqft: "850" });
    expect(hasErrorOn(errors, "area_sqft")).toBe(true);
  });
});

describe("Step2PropertyDto: furnishing (3-value enum)", () => {
  const valid = ["unfurnished", "semi_furnished", "fully_furnished"] as const;

  for (const value of valid) {
    it(`accepts furnishing='${value}'`, async () => {
      const errors = await validateDto({ ...VALID, furnishing: value });
      expect(hasErrorOn(errors, "furnishing")).toBe(false);
    });
  }

  it("rejects an unknown furnishing value", async () => {
    const errors = await validateDto({ ...VALID, furnishing: "partially" });
    expect(hasErrorOn(errors, "furnishing")).toBe(true);
  });
});

describe("Step2PropertyDto: purpose (3-value enum)", () => {
  const valid = ["residential", "commercial", "mixed"] as const;

  for (const value of valid) {
    it(`accepts purpose='${value}'`, async () => {
      const errors = await validateDto({ ...VALID, purpose: value });
      expect(hasErrorOn(errors, "purpose")).toBe(false);
    });
  }

  it("rejects an unknown purpose value", async () => {
    const errors = await validateDto({ ...VALID, purpose: "industrial" });
    expect(hasErrorOn(errors, "purpose")).toBe(true);
  });
});

describe("Step2PropertyDto: parking (optional 4-value enum)", () => {
  it("accepts payload with parking omitted", async () => {
    const errors = await validateDto({ ...VALID });
    expect(hasErrorOn(errors, "parking")).toBe(false);
  });

  const valid = ["none", "two_wheeler", "four_wheeler", "both"] as const;

  for (const value of valid) {
    it(`accepts parking='${value}'`, async () => {
      const errors = await validateDto({ ...VALID, parking: value });
      expect(hasErrorOn(errors, "parking")).toBe(false);
    });
  }

  it("rejects an unknown parking value", async () => {
    const errors = await validateDto({ ...VALID, parking: "helipad" });
    expect(hasErrorOn(errors, "parking")).toBe(true);
  });
});

describe("Step2PropertyDto: floor_number (optional, integer)", () => {
  it("accepts payload with floor_number omitted", async () => {
    const errors = await validateDto({ ...VALID });
    expect(hasErrorOn(errors, "floor_number")).toBe(false);
  });

  it("accepts integer floor_number (e.g. 0, 1, 42)", async () => {
    for (const v of [0, 1, 42]) {
      const errors = await validateDto({ ...VALID, floor_number: v });
      expect(hasErrorOn(errors, "floor_number")).toBe(false);
    }
  });

  it("rejects a float floor_number (1.5)", async () => {
    const errors = await validateDto({ ...VALID, floor_number: 1.5 });
    expect(hasErrorOn(errors, "floor_number")).toBe(true);
  });
});

describe("Step2PropertyDto: total_floors (optional, integer >= 1)", () => {
  it("accepts payload with total_floors omitted", async () => {
    const errors = await validateDto({ ...VALID });
    expect(hasErrorOn(errors, "total_floors")).toBe(false);
  });

  it("accepts total_floors = 1 (boundary)", async () => {
    const errors = await validateDto({ ...VALID, total_floors: 1 });
    expect(hasErrorOn(errors, "total_floors")).toBe(false);
  });

  it("accepts total_floors = 50", async () => {
    const errors = await validateDto({ ...VALID, total_floors: 50 });
    expect(hasErrorOn(errors, "total_floors")).toBe(false);
  });

  it("rejects total_floors = 0", async () => {
    const errors = await validateDto({ ...VALID, total_floors: 0 });
    expect(hasErrorOn(errors, "total_floors")).toBe(true);
  });

  it("rejects a float total_floors (2.5)", async () => {
    const errors = await validateDto({ ...VALID, total_floors: 2.5 });
    expect(hasErrorOn(errors, "total_floors")).toBe(true);
  });
});

describe("Step2PropertyDto: flat_number (optional, MaxLength 50)", () => {
  it("accepts payload with flat_number omitted", async () => {
    const errors = await validateDto({ ...VALID });
    expect(hasErrorOn(errors, "flat_number")).toBe(false);
  });

  it("accepts flat_number with exactly 50 chars (boundary)", async () => {
    const errors = await validateDto({ ...VALID, flat_number: "x".repeat(50) });
    expect(hasErrorOn(errors, "flat_number")).toBe(false);
  });

  it("rejects flat_number longer than 50 chars", async () => {
    const errors = await validateDto({ ...VALID, flat_number: "x".repeat(51) });
    expect(hasErrorOn(errors, "flat_number")).toBe(true);
  });

  it("rejects a non-string flat_number", async () => {
    const errors = await validateDto({ ...VALID, flat_number: 201 });
    expect(hasErrorOn(errors, "flat_number")).toBe(true);
  });
});

describe("Step2PropertyDto: municipal_number (optional, MaxLength 100)", () => {
  it("accepts payload with municipal_number omitted", async () => {
    const errors = await validateDto({ ...VALID });
    expect(hasErrorOn(errors, "municipal_number")).toBe(false);
  });

  it("accepts municipal_number with exactly 100 chars (boundary)", async () => {
    const errors = await validateDto({ ...VALID, municipal_number: "x".repeat(100) });
    expect(hasErrorOn(errors, "municipal_number")).toBe(false);
  });

  it("rejects municipal_number longer than 100 chars", async () => {
    const errors = await validateDto({ ...VALID, municipal_number: "x".repeat(101) });
    expect(hasErrorOn(errors, "municipal_number")).toBe(true);
  });

  it("rejects a non-string municipal_number", async () => {
    const errors = await validateDto({ ...VALID, municipal_number: 42 });
    expect(hasErrorOn(errors, "municipal_number")).toBe(true);
  });
});

describe("Step2PropertyDto: survey_number (optional, MaxLength 100)", () => {
  it("accepts payload with survey_number omitted", async () => {
    const errors = await validateDto({ ...VALID });
    expect(hasErrorOn(errors, "survey_number")).toBe(false);
  });

  it("accepts survey_number with exactly 100 chars (boundary)", async () => {
    const errors = await validateDto({ ...VALID, survey_number: "x".repeat(100) });
    expect(hasErrorOn(errors, "survey_number")).toBe(false);
  });

  it("rejects survey_number longer than 100 chars", async () => {
    const errors = await validateDto({ ...VALID, survey_number: "x".repeat(101) });
    expect(hasErrorOn(errors, "survey_number")).toBe(true);
  });

  it("rejects a non-string survey_number", async () => {
    const errors = await validateDto({ ...VALID, survey_number: 42 });
    expect(hasErrorOn(errors, "survey_number")).toBe(true);
  });
});

describe("Step2PropertyDto: top-level required/unknown rules", () => {
  it("flags missing required full_address", async () => {
    const { full_address, ...rest } = VALID;
    void full_address;
    const errors = await validateDto(rest);
    expect(hasErrorOn(errors, "full_address")).toBe(true);
  });

  it("flags missing required type", async () => {
    const { type, ...rest } = VALID;
    void type;
    const errors = await validateDto(rest);
    expect(hasErrorOn(errors, "type")).toBe(true);
  });

  it("flags missing required area_sqft", async () => {
    const { area_sqft, ...rest } = VALID;
    void area_sqft;
    const errors = await validateDto(rest);
    expect(hasErrorOn(errors, "area_sqft")).toBe(true);
  });

  it("flags missing required furnishing", async () => {
    const { furnishing, ...rest } = VALID;
    void furnishing;
    const errors = await validateDto(rest);
    expect(hasErrorOn(errors, "furnishing")).toBe(true);
  });

  it("flags missing required purpose", async () => {
    const { purpose, ...rest } = VALID;
    void purpose;
    const errors = await validateDto(rest);
    expect(hasErrorOn(errors, "purpose")).toBe(true);
  });

  it("rejects an extra unknown field (forbidNonWhitelisted)", async () => {
    const errors = await validateDto({ ...VALID, unexpected_field: "boom" });
    expect(hasErrorOn(errors, "unexpected_field")).toBe(true);
  });
});
