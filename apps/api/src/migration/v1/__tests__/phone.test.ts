import { describe, it, expect } from "vitest";
import { normalizeE164 } from "../phone";

describe("normalizeE164", () => {
  it("prefixes a bare 10-digit string", () => {
    expect(normalizeE164("9998887776")).toBe("+919998887776");
  });
  it("keeps an existing +91", () => {
    expect(normalizeE164("+919998887776")).toBe("+919998887776");
  });
  it("strips spaces and leading zeros", () => {
    expect(normalizeE164(" 09998887776 ")).toBe("+919998887776");
  });
  it("accepts a numeric (Excel float artifact)", () => {
    expect(normalizeE164(9998887776)).toBe("+919998887776");
  });
  it("strips a 91 country prefix without +", () => {
    expect(normalizeE164("919998887776")).toBe("+919998887776");
  });
  it("rejects a 9-digit number", () => {
    expect(normalizeE164("904440412")).toBeNull();
  });
  it("rejects empty / null", () => {
    expect(normalizeE164("")).toBeNull();
    expect(normalizeE164(null)).toBeNull();
  });
  it("rejects a 10-digit number not starting with 6-9", () => {
    expect(normalizeE164("1234567890")).toBeNull();
  });
  it("accepts numbers starting with 6/7/8/9", () => {
    expect(normalizeE164("6000000000")).toBe("+916000000000");
    expect(normalizeE164("9998887776")).toBe("+919998887776");
  });
  it("rejects undefined", () => {
    expect(normalizeE164(undefined)).toBeNull();
  });
});
