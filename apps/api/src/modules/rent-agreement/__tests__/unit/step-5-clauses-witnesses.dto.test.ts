import "reflect-metadata";

import { describe, expect, it } from "vitest";
import { validate } from "class-validator";
import { plainToInstance } from "class-transformer";

import {
  Step5ClausesWitnessesDto,
  WitnessDto
} from "../../validators/step-5-clauses-witnesses.dto";

async function validateDto(payload: unknown) {
  const dto = plainToInstance(Step5ClausesWitnessesDto, payload);
  const errors = await validate(dto, {
    whitelist: true,
    forbidNonWhitelisted: true
  });
  return { dto, errors };
}

const VALID_WITNESS = {
  name: "Witness One",
  father_name: "Father One",
  address: "Address line, City, State 560001"
};

const VALID = {
  pets_allowed: true,
  subletting_allowed: false,
  renovation_allowed: false,
  commercial_use_allowed: false,
  max_occupants: 4,
  witness_1: VALID_WITNESS,
  witness_2: { ...VALID_WITNESS, name: "Witness Two" }
};

function findError(errors: Awaited<ReturnType<typeof validate>>, property: string) {
  return errors.find((e) => e.property === property);
}

function findNestedError(
  errors: Awaited<ReturnType<typeof validate>>,
  parent: string,
  child: string
) {
  const parentErr = errors.find((e) => e.property === parent);
  return parentErr?.children?.find((e) => e.property === child);
}

describe("Step5ClausesWitnessesDto: exports", () => {
  it("exports Step5ClausesWitnessesDto and WitnessDto", () => {
    expect(Step5ClausesWitnessesDto).toBeDefined();
    expect(WitnessDto).toBeDefined();
  });
});

describe("Step5ClausesWitnessesDto: happy path", () => {
  it("accepts the minimal valid payload (no additional_terms, no phones)", async () => {
    const { errors } = await validateDto(VALID);
    expect(errors).toEqual([]);
  });

  it("accepts a fully-populated valid payload", async () => {
    const { errors } = await validateDto({
      ...VALID,
      pets_allowed: false,
      subletting_allowed: true,
      renovation_allowed: true,
      commercial_use_allowed: true,
      max_occupants: 10,
      additional_terms: ["Quiet hours after 10pm", "No smoking indoors"],
      witness_1: { ...VALID_WITNESS, phone: "+919876543210" },
      witness_2: { ...VALID_WITNESS, name: "Witness Two", phone: "+918123456789" }
    });
    expect(errors).toEqual([]);
  });
});

describe("Step5ClausesWitnessesDto: boolean flags", () => {
  const flags = [
    "pets_allowed",
    "subletting_allowed",
    "renovation_allowed",
    "commercial_use_allowed"
  ] as const;

  for (const flag of flags) {
    it(`${flag}: accepts true`, async () => {
      const { errors } = await validateDto({ ...VALID, [flag]: true });
      expect(findError(errors, flag)).toBeUndefined();
    });

    it(`${flag}: accepts false`, async () => {
      const { errors } = await validateDto({ ...VALID, [flag]: false });
      expect(findError(errors, flag)).toBeUndefined();
    });

    it(`${flag}: rejects non-boolean (string)`, async () => {
      const { errors } = await validateDto({ ...VALID, [flag]: "yes" });
      expect(findError(errors, flag)).toBeDefined();
    });

    it(`${flag}: rejects non-boolean (number)`, async () => {
      const { errors } = await validateDto({ ...VALID, [flag]: 1 });
      expect(findError(errors, flag)).toBeDefined();
    });

    it(`${flag}: rejects missing`, async () => {
      const payload = { ...VALID };
      delete (payload as Record<string, unknown>)[flag];
      const { errors } = await validateDto(payload);
      expect(findError(errors, flag)).toBeDefined();
    });
  }
});

