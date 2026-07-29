import { describe, expect, it } from "vitest";
import { normalizeIndianPhone } from "../phone.util";

describe("normalizeIndianPhone", () => {
  it("accepts an already-normalised number unchanged", () => {
    expect(normalizeIndianPhone("+919876543210")).toBe("+919876543210");
  });

  it("strips spaces and hyphens", () => {
    expect(normalizeIndianPhone("+91 98765 43210")).toBe("+919876543210");
    expect(normalizeIndianPhone("98765-43210")).toBe("+919876543210");
  });

  it("adds +91 to a bare ten-digit number", () => {
    expect(normalizeIndianPhone("9876543210")).toBe("+919876543210");
  });

  it("drops a leading zero", () => {
    expect(normalizeIndianPhone("09876543210")).toBe("+919876543210");
  });

  it("handles a 91 prefix without the plus", () => {
    expect(normalizeIndianPhone("919876543210")).toBe("+919876543210");
  });

  it("rejects too few or too many digits", () => {
    expect(normalizeIndianPhone("987654321")).toBeNull();
    expect(normalizeIndianPhone("98765432105")).toBeNull();
  });

  it("rejects non-numeric junk and empty input", () => {
    expect(normalizeIndianPhone("not a phone")).toBeNull();
    expect(normalizeIndianPhone("")).toBeNull();
  });

  it("rejects a non-Indian country code", () => {
    expect(normalizeIndianPhone("+14155552671")).toBeNull();
  });

  it("rejects a 10-digit number that does not start 6-9", () => {
    expect(normalizeIndianPhone("1234567890")).toBeNull();
    expect(normalizeIndianPhone("5000000000")).toBeNull();
    expect(normalizeIndianPhone("+911234567890")).toBeNull();
    expect(normalizeIndianPhone("910123456789")).toBeNull();
  });

  it("accepts each valid leading digit", () => {
    for (const lead of ["6", "7", "8", "9"]) {
      expect(normalizeIndianPhone(`${lead}876543210`)).toBe(`+91${lead}876543210`);
    }
  });
});
