import { describe, expect, it } from "vitest";

import {
  PAN_REGEX,
  PHONE_REGEX,
  AADHAAR_LAST4_REGEX,
  GSTIN_REGEX,
  isValidPan,
  isValidIndianPhone,
  isValidAadhaarLast4,
  isValidGSTIN
} from "../../validators/india-rules.validator";

describe("india-rules: PAN", () => {
  it("accepts a canonical PAN", () => {
    expect(isValidPan("ABCDE1234F")).toBe(true);
  });

  it("rejects lowercase letters", () => {
    expect(isValidPan("abcde1234f")).toBe(false);
  });

  it("rejects missing trailing letter", () => {
    expect(isValidPan("ABCDE1234")).toBe(false);
  });

  it("rejects 11 chars (extra suffix)", () => {
    expect(isValidPan("ABCDE1234FX")).toBe(false);
  });

  it("rejects non-string inputs", () => {
    expect(isValidPan(null as unknown as string)).toBe(false);
    expect(isValidPan(undefined as unknown as string)).toBe(false);
    expect(isValidPan(123 as unknown as string)).toBe(false);
  });

  it("exports the regex constant matching the canonical pattern", () => {
    expect(PAN_REGEX.source).toContain("[A-Z]{5}");
    expect(PAN_REGEX.source).toContain("[0-9]{4}");
  });
});

describe("india-rules: phone", () => {
  it("accepts +91 followed by 6-9 mobile prefix + 9 digits", () => {
    expect(isValidIndianPhone("+919876543210")).toBe(true);
    expect(isValidIndianPhone("+916123456789")).toBe(true);
    expect(isValidIndianPhone("+917123456789")).toBe(true);
    expect(isValidIndianPhone("+918123456789")).toBe(true);
  });

  it("rejects without +91 prefix", () => {
    expect(isValidIndianPhone("9876543210")).toBe(false);
    expect(isValidIndianPhone("919876543210")).toBe(false);
    expect(isValidIndianPhone("09876543210")).toBe(false);
  });

  it("rejects mobile prefix outside 6-9", () => {
    expect(isValidIndianPhone("+915876543210")).toBe(false);
    expect(isValidIndianPhone("+910123456789")).toBe(false);
    expect(isValidIndianPhone("+911234567890")).toBe(false);
  });

  it("rejects wrong total length", () => {
    expect(isValidIndianPhone("+91987654321")).toBe(false);
    expect(isValidIndianPhone("+9198765432109")).toBe(false);
  });

  it("rejects letters/special chars", () => {
    expect(isValidIndianPhone("+91987-543210")).toBe(false);
    expect(isValidIndianPhone("+919876ABC210")).toBe(false);
  });

  it("rejects non-string inputs", () => {
    expect(isValidIndianPhone(null as unknown as string)).toBe(false);
    expect(isValidIndianPhone(9876543210 as unknown as string)).toBe(false);
  });

  it("exports the regex constant matching the canonical pattern", () => {
    expect(PHONE_REGEX.source).toContain("+91");
    expect(PHONE_REGEX.source).toContain("[6-9]");
  });
});

describe("india-rules: Aadhaar last 4", () => {
  it("accepts exactly 4 digits", () => {
    expect(isValidAadhaarLast4("1234")).toBe(true);
    expect(isValidAadhaarLast4("0000")).toBe(true);
    expect(isValidAadhaarLast4("9999")).toBe(true);
  });

  it("rejects fewer or more digits", () => {
    expect(isValidAadhaarLast4("123")).toBe(false);
    expect(isValidAadhaarLast4("12345")).toBe(false);
    expect(isValidAadhaarLast4("")).toBe(false);
  });

  it("rejects letters or symbols", () => {
    expect(isValidAadhaarLast4("12A4")).toBe(false);
    expect(isValidAadhaarLast4("12 4")).toBe(false);
    expect(isValidAadhaarLast4("12.4")).toBe(false);
  });

  it("rejects non-string inputs", () => {
    expect(isValidAadhaarLast4(null as unknown as string)).toBe(false);
    expect(isValidAadhaarLast4(1234 as unknown as string)).toBe(false);
  });

  it("exports the regex constant", () => {
    expect(AADHAAR_LAST4_REGEX.source).toBe("^\\d{4}$");
  });
});

describe("india-rules: GSTIN", () => {
  it("accepts a canonical GSTIN", () => {
    // 27 = state code; AABCT3518Q = PAN; 1 = entity num; Z = static; 5 = checksum
    expect(isValidGSTIN("27AABCT3518Q1Z5")).toBe(true);
  });

  it("rejects wrong length", () => {
    expect(isValidGSTIN("27AABCT3518Q1Z")).toBe(false);
    expect(isValidGSTIN("27AABCT3518Q1Z55")).toBe(false);
  });

  it("rejects lowercase letters", () => {
    expect(isValidGSTIN("27aabct3518q1z5")).toBe(false);
  });

  it("rejects when state code is not 2 digits", () => {
    expect(isValidGSTIN("2AABCT3518Q1Z51")).toBe(false);
    expect(isValidGSTIN("AAABCT3518Q1Z51")).toBe(false);
  });

  it("rejects when 13th char is not 1-9 or A-Z", () => {
    expect(isValidGSTIN("27AABCT3518Q0Z5")).toBe(false);
  });

  it("rejects when 14th char is not Z", () => {
    expect(isValidGSTIN("27AABCT3518Q1X5")).toBe(false);
  });

  it("rejects non-string inputs", () => {
    expect(isValidGSTIN(null as unknown as string)).toBe(false);
    expect(isValidGSTIN(undefined as unknown as string)).toBe(false);
  });

  it("exports the regex constant", () => {
    expect(GSTIN_REGEX.source).toContain("[0-9]{2}");
    expect(GSTIN_REGEX.source).toContain("Z");
  });
});