describe("Step5ClausesWitnessesDto: max_occupants", () => {
  it("accepts 1 (lower boundary)", async () => {
    const { errors } = await validateDto({ ...VALID, max_occupants: 1 });
    expect(findError(errors, "max_occupants")).toBeUndefined();
  });

  it("accepts 50 (upper boundary)", async () => {
    const { errors } = await validateDto({ ...VALID, max_occupants: 50 });
    expect(findError(errors, "max_occupants")).toBeUndefined();
  });

  it("rejects 0 (below min)", async () => {
    const { errors } = await validateDto({ ...VALID, max_occupants: 0 });
    expect(findError(errors, "max_occupants")).toBeDefined();
  });

  it("rejects 51 (above max)", async () => {
    const { errors } = await validateDto({ ...VALID, max_occupants: 51 });
    expect(findError(errors, "max_occupants")).toBeDefined();
  });

  it("rejects floats", async () => {
    const { errors } = await validateDto({ ...VALID, max_occupants: 3.5 });
    expect(findError(errors, "max_occupants")).toBeDefined();
  });

  it("rejects missing", async () => {
    const payload = { ...VALID };
    delete (payload as Record<string, unknown>).max_occupants;
    const { errors } = await validateDto(payload);
    expect(findError(errors, "max_occupants")).toBeDefined();
  });

  it("rejects non-number (string)", async () => {
    const { errors } = await validateDto({ ...VALID, max_occupants: "4" });
    expect(findError(errors, "max_occupants")).toBeDefined();
  });
});

describe("Step5ClausesWitnessesDto: additional_terms", () => {
  it("accepts when omitted", async () => {
    const { errors } = await validateDto(VALID);
    expect(findError(errors, "additional_terms")).toBeUndefined();
  });

  it("accepts an empty array", async () => {
    const { errors } = await validateDto({ ...VALID, additional_terms: [] });
    expect(findError(errors, "additional_terms")).toBeUndefined();
  });

  it("accepts exactly 10 strings (upper boundary)", async () => {
    const arr = Array.from({ length: 10 }, (_, i) => `Term ${i + 1}`);
    const { errors } = await validateDto({ ...VALID, additional_terms: arr });
    expect(findError(errors, "additional_terms")).toBeUndefined();
  });

  it("rejects 11 strings (over boundary)", async () => {
    const arr = Array.from({ length: 11 }, (_, i) => `Term ${i + 1}`);
    const { errors } = await validateDto({ ...VALID, additional_terms: arr });
    expect(findError(errors, "additional_terms")).toBeDefined();
  });

  it("rejects a single string > 500 chars", async () => {
    const tooLong = "a".repeat(501);
    const { errors } = await validateDto({ ...VALID, additional_terms: [tooLong] });
    expect(findError(errors, "additional_terms")).toBeDefined();
  });

  it("accepts a single string of exactly 500 chars", async () => {
    const ok = "a".repeat(500);
    const { errors } = await validateDto({ ...VALID, additional_terms: [ok] });
    expect(findError(errors, "additional_terms")).toBeUndefined();
  });

  it("rejects non-array", async () => {
    const { errors } = await validateDto({ ...VALID, additional_terms: "single string" });
    expect(findError(errors, "additional_terms")).toBeDefined();
  });

  it("rejects non-string array elements", async () => {
    const { errors } = await validateDto({ ...VALID, additional_terms: [123, true] });
    expect(findError(errors, "additional_terms")).toBeDefined();
  });

  it("sanitizes HTML tags out of each element", async () => {
    const { dto } = await validateDto({
      ...VALID,
      additional_terms: ["<script>alert('x')</script>Quiet hours"]
    });
    expect(dto.additional_terms).toEqual(["alert('x')Quiet hours"]);
  });

  it("sanitizes control characters out of each element", async () => {
    const { dto } = await validateDto({
      ...VALID,
      additional_terms: ["Hello\x00World\x1F!\x7F", "Line\rOther"]
    });
    expect(dto.additional_terms).toEqual(["HelloWorld!", "LineOther"]);
  });

  it("trims whitespace around each sanitized element", async () => {
    const { dto } = await validateDto({
      ...VALID,
      additional_terms: ["  spaced  "]
    });
    expect(dto.additional_terms).toEqual(["spaced"]);
  });

  it("leaves the array untouched when not provided", async () => {
    const { dto } = await validateDto(VALID);
    expect(dto.additional_terms).toBeUndefined();
  });

  it("leaves non-string elements untouched in the transform (validator rejects them)", async () => {
    const { dto, errors } = await validateDto({
      ...VALID,
      additional_terms: [123 as unknown as string]
    });
    // Non-strings pass through the sanitizer unchanged, but @IsString({each:true}) rejects them.
    expect(dto.additional_terms).toEqual([123]);
    expect(findError(errors, "additional_terms")).toBeDefined();
  });
});

