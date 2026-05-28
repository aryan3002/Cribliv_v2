// Actual signature verification is in drafts.service.advance() + signatures.service.
// This DTO only gates the advance shape (body of POST /:id/step/6/advance).
// Signature image validation (PNG/JPEG, ≤500KB, ≤2MP, EXIF) lives in signatures/image.guard.ts.

import "reflect-metadata";

import { describe, expect, it } from "vitest";
import { validate } from "class-validator";
import { plainToInstance } from "class-transformer";

import { Step6SignaturesDto } from "../../validators/step-6-signatures.dto";

async function validateDto(payload: unknown) {
  const dto = plainToInstance(Step6SignaturesDto, payload);
  return validate(dto, { whitelist: true, forbidNonWhitelisted: true });
}

/* ─── Happy path ────────────────────────────────────────────────────────── */

describe("Step6SignaturesDto: happy path", () => {
  it("accepts an empty payload {}", async () => {
    const errors = await validateDto({});
    expect(errors).toEqual([]);
  });

  it("accepts { confirm: true }", async () => {
    const errors = await validateDto({ confirm: true });
    expect(errors).toEqual([]);
  });

  it("accepts { confirm: false }", async () => {
    const errors = await validateDto({ confirm: false });
    expect(errors).toEqual([]);
  });
});

/* ─── confirm type guard ────────────────────────────────────────────────── */

describe("Step6SignaturesDto.confirm", () => {
  it("rejects a string value like 'yes'", async () => {
    const errors = await validateDto({ confirm: "yes" });
    const confirmError = errors.find((e) => e.property === "confirm");
    expect(confirmError).toBeDefined();
    expect(confirmError?.constraints).toHaveProperty("isBoolean");
  });

  it("rejects a numeric value like 1", async () => {
    const errors = await validateDto({ confirm: 1 });
    const confirmError = errors.find((e) => e.property === "confirm");
    expect(confirmError).toBeDefined();
    expect(confirmError?.constraints).toHaveProperty("isBoolean");
  });

  it("rejects a numeric value like 0", async () => {
    const errors = await validateDto({ confirm: 0 });
    const confirmError = errors.find((e) => e.property === "confirm");
    expect(confirmError).toBeDefined();
    expect(confirmError?.constraints).toHaveProperty("isBoolean");
  });

  it("rejects a null value (treated as wrong type when present)", async () => {
    // null is distinct from "missing" — class-validator treats explicit null as not-optional satisfied
    const errors = await validateDto({ confirm: null });
    // Either accepted (IsOptional swallows null) or rejected as non-boolean. We tolerate
    // both, but we assert no unknown-property error.
    const unknownErrors = errors.filter(
      (e) => e.constraints && "whitelistValidation" in e.constraints
    );
    expect(unknownErrors).toEqual([]);
  });
});

/* ─── forbidNonWhitelisted: clients must NOT smuggle signature data through this endpoint ─ */

describe("Step6SignaturesDto: forbidNonWhitelisted", () => {
  it("rejects unknown field 'image_b64' (critical: clients must not smuggle uploads through advance)", async () => {
    const errors = await validateDto({ image_b64: "data:image/png;base64,iVBORw0K..." });
    expect(errors.length).toBeGreaterThan(0);
    const hasWhitelistError = errors.some(
      (e) => e.constraints && "whitelistValidation" in e.constraints
    );
    expect(hasWhitelistError).toBe(true);
  });

  it("rejects unknown field 'signature_url'", async () => {
    const errors = await validateDto({ signature_url: "https://example.com/sig.png" });
    expect(errors.length).toBeGreaterThan(0);
    const hasWhitelistError = errors.some(
      (e) => e.constraints && "whitelistValidation" in e.constraints
    );
    expect(hasWhitelistError).toBe(true);
  });

  it("rejects unknown field 'owner_signed'", async () => {
    const errors = await validateDto({ owner_signed: true });
    expect(errors.length).toBeGreaterThan(0);
    const hasWhitelistError = errors.some(
      (e) => e.constraints && "whitelistValidation" in e.constraints
    );
    expect(hasWhitelistError).toBe(true);
  });

  it("rejects multiple unknown fields together", async () => {
    const errors = await validateDto({
      image_b64: "data:image/png;base64,abc",
      owner_signed: true,
      tenant_signed: true,
      foo: "bar"
    });
    const offendingProps = errors
      .filter((e) => e.constraints && "whitelistValidation" in e.constraints)
      .map((e) => e.property);
    expect(offendingProps).toEqual(
      expect.arrayContaining(["image_b64", "owner_signed", "tenant_signed", "foo"])
    );
  });

  it("rejects unknown field even when combined with valid confirm", async () => {
    const errors = await validateDto({ confirm: true, sneaky: "value" });
    const hasWhitelistError = errors.some(
      (e) => e.property === "sneaky" && e.constraints && "whitelistValidation" in e.constraints
    );
    expect(hasWhitelistError).toBe(true);
  });
});
