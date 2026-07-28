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

  it("prefixes formula starting with + without quoting", () => {
    expect(escapeCsvCell("+1")).toBe("'+1");
  });

  it("prefixes formula starting with - without quoting", () => {
    expect(escapeCsvCell("-1")).toBe("'-1");
  });

  it("prefixes formula starting with @ without quoting", () => {
    expect(escapeCsvCell("@SUM")).toBe("'@SUM");
  });

  it("prefixes formula starting with tab without quoting", () => {
    expect(escapeCsvCell("\tvalue")).toBe("'\tvalue");
  });

  it("prefixes formula starting with CR without quoting", () => {
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

  // Anchor regression guards: the leading-trigger-character rule must only match at
  // position 0. Every test above places its trigger character at the start of the
  // string, so a regex with the `^` anchor dropped (matching the trigger anywhere)
  // would still pass all of them. These cases put the trigger character mid-string,
  // where it must be left alone.
  it("does not prefix a hyphen that appears mid-string, not at the start", () => {
    expect(escapeCsvCell("Jean-Luc")).toBe("Jean-Luc");
  });

  it("does not prefix an equals sign that appears mid-string, not at the start", () => {
    expect(escapeCsvCell("a=b")).toBe("a=b");
  });

  it("does not prefix an at-sign that appears mid-string, not at the start", () => {
    expect(escapeCsvCell("R&D @ Home")).toBe("R&D @ Home");
  });

  it("does not prefix a mid-string tab, and a tab alone never triggers quoting either", () => {
    expect(escapeCsvCell("a\tb")).toBe("a\tb");
  });
});
