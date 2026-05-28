import { describe, expect, it } from "vitest";
import { paiseToRupees } from "../../format/money.format";

describe("paiseToRupees", () => {
  it("formats zero as ₹0.00", () => {
    expect(paiseToRupees(0)).toBe("₹0.00");
  });

  it("formats 100 paise as ₹1.00", () => {
    expect(paiseToRupees(100)).toBe("₹1.00");
  });

  it("formats sub-rupee amount 12345 paise as ₹123.45", () => {
    expect(paiseToRupees(12345)).toBe("₹123.45");
  });

  it("formats single paisa as ₹0.01 (preserves two-digit decimal)", () => {
    expect(paiseToRupees(1)).toBe("₹0.01");
  });

  it("preserves two-digit decimal precision for 9 paise as ₹0.09", () => {
    expect(paiseToRupees(9)).toBe("₹0.09");
  });

  it("formats across thousand boundary (100000 paise → ₹1,000.00)", () => {
    expect(paiseToRupees(100000)).toBe("₹1,000.00");
  });

  it("formats across lakh boundary with Indian grouping (10000000 paise → ₹1,00,000.00)", () => {
    expect(paiseToRupees(10000000)).toBe("₹1,00,000.00");
  });

  it("formats ten lakh (100000000 paise → ₹10,00,000.00)", () => {
    expect(paiseToRupees(100000000)).toBe("₹10,00,000.00");
  });

  it("formats across crore boundary with Indian grouping (1000000000 paise → ₹1,00,00,000.00)", () => {
    expect(paiseToRupees(1000000000)).toBe("₹1,00,00,000.00");
  });

  it("formats a mid-range amount with Indian grouping (1234567890 paise → ₹1,23,45,678.90)", () => {
    expect(paiseToRupees(1234567890)).toBe("₹1,23,45,678.90");
  });

  it("places minus sign BEFORE the ₹ symbol for negative amount", () => {
    expect(paiseToRupees(-12345)).toBe("-₹123.45");
  });

  it("formats negative amount across lakh boundary correctly", () => {
    expect(paiseToRupees(-10000000)).toBe("-₹1,00,000.00");
  });

  it("formats Number.MAX_SAFE_INTEGER with Indian grouping", () => {
    // 9007199254740991 paise = 90071992547409 rupees + 91 paise
    // Indian grouping: last 3 = "409", then groups of 2 → 9,00,71,99,25,47,409.91
    expect(paiseToRupees(Number.MAX_SAFE_INTEGER)).toBe("₹9,00,71,99,25,47,409.91");
  });

  it("throws on non-integer paise", () => {
    expect(() => paiseToRupees(123.7)).toThrow("paise must be an integer");
  });

  it("throws on NaN", () => {
    expect(() => paiseToRupees(Number.NaN)).toThrow("paise must be a finite integer");
  });

  it("throws on positive Infinity", () => {
    expect(() => paiseToRupees(Number.POSITIVE_INFINITY)).toThrow("paise must be a finite integer");
  });

  it("throws on negative Infinity", () => {
    expect(() => paiseToRupees(Number.NEGATIVE_INFINITY)).toThrow("paise must be a finite integer");
  });
});
