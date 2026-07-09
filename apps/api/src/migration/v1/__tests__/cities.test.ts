import { describe, it, expect } from "vitest";
import { normalizeCitySlug } from "../cities";

describe("normalizeCitySlug", () => {
  it("maps known cities", () => {
    expect(normalizeCitySlug("Gurugram")).toBe("gurugram");
    expect(normalizeCitySlug("Lucknow")).toBe("lucknow");
    expect(normalizeCitySlug("Varanasi")).toBe("varanasi");
  });
  it("trims the trailing-space Lucknow variant", () => {
    expect(normalizeCitySlug("Lucknow ")).toBe("lucknow");
  });
  it("is case-insensitive", () => {
    expect(normalizeCitySlug("GURUGRAM")).toBe("gurugram");
  });
  it("returns null for an unknown city", () => {
    expect(normalizeCitySlug("Atlantis")).toBeNull();
  });
});
