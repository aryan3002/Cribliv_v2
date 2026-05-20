import { describe, expect, it } from "vitest";
import { RaError } from "../ra-error";

describe("RaError.fromResponse", () => {
  it("parses backend RENT_AGREEMENT_* error envelope", () => {
    const err = RaError.fromResponse(422, {
      ok: false,
      error: {
        code: "RENT_AGREEMENT_STEP_VALIDATION_FAILED",
        message: "Step 1 validation failed",
        errors: [{ code: "isInt", field: "owner.age", message: "must be an integer" }]
      }
    });
    expect(err.code).toBe("RENT_AGREEMENT_STEP_VALIDATION_FAILED");
    expect(err.httpStatus).toBe(422);
    expect(err.fieldErrors?.[0].field).toBe("owner.age");
  });

  it("falls back to UNKNOWN when envelope shape is missing", () => {
    const err = RaError.fromResponse(500, {});
    expect(err.code).toBe("UNKNOWN");
    expect(err.httpStatus).toBe(500);
  });

  it("is an Error instance (so `throw` + `instanceof Error` works)", () => {
    const err = RaError.fromResponse(404, {
      error: { code: "RENT_AGREEMENT_NOT_FOUND", message: "x" }
    });
    expect(err).toBeInstanceOf(Error);
  });
});
