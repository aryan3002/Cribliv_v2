// Step 7 is a marker; final-agreement.schema runs against cumulative row state
// inside drafts.service.advance(). This DTO only guards the request body shape,
// rejecting unknown smuggled fields and enforcing the optional boolean ack.

import "reflect-metadata";

import { describe, expect, it } from "vitest";
import { validate } from "class-validator";
import { plainToInstance } from "class-transformer";

import { Step7ReviewDto } from "../../validators/step-7-review.dto";

async function validateDto(payload: unknown) {
  const dto = plainToInstance(Step7ReviewDto, payload);
  return validate(dto, { whitelist: true, forbidNonWhitelisted: true });
}

/* ─── Happy path ────────────────────────────────────────────────────────── */

describe("Step7ReviewDto: happy path", () => {
  it("accepts an empty payload", async () => {
    const errors = await validateDto({});
    expect(errors).toEqual([]);
  });

  it("accepts { agree_to_terms: true }", async () => {
    const errors = await validateDto({ agree_to_terms: true });
    expect(errors).toEqual([]);
  });

  it("accepts { agree_to_terms: false }", async () => {
    const errors = await validateDto({ agree_to_terms: false });
    expect(errors).toEqual([]);
  });
});

/* ─── agree_to_terms type rules ─────────────────────────────────────────── */

describe("Step7ReviewDto.agree_to_terms", () => {
  it('rejects a string value (e.g. "yes")', async () => {
    const errors = await validateDto({ agree_to_terms: "yes" });
    const err = errors.find((e) => e.property === "agree_to_terms");
    expect(err).toBeDefined();
    expect(err?.constraints?.isBoolean).toBeDefined();
  });

  it("rejects a numeric value (e.g. 1)", async () => {
    const errors = await validateDto({ agree_to_terms: 1 });
    const err = errors.find((e) => e.property === "agree_to_terms");
    expect(err).toBeDefined();
    expect(err?.constraints?.isBoolean).toBeDefined();
  });

  it("rejects a numeric zero (still non-boolean)", async () => {
    const errors = await validateDto({ agree_to_terms: 0 });
    const err = errors.find((e) => e.property === "agree_to_terms");
    expect(err).toBeDefined();
    expect(err?.constraints?.isBoolean).toBeDefined();
  });

  it("accepts undefined / omitted (covered by @IsOptional)", async () => {
    const errors = await validateDto({ agree_to_terms: undefined });
    expect(errors).toEqual([]);
  });
});

/* ─── forbidNonWhitelisted: clients cannot smuggle field overrides ──────── */

describe("Step7ReviewDto: unknown fields", () => {
  it("rejects an unknown field like rent_amount_paise (forbidNonWhitelisted)", async () => {
    const errors = await validateDto({ rent_amount_paise: 100 });
    const err = errors.find((e) => e.property === "rent_amount_paise");
    expect(err).toBeDefined();
  });

  it("rejects unknown field alongside a valid agree_to_terms", async () => {
    const errors = await validateDto({
      agree_to_terms: true,
      monthly_rent: 50000
    });
    const err = errors.find((e) => e.property === "monthly_rent");
    expect(err).toBeDefined();
  });

  it("rejects multiple unknown fields", async () => {
    const errors = await validateDto({
      owner: { full_name: "X" },
      tenant: { full_name: "Y" }
    });
    expect(errors.find((e) => e.property === "owner")).toBeDefined();
    expect(errors.find((e) => e.property === "tenant")).toBeDefined();
  });
});

/* ─── Module export sanity ──────────────────────────────────────────────── */

describe("Module exports", () => {
  it("exports Step7ReviewDto as a constructor", () => {
    expect(typeof Step7ReviewDto).toBe("function");
  });
});