describe("Step5ClausesWitnessesDto: witness_1 (nested)", () => {
  it("rejects when witness_1 is missing", async () => {
    const payload = { ...VALID };
    delete (payload as Record<string, unknown>).witness_1;
    const { errors } = await validateDto(payload);
    expect(findError(errors, "witness_1")).toBeDefined();
  });

  it("propagates child error when witness_1.name is missing", async () => {
    const { errors } = await validateDto({
      ...VALID,
      witness_1: { father_name: "Father", address: "Address line, City, State 560001" }
    });
    expect(findNestedError(errors, "witness_1", "name")).toBeDefined();
  });

  it("propagates child error when witness_1.father_name is too short", async () => {
    const { errors } = await validateDto({
      ...VALID,
      witness_1: { ...VALID_WITNESS, father_name: "A" }
    });
    expect(findNestedError(errors, "witness_1", "father_name")).toBeDefined();
  });

  it("propagates child error when witness_1.address is < 10 chars", async () => {
    const { errors } = await validateDto({
      ...VALID,
      witness_1: { ...VALID_WITNESS, address: "Short" }
    });
    expect(findNestedError(errors, "witness_1", "address")).toBeDefined();
  });

  it("phone is optional on witness_1", async () => {
    const { errors } = await validateDto(VALID);
    expect(findNestedError(errors, "witness_1", "phone")).toBeUndefined();
  });

  it("accepts a valid Indian phone on witness_1", async () => {
    const { errors } = await validateDto({
      ...VALID,
      witness_1: { ...VALID_WITNESS, phone: "+919876543210" }
    });
    expect(findNestedError(errors, "witness_1", "phone")).toBeUndefined();
  });

  it("rejects a malformed phone on witness_1 (no +91)", async () => {
    const { errors } = await validateDto({
      ...VALID,
      witness_1: { ...VALID_WITNESS, phone: "9876543210" }
    });
    expect(findNestedError(errors, "witness_1", "phone")).toBeDefined();
  });

  it("rejects a phone outside the 6-9 mobile-prefix range on witness_1", async () => {
    const { errors } = await validateDto({
      ...VALID,
      witness_1: { ...VALID_WITNESS, phone: "+915876543210" }
    });
    expect(findNestedError(errors, "witness_1", "phone")).toBeDefined();
  });
});

describe("Step5ClausesWitnessesDto: witness_2 (nested)", () => {
  it("rejects when witness_2 is missing", async () => {
    const payload = { ...VALID };
    delete (payload as Record<string, unknown>).witness_2;
    const { errors } = await validateDto(payload);
    expect(findError(errors, "witness_2")).toBeDefined();
  });

  it("propagates child error when witness_2.address is missing", async () => {
    const { errors } = await validateDto({
      ...VALID,
      witness_2: { name: "Witness Two", father_name: "Father Two" }
    });
    expect(findNestedError(errors, "witness_2", "address")).toBeDefined();
  });

  it("rejects when witness_2.name is too long (>200)", async () => {
    const { errors } = await validateDto({
      ...VALID,
      witness_2: { ...VALID_WITNESS, name: "x".repeat(201) }
    });
    expect(findNestedError(errors, "witness_2", "name")).toBeDefined();
  });

  it("rejects when witness_2.address is too long (>500)", async () => {
    const { errors } = await validateDto({
      ...VALID,
      witness_2: { ...VALID_WITNESS, address: "x".repeat(501) }
    });
    expect(findNestedError(errors, "witness_2", "address")).toBeDefined();
  });

  it("accepts witness_2 with a valid phone", async () => {
    const { errors } = await validateDto({
      ...VALID,
      witness_2: { ...VALID_WITNESS, name: "Witness Two", phone: "+918123456789" }
    });
    expect(findNestedError(errors, "witness_2", "phone")).toBeUndefined();
  });
});

describe("Step5ClausesWitnessesDto: whitelist / forbidNonWhitelisted", () => {
  it("rejects an unknown top-level field", async () => {
    const { errors } = await validateDto({ ...VALID, sneaky_field: "nope" });
    expect(findError(errors, "sneaky_field")).toBeDefined();
  });

  it("rejects an unknown field inside a witness", async () => {
    const { errors } = await validateDto({
      ...VALID,
      witness_1: { ...VALID_WITNESS, extra: "nope" }
    });
    expect(findNestedError(errors, "witness_1", "extra")).toBeDefined();
  });
});
