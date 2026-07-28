import { describe, expect, it } from "vitest";
import { previewNormalizedIndianPhone } from "../format";

/**
 * Mirrors apps/api/src/modules/admin/__tests__/phone.util.test.ts's own
 * cases 1:1 — previewNormalizedIndianPhone is a deliberate, documented
 * duplicate of the API's normalizeIndianPhone (2026-07-28 review, Finding 5),
 * kept in sync by hand rather than a shared import. Running the same case
 * list against both copies is the cheapest available guard against the two
 * silently drifting apart.
 */
describe("previewNormalizedIndianPhone", () => {
  it("accepts an already-normalised number and formats it for display", () => {
    expect(previewNormalizedIndianPhone("+919876543210")).toBe("+91 98765 43210");
  });

  it("strips spaces and hyphens", () => {
    expect(previewNormalizedIndianPhone("+91 98765 43210")).toBe("+91 98765 43210");
    expect(previewNormalizedIndianPhone("98765-43210")).toBe("+91 98765 43210");
  });

  it("adds +91 to a bare ten-digit number", () => {
    expect(previewNormalizedIndianPhone("9876543210")).toBe("+91 98765 43210");
  });

  it("drops a leading zero", () => {
    expect(previewNormalizedIndianPhone("09876543210")).toBe("+91 98765 43210");
  });

  it("handles a 91 prefix without the plus", () => {
    expect(previewNormalizedIndianPhone("919876543210")).toBe("+91 98765 43210");
  });

  it("returns null for too few or too many digits — no preview, not an error message", () => {
    expect(previewNormalizedIndianPhone("987654321")).toBeNull();
    expect(previewNormalizedIndianPhone("98765432105")).toBeNull();
  });

  it("returns null for non-numeric junk, empty input, and mid-typing partial input", () => {
    expect(previewNormalizedIndianPhone("not a phone")).toBeNull();
    expect(previewNormalizedIndianPhone("")).toBeNull();
    expect(previewNormalizedIndianPhone("987")).toBeNull();
  });

  it("returns null for a non-Indian country code", () => {
    expect(previewNormalizedIndianPhone("+14155552671")).toBeNull();
  });

  it("returns null for a 10-digit number that does not start 6-9", () => {
    expect(previewNormalizedIndianPhone("1234567890")).toBeNull();
    expect(previewNormalizedIndianPhone("5000000000")).toBeNull();
  });

  it("accepts each valid leading digit", () => {
    for (const lead of ["6", "7", "8", "9"]) {
      expect(previewNormalizedIndianPhone(`${lead}876543210`)).toBe(`+91 ${lead}8765 43210`);
    }
  });
});
