import { describe, it, expect } from "vitest";
import { escapeCsvCell } from "../leads.service";

describe("escapeCsvCell", () => {
  it("returns empty string for null and undefined", () => {
    expect(escapeCsvCell(null)).toBe("");
    expect(escapeCsvCell(undefined)).toBe("");
  });

  it("returns unchanged value for simple strings", () => {
    expect(escapeCsvCell("hello")).toBe("hello");
    expect(escapeCsvCell("123")).toBe("123");
  });

  it("quotes values containing commas", () => {
    expect(escapeCsvCell("hello, world")).toBe('"hello, world"');
  });

  it("quotes values containing quotes and doubles inner quotes", () => {
    expect(escapeCsvCell('Asha, "Tenant"')).toBe('"Asha, ""Tenant"""');
  });

  it("quotes values containing newlines", () => {
    expect(escapeCsvCell("line1\nline2")).toBe('"line1\nline2"');
  });

  it("prefixes formula starting with = and then quotes if needed", () => {
    expect(escapeCsvCell("=SUM(1,2)")).toBe('"\'=SUM(1,2)"');
  });

  it("prefixes formula starting with + and then quotes if needed", () => {
    expect(escapeCsvCell("+1")).toBe("'+1");
  });

  it("prefixes formula starting with - and then quotes if needed", () => {
    expect(escapeCsvCell("-1")).toBe("'-1");
  });

  it("prefixes formula starting with @ and then quotes if needed", () => {
    expect(escapeCsvCell("@SUM")).toBe("'@SUM");
  });

  it("prefixes formula starting with tab and then quotes if needed", () => {
    expect(escapeCsvCell("\tvalue")).toBe("'\tvalue");
  });

  it("prefixes formula starting with CR and then quotes if needed", () => {
    expect(escapeCsvCell("\rvalue")).toBe("'\rvalue");
  });

  it("prefixes formula starting with = even without comma/quote/newline", () => {
    expect(escapeCsvCell("=simple")).toBe("'=simple");
  });

  it("prefixes formula starting with + even without comma/quote/newline", () => {
    expect(escapeCsvCell("+simple")).toBe("'+simple");
  });

  it("prefixes formula starting with - even without comma/quote/newline", () => {
    expect(escapeCsvCell("-simple")).toBe("'-simple");
  });

  it("prefixes formula starting with @ even without comma/quote/newline", () => {
    expect(escapeCsvCell("@simple")).toBe("'@simple");
  });

  it("does not prefix non-formula values starting with letters", () => {
    expect(escapeCsvCell("apple")).toBe("apple");
  });

  it("preserves existing test case: Asha with comma and quotes", () => {
    expect(escapeCsvCell('Asha, "Tenant"')).toBe('"Asha, ""Tenant"""');
  });
});
