import { describe, it, expect } from "vitest";
import { validateStep, EMPTY_FORM, type WizardForm } from "../types";

/**
 * These guard the client/server validation contract for the owner listing
 * wizard. The API rejects `POST /owner/listings` with HTTP 400 when the
 * payload violates the DTO (apps/api/.../dto/listing.dto.ts), and the wizard
 * fires that save fire-and-forget on "Next" — so any field the server
 * constrains but the client does not catch surfaces as the silent
 * "Couldn't save your draft right now" banner. `validateStep` must mirror the
 * server contract so bad input is caught at the field instead.
 */

const form = (overrides: Partial<WizardForm>): WizardForm => ({ ...EMPTY_FORM, ...overrides });

describe("validateStep — Location (step 1) pincode", () => {
  it("rejects a pincode that is not exactly 6 digits", () => {
    const errors = validateStep(1, form({ city: "delhi", pincode: "1234" }));
    expect(errors.some((e) => e.field === "pincode")).toBe(true);
  });

  it("rejects a pincode containing non-digit characters", () => {
    const errors = validateStep(1, form({ city: "delhi", pincode: "22600a" }));
    expect(errors.some((e) => e.field === "pincode")).toBe(true);
  });

  it("accepts a valid 6-digit pincode", () => {
    const errors = validateStep(1, form({ city: "delhi", pincode: "226001" }));
    expect(errors.some((e) => e.field === "pincode")).toBe(false);
  });

  it("accepts an empty pincode (optional field)", () => {
    const errors = validateStep(1, form({ city: "delhi", pincode: "" }));
    expect(errors.some((e) => e.field === "pincode")).toBe(false);
  });
});

describe("validateStep — Details (step 2) bathrooms", () => {
  it("rejects 0 bathrooms (server requires >= 1)", () => {
    const errors = validateStep(2, form({ listing_type: "flat_house", bathrooms: "0" }));
    expect(errors.some((e) => e.field === "bathrooms")).toBe(true);
  });

  it("rejects more than 10 bathrooms (server max is 10)", () => {
    const errors = validateStep(2, form({ listing_type: "flat_house", bathrooms: "11" }));
    expect(errors.some((e) => e.field === "bathrooms")).toBe(true);
  });

  it("accepts a valid bathroom count", () => {
    const errors = validateStep(2, form({ listing_type: "flat_house", bathrooms: "2" }));
    expect(errors.some((e) => e.field === "bathrooms")).toBe(false);
  });

  it("accepts an empty bathroom count (optional field)", () => {
    const errors = validateStep(2, form({ listing_type: "flat_house", bathrooms: "" }));
    expect(errors.some((e) => e.field === "bathrooms")).toBe(false);
  });
});
